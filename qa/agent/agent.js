// AI-driven test execution: the LLM (Gemini by default) drives Playwright.
//
// For each manual test case the agent loop is:
//   observe  -> the harness captures the page (screenshot + list of controls + visible text, recent messages and API
//               responses) and gives it to the model together with the test case, the application guide, the test
//               data list, the database schema and everything the model has done so far;
//   decide   -> the model chooses the next actions (which incident to use, which controls to click, what to type,
//               which resolution steps to enter, which SQL checks to run) and explains why;
//   act      -> Playwright performs exactly those actions in Chrome and takes a screenshot;
//   ...repeat until the model gives a verdict: pass, fail (with root cause and draft defect) or inconclusive
//   (routed to a person).
// Playwright never decides anything: it is the model's hands. The model never touches the database directly:
// its only write path is the application UI (like a tester), and its SQL access is read-only.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const llm = require("../llm");
const dbtool = require("../dbtool");

const ROOT = path.join(__dirname, "..", "..");
const GUIDE = fs.readFileSync(path.join(__dirname, "app-guide.md"), "utf8");
const MAX_TURNS = Number(process.env.AGENT_MAX_TURNS || 24);
const MAX_ACTIONS = 6;

const SYSTEM = `You are an autonomous QA test engineer. You test EIM 360, an incident-management web application, by driving a real
Chrome browser through Playwright. You decide everything: which test data to use, every click and every value you type
(including realistic resolution steps that fit the incident's failure and job log), and how to verify the result.
Playwright only executes the actions you return.

How to work:
- Follow the intent of the manual test case. If the UI wording differs slightly from the test case but the intent is
  clearly achievable, carry on and mention it in "observations"; that alone is not a failure.
- Prefer few turns: you may return up to ${MAX_ACTIONS} actions per turn when you already know the refs of the controls.
  Refs come from the current page snapshot and stay valid for the whole turn, even if the page re-renders. Controls that
  do not exist yet (for example a step row you are about to add) only get a ref in the next snapshot.
- Verify the expected result with evidence: what the page shows after the action AND, when the case is about saving,
  persistence, counters, versions or synchronisation, what the database actually stored (read-only SQL). Check the
  state before and after when the case is about a change (for example a counter).
- Write values through the UI only. The database is read-only for you.
- Never invent evidence. If you cannot complete the case or the evidence is contradictory, say so.

Verdicts:
- "pass": every expected result was observed.
- "fail": the application did not meet the expected result. Classify the failure as "Product defect",
  "Test script maintenance" (the test case itself is out of date) or "Environment / test data".
- "inconclusive": you could not reach a reliable verdict (blocked, ambiguous evidence, missing data). A person decides.

Reply with ONE JSON object:
{"thought": "<your reasoning about the current state, 1-3 sentences>",
 "step": "<short imperative title for what this turn does, as a tester would log it>",
 "actions": [ ...one or more actions... ]}

Actions:
 {"type":"click","ref":"e12"}
 {"type":"fill","ref":"e7","text":"..."}                 (replaces the field's value)
 {"type":"select","ref":"e3","option":"<visible option text>"}
 {"type":"check","ref":"e9"}                             (radio buttons and checkboxes)
 {"type":"press","key":"Enter"}
 {"type":"navigate","route":"#/incidents/edit/INC0012345"}
 {"type":"reload"}
 {"type":"role","role":"SWAT"|"SME"|"Manager"|"Admin"}  (switch the signed-in role, reloads the page)
 {"type":"query","sql":"SELECT ...","why":"..."}         (read-only SQL; the result comes back next turn)
 {"type":"finish", ...verdict fields...}                 (must be the only action in its turn)

finish fields:
 {"type":"finish","verdict":"pass"|"fail"|"inconclusive","confidence":0.0-1.0,
  "summary":"<2-3 sentences: what you did and what you found>",
  "testData":"<which incident you used and why>",
  "resolutionSteps":["<the resolution steps you entered, if any>"], "resolutionRationale":"<why these steps>",
  "expected":"<expected result>", "actual":"<what actually happened>",
  "evidence":["<each piece of evidence: UI text, toast, SQL result>"],
  "observations":["<anything noteworthy that is not a failure, e.g. label differs from the test case>"],
  and when verdict is "fail" also:
  "classification":"Product defect"|"Test script maintenance"|"Environment / test data",
  "rootCause":"<2-3 sentences>", "component":"<screen, API or table most likely responsible>",
  "narrative":"<2-3 sentences for a test lead>", "nextSteps":["3-5 concrete actions"],
  "defectTitle":"<one line>", "severity":"High"|"Medium"|"Low", "dbFindings":"<what the data showed>",
  "reproSteps":["<numbered steps a developer can follow>"]}`;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const clip = (s, n) => { s = String(s ?? ""); return s.length > n ? s.slice(0, n) + "…" : s; };

// ---------------------------------------------------------------- page observation
async function snapshot(page) {
  return page.evaluate(() => {
    const visible = e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
    document.querySelectorAll("[data-ai-ref]").forEach(e => e.removeAttribute("data-ai-ref"));
    const labelOf = e => {
      if (e.getAttribute("aria-label")) return e.getAttribute("aria-label");
      if (e.id) { const l = document.querySelector(`label[for="${e.id}"]`); if (l) return l.innerText; }
      const wrap = e.closest("label"); if (wrap) return wrap.innerText;
      return e.getAttribute("placeholder") || e.innerText || e.getAttribute("name") || e.getAttribute("title") || "";
    };
    const section = e => { const box = e.closest("[data-testid^='review-'], .ai-box, section.acc, .field"); const h = box && box.querySelector(".ai-head, .acc-head, label"); return h ? h.innerText.split("\n")[0].trim().slice(0, 40) : ""; };
    const out = []; let n = 0;
    for (const e of document.querySelectorAll("button, a[href], input, select, textarea, [role=tab]")) {
      const radio = e.type === "radio" || e.type === "checkbox";
      if (!(visible(e) || (radio && e.closest("label") && visible(e.closest("label"))))) continue;
      if (e.type === "hidden") continue;
      if (e.closest("nav, aside, .sidebar, #sidebar")) continue; // app menu: routes are listed in the guide
      const ref = "e" + (++n); e.setAttribute("data-ai-ref", ref);
      const tag = e.tagName.toLowerCase();
      const o = { ref, kind: tag === "a" ? "link" : tag === "input" ? (e.type || "text") : tag, label: labelOf(e).trim().replace(/\s+/g, " ").slice(0, 70) };
      const sec = section(e); if (sec && sec !== o.label) o.in = sec;
      if (e.dataset.testid) o.testid = e.dataset.testid;
      if (tag === "a") o.href = e.getAttribute("href");
      if (tag === "input" || tag === "textarea") { if (!radio) o.value = e.value.slice(0, 300); else o.checked = e.checked; if (e.name && radio) o.group = e.name; }
      if (tag === "select") { o.value = e.options[e.selectedIndex] ? e.options[e.selectedIndex].text : ""; o.options = [...e.options].map(x => x.text).slice(0, 25); }
      if (e.disabled) o.disabled = true;
      // stable selector so a ref still works after the page re-renders within the same turn
      const tid = e.dataset.testid;
      o.sel = tid && document.querySelectorAll(`[data-testid="${CSS.escape(tid)}"]`).length === 1 ? `[data-testid="${CSS.escape(tid)}"]` : e.id && document.querySelectorAll("#" + CSS.escape(e.id)).length === 1 ? "#" + CSS.escape(e.id) : `[data-ai-ref="${ref}"]`;
      out.push(o);
      if (n >= 160) break;
    }
    const view = document.querySelector("#view") || document.body;
    const errs = [...document.querySelectorAll("[data-err]")].filter(x => x.innerText.trim()).map(x => `${x.dataset.err}: ${x.innerText.trim()}`);
    return { url: location.hash || location.pathname, title: (document.querySelector("#view h1") || {}).innerText || document.title,
      role: localStorage.getItem("eim.role") || "", elements: out, text: view.innerText.replace(/\n{3,}/g, "\n\n").slice(0, 6000), fieldErrors: errs };
  });
}

function describeElements(els) {
  return els.map(e => {
    const bits = [`[${e.ref}] ${e.kind}`, JSON.stringify(e.label)];
    if (e.in) bits.push(`in "${e.in}"`);
    if (e.testid) bits.push(`testid=${e.testid}`);
    if (e.href) bits.push(`href=${e.href}`);
    if (e.group) bits.push(`group=${e.group}`);
    if (e.checked !== undefined) bits.push(e.checked ? "checked" : "unchecked");
    if (e.value !== undefined && e.value !== "") bits.push(`value=${JSON.stringify(e.value)}`);
    if (e.options) bits.push(`options=${JSON.stringify(e.options)}`);
    if (e.disabled) bits.push("DISABLED");
    return bits.join(" ");
  }).join("\n");
}

// ---------------------------------------------------------------- main loop
async function runCase({ page, app, step, testInfo, caseDef }) {
  const cfg = llm.config();
  if (!cfg.ready) throw new Error(`AI agent needs an LLM: ${cfg.reason}. Set LLM_PROVIDER and its key in .env.`);
  const t0 = Date.now();
  const runId = process.env.QA_RUN_ID || "adhoc";
  const port = new URL(app.url).port;
  const dbFile = process.env.AGENT_DB_FILE || path.join(os.tmpdir(), `eim360-${port}.sqlite`);

  // capture what a tester would see in passing: toasts and API responses
  const toasts = [], api = [], inflight = new Set();
  await page.addInitScript(() => {
    window.__aiToasts = [];
    new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => {
      if (n.nodeType !== 1) return;
      const t = n.matches && n.matches('[data-testid="toast"]') ? n : n.querySelector && n.querySelector('[data-testid="toast"]');
      if (t) window.__aiToasts.push(t.innerText.trim());
    }))).observe(document.documentElement, { childList: true, subtree: true });
  });
  page.on("request", r => { if (r.url().includes("/api/")) inflight.add(r); });
  const done = r => inflight.delete(r);
  page.on("requestfailed", done);
  page.on("response", async res => {
    const r = res.request(); done(r);
    const u = new URL(res.url());
    if (!u.pathname.startsWith("/api/") || u.pathname.startsWith("/api/qa") || u.pathname.startsWith("/api/test")) return;
    const e = { method: r.method(), path: u.pathname + u.search, status: res.status() };
    if (r.method() !== "GET" || res.status() >= 400) { try { e.body = clip(await res.text(), 300); } catch {} }
    if (r.method() !== "GET") { try { e.sent = clip(r.postData(), 600); } catch {} }
    api.push(e);
  });
  const settle = async () => { const end = Date.now() + 6000; await sleep(120); while (inflight.size && Date.now() < end) await sleep(60); await sleep(150); };

  // start where a tester starts: the incident list, signed in as the case's role
  const role = /^(SWAT|SME|Manager|Admin)$/.test(caseDef.role || "") ? caseDef.role : "SWAT";
  await step(`AI agent starts: open EIM 360 as ${role}`, async () => { await app.open("#/incidents", role); await settle(); });

  const candidates = (await app.api("/api/test/candidates")).json || [];
  const testData = candidates.map(c => `${c.number}: status ${c.status}, interface ${c.interfaceCode}, ${c.hasPrediction ? `AI prediction (category ${c.category})` : "NO AI prediction"}, ${c.hasRec ? "KB recipe exists for interface+category" : "NO KB recipe for interface+category"}${c.workedBy ? `, worked by ${c.workedBy}` : ""}`).join("\n");
  let schemaTxt = "";
  { const ro = dbtool.openReadOnly(dbFile); if (ro) { schemaTxt = dbtool.schema(ro); ro.close(); } }

  const history = [], audit = [], queries = [], turnsLog = [];
  let usage = { input: 0, output: 0, cached: 0 }, cost = 0, costKnown = true, llmMs = 0, calls = 0, actionsRun = 0, final = null, lastShot = null;
  let pendingQueryResults = [];

  for (let turn = 1; turn <= MAX_TURNS && !final; turn++) {
    const obs = await snapshot(page);
    const newToasts = await page.evaluate(() => { const t = window.__aiToasts || []; window.__aiToasts = []; return t; }).catch(() => []);
    toasts.push(...newToasts);
    const newApi = api.splice(0);
    const shot = await page.screenshot({ type: "jpeg", quality: 60 }).catch(() => null);
    lastShot = shot;
    const remaining = MAX_TURNS - turn;
    const prompt = [
      // static parts first (identical across turns and cases) so the provider's prompt cache can reuse them
      `APPLICATION GUIDE:\n${GUIDE}`,
      ``,
      `TEST DATA (open incidents after the reset):\n${testData}`,
      ``,
      `TEST CASE ${caseDef.caseId}${caseDef.clientRef ? ` (client ref ${caseDef.clientRef}, ${caseDef.suite})` : ""}: ${caseDef.title}`,
      `Role: ${caseDef.role || "SWAT"}. Priority: ${caseDef.priority || "-"}.${caseDef.preconditions ? ` Preconditions: ${caseDef.preconditions}` : ""}`,
      `Manual steps:\n${(caseDef.steps || []).map((s, k) => `  ${k + 1}. ${s}`).join("\n")}`,
      `Expected result: ${caseDef.expected}`,
      ``,
      `DATABASE SCHEMA (read-only access via the "query" action; at most 25 rows are returned):\n${schemaTxt}`,
      ``,
      history.length ? `WHAT YOU HAVE DONE SO FAR:\n${history.join("\n")}` : `WHAT YOU HAVE DONE SO FAR: nothing yet.`,
      pendingQueryResults.length ? `\nRESULTS OF YOUR SQL QUERIES FROM THE LAST TURN:\n${pendingQueryResults.join("\n")}` : "",
      ``,
      `CURRENT PAGE (turn ${turn}; ${remaining} turn${remaining === 1 ? "" : "s"} left after this one${remaining <= 2 ? " - finish now if you have enough evidence" : ""}):`,
      `URL: ${obs.url} · Role: ${obs.role} · Heading: ${obs.title}`,
      newToasts.length ? `Messages shown since the last turn: ${newToasts.map(t => JSON.stringify(t)).join(", ")}` : `Messages shown since the last turn: none`,
      obs.fieldErrors.length ? `Field validation messages on the page: ${obs.fieldErrors.join(" | ")}` : "",
      newApi.length ? `API calls the page made since the last turn:\n${newApi.map(a => `  ${a.method} ${a.path} -> ${a.status}${a.sent ? ` sent ${a.sent}` : ""}${a.body ? ` response ${a.body}` : ""}`).join("\n")}` : "",
      `Controls (use the ref to act on one):\n${describeElements(obs.elements)}`,
      `Visible text of the page:\n${obs.text}`,
      shot ? `The attached image is a screenshot of the current viewport.` : "",
    ].filter(x => x !== "").join("\n");
    pendingQueryResults = [];

    let r;
    try { r = await llm.complete({ system: SYSTEM, prompt, images: shot ? [{ mime: "image/jpeg", base64: shot.toString("base64") }] : [], maxTokens: 3000 }); }
    catch (err) { final = { verdict: "inconclusive", error: true, summary: `The AI agent stopped: the model call failed (${clip(err.message, 200)}).`, confidence: 0 }; break; }
    calls++; usage.input += r.usage.input; usage.output += r.usage.output; usage.cached += r.usage.cached || 0; llmMs += r.latencyMs; if (r.costUsd == null) costKnown = false; else cost += r.costUsd;
    const j = r.json || {};
    const acts = (Array.isArray(j.actions) ? j.actions : j.type ? [j] : []).slice(0, MAX_ACTIONS);
    const rec = { turn, thought: clip(j.thought, 600), step: clip(j.step || "Continue the test", 140), actions: [], ms: r.latencyMs, tokens: r.usage.input + r.usage.output,
      screenshotSha256: shot ? crypto.createHash("sha256").update(shot).digest("hex") : null };
    audit.push({ turn, prompt, response: r.text, usage: r.usage, latencyMs: r.latencyMs });

    const fin = acts.find(a => String(a.type).toLowerCase() === "finish");
    if (fin) { final = fin; rec.actions.push({ type: "finish", verdict: fin.verdict }); history.push(`Turn ${turn}: ${rec.step} -> finished`); turnsLog.push(rec); break; }
    if (!acts.length) { history.push(`Turn ${turn}: you returned no valid action. Return at least one action.`); turnsLog.push(rec); continue; }

    const uiActs = acts.filter(a => String(a.type).toLowerCase() !== "query");
    const qActs = acts.filter(a => String(a.type).toLowerCase() === "query");
    const results = [];
    const exec = async () => {
      for (const a of uiActs) {
        const type = String(a.type || "").toLowerCase();
        const res = { type, ref: a.ref, value: a.text ?? a.option ?? a.route ?? a.key ?? a.role };
        const target = a.ref ? (obs.elements.find(e => e.ref === a.ref) || {}) : {};
        const loc = a.ref ? page.locator(target.sel || `[data-ai-ref="${String(a.ref).replace(/"/g, "")}"]`) : null;
        res.target = target.label ? `${target.kind} "${target.label}"${target.testid ? ` (${target.testid})` : ""}` : a.ref || "";
        try {
          if (["click", "fill", "select", "check"].includes(type) && !(await loc.count())) throw new Error(`ref ${a.ref} is not on the current page (refs change every turn)`);
          if (type === "click") await loc.click({ timeout: 5000 });
          else if (type === "fill") await loc.fill(String(a.text ?? ""), { timeout: 5000 });
          else if (type === "select") { try { await loc.selectOption({ label: String(a.option) }, { timeout: 5000 }); } catch { await loc.selectOption(String(a.option), { timeout: 5000 }); } }
          else if (type === "check") await loc.check({ timeout: 5000 });
          else if (type === "press") await page.keyboard.press(String(a.key || "Enter"));
          else if (type === "navigate") { const route = String(a.route || ""); if (!/^#\/[\w\-/?=&.%]*$/.test(route)) throw new Error("only in-app routes like #/incidents are allowed"); await page.goto(app.url + "/" + route); await page.locator("#view h1").waitFor({ timeout: 8000 }); }
          else if (type === "reload") { await page.reload(); await page.locator("#view h1").waitFor({ timeout: 8000 }); }
          else if (type === "role") { const ro = String(a.role); if (!/^(SWAT|SME|Manager|Admin)$/.test(ro)) throw new Error("unknown role"); await page.evaluate(x => localStorage.setItem("eim.role", x), ro); await page.reload(); await page.locator("#view h1").waitFor({ timeout: 8000 }); }
          else throw new Error(`unknown action type "${a.type}"`);
          res.ok = true; actionsRun++;
        } catch (err) { res.ok = false; res.error = clip(String(err.message).split("\n")[0], 200); }
        await settle();
        results.push(res);
        if (!res.ok) break; // the page may not be what the model expected; let it look again
      }
    };
    if (uiActs.length) await step(`AI: ${rec.step}`, exec);
    for (const q of qActs) {
      const ro = dbtool.openReadOnly(dbFile);
      const out = ro ? dbtool.query(ro, q.sql) : { error: "database not available" };
      try { ro && ro.close(); } catch {}
      queries.push({ turn, sql: String(q.sql || ""), why: String(q.why || ""), rowCount: out.rowCount ?? null, error: out.error || null, sample: (out.rows || []).slice(0, 8) });
      pendingQueryResults.push(`SQL: ${q.sql}\n  -> ${out.error ? "ERROR " + out.error : `${out.rowCount} row(s): ${clip(JSON.stringify(out.rows), 2500)}`}`);
      results.push({ type: "query", value: clip(q.sql, 300), why: q.why, ok: !out.error, rows: out.rowCount ?? null, error: out.error || undefined });
    }
    if (!uiActs.length && qActs.length) await step(`AI database check: ${clip(qActs.map(q => q.why || q.sql).join("; "), 120)}`, async () => {}, { screenshot: false });
    rec.actions = results;
    turnsLog.push(rec);
    history.push(`Turn ${turn}: ${rec.step}\n  thought: ${rec.thought}\n  ${results.map(x => `${x.type}${x.target ? ` ${x.target}` : ""}${x.value != null && x.type !== "query" ? ` = ${JSON.stringify(clip(x.value, 120))}` : x.type === "query" ? ` ${JSON.stringify(x.value)}` : ""} -> ${x.ok ? "ok" : "FAILED: " + x.error}`).join("\n  ")}`);
  }

  if (!final) final = { verdict: "inconclusive", summary: `The AI agent used all ${MAX_TURNS} turns without reaching a verdict.`, confidence: 0 };
  const verdict = ["pass", "fail", "inconclusive"].includes(String(final.verdict).toLowerCase()) ? String(final.verdict).toLowerCase() : "inconclusive";
  const arr = x => Array.isArray(x) ? x.map(String).filter(Boolean) : x ? [String(x)] : [];
  const result = {
    mode: "agent", provider: cfg.provider, model: cfg.model, verdict,
    confidence: typeof final.confidence === "number" ? Math.max(0, Math.min(1, final.confidence)) : null,
    summary: String(final.summary || ""), testData: String(final.testData || ""),
    resolutionSteps: arr(final.resolutionSteps), resolutionRationale: String(final.resolutionRationale || ""),
    expected: String(final.expected || caseDef.expected || ""), actual: String(final.actual || ""),
    evidence: arr(final.evidence), observations: arr(final.observations),
    classification: final.classification || null, rootCause: final.rootCause || "", component: final.component || "", narrative: final.narrative || "",
    nextSteps: arr(final.nextSteps), defectTitle: final.defectTitle || "", severity: final.severity || "", dbFindings: final.dbFindings || "", reproSteps: arr(final.reproSteps),
    harnessError: !!final.error,
    turns: turnsLog.length, calls, actions: actionsRun, queries, timeline: turnsLog,
    usage, costUsd: costKnown ? Number(cost.toFixed(5)) : null, llmMs, wallMs: Date.now() - t0,
    audit: `agent/${caseDef.caseId}.json`,
  };
  try {
    const dir = path.join(ROOT, "qa", "runs", runId, "agent"); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${caseDef.caseId}.json`), JSON.stringify({ caseId: caseDef.caseId, at: new Date().toISOString(), provider: cfg.provider, model: cfg.model, system: SYSTEM, database: { access: "read-only", file: path.basename(dbFile) }, result: { ...result, timeline: undefined }, turns: audit.map((a, k) => ({ ...a, executed: (turnsLog[k] || {}).actions })) }, null, 2));
  } catch { /* audit is best-effort */ }
  await testInfo.attach("ai-agent", { body: JSON.stringify(result), contentType: "application/json" });
  return result;
}

module.exports = { run: runCase, SYSTEM };

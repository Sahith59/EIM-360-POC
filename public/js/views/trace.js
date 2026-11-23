// AI trace: everything the AI did for one test case, in order, for a person to verify after the run.
// Nothing here slows the AI down: the agent writes its audit file and screenshots as it goes, and this page only reads them.
import { icon } from "../icons.js";
import { api, esc, fmtDur, fmtUtc, modal, pageHead, $, $$ } from "../core.js";

const art = (run, rel) => `/qa-artifacts/${encodeURIComponent(run)}/${String(rel).split("/").map(encodeURIComponent).join("/")}`;
const usd = v => v == null ? "n/a" : "$" + (v < 1 ? v.toFixed(4) : v.toFixed(2));
const prettyModel = m => ({ "gemini-3.5-flash": "Gemini 3.5 Flash" })[m] || m;
// show a value exactly as typed, with every backslash made visible
const raw = v => esc(String(v)).replace(/\\/g, '<mark class="tr-bs">\\</mark>');
const target = t => { const m = String(t || "").match(/^(\w+) "(.*)"(?: \((.*)\))?$/); return m ? `<b>${esc(m[2])}</b> <span class="muted small">${esc(m[1])}${m[3] ? " · " + esc(m[3]) : ""}</span>` : esc(t || ""); };
const secs = ms => ms == null ? "–" : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
const num = n => (n || 0).toLocaleString("en-US");
// list prices used only when an older trace did not store the cost of each call (USD per 1M tokens)
const PRICE = [[/gemini-3\.5-flash/, 1.5, 9, 0.1], [/gemini/, 2, 12, 0.1], [/claude-sonnet/, 3, 15, 0.1], [/claude-opus/, 5, 25, 0.1], [/gpt/, 2, 10, 0.1]];
const priceCall = (model, u) => { const p = PRICE.find(([re]) => re.test(model || "")); if (!p || !u) return null; const c = Math.min(u.cached || 0, u.input || 0); return (((u.input || 0) - c) * p[1] + c * p[1] * p[3] + (u.output || 0) * p[2]) / 1e6; };

// the prompt is built from labelled blocks; split it so each block can be shown on its own
const MARKS = [["guide", "APPLICATION GUIDE:"], ["testData", "TEST DATA (open incidents after the reset):"], ["required", "REQUIRED TEST DATA:"], ["case", "TEST CASE "],
  ["schema", "DATABASE SCHEMA"], ["history", "WHAT YOU HAVE DONE SO FAR"], ["sqlBack", "RESULTS OF YOUR SQL QUERIES"], ["page", "CURRENT PAGE"], ["retry", "Your previous reply could not be used"]];
function splitPrompt(p) {
  const at = MARKS.map(([k, m]) => [k, p.indexOf(m)]).filter(([, i]) => i >= 0).sort((a, b) => a[1] - b[1]);
  const out = {};
  at.forEach(([k, i], n) => { out[k] = p.slice(i, n + 1 < at.length ? at[n + 1][1] : p.length).trim(); });
  return out;
}
const afterColon = s => (s || "").replace(/^[^\n:]*:\s*/, "");
function pretty(t) { try { return JSON.stringify(JSON.parse(t), null, 2); } catch { return String(t); } }
function parseJson(t) { try { const i = t.indexOf("{"), j = t.lastIndexOf("}"); return JSON.parse(t.slice(i, j + 1)); } catch { return null; } }
// older traces kept the page's API calls and messages only inside the prompt text
function apiFromPrompt(p) {
  const m = p.match(/API calls the page made since the last turn:\n([\s\S]*?)(?:\nControls \(use the ref|$)/);
  return m ? m[1].split("\n").map(l => l.trim()).filter(Boolean).map(l => { const x = l.match(/^(\w+) (\S+) -> (\d+)(?: sent (.*?))?(?: response (.*))?$/); return x ? { method: x[1], path: x[2], status: +x[3], sent: x[4], body: x[5] } : { raw: l }; }) : [];
}
function msgsFromPrompt(p) { const m = p.match(/Messages shown since the last turn: (.*)/); return m && m[1] !== "none" ? (m[1].match(/"((?:[^"\\]|\\.)*)"/g) || []).map(s => JSON.parse(s)) : []; }

const block = (title, body, { open = false, id = "", note = "" } = {}) => `<details class="tr-block" ${open ? "open" : ""} ${id ? `data-testid="${id}"` : ""}><summary><b>${title}</b>${note ? ` <span class="muted small">${note}</span>` : ""}</summary><div class="tr-block-body">${body}</div></details>`;
const pre = t => `<pre class="tr-pre">${esc(t)}</pre>`;
const kv = rows => `<table class="tbl tr-kv"><tbody>${rows.filter(r => r).map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("")}</tbody></table>`;
function rowsTable(rows, cols) {
  if (!rows || !rows.length) return `<div class="small muted">0 rows</div>`;
  cols = cols && cols.length ? cols : Object.keys(rows[0]);
  return `<div class="table-wrap"><table class="tbl tr-rows"><thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${cols.map(c => `<td class="mono">${esc(r[c] == null ? "NULL" : typeof r[c] === "object" ? JSON.stringify(r[c]) : String(r[c]))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

export async function trace(view, runId, idx) {
  const run = await api("/api/qa/runs/" + runId);
  const x = run.tests.find(t => t.idx === Number(idx));
  const crumbs = [["Home", "#/home"], ["Quality Engineering", "#/qa/runs"], [`Run ${run.id}`, `#/qa/runs/${run.id}`], [x ? x.caseId : "Case", x ? `#/qa/runs/${run.id}/${x.idx}` : ""], ["AI trace", ""]];
  if (!x) { view.innerHTML = pageHead("AI trace", crumbs) + `<div class="card"><div class="empty">Case not found.</div></div>`; return; }
  const g = x.agent, a = x.analysis;
  const auditRel = g ? g.audit : a && a.llmAudit;
  let audit = null;
  if (auditRel) { try { const r = await fetch(art(run.id, auditRel), { cache: "no-store" }); if (r.ok) audit = await r.json(); } catch {} }
  const catalog = await api("/api/qa/catalog").catch(() => []);
  const c = (audit && audit.context && audit.context.testCase) || catalog.find(k => k.caseId === x.caseId) || {};
  const head = pageHead(`AI trace · ${x.caseId}`, crumbs, esc(x.title));
  const back = `<div class="row" style="margin-bottom:14px;gap:8px"><a class="btn" href="#/qa/runs/${run.id}/${x.idx}">${icon("arrow-left", 15)}Back to case</a><a class="btn" href="#/qa/runs/${run.id}">${icon("list", 15)}Run ${esc(run.id)}</a><span class="spacer"></span>${auditRel ? `<a class="btn" href="${art(run.id, auditRel)}" download="${esc(x.caseId)}_ai_trace.json" data-testid="trace-download">${icon("download", 15)}Download raw trace (JSON)</a>` : ""}<button class="btn" id="tr-print">${icon("printer", 15)}Print / save as PDF</button></div>`;

  if (!g && !(a && a.llm)) {
    view.innerHTML = head + back + `<div class="card"><div class="card-body"><b>No AI calls for this case.</b> <span class="muted">It ran as a scripted Playwright test${x.status === "passed" ? " and passed, so the AI was not asked to analyse it" : ""}. Each step's screenshot is on the case page.</span></div></div>`;
    $("#tr-print").onclick = () => window.print(); return;
  }
  if (!g) return triageTrace(view, run, x, a, audit, c, head, back);

  // ---------------- AI-driven case ----------------
  const T = (audit && audit.turns) || [];
  const L = g.timeline || [];
  const model = g.model;
  const AI = /gemini/i.test(g.provider) ? "Gemini" : /anthropic|claude/i.test(g.provider) ? "Claude" : /openai|azure/i.test(g.provider) ? "GPT" : "The AI";
  // per-call cost: stored by newer traces, otherwise priced from the tokens of that call
  let costKnown = true;
  const calls = L.map((rec, k) => {
    const t = T[k] || {};
    let cost = t.costUsd; if (cost == null) { cost = priceCall(model, t.usage); costKnown = false; }
    return { rec, t, cost, parsed: t.parsed || parseJson(t.response || "") };
  });
  // which screenshot the AI saw at each turn, and which the step fixture took after its actions
  const steps = x.steps || [];
  let si = 1, current = steps[0] && steps[0].screenshot;
  calls.forEach(cl => {
    const types = cl.rec.actions.map(z => z.type);
    const ui = types.some(tp => tp !== "query" && tp !== "finish");
    const q = !ui && types.includes("query");
    cl.saw = cl.t.screenshot ? { src: art(run.id, "agent/" + cl.t.screenshot), exact: true } : current ? { src: art(run.id, current), exact: false } : null;
    if (ui) { const s = steps[si++]; cl.after = s && s.screenshot ? art(run.id, s.screenshot) : null; cl.stepMs = s ? s.durationMs : null; if (s && s.screenshot) current = s.screenshot; }
    else if (q) { const s = steps[si++]; cl.stepMs = s ? s.durationMs : null; }
  });
  // what the page did because of a turn's actions is reported to the AI at the start of the next turn
  calls.forEach((cl, k) => {
    const nx = T[k + 1];
    cl.apiAfter = nx ? (nx.apiCalls || apiFromPrompt(nx.prompt || "")) : [];
    cl.msgsAfter = nx ? (nx.messages || msgsFromPrompt(nx.prompt || "")) : [];
    cl.sql = (cl.t.sqlResults && cl.t.sqlResults.length) ? cl.t.sqlResults : (g.queries || []).filter(q => q.turn === cl.rec.turn).map(q => ({ sql: q.sql, why: q.why, rowCount: q.rowCount, error: q.error, rows: q.sample || [], partial: (q.rowCount || 0) > (q.sample || []).length }));
  });
  const issues = (g.integrityCheck && g.integrityCheck.issues) || [];
  const totIn = g.usage.input, totOut = g.usage.output, totCached = g.usage.cached || 0;
  const totalCost = g.costUsd != null ? g.costUsd : calls.reduce((s, cl) => s + (cl.cost || 0), 0);
  const initApi = T[0] ? (T[0].apiCalls || apiFromPrompt(T[0].prompt || "")) : [], initMsgs = T[0] ? (T[0].messages || msgsFromPrompt(T[0].prompt || "")) : [];
  const backendCalls = initApi.length + calls.reduce((s, cl) => s + cl.apiAfter.length, 0);
  const browserMs = Math.max(0, g.wallMs - g.llmMs);
  const first = splitPrompt((T[0] && T[0].prompt) || "");
  const V = { pass: ["Pass", "ok", "check-circle-2"], fail: ["Fail", "bad", "x-circle"], inconclusive: ["Inconclusive", "violet", "circle-help"] }[g.verdict] || ["?", "", "circle-help"];

  const summary = (g.harnessError ? `<div class="callout" style="margin-bottom:12px;border-color:#f2c3be;background:var(--bad-50)">${icon("alert-triangle", 15)} <b>The AI could not finish this case:</b> ${esc(g.summary)} A person decides it.</div>` : "") + `<div class="card tr-summary" data-testid="trace-summary"><div class="card-body">
    <div class="row" style="gap:10px;flex-wrap:wrap;margin-bottom:12px"><span class="pill ${V[1]}" style="font-size:14px">${icon(V[2], 15)}AI verdict: ${V[0]}</span>${g.classification && g.verdict === "fail" ? `<span class="pill bad">${esc(g.classification)}</span>` : ""}<span class="muted">${esc(prettyModel(model))} drove Chrome through Playwright · run ${esc(run.id)} · build ${esc(run.build.label || run.build.version)}</span></div>
    <p class="tr-lead" data-testid="trace-story">${esc(g.summary)}</p>
    <div class="tr-stats">
      ${[["AI steps", L.length, "model calls"], ["Browser actions", g.actions, "clicks and entries"], ["SQL queries", g.queries.length, "read-only"], ["Backend calls", backendCalls, "by the page"], ["Screenshots", calls.filter(cl => cl.saw).length, "seen by the AI"],
         ["Tokens", num(totIn + totOut), `${num(totCached)} from cache`, `Tokens are the units of text the AI read and wrote: ${num(totIn)} in (${num(totCached)} served from cache), ${num(totOut)} out`], ["Cost", usd(totalCost), "for this case"], ["Time", secs(g.wallMs), `AI ${secs(g.llmMs)} · browser ${secs(browserMs)}`]]
        .map(([k, v, s, tip]) => `<div class="tr-stat"${tip ? ` title="${esc(tip)}"` : ""}><div class="small muted">${k}</div><div class="tr-stat-v">${v}</div><div class="small muted">${s}</div></div>`).join("")}
    </div>
    <div class="tr-bar" title="Where the time went"><span style="width:${(g.llmMs / g.wallMs * 100).toFixed(1)}%" class="tr-bar-ai"></span><span style="width:${(browserMs / g.wallMs * 100).toFixed(1)}%" class="tr-bar-pw"></span></div>
    <div class="small muted" style="margin-top:4px"><span class="tr-dot tr-bar-ai"></span>${esc(AI)} thinking ${Math.round(g.llmMs / g.wallMs * 100)}% · <span class="tr-dot tr-bar-pw"></span>Playwright, page loads and checks ${Math.round(browserMs / g.wallMs * 100)}%</div>
    <nav class="tr-nav small"><a href="#tr-context" data-jump>1 · What the AI was given</a><a href="#tr-steps" data-jump>2 · Every decision and action (${L.length})</a><a href="#tr-db" data-jump>3 · Database before and after</a><a href="#tr-verdict" data-jump>4 · Verdict, checks and review</a><a href="#tr-cost" data-jump>5 · Cost and time per call</a></nav>
  </div></div>`;

  // 1 · context
  const tdLines = afterColon(first.testData || "").split("\n").filter(Boolean);
  const context = `<section id="tr-context"><h2 class="tr-h">${icon("inbox", 18)}1 · What the AI was given</h2>
    <p class="small muted" style="margin:-4px 0 10px">The same context goes into every model call. Below it, each call adds what the AI has done so far and the current page.</p>
    <div class="grid g2" style="align-items:start">
      <div class="card"><div class="card-head"><h2>${icon("list-checks", 17)}Manual test case</h2><span class="small muted">${esc(c.source || "client test sheet")}</span></div><div class="card-body">
        ${kv([["Case", `<b>${esc(x.caseId)}</b>${c.clientRef ? ` · client ref ${esc(c.clientRef)}` : ""}${c.suite ? ` · ${esc(c.suite)}` : ""}`], ["Title", esc(c.title || x.title)], ["Role · priority", `${esc(c.role || "SWAT")} · ${esc(c.priority || "–")}`],
          ["Steps", `<ol style="margin:0;padding-left:18px">${(c.steps || []).map(s => `<li>${esc(s)}</li>`).join("")}</ol>`], ["Expected result", esc(c.expected || "")],
          (audit && audit.context && audit.context.requiredIncident) || first.required ? ["Required incident", `<b class="mono">${esc((audit && audit.context && audit.context.requiredIncident) || (first.required.match(/INC\w+/) || [""])[0])}</b> <span class="muted">(the one the tester used)</span>`] : null])}
      </div></div>
      <div class="stack">
        ${block("Instructions to the model (system prompt)", pre(audit ? audit.system : "not stored in this trace"), { id: "ctx-system", note: "how to work, verdict rules, allowed actions" })}
        ${block("Application guide", pre(audit && audit.context ? audit.context.appGuide : afterColon(first.guide || "")), { id: "ctx-guide", note: "what a new tester is told about EIM 360" })}
        ${block(`Test data list (${tdLines.length} incidents)`, pre(tdLines.join("\n")), { id: "ctx-testdata", note: "which incidents have a prediction and a KB recipe" })}
        ${block("Database schema", pre(afterColon(first.schema || "")), { id: "ctx-schema", note: "tables and row counts; access is read-only" })}
        ${block("Database access rules", kv([["Access", "read-only: SQLite opened read-only + PRAGMA query_only"], ["Allowed", "one SELECT (or WITH … SELECT) per query, at most 25 rows returned"], ["Writes", "only through the application UI, like a tester, in a test database reset before every case"], ["Database", esc(audit && audit.database ? audit.database.file : "per-run test database")]]), { id: "ctx-db" })}
      </div>
    </div></section>`;

  // 2 · timeline
  const actionRows = cl => cl.rec.actions.filter(z => z.type !== "query" && z.type !== "finish").map((z, n) => `<tr class="${z.ok === false ? "tr-fail" : ""}"><td class="num">${n + 1}</td><td><span class="pill">${esc(z.type)}</span></td><td>${target(z.target)}</td><td class="mono">${z.value != null && z.value !== "" ? raw(z.value) : '<span class="muted">–</span>'}</td><td>${z.ok === false ? `<span class="pill bad">${icon("x", 12)}failed</span><div class="small" style="color:var(--bad)">${esc(z.error || "")}</div>` : `<span class="pill ok">${icon("check", 12)}done</span>`}</td><td class="num small muted">${z.ms != null ? secs(z.ms) : ""}</td></tr>`).join("");
  const turnCard = (cl, k) => {
    const rec = cl.rec, t = cl.t, p = cl.parsed || {}, fin = rec.actions.find(z => z.type === "finish");
    const kind = fin ? (fin.ok === false ? "challenge" : "finish") : !rec.actions.length ? "none" : rec.actions.some(z => z.type !== "query") ? "act" : "sql";
    const label = { none: ["No usable action returned", "alert-triangle"], act: ["Browser actions", "mouse-pointer-click"], sql: ["Database check", "database"], finish: ["Verdict", "flag"], challenge: ["Verdict sent back by the integrity check", "alert-triangle"] }[kind];
    const ps = splitPrompt(t.prompt || "");
    const acts = actionRows(cl);
    const mism = c2 => { const hits = issues.filter(z => c2.sql.some(q => JSON.stringify(q.rows || []).includes(z.found)) || c2.msgsAfter.some(m => m.includes(z.found))); return hits.length ? `<div class="tr-mismatch">${icon("alert-triangle", 15)}<div><b>Here the value changed.</b> ${hits.map(z => `Gemini typed <span class="mono">${raw(z.typed)}</span>; the database returned <span class="mono">${raw(z.found)}</span>.`).join(" ")}</div></div>` : ""; };
    return `<article class="tr-turn tr-k-${kind}" id="turn-${rec.turn}" data-testid="trace-turn">
      <header class="tr-turn-head"><span class="tr-num">${rec.turn}</span><div style="min-width:0"><div class="tr-turn-title">${esc(rec.step)}</div><div class="small muted">${icon(label[1], 13)} ${label[0]}${t.startedAtMs != null ? ` · started ${secs(t.startedAtMs)} into the case` : ""} · model ${secs(t.latencyMs || rec.ms)} · ${num(((t.usage || {}).input || 0) + ((t.usage || {}).output || 0))} tokens · <b>${usd(cl.cost)}</b>${t.attempts > 1 ? ` · <span style="color:var(--warn)">answered on attempt ${t.attempts}</span>` : ""}</div></div></header>
      <div class="tr-turn-body">
        <div class="tr-shots">
          ${cl.saw ? `<figure class="shot" data-zoom="${cl.saw.src}" data-zoom-title="AI step ${rec.turn} · the screen ${esc(AI)} saw" title="Click to enlarge${t.screenshotSha256 || rec.screenshotSha256 ? ` · sha256 ${esc(t.screenshotSha256 || rec.screenshotSha256)}` : ""}"><img src="${cl.saw.src}" alt="Screen the AI saw at step ${rec.turn}"><figcaption class="cap">${icon("eye", 13)}<span>The screen ${esc(AI)} saw</span><span class="spacer"></span><span class="muted">${icon("search", 12)} enlarge</span></figcaption></figure>` : ""}

        </div>
        <div class="tr-detail">
          <div class="tr-lbl">${icon("bot", 14)}${esc(AI)}'s reasoning</div>
          <p class="tr-thought">${esc(rec.thought || p.thought || "")}</p>
          ${t.page ? `<div class="small muted" style="margin-bottom:8px">Page at that moment: <span class="mono">${esc(t.page.url)}</span> · “${esc(t.page.heading)}” · ${t.page.controls} controls listed for the AI${t.page.fieldErrors && t.page.fieldErrors.length ? ` · validation shown: ${esc(t.page.fieldErrors.join("; "))}` : ""}</div>` : ""}
          ${acts ? `<div class="tr-lbl">${icon("mouse-pointer-click", 14)}What ${esc(AI)} told Playwright to do</div><div class="table-wrap"><table class="tbl tr-acts"><thead><tr><th class="num">#</th><th>Action</th><th>On screen element</th><th>Value typed / chosen</th><th>Result</th><th class="num">Took</th></tr></thead><tbody>${acts}</tbody></table></div>` : ""}
          ${cl.sql.map(q => `<div class="tr-lbl">${icon("database", 14)}SQL query (read-only)</div><pre class="tr-pre tr-sql">${esc(q.sql)}</pre><div class="small muted" style="margin:4px 0">${q.why ? `Why: ${esc(q.why)} · ` : ""}${q.error ? `<span style="color:var(--bad)">error: ${esc(q.error)}</span>` : `${q.rowCount} row${q.rowCount === 1 ? "" : "s"} returned${q.partial ? " (first rows shown; the full result is in the prompt of the next call)" : ""}`}</div>${q.error ? "" : rowsTable(q.rows, q.columns)}`).join("")}
          ${cl.apiAfter.length || cl.msgsAfter.length ? `<div class="tr-lbl">${icon("server", 14)}What the application did in response</div>
            ${cl.msgsAfter.length ? `<div class="small" style="margin-bottom:6px">Messages on screen: ${cl.msgsAfter.map(m => `<span class="pill">${esc(m)}</span>`).join(" ")}</div>` : ""}
            ${cl.apiAfter.length ? `<div class="table-wrap"><table class="tbl tr-api"><thead><tr><th>Backend call made by the page</th><th class="num">Status</th></tr></thead><tbody>${cl.apiAfter.map(z => z.raw ? `<tr><td colspan="2" class="mono small">${esc(z.raw)}</td></tr>` : `<tr><td class="mono small">${esc(z.method)} ${esc(z.path)}${z.sent || z.bodyFull || z.body ? `<details class="tr-payload"><summary>${z.sent ? "Show what was sent and returned" : "Show what was returned"}</summary>${z.sent ? `<div class="tr-lbl">Sent</div>${pre(pretty(z.sent))}` : ""}${z.bodyFull || z.body ? `<div class="tr-lbl">Returned</div>${pre(pretty(z.bodyFull || z.body))}` : ""}<div class="small muted">JSON writes one backslash as \\\\.</div></details>` : ""}</td><td class="num"><span class="pill ${z.status >= 400 ? "bad" : "ok"}">${z.status}</span></td></tr>`).join("")}</tbody></table></div>` : ""}` : ""}
          ${mism(cl)}
          ${fin ? `<div class="tr-lbl">${icon("flag", 14)}${fin.ok === false ? "Gemini said PASS, but the integrity check disagreed" : `Verdict returned: ${esc(String(fin.verdict).toUpperCase())}`}</div>${fin.ok === false ? `<p class="small" style="color:var(--bad);margin:0 0 6px">${esc(fin.error || "")}. The finding was sent back to Gemini, which looked again.</p>` : `<p class="small muted" style="margin:0 0 6px">Details in section 3.</p>`}` : ""}
        </div>
          <div class="tr-raw">
            ${block("Prompt sent to the model", `${ps.history ? `<div class="tr-lbl">What it had done so far</div>${pre(ps.history)}` : ""}${ps.sqlBack ? `<div class="tr-lbl">SQL results handed back</div>${pre(ps.sqlBack)}` : ""}${ps.page ? `<div class="tr-lbl">Current page as text (controls, messages, API calls, visible text)</div>${pre(ps.page)}` : ""}${ps.retry ? `<div class="tr-lbl">Retry note</div>${pre(ps.retry)}` : ""}<div class="small muted">Plus the context in section 1 (guide, test data, case, schema) and the screenshot shown above.</div>${block("Full prompt text, exactly as sent", pre(t.prompt || ""), {})}`, { note: `${num((t.usage || {}).input)} tokens in${(t.usage || {}).cached ? `, ${num(t.usage.cached)} from cache` : ""}` })}
            ${block("Model response, exactly as returned", pre(t.response || ""), { note: `${num((t.usage || {}).output)} tokens out (incl. thinking)` })}
            ${cl.parsed ? block("Model response, formatted", pre(JSON.stringify(cl.parsed, null, 2)), { note: "the same response, parsed and indented for reading" }) : ""}
            ${t.attemptErrors && t.attemptErrors.length ? block(`Earlier attempts that could not be used (${t.attemptErrors.length})`, pre(t.attemptErrors.join("\n")), {}) : ""}
          </div>
      </div></article>`;
  };
  const timeline = `<section id="tr-steps"><h2 class="tr-h">${icon("route", 18)}2 · Every decision and action<span class="spacer"></span><button class="btn sm" id="tr-expand" type="button">Expand all details</button></h2>
    <p class="small muted" style="margin:-4px 0 6px">Each card is one AI step (one model call): the screen Gemini saw, why it decided what it did, what Playwright executed, what the database returned and how the application responded. Nothing here was edited after the run.</p>
    <div class="tr-legend small"><span><i class="tr-sw tr-k-act"></i>browser actions</span><span><i class="tr-sw tr-k-sql"></i>database check</span><span><i class="tr-sw tr-k-finish"></i>verdict</span><span><i class="tr-sw tr-k-challenge"></i>sent back by the integrity check</span></div>
    <div class="tr-timeline">${initApi.length || initMsgs.length ? `<article class="tr-turn tr-k-start"><header class="tr-turn-head"><span class="tr-num">0</span><div><div class="tr-turn-title">Start: the test harness opened EIM 360 as ${esc((T[0] && T[0].page && T[0].page.role) || c.role || "SWAT")} on a freshly reset test database</div><div class="small muted">Not an AI step. These are the calls the page made while loading, before Gemini's first decision.</div></div></header><div style="padding:10px 14px">${initMsgs.length ? `<div class="small" style="margin-bottom:6px">Messages on screen: ${initMsgs.map(m => `<span class="pill">${esc(m)}</span>`).join(" ")}</div>` : ""}<div class="table-wrap"><table class="tbl tr-api"><thead><tr><th>Backend call made by the page</th><th class="num">Status</th></tr></thead><tbody>${initApi.map(z => `<tr><td class="mono small">${esc(z.method || "")} ${esc(z.path || z.raw || "")}</td><td class="num"><span class="pill ${z.status >= 400 ? "bad" : "ok"}">${z.status || ""}</span></td></tr>`).join("")}</tbody></table></div></div></article>` : ""}${calls.map(turnCard).join("")}</div></section>`;

  // 3 · verdict
  const ic = g.integrityCheck || { checked: 0, issues: [] };
  const RT = g.roundTrip || (audit && audit.roundTrip) || [];
  const cellRt = (v, k) => !v ? "–" : v.status === "exact" ? `<span class="pill ok">${icon("check", 12)}unchanged</span>` : v.status === "changed" ? `<span class="pill bad">${icon("x", 12)}changed</span><div class="mono small">${raw(v.found)}</div>` : `<span class="muted small">${k === "sent" ? "not sent" : k === "stored" ? "not stored by this case" : "not on the final page"}</span>`;
  const rtVerdict = r => r.sent.status === "exact" && r.stored.status === "changed" ? "Sent correctly by the page, changed when the backend saved it: the defect is in the backend save logic." : r.sent.status === "changed" ? "Already changed before it was sent: the defect is in the page (front end)." : r.sent.status === "exact" && r.stored.status === "exact" && r.displayed.status === "changed" ? "Stored correctly but displayed differently: the defect is in how the page shows it." : "";
  const rtTable = RT.length ? `<div class="table-wrap"><table class="tbl tr-rt" data-testid="trace-roundtrip"><thead><tr><th>Typed by Gemini</th><th>Sent to the backend</th><th>Stored in the database</th><th>Shown on the page</th></tr></thead><tbody>${RT.map(r => `<tr><td class="mono">${raw(r.typed)}</td><td>${cellRt(r.sent, "sent")}</td><td>${cellRt(r.stored, "stored")}</td><td>${cellRt(r.displayed, "displayed")}</td></tr>${rtVerdict(r) ? `<tr><td colspan="4" class="small"><b>${esc(rtVerdict(r))}</b></td></tr>` : ""}`).join("")}</tbody></table></div>` : "";
  const rv = x.rcaReview;
  const verdict = `<section id="tr-verdict"><h2 class="tr-h">${icon("flag", 18)}4 · Verdict, checks and review</h2>
    <div class="stack">
      <div class="card"><div class="card-head"><h2>${icon(V[2], 17)}AI verdict: ${V[0]}</h2>${g.confidence != null ? `<span class="small muted">confidence ${Math.round(g.confidence * 100)}%</span>` : ""}</div><div class="card-body">
        <p style="margin-top:0">${esc(g.summary)}</p>
        ${kv([["Test data used", esc(g.testData)], g.resolutionSteps.length ? ["Resolution steps", `<ol style="margin:0;padding-left:18px">${g.resolutionSteps.map(s => `<li class="mono">${esc(s)}</li>`).join("")}</ol>${g.resolutionRationale ? `<div class="small muted">Why: ${esc(g.resolutionRationale)}</div>` : ""}`] : null,
          ["Expected", esc(g.expected)], ["Observed", esc(g.actual)], ["Evidence", `<ul style="margin:0;padding-left:18px">${g.evidence.map(e => `<li>${esc(e)}</li>`).join("")}</ul>`], g.observations.length ? ["Observations", `<ul style="margin:0;padding-left:18px">${g.observations.map(e => `<li>${esc(e)}</li>`).join("")}</ul>`] : null])}
        ${g.verdict === "fail" ? `<div class="tr-lbl" style="margin-top:12px">Root cause (AI draft)</div>${kv([["Classification", esc(g.classification || "")], ["Root cause", esc(g.rootCause)], ["Component", esc(g.component)], g.narrative ? ["Narrative", esc(g.narrative)] : null, ["Database findings", esc(g.dbFindings)], ["Draft defect", `${esc(g.defectTitle)} · <b>${esc(g.severity)}</b>`], ["Steps to reproduce", `<ol style="margin:0;padding-left:18px">${g.reproSteps.map(s => `<li>${esc(s)}</li>`).join("")}</ol>`], ["Suggested next steps", `<ol style="margin:0;padding-left:18px">${g.nextSteps.map(s => `<li>${esc(s)}</li>`).join("")}</ol>`]])}` : ""}
      </div></div>
      <div class="grid g2" style="align-items:start">
        <div class="card" data-testid="trace-integrity"><div class="card-head"><h2>${icon(ic.issues.length ? "alert-triangle" : "check-circle-2", 17)}Independent integrity check</h2><span class="small muted">code, not AI</span></div><div class="card-body">
          <p class="small" style="margin-top:0">Every value the AI typed is followed through the system: what the page sent to the backend, what the database stored and what the page then showed.</p>
          ${rtTable}
          ${ic.checked ? (ic.issues.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Typed by the AI</th><th>Found</th><th>Where</th></tr></thead><tbody>${ic.issues.map(z => `<tr><td class="mono">${raw(z.typed)}</td><td class="mono" style="color:var(--bad)">${raw(z.found)}</td><td class="small">${esc(z.where)}</td></tr>`).join("")}</tbody></table></div><p class="small" style="margin-bottom:0">${g.revisedAfterCheck ? (g.verdict !== "pass" ? "Gemini first said PASS; this check sent it back and Gemini changed its verdict." : "This check sent Gemini back to look again; it re-checked and kept PASS.") : "Consistent with the AI's verdict."}</p>` : `<p class="small" style="margin:0">${ic.checked} typed value${ic.checked === 1 ? "" : "s"} checked: unchanged wherever it was found (see the table above for sent, stored and shown).</p>`) : `<p class="small muted" style="margin:0">The AI typed no values in this case.</p>`}
        </div></div>
        <div class="card"><div class="card-head"><h2>${icon("user-check", 17)}Human review</h2></div><div class="card-body small">
          ${g.verdict === "fail" ? (rv ? `<b>${esc(rv.decision)}</b> by ${esc(rv.by)} · ${fmtUtc(rv.at)}${rv.comment ? `<div class="muted">“${esc(rv.comment)}”</div>` : ""}${rv.decision === "Edited" && rv.rootCause ? `<div style="margin-top:6px"><b>Root cause as edited by the reviewer:</b> ${esc(rv.rootCause)}</div>` : ""}<div style="margin-top:8px"><a class="btn sm" href="/api/qa/runs/${run.id}/${x.caseId}/report.docx">${icon("file-text", 13)}Defect report (Word)</a> <a class="btn sm" href="/api/qa/runs/${run.id}/${x.caseId}/report.pdf">${icon("file-text", 13)}PDF</a></div>` : `Waiting for a QA lead: <a href="#/qa/runs/${run.id}/${x.idx}">approve, edit or reject the root cause</a> on the case page. The defect report unlocks after that.`)
            : g.verdict === "inconclusive" ? "The AI could not decide. A QA engineer decides this case on the case page." : "Passed: no defect to raise. A tester can spot-check the evidence above."}
        </div></div>
      </div>
    </div></section>`;

  // 3 · database before and after (harness)
  const DC = audit && audit.dbChanges;
  const fmtV = v => v == null ? '<span class="muted">NULL</span>' : raw(typeof v === "object" ? JSON.stringify(v) : String(v));
  const dbSection = `<section id="tr-db"><h2 class="tr-h">${icon("database", 18)}3 · Database before and after</h2>
    <p class="small muted" style="margin:-4px 0 10px">Recorded by the test harness, not by the AI: the tables below were copied before the first AI step and after the last one, and compared row by row. This is what the case actually changed in the database.</p>
    ${!DC ? `<div class="card"><div class="card-body small muted">This run was recorded before database snapshots were added. Rerun the case to see them.</div></div>` : `<div class="stack">${Object.entries(DC).map(([t, d]) => {
      const n = d.inserted.length + d.updated.length + d.deleted.length;
      if (!n) return `<div class="tr-db-none small"><span class="mono">${esc(t)}</span> · no change (${num(d.rowsAfter)} rows)</div>`;
      const ins = d.inserted.length ? `<div class="tr-lbl">${d.inserted.length} row${d.inserted.length === 1 ? "" : "s"} added</div>${rowsTable(d.inserted)}` : "";
      const upd = d.updated.length ? `<div class="tr-lbl">${d.updated.length} row${d.updated.length === 1 ? "" : "s"} changed</div><div class="table-wrap"><table class="tbl tr-rows"><thead><tr><th>${esc(d.pk)}</th><th>Column</th><th>Before</th><th>After</th></tr></thead><tbody>${d.updated.map(u => Object.entries(u.changes).map(([c, [a, b]], i) => `<tr>${i === 0 ? `<td class="mono" rowspan="${Object.keys(u.changes).length}">${esc(u.key)}</td>` : ""}<td class="mono">${esc(c)}</td><td class="mono">${fmtV(a)}</td><td class="mono">${fmtV(b)}</td></tr>`).join("")).join("")}</tbody></table></div>` : "";
      const del = d.deleted.length ? `<div class="tr-lbl">${d.deleted.length} row${d.deleted.length === 1 ? "" : "s"} removed</div>${rowsTable(d.deleted)}` : "";
      return `<div class="card"><div class="card-head"><h2 class="mono" style="font-size:15px">${esc(t)}</h2><span class="small muted">${num(d.rowsBefore)} rows before → ${num(d.rowsAfter)} after</span></div><div class="card-body">${ins}${upd}${del}</div></div>`;
    }).join("")}</div>`}</section>`;

  // 5 · cost and time
  const costTbl = `<section id="tr-cost"><h2 class="tr-h">${icon("receipt", 18)}5 · Cost and time per AI step</h2><div class="card"><div class="table-wrap"><table class="tbl" data-testid="trace-cost"><thead><tr><th class="num">Step</th><th>What it decided</th><th class="num">Model time</th><th class="num">Input tokens</th><th class="num">of which cached</th><th class="num">Output tokens</th><th class="num">Cost</th></tr></thead><tbody>
    ${calls.map(cl => `<tr><td class="num"><a href="#turn-${cl.rec.turn}" data-jump>${cl.rec.turn}</a></td><td>${esc(cl.rec.step)}</td><td class="num">${secs(cl.t.latencyMs || cl.rec.ms)}</td><td class="num">${num((cl.t.usage || {}).input)}</td><td class="num">${num((cl.t.usage || {}).cached)}</td><td class="num">${num((cl.t.usage || {}).output)}</td><td class="num">${usd(cl.cost)}</td></tr>`).join("")}
    <tr style="font-weight:650"><td></td><td>Total for this case</td><td class="num">${secs(g.llmMs)}</td><td class="num">${num(totIn)}</td><td class="num">${num(totCached)}</td><td class="num">${num(totOut)}</td><td class="num">${usd(totalCost)}</td></tr>
  </tbody></table></div><div class="card-body small muted">${costKnown ? "Cost of each call as computed at run time from the tokens the provider reported." : `This trace was recorded before per-call costs were stored, so each call is priced from its tokens at list price; the case total is the one recorded at run time.`} Gemini bills input served from its prompt cache at a tenth of the input price. Case time ${secs(g.wallMs)} = model ${secs(g.llmMs)} + Playwright, page loads and checks ${secs(browserMs)}.</div></div></section>`;

  view.innerHTML = head + back + summary + context + timeline + dbSection + verdict + costTbl;
  wire(view);
}

function wire(view) {
  $$("[data-zoom]", view).forEach(f => f.onclick = () => modal(f.dataset.zoomTitle || "Screenshot", `<img src="${f.dataset.zoom}" style="display:block;max-width:100%;height:auto">`));
  const ex = $("#tr-expand", view); if (ex) ex.onclick = () => { const open = ex.dataset.open !== "1"; $$("#tr-steps details", view).forEach(d => d.open = open); ex.dataset.open = open ? "1" : "0"; ex.textContent = open ? "Collapse all details" : "Expand all details"; };
  $$("[data-jump]", view).forEach(l => l.onclick = e => { e.preventDefault(); const t = document.getElementById(l.getAttribute("href").slice(1)); if (t) { t.scrollIntoView({ behavior: "smooth", block: "start" }); t.classList.add("tr-flash"); setTimeout(() => t.classList.remove("tr-flash"), 1200); } });
  const pr = $("#tr-print", view); if (pr) pr.onclick = () => { $$("details", view).forEach(d => d.open = true); window.print(); };
}

// ---------------- scripted run: the AI only diagnosed a failure ----------------
function triageTrace(view, run, x, a, audit, c, head, back) {
  const turns = (audit && audit.turns) || [];
  const q = (audit && audit.database && audit.database.queries) || a.dbQueries || [];
  const L = a.llm || {};
  view.innerHTML = head + back + `<div class="card tr-summary"><div class="card-body">
    <div class="row" style="gap:10px;flex-wrap:wrap;margin-bottom:12px"><span class="pill bad">${icon("x-circle", 15)}Scripted test failed</span><span class="pill">${esc(a.classification)}</span><span class="muted">The test ran as a fixed Playwright script; ${esc(L.provider || "")} <span class="mono">${esc(L.model || "")}</span> was then asked to diagnose the failure.</span></div>
    <div class="tr-stats">${[["Model calls", L.calls || turns.length, "diagnosis"], ["SQL queries", q.length, "read-only snapshot"], ["Tokens", num(((L.usage || {}).input || 0) + ((L.usage || {}).output || 0)), ""], ["Cost", usd(L.costUsd), ""], ["Model time", secs(L.latencyMs), ""]].map(([k, v, s]) => `<div class="tr-stat"><div class="small muted">${k}</div><div class="tr-stat-v">${v}</div><div class="small muted">${s}</div></div>`).join("")}</div></div></div>
    <section><h2 class="tr-h">${icon("inbox", 18)}What the AI was given</h2><div class="stack">
      ${block("Instructions to the model", pre(audit ? audit.system : "not stored"), {})}
      ${audit && audit.image ? `<figure class="shot" style="max-width:520px" data-zoom="${art(run.id, audit.image.file)}"><img src="${art(run.id, audit.image.file)}" alt="Screenshot sent to the model"><figcaption class="cap">${icon("eye", 13)}<span>Screenshot sent with the failure (sha256 ${esc(audit.image.sha256.slice(0, 12))}…)</span></figcaption></figure>` : ""}
    </div></section>
    <section><h2 class="tr-h">${icon("route", 18)}Every model call</h2><div class="stack">${turns.map((t, k) => `<div class="card"><div class="card-head"><h2>Call ${k + 1}</h2><span class="small muted">${secs(t.latencyMs)} · ${num(((t.usage || {}).input || 0) + ((t.usage || {}).output || 0))} tokens</span></div><div class="card-body">${block("Prompt, exactly as sent", pre(t.prompt || ""), {})}${block("Response, exactly as returned", pre(t.response || (t.text || "")), { open: true })}</div></div>`).join("")}</div></section>
    ${q.length ? `<section><h2 class="tr-h">${icon("database", 18)}SQL queries on the database snapshot</h2><div class="stack">${q.map(z => `<div class="card"><div class="card-body"><pre class="tr-pre tr-sql">${esc(z.sql)}</pre><div class="small muted" style="margin:4px 0">${z.error ? `error: ${esc(z.error)}` : `${z.rowCount} rows`}</div>${z.error ? "" : rowsTable(z.rows || z.sample || [])}</div></div>`).join("")}</div></section>` : ""}
    <section><h2 class="tr-h">${icon("flag", 18)}Diagnosis</h2><div class="card"><div class="card-body">${kv([["Root cause", esc(a.rootCause)], ["Component", esc(a.component)], ["Narrative", esc(a.narrative || "")], ["Next steps", `<ol style="margin:0;padding-left:18px">${(a.nextSteps || []).map(s => `<li>${esc(s)}</li>`).join("")}</ol>`]])}</div></div></section>`;
  wire(view);
}

// EIM 360 Incident Management – POC mock server (no dependencies).
// Start: node server/index.js   ->  http://localhost:4360
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const { seed, PATTERNS, CATEGORIES } = require("./data");

const PORT = Number(process.env.PORT || 4360);
const ROOT = path.join(__dirname, "..");
const PUB = path.join(ROOT, "public");
const RUNS = path.join(ROOT, "qa", "runs");
const DATA = path.join(ROOT, "data");
fs.mkdirSync(DATA, { recursive: true });

// ---------------- build under test ----------------
// The release-candidate build intentionally carries known issues so the POC can show
// how the AI test agent detects, triages and reports them. BUILD=fixed removes them.
const BUILD = process.env.BUILD === "fixed"
  ? { version: "2.4.1", label: "2.4.1 (fixed)", defects: [] }
  : { version: "2.4.1-rc1", label: "2.4.1-rc1 (release candidate)", defects: ["N1", "N2", "N3", "UI2"] };
// EXTRA_DEFECTS adds defects that have no analyst note anywhere (e.g. N5), to prove the AI diagnoses failures it has never seen.
// They are deliberately not shown in the build label, so nothing in the AI prompt hints at them.
const EXTRA = (process.env.EXTRA_DEFECTS || "").split(",").map(x => x.trim()).filter(Boolean);
const has = d => BUILD.defects.includes(d) || EXTRA.includes(d);
// LATENCY_MS delays every API response to simulate a production network and database round trip.
const LATENCY = Math.max(0, Number(process.env.LATENCY_MS || 0));
const FAILURE_MIN = has("D2") ? 5 : 10;
const FAILURE_MAX = 500;

let S = seed();
// ---- SQLite system of record (node:sqlite is built into Node 22+) ----
process.removeAllListeners("warning"); process.on("warning", w => { if (w.name !== "ExperimentalWarning") console.warn(w); });
const DBM = require("./db");
const DB_FILE = process.env.DB_FILE || (PORT === 4360 ? path.join(DATA, "eim360.sqlite") : path.join(require("os").tmpdir(), `eim360-${PORT}.sqlite`));
const db = DBM.open(DB_FILE);
DBM.sync(db, S);
const activeKb = () => S.kb.filter(k => k.active);
const ROLES = ["SWAT", "SME", "Manager", "Admin"];
const USER_NAMES = { SWAT: "Kavya Menon", SME: "Nikhil Patel", Manager: "Jenna Harper", Admin: "Platform Admin" };
const ACTIVE = ["Open", "In Progress", "Awaiting SME Response", "Can be Closed"];

// ---------------- helpers ----------------
const iface = code => S.interfaces.find(i => i.code === code);
const categorise = text => { const p = PATTERNS.find(p => p.re.test(text)); return p ? p.category : null; };
function suggestion(inc) {
  if (inc.resolution) return inc.resolution;
  const cat = inc.aiPrediction ? inc.aiPrediction.category : categorise(inc.log.join(" "));
  if (!cat) return { source: "None", steps: [] };
  const exact = activeKb().find(k => k.interfaceCode === inc.interfaceCode && k.category === cat);
  if (exact) return { source: "Knowledge Base", kbId: exact.id, steps: exact.steps.map(t => ({ text: t, done: false })) };
  const past = S.incidents.find(o => o !== inc && o.resolution && o.aiPrediction && o.aiPrediction.category === cat && o.approved);
  if (past) return { source: "Similar past incident", ref: past.number, steps: past.resolution.steps.map(s => ({ text: s.text, done: false })) };
  return { source: "None", steps: [] };
}
function transitions(inc, role) {
  const t = [];
  const can = rs => rs.includes(role);
  if (inc.status === "Open" && can(["SWAT", "Admin"])) t.push("In Progress");
  if (inc.status === "In Progress" && can(["SWAT", "Admin"])) t.push("Awaiting SME Response");
  if (inc.status === "Awaiting SME Response" && can(["SME", "Admin"])) { if (inc.approved) t.push("Can be Closed"); t.push("In Progress"); }
  if (inc.status === "Can be Closed" && can(["SWAT", "Admin"]) && inc.approved) t.push("Closed");
  return t;
}
const perms = role => ({
  edit: ["SWAT", "SME", "Admin"].includes(role),
  approve: ["SME", "Admin"].includes(role),
  sync: role !== "Manager",
  showEditInList: role !== "Manager" || has("D3"),
});
function listRow(i) {
  const f = iface(i.interfaceCode);
  const res = i.resolution || null;
  return { number: i.number, status: i.status, critical: i.critical, interfaceCode: i.interfaceCode, interfaceDescription: f.description,
    smeOnshore: f.smeOnshore, workedBy: i.workedBy, createdAt: i.createdAt,
    progress: res ? { done: res.steps.filter(s => s.done).length, total: res.steps.length } : { done: 0, total: 1 } };
}
function tabCounts() {
  const c = Object.fromEntries(ACTIVE.map(s => [s, S.incidents.filter(i => i.status === s).length]));
  if (has("D1")) c["Can be Closed"] += S.incidents.filter(i => i.status === "Closed" && Date.now() - new Date(i.closedAt) < 48 * 3600e3).length;
  return c;
}
function summary() {
  const act = S.incidents.filter(i => ACTIVE.includes(i.status));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return {
    receivedToday: S.incidents.filter(i => new Date(i.createdAt) >= today).length,
    open: act.filter(i => i.status === "Open").length, inProgress: act.filter(i => i.status === "In Progress").length,
    awaitingSme: act.filter(i => i.status === "Awaiting SME Response").length, canBeClosed: act.filter(i => i.status === "Can be Closed").length,
    p1: act.filter(i => i.critical === "P1").length, p2: act.filter(i => i.critical === "P2").length, p3: act.filter(i => i.critical === "P3").length,
    backlog: act.filter(i => Date.now() - new Date(i.createdAt) > 3 * 864e5).length,
    unassigned: act.filter(i => !i.workedBy).length,
    noPrediction: act.filter(i => !i.aiPrediction).length,
    lastSync: S.lastSync,
  };
}
function dashboard(days) {
  const from = Date.now() - days * 864e5;
  const inRange = S.incidents.filter(i => new Date(i.createdAt) >= from);
  const series = [];
  for (let d = days - 1; d >= 0; d--) {
    const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - d);
    const end = new Date(start.getTime() + 864e5);
    series.push({ date: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`,
      created: S.incidents.filter(i => new Date(i.createdAt) >= start && new Date(i.createdAt) < end).length,
      closed: S.incidents.filter(i => i.closedAt && new Date(i.closedAt) >= start && new Date(i.closedAt) < end).length });
  }
  const managers = [...new Set(S.interfaces.map(i => i.manager))].sort().map(m => {
    const rows = inRange.filter(i => iface(i.interfaceCode).manager === m);
    return { manager: m, total: rows.length, active: rows.filter(i => ACTIVE.includes(i.status)).length, closed: rows.filter(i => i.status === "Closed").length, p1: rows.filter(i => i.critical === "P1").length };
  });
  const byIface = {};
  inRange.forEach(i => byIface[i.interfaceCode] = (byIface[i.interfaceCode] || 0) + 1);
  const top = Object.entries(byIface).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([code, n]) => ({ code, description: iface(code).description, incidents: n }));
  const cats = {};
  inRange.forEach(i => { const c = i.aiPrediction ? i.aiPrediction.category : "No prediction"; cats[c] = (cats[c] || 0) + 1; });
  const closed = inRange.filter(i => i.closedAt);
  const mttr = closed.length ? closed.reduce((a, i) => a + (new Date(i.closedAt) - new Date(i.createdAt)), 0) / closed.length / 3600e3 : 0;
  return { days, total: inRange.length, series, managers, top, categories: cats, mttrHours: Math.round(mttr * 10) / 10, closed: closed.length };
}
function csv(rows) { return rows.map(r => r.map(v => /[",\n]/.test(String(v ?? "")) ? `"${String(v).replace(/"/g, '""')}"` : (v ?? "")).join(",")).join("\r\n") + "\r\n"; }
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2));

// ---------------- QA (test results produced by the Playwright reporter) ----------------
function runsIndex() {
  if (!fs.existsSync(RUNS)) return [];
  return fs.readdirSync(RUNS).filter(d => fs.existsSync(path.join(RUNS, d, "run.json")))
    .map(d => { const r = loadRun(d); return r && { id: r.id, startedAt: r.startedAt, build: r.build, totals: r.totals, durationMs: r.durationMs, workers: r.workers, browser: r.browser, complete: r.tests.length >= catalogSize(), envFailures: r.tests.filter(t => t.analysis && t.analysis.classification === "Environment / test data").length, agent: !!(r.ai && r.ai.agent), aiCostUsd: r.ai && r.ai.agent ? r.ai.agent.costUsd : null }; })
    .filter(Boolean).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
const catalogSize = () => readJson(path.join(ROOT, "tests", "catalog.json"), []).length;
function loadRun(id) {
  const run = readJson(path.join(RUNS, id, "run.json"), null);
  if (!run) return null;
  const approvals = readJson(path.join(DATA, "test-approvals.json"), {});
  const rca = readJson(path.join(DATA, "rca-reviews.json"), {});
  run.tests.forEach(t => { if (t.analysis && rca[`${id}/${t.caseId}`]) t.rcaReview = rca[`${id}/${t.caseId}`]; });
  run.tests.forEach(t => { const a = approvals[t.caseId]; if (a) { t.approval = a; if (t.status === "review" && a.decision === "Approved") { t.status = "passed"; t.approvedReview = true; } } });
  const T = run.tests; run.totals = { ...run.totals, passed: T.filter(t => t.status === "passed").length, failed: T.filter(t => t.status === "failed").length, review: T.filter(t => t.status === "review").length };
  return run;
}

// ---------------- http ----------------
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".json": "application/json", ".svg": "image/svg+xml", ".webm": "video/webm", ".zip": "application/zip" };
const send = (res, code, body, type = "application/json") => { if (res.mutating && code < 400) DBM.sync(db, S); res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" }); res.end(type === "application/json" ? JSON.stringify(body) : body); };
const readBody = req => new Promise(ok => { let d = ""; req.on("data", c => d += c); req.on("end", () => { try { ok(d ? JSON.parse(d) : {}); } catch { ok({}); } }); });
function serveFile(res, base, rel) {
  let dec; try { dec = decodeURIComponent(rel); } catch { return false; }
  const file = path.normalize(path.join(base, dec));
  if (!file.startsWith(base) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res); return true;
}

const server = http.createServer(async (req, res) => {
  const t0 = process.hrtime.bigint();
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;
  res.mutating = req.method !== "GET" && p.startsWith("/api/") && !p.startsWith("/api/qa/");
  if (LATENCY && p.startsWith("/api/") && !p.startsWith("/api/qa/")) await new Promise(r => setTimeout(r, LATENCY));
  const role = ROLES.includes(req.headers["x-role"]) ? req.headers["x-role"] : "Manager"; // no role header = most restricted
  const deny = (msg = `The ${role} role cannot perform this action.`) => send(res, 403, { error: msg });
  try {
    // ---- meta ----
    if (p === "/api/meta") return send(res, 200, { build: BUILD, env: "DEV", database: { engine: "SQLite " + db.prepare("select sqlite_version() v").get().v, file: path.relative(ROOT, DB_FILE).startsWith("..") ? path.basename(DB_FILE) : path.relative(ROOT, DB_FILE) }, roles: ROLES, people: S.people, categories: CATEGORIES, failureMin: FAILURE_MIN, failureMax: FAILURE_MAX, permissions: perms(role), role });
    if (p === "/api/summary") return send(res, 200, summary());

    // ---- incidents ----
    if (p === "/api/incidents" && req.method === "GET") {
      const status = url.searchParams.get("status");
      const q = (url.searchParams.get("q") || "").toLowerCase();
      let rows = S.incidents.filter(i => status ? i.status === status : ACTIVE.includes(i.status)).map(listRow);
      if (q) rows = rows.filter(r => [r.number, r.interfaceCode, r.interfaceDescription, r.smeOnshore, r.critical, r.workedBy].join(" ").toLowerCase().includes(q));
      rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      return send(res, 200, { rows, total: S.incidents.filter(i => ACTIVE.includes(i.status)).length, tabs: tabCounts(), lastSync: S.lastSync, loadMs: Math.round(ms * 100) / 100 });
    }
    if (p === "/api/sync" && req.method === "POST") {
      if (!perms(role).sync) return deny();
      const added = S.queue.splice(0).map(i => ({ ...i, createdAt: new Date().toISOString(), history: [{ at: new Date().toISOString(), by: "ServiceNow", action: "Incident imported (Open)" }] }));
      S.incidents.unshift(...added); S.lastSync = new Date().toISOString();
      return send(res, 200, { added: added.length, lastSync: S.lastSync });
    }
    let m = p.match(/^\/api\/incidents\/(INCTSK\d+)(?:\/(\w+))?$/);
    if (m) {
      const inc = S.incidents.find(i => i.number === m[1]);
      if (!inc) return send(res, 404, { error: `Incident ${m[1]} was not found.` });
      const action = m[2];
      if (!action && req.method === "GET")
        { const k = activeKb().find(x => x.interfaceCode === inc.interfaceCode && x.category === inc.category); return send(res, 200, { ...inc, interface: iface(inc.interfaceCode), suggestion: suggestion(inc), recommendation: k ? { id: k.id, version: k.version, usage: k.usage, steps: k.steps } : null, transitions: transitions(inc, role), permissions: perms(role), failureMin: FAILURE_MIN, failureMax: FAILURE_MAX }); }
      const b = await readBody(req);
      const log = (action) => inc.history.push({ at: new Date().toISOString(), by: `${USER_NAMES[role]} (${role})`, action });
      const closed = () => send(res, 409, { error: "Closed incidents are read-only." });
      if (!action && req.method === "PUT") {
        if (!perms(role).edit) return deny();
        if (inc.status === "Closed") return closed();
        const errors = {};
        const fd = String(b.failureDetails ?? "").trim();
        if (!b.workedBy) errors.workedBy = "Select the assignee working on this incident.";
        else if (!S.people.swat.includes(b.workedBy)) errors.workedBy = "Select an assignee from the list.";
        if (fd.length < FAILURE_MIN || fd.length > FAILURE_MAX) errors.failureDetails = `Failure details must be between 10 and ${FAILURE_MAX} characters.`;
        if (b.status && b.status !== inc.status && !transitions(inc, role).includes(b.status)) errors.status = `Status cannot move from ${inc.status} to ${b.status} for the ${role} role.`;
        if (Object.keys(errors).length) return send(res, 422, { error: "Please correct the highlighted fields.", errors });
        const changes = [];
        if (b.workedBy !== inc.workedBy) { inc.workedBy = b.workedBy; changes.push(`Assigned to ${b.workedBy}`); }
        if (fd !== inc.failureDetails) { inc.failureDetails = fd; changes.push("Failure details updated"); }
        if (Array.isArray(b.stepsDone) && inc.resolution) inc.resolution.steps.forEach((s, x) => {
          const v = !!b.stepsDone[x];
          if (v !== s.done) { s.done = v; changes.push(`Resolution step ${x + 1} marked ${v ? "done" : "not done"}`); }
        });
        if (b.status && b.status !== inc.status) {
          if (!inc.resolution && suggestion(inc).steps.length) { const sg = suggestion(inc); inc.resolution = { ...sg, steps: sg.steps.map(x => ({ ...x })) }; }
          if (b.status === "In Progress" && inc.status === "Awaiting SME Response" && inc.approved) { inc.approved = false; changes.push("SME approval cleared (sent back)"); }
          inc.status = b.status; changes.push(`Status changed to ${b.status}`);
          if (b.status === "Closed") inc.closedAt = new Date().toISOString();
        }
        changes.forEach(c => log(c));
        return send(res, 200, { ok: true, changes });
      }
      if (action === "resolution" && req.method === "POST") {
        if (!perms(role).edit) return deny();
        if (inc.status === "Closed") return closed();
        const steps = (Array.isArray(b.steps) ? b.steps : []).map(s => String(s).trim()).filter(Boolean);
        if (steps.length > 15 || steps.some(s => s.length > 300)) return send(res, 422, { error: "Enter up to 15 steps of at most 300 characters each.", errors: { steps: "Enter up to 15 steps of at most 300 characters each." } });
        if (!steps.length) return send(res, 422, { error: "Enter at least one resolution step.", errors: { steps: "Enter at least one resolution step." } });
        inc.resolution = { source: "Manual entry", steps: steps.map(t => ({ text: t, done: false })) }; inc.approved = false;
        log(`Resolution steps entered manually (${steps.length})`);
        return send(res, 200, { ok: true });
      }
      if (action === "review" && req.method === "POST") {
        if (!perms(role).edit) return deny();
        if (inc.status === "Closed" || inc.review.status === "Completed") return send(res, 409, { error: "The AI review for this incident is complete and read-only." });
        const act = b.action;
        if (!["wip", "one-time", "add-kb", "resolve", "send-sme"].includes(act)) return send(res, 422, { error: "Unknown action." });
        const pred = inc.aiPrediction;
        const fd = b.failure || {}, cat = b.category || {}, st = b.steps || {};
        const items = (Array.isArray(st.items) ? st.items : []).map(x => String(x ?? "").trim()).filter(Boolean);
        const errors = {};
        const long = items.findIndex(x => x.length > 300);
        if (long >= 0) return send(res, 422, { error: `Resolution step ${long + 1} is longer than 300 characters. Shorten it and save again.`, errors: { steps: `Step ${long + 1} is longer than 300 characters.` } });
        if (items.length > 15) return send(res, 422, { error: "Enter at most 15 resolution steps.", errors: { steps: "Enter at most 15 resolution steps." } });
        const finalFailure = pred && fd.decision === "Approved" ? pred.summary : String(fd.correction || "").trim();
        const finalCategory = pred && cat.decision === "Approved" ? pred.category : String(cat.value || "");
        if (act !== "wip") {
          if (!b.workedBy) errors.workedBy = "Select the assignee working on this incident.";
          if (pred && !["Approved", "Rejected"].includes(fd.decision)) errors.failure = "Approve or reject the predicted failure details.";
          else if (finalFailure.length < 10 || finalFailure.length > 500) errors.failure = pred && fd.decision === "Rejected" ? "Enter the corrected failure details (10-500 characters)." : "Enter the failure details (10-500 characters).";
          if (pred && !["Approved", "Rejected"].includes(cat.decision)) errors.category = "Approve or reject the predicted issue category.";
          else if (!CATEGORIES.includes(finalCategory)) errors.category = pred && cat.decision === "Rejected" ? "Select the corrected issue category." : "Select the issue category.";
          if (st.decision === "Rejected" && !items.length) errors.steps = "Enter the corrected resolution steps.";
          else if (!items.length) errors.steps = "Add at least one resolution step.";
        }
        if (b.workedBy && !S.people.swat.includes(b.workedBy)) errors.workedBy = "Select an assignee from the list.";
        if (Object.keys(errors).length) return send(res, 422, { error: "Please correct the highlighted fields.", errors });
        const clean = t => { let v = has("N1") ? t.replace(/\\/g, "") : t; if (has("N5")) v = v.replace(/&/g, "&amp;"); return v; }; // persistence layer escaping
        // save draft values
        inc.workedBy = b.workedBy || inc.workedBy;
        inc.review.failure = { decision: pred ? fd.decision || null : "Manual", correction: String(fd.correction || "") };
        inc.review.category = { decision: pred ? cat.decision || null : "Manual", value: String(cat.value || "") };
        inc.review.steps = { decision: st.decision || null };
        if (finalFailure) inc.failureDetails = finalFailure;
        if (finalCategory) inc.category = finalCategory;
        inc.resolutionDetails = String(b.resolutionDetails || "").slice(0, 1000);
        const rec = activeKb().find(k => k.interfaceCode === inc.interfaceCode && k.category === (finalCategory || inc.category));
        const fromKb = !!rec && st.decision === "Approved" && items.length === rec.steps.length && items.every((x, i) => x === rec.steps[i]);
        const prevSteps = inc.resolution ? inc.resolution.steps : [];
        inc.resolution = items.length ? { source: fromKb ? "Knowledge Base" : "Manual entry", kbId: fromKb ? rec.id : null, steps: items.map((t, i) => ({ text: clean(t), done: !!(prevSteps[i] && prevSteps[i].text === clean(t) && prevSteps[i].done) })) } : inc.resolution;
        if (inc.review.status === "Not started") inc.review.status = "In progress";
        if (inc.status === "Open") { inc.status = "In Progress"; log("Status changed to In Progress"); }
        if (act === "wip") { log("Work in progress saved"); return send(res, 200, { ok: true, message: "Work in progress saved" }); }
        if (act === "send-sme") { inc.status = "Awaiting SME Response"; log("Sent to SME for review"); return send(res, 200, { ok: true, message: "Sent to SME for review" }); }
        // approval: write execution records (replace the active set; identical content creates nothing new)
        const now = new Date().toISOString();
        const active = S.exec.filter(x => x.incident === inc.number && x.active);
        const same = active.length === inc.resolution.steps.length && active.every((x, i) => x.step_text === inc.resolution.steps[i].text);
        if (!same) {
          active.forEach(x => { x.active = false; x.eff_end = now; });
          inc.resolution.steps.forEach((s2, i) => S.exec.push({ incident: inc.number, step_no: i + 1, step_text: s2.text, source: inc.resolution.source, active: true, eff_start: now, eff_end: null }));
        }
        let kbResult = "none";
        if (act === "add-kb") {
          const texts = inc.resolution.steps.map(x => x.text);
          if (rec && rec.steps.length === texts.length && rec.steps.every((x, i) => x === texts[i])) { rec.usage += 1; kbResult = "unchanged"; }
          else {
            if (rec && !has("N2")) { rec.active = false; rec.effEnd = now; }
            S.kb.unshift({ id: S.kbSeq++, kbKey: `${inc.interfaceCode}|${inc.category}`, interfaceCode: inc.interfaceCode, category: inc.category, version: rec ? rec.version + 1 : 1, active: true, effStart: now, effEnd: null, usage: 1, steps: texts, approvedBy: USER_NAMES[role], approvedAt: now });
            kbResult = rec ? "new-version" : "created";
          }
        } else if (fromKb && !has("N3")) rec.usage += 1;
        inc.kbUsed = fromKb ? rec.id : null;
        inc.approved = true;
        inc.review.status = "Completed";
        S.events.push({ incident: inc.number, failure_details: inc.failureDetails, issue_category: inc.category, resolution_steps: inc.resolution.steps.length, resolution_source: inc.resolution.source, review_status: "Completed", approval_type: act === "add-kb" ? "Approve & Add to KB" : act === "resolve" ? "Approve and Resolve" : "Approve One Time", recorded_at: now });
        if (act === "resolve") { inc.status = "Closed"; inc.closedAt = now; log("Approved and resolved"); }
        else { inc.status = "Can be Closed"; log(act === "add-kb" ? (kbResult === "unchanged" ? "Approved; Knowledge Base already up to date" : "Approved and added to Knowledge Base") : "Approved one time"); }
        return send(res, 200, { ok: true, kbResult, message: act === "resolve" ? "Incident approved and resolved" : act === "add-kb" ? (kbResult === "unchanged" ? "Approved. The Knowledge Base already has these steps." : "Approved and added to the Knowledge Base") : "Approved one time" });
      }
      if (action === "close" && req.method === "POST") {
        if (!perms(role).edit) return deny();
        if (inc.status !== "Can be Closed") return send(res, 409, { error: "Only incidents in Can be Closed can be closed." });
        inc.status = "Closed"; inc.closedAt = new Date().toISOString(); log("Incident closed");
        return send(res, 200, { ok: true });
      }
      if (action === "approve" && req.method === "POST") {
        if (!perms(role).approve) return deny("Only SME or Admin users can approve resolution steps.");
        if (inc.status !== "Awaiting SME Response") return send(res, 409, { error: "Resolution steps can be approved while the incident is awaiting SME response." });
        if (inc.approved) return send(res, 409, { error: "This resolution is already approved." });
        const sug = suggestion(inc);
        if (!sug.steps.length) return send(res, 422, { error: "There are no resolution steps to approve." });
        inc.resolution = { ...sug, steps: sug.steps.map(s => ({ ...s })) }; inc.approved = true;
        let kbAdded = false;
        const cat = inc.aiPrediction ? inc.aiPrediction.category : categorise(inc.log.join(" ")) || "Uncategorised";
        if (b.addToKb && cat !== "Uncategorised" && !activeKb().find(k => k.interfaceCode === inc.interfaceCode && k.category === cat)) {
          S.kb.unshift({ id: S.kbSeq++, kbKey: `${inc.interfaceCode}|${cat}`, interfaceCode: inc.interfaceCode, category: cat, version: 1, active: true, effStart: new Date().toISOString(), effEnd: null, usage: 1, steps: sug.steps.map(s => s.text), approvedBy: USER_NAMES[role], approvedAt: new Date().toISOString() }); kbAdded = true;
        }
        inc.review.status = "Completed"; inc.status = "Can be Closed";
        log(b.addToKb ? "Resolution approved and added to Knowledge Base" : "Resolution approved");
        return send(res, 200, { ok: true, kbAdded });
      }
    }

    // ---- reference data ----
    if (p === "/api/interfaces") return send(res, 200, S.interfaces.map(i => ({ ...i, kbEntries: activeKb().filter(k => k.interfaceCode === i.code).length, activeIncidents: S.incidents.filter(x => x.interfaceCode === i.code && ACTIVE.includes(x.status)).length })));
    if (p === "/api/kb") return send(res, 200, (url.searchParams.get("all") ? S.kb : activeKb()).map(k => ({ ...k, interfaceDescription: iface(k.interfaceCode).description, smeOnshore: iface(k.interfaceCode).smeOnshore, smeOffshore: iface(k.interfaceCode).smeOffshore })));
    if (p === "/api/kb/recommend") { const k = activeKb().find(x => x.interfaceCode === url.searchParams.get("interface") && x.category === url.searchParams.get("category")); return send(res, 200, k ? { id: k.id, version: k.version, usage: k.usage, steps: k.steps } : null); }
    if (p === "/api/backend/swat_kb") return send(res, 200, DBM.read.swat_kb(db)); // read from SQLite
    if (p === "/api/backend/resolution_execution") return send(res, 200, DBM.read.resolution_execution(db));
    if (p === "/api/backend/incident_task_event") return send(res, 200, DBM.read.incident_task_event(db));
    let mi = p.match(/^\/api\/interfaces\/(\w+)$/);
    if (mi && req.method === "PUT") {
      if (!["SME", "Admin"].includes(role)) return deny("Only SME or Admin users can assign interface SMEs.");
      const f = iface(mi[1]); if (!f) return send(res, 404, { error: "Interface not found." });
      const b = await readBody(req);
      const on = S.people.smeOnshore, off = S.people.smeOffshore;
      if (!on.includes(b.smeOnshore) || !off.includes(b.smeOffshore)) return send(res, 422, { error: "Select an onshore and an offshore SME from the lists." });
      f.smeOnshore = b.smeOnshore; f.smeOffshore = b.smeOffshore;
      return send(res, 200, { ok: true });
    }
    if (p === "/api/jobs") {
      const jobs = S.interfaces.map((f, x) => {
        const last = S.incidents.filter(i => i.interfaceCode === f.code).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        const failed = last && ACTIVE.includes(last.status);
        return { stream: f.iwsStream, interfaceCode: f.code, workstation: f.workstation, frequency: f.frequency, status: failed ? "Abended" : "Succeeded", incident: failed ? last.number : null, lastRun: failed ? last.createdAt : new Date(Date.now() - ((x * 37) % 600) * 60e3).toISOString() };
      });
      return send(res, 200, jobs);
    }
    if (p === "/api/dashboard") return send(res, 200, dashboard(Math.min(365, Math.max(1, parseInt(url.searchParams.get("days"), 10) || 30))));
    if (p === "/api/governance") return send(res, 200, S.interfaces.map(f => {
      const rows = S.incidents.filter(i => i.interfaceCode === f.code && i.closedAt);
      const within = rows.filter(i => (new Date(i.closedAt) - new Date(i.createdAt)) / 3600e3 <= f.slaHours * 4).length;
      return { code: f.code, description: f.description, domain: f.domain, slaHours: f.slaHours, closed: rows.length, withinTarget: within, rate: rows.length ? Math.round(within / rows.length * 100) : null };
    }));
    if (p === "/api/export") {
      const status = url.searchParams.get("status");
      const rows = S.incidents.filter(i => status ? i.status === status : ACTIVE.includes(i.status)).map(listRow);
      const body = csv([["Incident Task Number", "Status", "Critical Flag", "Interface Code", "Interface Description", "SME (Onshore)", "Worked By", "Created (UTC)", "Resolution Progress"],
        ...rows.map(r => [r.number, r.status, r.critical, r.interfaceCode, r.interfaceDescription, r.smeOnshore, r.workedBy || "", r.createdAt, `${r.progress.done}/${r.progress.total}`])]);
      res.writeHead(200, { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="eim360_incidents${status ? "_" + status.replace(/\s+/g, "_").toLowerCase() : ""}.csv"` });
      return res.end(body);
    }
    if (p === "/api/test/candidates") return send(res, 200, S.incidents.filter(i => ["Open", "In Progress"].includes(i.status)).map(i => ({ number: i.number, status: i.status, workedBy: i.workedBy, hasPrediction: !!i.aiPrediction, category: i.category, interfaceCode: i.interfaceCode, hasRec: !!activeKb().find(k => k.interfaceCode === i.interfaceCode && k.category === i.category), noRecCategory: CATEGORIES.find(c => c !== i.category && !activeKb().find(k => k.interfaceCode === i.interfaceCode && k.category === c)) || null }))); // non-production test hook
    if (p === "/api/test/reset" && req.method === "POST") { S = seed(); return send(res, 200, { ok: true }); }
    if (p === "/api/test/db-snapshot" && req.method === "POST") { // non-production: copy the database as it is right now (used when a test fails)
      const b = await readBody(req); const out = path.resolve(String(b.file || ""));
      if (!out.startsWith(RUNS + path.sep) || !out.endsWith(".sqlite")) return send(res, 422, { error: "Snapshot path must be a .sqlite file inside qa/runs." });
      fs.mkdirSync(path.dirname(out), { recursive: true }); try { fs.unlinkSync(out); } catch {}
      db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`); return send(res, 200, { ok: true, file: out });
    } // non-production test hook

    // ---- QA / AI test agent ----
    if (p === "/api/qa/runs") return send(res, 200, runsIndex());
    const rpt = p.match(/^\/api\/qa\/runs\/([\w-]+)\/([\w-]+)\/report\.(docx|pdf)$/);
    if (rpt) { // defect report export: only after a QA lead approved or edited the AI root cause
      const r = loadRun(rpt[1]); const t = r && r.tests.find(x => x.caseId === rpt[2] && x.analysis);
      if (!t) return send(res, 404, { error: "Failed test not found in this run." });
      if (!t.rcaReview || t.rcaReview.decision === "Rejected") return send(res, 409, { error: "Approve or edit the root cause before exporting the defect report." });
      const R = require("../qa/report"), m = R.model(r, t, t.rcaReview);
      const buf = rpt[3] === "pdf" ? await R.pdf(m) : await R.docx(m);
      res.writeHead(200, { "Content-Type": rpt[3] === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Content-Disposition": `attachment; filename="${t.caseId}_defect_report.${rpt[3]}"`, "Cache-Control": "no-store" });
      return res.end(buf);
    }
    m = p.match(/^\/api\/qa\/runs\/([\w-]+)$/);
    if (m) { const r = loadRun(m[1]); return r ? send(res, 200, r) : send(res, 404, { error: "Run not found" }); }
    if (p === "/api/qa/rca-review" && req.method === "POST") {
      // human in the loop: a QA lead approves, edits or rejects the AI root cause before a defect is raised
      if (role === "Manager") return deny("Managers have view-only access; a QA lead reviews root causes.");
      const b = await readBody(req); const r = loadRun(String(b.runId || ""));
      const ids = Array.isArray(b.caseIds) ? b.caseIds : [b.caseId];
      if (!r || !ids.length || !ids.every(c => r.tests.some(t => t.caseId === c && t.analysis))) return send(res, 422, { error: "Unknown run or failed test case." });
      if (!["Approved", "Edited", "Rejected"].includes(b.decision)) return send(res, 422, { error: "Decision must be Approved, Edited or Rejected." });
      const text = String(b.rootCause || "").trim().slice(0, 1500), comment = String(b.comment || "").trim().slice(0, 500);
      if (b.decision === "Edited" && text.length < 10) return send(res, 422, { error: "Enter the corrected root cause (at least 10 characters)." });
      if (b.decision === "Rejected" && comment.length < 5) return send(res, 422, { error: "Say why the AI root cause is rejected." });
      const all = readJson(path.join(DATA, "rca-reviews.json"), {}), rec = { decision: b.decision, by: USER_NAMES[role], role, at: new Date().toISOString(), ...(b.decision === "Edited" ? { rootCause: text } : {}), ...(comment ? { comment } : {}) };
      ids.forEach(c => { all[`${r.id}/${c}`] = rec; });
      writeJson(path.join(DATA, "rca-reviews.json"), all); return send(res, 200, rec);
    }
    if (p === "/api/qa/catalog") return send(res, 200, readJson(path.join(ROOT, "tests", "catalog.json"), []));
    if (p === "/api/qa/approvals" && req.method === "POST") {
      if (role === "Manager") return deny();
      const b = await readBody(req); const all = readJson(path.join(DATA, "test-approvals.json"), {});
      if (!readJson(path.join(ROOT, "tests", "catalog.json"), []).some(c => c.caseId === b.caseId) || !["Approved", "Changes requested"].includes(b.decision)) return send(res, 422, { error: "Unknown test case or decision." });
      all[b.caseId] = { decision: b.decision, by: USER_NAMES[role], at: new Date().toISOString(), note: String(b.note || "").slice(0, 300) };
      writeJson(path.join(DATA, "test-approvals.json"), all); return send(res, 200, all[b.caseId]);
    }
    if (p === "/api/qa/manual-timings") {
      const f = path.join(DATA, "manual-timings.json");
      if (req.method === "GET") return send(res, 200, readJson(f, []));
      if (role === "Manager") return deny();
      const b = await readBody(req); const all = readJson(f, []);
      if (req.method === "DELETE") { writeJson(f, all.filter(x => x.id !== b.id)); return send(res, 200, { ok: true }); }
      if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
      const seconds = Math.round(Number(b.seconds));
      if (!readJson(path.join(ROOT, "tests", "catalog.json"), []).some(c => c.caseId === b.caseId) || typeof b.seconds !== "number" || !(b.seconds >= 1 && seconds <= 8 * 3600)) return send(res, 422, { error: "A known test case and a time between 1 second and 8 hours are required." });
      const rec = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), caseId: b.caseId, tester: String(b.tester || "").slice(0, 80), seconds, result: ["Pass", "Fail", "Blocked"].includes(b.result) ? b.result : "Pass", at: new Date().toISOString() };
      all.push(rec); writeJson(f, all); return send(res, 200, rec);
    }

    // ---- static ----
    if (p.startsWith("/qa-artifacts/") && serveFile(res, RUNS, p.slice("/qa-artifacts/".length))) return;
    if (p.startsWith("/api/")) return send(res, 404, { error: "Not found" });
    if (serveFile(res, PUB, p === "/" ? "index.html" : p.slice(1))) return;
    serveFile(res, PUB, "index.html") || send(res, 404, { error: "Not found" }); // SPA fallback
  } catch (e) {
    const ref = "ERR-" + Date.now().toString(36).toUpperCase();
    console.error(ref, e); // technical detail stays in the server log
    send(res, 500, { error: `We couldn't complete this request. Please try again or contact support (reference ${ref}).` });
  }
});
server.listen(PORT, () => console.log(`EIM 360 POC (${BUILD.label}) running at http://localhost:${PORT} · database: SQLite ${DB_FILE}`));
module.exports = server;

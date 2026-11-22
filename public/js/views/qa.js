import { icon } from "../icons.js";
import { api, store, esc, fmtUtc, fmtDur, fmtMin, ago, toast, modal, download, pageHead, busy, $, $$ } from "../core.js";
let TICK = null; // the Manual Timing stopwatch interval (module level, so a re-render never leaves one running)

const ST = { passed: ["Passed", "ok", "check-circle-2"], failed: ["Failed", "bad", "x-circle"], review: ["In Review", "violet", "circle-help"], skipped: ["Skipped", "", "circle-dot"] };
const CLS = { "Product defect": "bad", "Test script maintenance": "warn", "Environment / test data": "info" };
const pill = s => `<span class="pill ${ST[s][1]}" data-testid="status-pill">${icon(ST[s][2], 13)}${ST[s][0]}</span>`;
const strip = t => `<div class="result-strip"><i style="width:${t.passed / t.total * 100}%;background:var(--ok)"></i><i style="width:${t.failed / t.total * 100}%;background:var(--bad)"></i><i style="width:${t.review / t.total * 100}%;background:var(--violet)"></i></div>`;
const art = (runId, p) => `/qa-artifacts/${runId}/${p}`;
const SRC_TITLE = { Rules: "Produced by the rule-based triage from this run's evidence", LLM: "Written by the LLM pass from this run's evidence" };
const src = (a, k) => { const v = a.sources && a.sources[k]; if (!v) return ""; const t = SRC_TITLE[v] || `Analyst note ${v}: ${a.knownIssue ? a.knownIssue.author : ""}, reused because this run's failure matches it`; return `<span class="pill" style="font-size:11px;padding:0 6px;margin-left:4px" title="${esc(t)}">${esc(v === "Rules" || v === "LLM" ? v : "Analyst note " + v)}</span>`; };
const PLAN_MIN = 10; // planning estimate per case incl. recording evidence and write-up (same as the business case); replaced by measured timings

const VERDICT = { pass: ["Pass", "ok", "check-circle-2"], fail: ["Fail", "bad", "x-circle"], inconclusive: ["Inconclusive · needs a person", "violet", "circle-help"] };
const usd = v => v == null ? "n/a" : "$" + v.toFixed(v < 0.1 ? 4 : 2);
const secs = ms => (ms / 1000).toFixed(1) + " s";
// what the AI agent decided and did for one case (shown for passed, failed and inconclusive cases alike)
function agentCard(g, runId) {
  const v = VERDICT[g.verdict] || VERDICT.inconclusive;
  const list = (title, xs, tid) => xs && xs.length ? `<div class="small muted" style="margin-top:10px">${title}</div><ul style="margin:4px 0 0;padding-left:18px"${tid ? ` data-testid="${tid}"` : ""}>${xs.map(e => `<li class="small">${esc(e)}</li>`).join("")}</ul>` : "";
  return `<div class="ai-box" data-testid="agent-card"><div class="ai-head">${icon("bot", 17)}AI agent run <span class="pill ${v[1]}" data-testid="agent-verdict">${icon(v[2], 13)}AI verdict: ${v[0]}</span>${g.confidence != null ? `<span class="small muted" style="font-weight:400">confidence ${Math.round(g.confidence * 100)}%</span>` : ""}</div>
    <div class="ai-body">
      <p style="margin:0 0 6px" data-testid="agent-summary">${esc(g.summary)}</p>
      ${g.testData ? `<div class="small muted" style="margin-top:10px">Test data chosen by the AI</div><p class="small" style="margin:2px 0 0">${esc(g.testData)}</p>` : ""}
      ${g.resolutionSteps && g.resolutionSteps.length ? `<div class="small muted" style="margin-top:10px">Resolution steps decided by the AI</div><ol style="margin:4px 0 0;padding-left:18px" data-testid="agent-resolution">${g.resolutionSteps.map(e => `<li class="small mono">${esc(e)}</li>`).join("")}</ol>${g.resolutionRationale ? `<p class="small muted" style="margin:4px 0 0">Why: ${esc(g.resolutionRationale)}</p>` : ""}` : ""}
      <div class="grid g2" style="margin-top:10px"><div><div class="small muted">Expected</div><p class="small" style="margin:2px 0 0">${esc(g.expected)}</p></div><div><div class="small muted">Observed by the AI</div><p class="small" style="margin:2px 0 0" data-testid="agent-actual">${esc(g.actual)}</p></div></div>
      ${list("Evidence the AI checked", g.evidence, "agent-evidence")}
      ${list("Observations (not failures)", g.observations)}
      ${g.queries && g.queries.length ? `<details style="margin-top:10px" data-testid="agent-db"><summary class="small"><b>Database checks by the AI</b> (${g.queries.length} read-only SQL quer${g.queries.length === 1 ? "y" : "ies"} on the live test database)</summary>${g.queries.map(d => `<pre class="mono small" style="white-space:pre-wrap;margin:6px 0 2px">${esc(d.sql)}</pre><div class="small muted">${esc(d.why || "")} → ${d.error ? `error: ${esc(d.error)}` : `${d.rowCount} row(s)${d.sample && d.sample.length ? `: ${esc(JSON.stringify(d.sample).slice(0, 240))}` : ""}`}</div>`).join("")}</details>` : ""}
      <details style="margin-top:10px" data-testid="agent-timeline"><summary class="small"><b>Decision log</b>: ${g.turns} turns, ${g.actions} browser actions decided by the AI</summary><ol style="margin:6px 0 0;padding-left:18px">${(g.timeline || []).map(t => `<li class="small" style="margin-bottom:6px"><b>${esc(t.step)}</b> <span class="muted">· ${secs(t.ms)}</span><div class="muted">${esc(t.thought)}</div>${t.actions.length ? `<div class="mono" style="font-size:11.5px">${t.actions.map(a => esc(`${a.ok === false ? "✗" : "✓"} ${a.type}${a.target ? " " + a.target : ""}${a.value != null && a.type !== "finish" ? " = " + String(a.value).slice(0, 90) : ""}${a.verdict ? " " + a.verdict : ""}${a.error ? " (" + a.error + ")" : ""}`)).join("<br>")}</div>` : ""}</li>`).join("")}</ol></details>
      ${g.audit ? `<p class="small" style="margin:10px 0 0"><a href="/qa-artifacts/${esc(runId)}/${esc(g.audit)}" target="_blank" data-testid="agent-audit">${icon("file-text", 13)} View every AI request and response for this case</a> <span class="muted">(prompts, screenshot fingerprints, raw model output, executed actions)</span></p>` : ""}
      <p class="small muted" style="margin:10px 0 0" data-testid="agent-stats">${esc(g.provider)} <span class="mono">${esc(g.model)}</span> · ${g.calls} model calls · ${(g.usage.input + g.usage.output).toLocaleString()} tokens · ${usd(g.costUsd)} · AI thinking ${secs(g.llmMs)} · case total ${secs(g.wallMs)}</p>
    </div></div>`;
}

async function latestRunId(full) { const r = await api("/api/qa/runs"); const ok = full ? r.find(x => x.complete && !x.envFailures) : r[0]; return (ok || r[0] || {}).id; }

// ------------------------------------------------------------------ runs list
export async function runs(view) {
  const list = await api("/api/qa/runs");
  view.innerHTML = pageHead("AI Test Runs", [["Home", "#/home"], ["Quality Engineering", "#/qa/runs"], ["Test Runs", ""]], "Automated regression runs against the build under test, with AI-assisted triage of every failure.") + `
  <div class="callout" style="margin-bottom:16px">${icon("info", 15)} <b>How it works.</b> In an <b>AI-driven run</b> (<span class="mono">npm run test:agent</span>) the LLM set in <span class="mono">.env</span> (Gemini by default) reads each manual test case and drives Chrome through Playwright: it picks the test data, decides every click and every value it types, including the resolution steps, checks the result on the page and with read-only SQL, and gives a verdict with its reasoning for every case. Playwright only executes its actions and takes a screenshot after each one. In a <b>scripted run</b> (<span class="mono">npm test</span>) Playwright replays tests that were written once and approved, and the LLM triages the failures. Either way, a QA lead approves, edits or rejects every AI root cause before a defect is raised, and inconclusive AI verdicts go to a person.</div>
  <div class="card"><div class="table-wrap"><table class="tbl" data-testid="runs-table"><thead><tr><th>Run</th><th>Build</th><th>Started</th><th>Browser</th><th class="num">Tests</th><th style="width:220px">Results</th><th class="num">Duration</th></tr></thead><tbody>
  ${list.map(r => `<tr class="clickable" data-run="${r.id}"><td><a class="mono" href="#/qa/runs/${r.id}">${r.id}</a></td><td>${esc(r.build.version)}</td><td class="small">${fmtUtc(r.startedAt)}</td><td>${esc(r.browser)} · ${r.workers} workers</td><td class="num">${r.totals.total}</td>
    <td>${strip(r.totals)}<div class="small muted" style="margin-top:4px">${r.totals.passed} passed · ${r.totals.failed} failed · ${r.totals.review} in review</div></td><td class="num">${fmtDur(r.durationMs)}</td></tr>`).join("") || `<tr><td colspan="7"><div class="empty">No runs yet. Run <span class="mono">npm test</span> to execute the suite.</div></td></tr>`}
  </tbody></table></div></div>`;
  $$("[data-run]").forEach(tr => tr.onclick = e => { if (!e.target.closest("a")) location.hash = "#/qa/runs/" + tr.dataset.run; });
}

// ------------------------------------------------------------------ run detail
export async function run(view, id) {
  const r = await api("/api/qa/runs/" + id);
  const filter = new URLSearchParams(location.hash.split("?")[1] || "").get("s") || "all";
  const t = r.totals;
  const failed = r.tests.filter(x => x.status === "failed");
  const groups = [];
  failed.forEach(x => { const a = x.analysis || { rootCause: x.error.message, classification: "Unclassified", nextSteps: [] }; const key = a.signature || (a.knownIssue ? a.knownIssue.id : a.classification + a.rootCause); let g = groups.find(y => y.key === key); if (!g) groups.push(g = { key, a, title: (a.defect && a.defect.title) || (a.classification === "Test script maintenance" ? "Renamed control: test locator out of date" : x.title), tests: [] }); g.tests.push(x); });
  groups.sort((p, q) => q.tests.length - p.tests.length);
  const byCls = {}; failed.forEach(x => { const c = x.analysis ? x.analysis.classification : "Unclassified"; byCls[c] = (byCls[c] || 0) + 1; });
  const shown = r.tests.filter(x => filter === "all" || x.status === filter);
  const execMs = r.tests.reduce((a, x) => a + x.durationMs, 0);
  const T = (r.ai && r.ai.triage) || null, rev = failed.filter(x => x.rcaReview), pend = failed.filter(x => x.analysis && !x.rcaReview).length;
  const G = r.ai && r.ai.agent;
  const agentSummary = G ? `<div class="card" style="margin-bottom:16px" data-testid="agent-summary-card"><div class="card-body"><div class="row" style="gap:18px;flex-wrap:wrap">
    <span>${icon("bot", 15)} <b>AI-driven run</b> · ${esc(G.provider)} <span class="mono">${esc(G.model)}</span> decided every step of <b>${G.cases}</b> cases: <b>${G.verdicts.pass}</b> pass · <b>${G.verdicts.fail}</b> fail · <b>${G.verdicts.inconclusive}</b> inconclusive</span>
    <span class="small muted">${G.actions} browser actions · ${G.queries} read-only SQL checks · ${G.calls} model calls · ${(G.inputTokens + G.outputTokens).toLocaleString()} tokens · ${usd(G.costUsd)} (${usd(G.avgCostPerCase)} per case) · ${secs(G.avgCaseMs)} per case on average</span>
    <span class="spacer"></span>${failed.length ? `<span data-testid="rca-review-count">${icon("user-check", 15)} Human review: <b>${rev.filter(x => x.rcaReview.decision !== "Rejected").length}</b> accepted · <b>${rev.filter(x => x.rcaReview.decision === "Rejected").length}</b> rejected · <b>${pend}</b> pending</span>` : ""}</div></div></div>` : "";
  const aiCard = G ? agentSummary : failed.length ? `<div class="card" style="margin-bottom:16px" data-testid="ai-triage-summary"><div class="card-body"><div class="row" style="gap:18px;flex-wrap:wrap">
    <span>${icon("bot", 15)} <b>AI triage</b> · ${T && T.llmAnalysed ? `${esc(T.provider)} <span class="mono">${esc(T.model)}</span> analysed <b>${T.llmAnalysed}/${T.failures}</b> failures${T.withScreenshot ? " with screenshots" : ""}` : `LLM off for this run${T && T.llmErrors && T.llmErrors.length ? ` (error: ${esc(T.llmErrors[0].slice(0, 90))})` : " (rules and analyst notes only)"}`}</span>
    ${T && T.llmAnalysed ? `<span class="small muted">${(T.inputTokens + T.outputTokens).toLocaleString()} tokens${T.costUsd != null ? ` · $${T.costUsd.toFixed(4)}` : ""} · ${(T.wallMs / 1000).toFixed(1)} s · agrees with rules on ${T.agreesWithRules}/${T.llmAnalysed}</span>` : ""}
    ${r.conditions ? `<span class="small muted" data-testid="run-timing">Playwright ${((r.conditions.playwrightMs || r.durationMs) / 1000).toFixed(1)} s · AI triage ${((r.conditions.triageMs || 0) / 1000).toFixed(1)} s${r.conditions.latencyMs ? ` · simulated latency ${r.conditions.latencyMs} ms per API call` : ""}</span>` : ""}
    <span class="spacer"></span><span data-testid="rca-review-count">${icon("user-check", 15)} Human review: <b>${rev.filter(x => x.rcaReview.decision !== "Rejected").length}</b> accepted · <b>${rev.filter(x => x.rcaReview.decision === "Rejected").length}</b> rejected · <b>${pend}</b> pending</span></div></div></div>` : "";
  view.innerHTML = pageHead(`Test Run · ${fmtUtc(r.startedAt).slice(0, 16)} UTC`, [["Home", "#/home"], ["Quality Engineering", "#/qa/runs"], ["Run", ""]], `${esc(r.id)} · build ${esc(r.build.label)} · ${esc(r.browser)} · ${r.workers} parallel workers`) + `
  <div class="grid g4" style="margin-bottom:16px">
    <div class="card kpi"><div class="label">${icon("list-checks", 15)}Test cases executed</div><div class="value" data-testid="run-total">${t.total}</div><div class="foot">${r.tests.reduce((a, x) => a + x.steps.length, 0)} steps · ${r.tests.reduce((a, x) => a + x.steps.filter(s => s.screenshot).length, 0)} screenshots</div></div>
    <div class="card kpi"><div class="label">${icon("timer", 15)}Wall-clock duration</div><div class="value">${fmtDur(r.durationMs)}</div><div class="foot">${fmtDur(execMs)} of test time across workers</div></div>
    <div class="card kpi"><div class="label">${icon("check-circle-2", 15)}Pass rate (excl. in review)</div><div class="value">${Math.round(t.passed / (t.passed + t.failed) * 100)}%</div><div class="foot">${t.passed} passed · ${t.failed} failed</div></div>
    <div class="card kpi"><div class="label">${icon("bug", 15)}Failures triaged</div><div class="value">${failed.filter(x => x.analysis).length}/${failed.length}</div><div class="foot">${Object.entries(byCls).map(([c, n]) => `${n} ${c.toLowerCase()}`).join(" · ") || "no failures"}</div></div>
  </div>
  <div class="card" style="margin-bottom:16px"><div class="card-body">${strip(t)}<div class="row small" style="margin-top:8px"><span><span class="dot" style="color:var(--ok)"></span> ${t.passed} passed</span><span><span class="dot" style="color:var(--bad)"></span> ${t.failed} failed</span><span><span class="dot" style="color:var(--violet)"></span> ${t.review} in review</span><span class="spacer"></span><a class="small" href="${art(r.id, "report/index.html")}" target="_blank" rel="noopener">${icon("external-link", 13)} Playwright HTML report</a></div></div></div>
  ${aiCard}
  ${failed.length ? `<div class="card" style="margin-bottom:16px"><div class="card-head"><h2>${icon("bug", 17)}Failure triage · ${failed.length} failures, ${groups.length} root cause${groups.length === 1 ? "" : "s"}</h2><span class="small muted">Failures with the same cause are grouped · review before raising defects</span></div>
    <div class="table-wrap"><table class="tbl" data-testid="triage-groups"><thead><tr><th>Root cause</th><th>Classification</th><th>Cases affected</th><th>Next step</th><th>QA review</th></tr></thead><tbody>
    ${groups.map(g => `<tr><td style="max-width:420px"><b>${esc(g.title)}</b><div class="small muted">${esc(g.a.rootCause.slice(0, 180))}${g.a.rootCause.length > 180 ? "…" : ""}</div></td><td><span class="pill ${CLS[g.a.classification] || ""}">${esc(g.a.classification)}</span></td>
      <td>${g.tests.map(x => `<a class="pill" style="margin:0 4px 4px 0" href="#/qa/runs/${r.id}/${x.idx}">${x.caseId}</a>`).join("")}</td><td class="small" style="max-width:280px">${esc(g.a.nextSteps[0] || "")}</td><td class="small">${(() => { const d = g.tests.filter(x => x.rcaReview); return d.length === g.tests.length ? `<span class="pill ${d.some(x => x.rcaReview.decision === "Rejected") ? "warn" : "ok"}">${esc([...new Set(d.map(x => x.rcaReview.decision))].join(" / "))}</span>` : `<span class="pill violet">${g.tests.length - d.length} pending</span>`; })()}</td></tr>`).join("")}
    </tbody></table></div></div>` : ""}
  <div class="card"><div class="tabs">${[["all", "All", t.total], ["passed", "Passed", t.passed], ["failed", "Failed", t.failed], ["review", "In Review", t.review]].map(([k, l, n]) => `<button class="tab ${filter === k ? "active" : ""}" data-f="${k}" data-testid="qa-tab-${k}">${l}<span class="count">${n}</span></button>`).join("")}</div>
  <div class="table-wrap"><table class="tbl" data-testid="tests-table"><thead><tr><th>Status</th><th>Case</th><th>Test</th><th>Suite</th><th class="num">Steps</th>${G ? `<th class="num">AI cost</th>` : ""}<th class="num">Duration</th></tr></thead><tbody>
  ${shown.map(x => `<tr class="clickable" data-test="${x.idx}"><td>${pill(x.status)}</td><td class="mono">${x.caseId}</td><td>${esc(x.title)}${x.agent ? `<div class="small muted">${esc(x.agent.summary.slice(0, 140))}${x.agent.summary.length > 140 ? "…" : ""}</div>` : ""}${x.status === "review" && !x.agent ? `<div class="small muted">AI-generated · awaiting engineer approval${x.approval ? ` · ${x.approval.decision} by ${esc(x.approval.by)}` : ""}</div>` : ""}</td><td>${esc(x.suite || x.area)}</td><td class="num">${x.steps.length}</td>${G ? `<td class="num small">${x.agent ? usd(x.agent.costUsd) : ""}</td>` : ""}<td class="num">${fmtDur(x.durationMs)}</td></tr>`).join("")}
  </tbody></table></div></div>`;
  $$("[data-f]").forEach(b => b.onclick = () => location.hash = `#/qa/runs/${r.id}` + (b.dataset.f === "all" ? "" : "?s=" + b.dataset.f));
  $$("[data-test]").forEach(tr => tr.onclick = () => location.hash = `#/qa/runs/${r.id}/${tr.dataset.test}`);
}

// ------------------------------------------------------------------ single test
export async function test(view, id, idx) {
  const [r, catalog] = await Promise.all([api("/api/qa/runs/" + id), api("/api/qa/catalog")]);
  const x = r.tests.find(t => String(t.idx) === String(idx));
  if (!x) throw new Error("Test not found in this run.");
  const c = catalog.find(k => k.caseId === x.caseId) || { steps: [], expected: "" };
  const a = x.analysis, rv = x.rcaReview;
  const group = a ? r.tests.filter(t => t.status === "failed" && t.analysis && t.analysis.signature === a.signature).map(t => t.caseId) : [];
  const finalRoot = rv && rv.decision === "Edited" ? rv.rootCause : a && a.rootCause;
  const pos = r.tests.indexOf(x);
  const nav = k => r.tests[pos + k] ? `#/qa/runs/${r.id}/${r.tests[pos + k].idx}` : null;
  const defectMd = a && a.defect ? `# ${a.defect.title}\n\n**Severity:** ${a.defect.severity}  \n**Found by:** AI test agent, run ${r.id} (${x.caseId})${rv ? `  \n**Root cause reviewed by:** ${rv.by} (${rv.decision})` : ""}  \n**Build:** ${r.build.version} · ${r.browser}\n\n## Steps to reproduce\n${a.defect.steps.map((s, k) => `${k + 1}. ${s}`).join("\n")}\n\n## Expected\n${a.defect.expected}\n\n## Actual\n${a.defect.actual}\n\n## Evidence\n${a.evidence.map(e => "- " + e).join("\n")}\n\n## Suspected cause\n${finalRoot}\n` : "";

  const failLoc = x.error && x.error.location ? `${x.error.location.file}:${x.error.location.line}` : x.file;
  const whatFailed = x.status !== "failed" ? "" : `<div class="card"><div class="card-head"><h2>${icon("x-circle", 17)}What failed</h2></div><div class="card-body">
      <div class="small muted">${x.error.byAgent ? "Decided by" : "Failed at step"}</div><div style="margin-bottom:10px"><b>${x.error.byAgent ? `The AI agent's verdict after ${x.steps.length} steps` : esc((x.steps.find(s => s.status === "failed") || {}).title || "—")}</b></div>
      ${x.error.expected != null || x.error.actual != null ? `<div class="compare" style="margin-bottom:10px"><div class="box exp"><b>Expected</b><span class="mono" data-testid="expected">${esc(x.error.expected)}</span></div><div class="box act"><b>Actual</b><span class="mono" data-testid="actual">${esc(x.error.actual)}</span></div></div>` : ""}
      <div class="logbox" data-testid="error-message">${esc(x.error.message)}</div>
      ${x.artifacts.trace ? `<p class="small muted" style="margin-bottom:0">${icon("download", 13)} <a href="${art(r.id, x.artifacts.trace)}">Download Playwright trace</a> · open with <span class="mono">npx playwright show-trace</span></p>` : ""}
    </div></div>`;
  const evidenceCard = `<div class="card"><div class="card-head"><h2>${icon("camera", 17)}Step-by-step evidence</h2><span class="small muted">${x.steps.length} steps · click to enlarge</span></div><div class="card-body">
      <div class="shot-grid" data-testid="screenshots">${x.steps.map((s, k) => `<figure class="shot ${s.status === "failed" ? "failed" : ""}" style="margin:0" data-shot="${k}">${s.screenshot ? `<img loading="lazy" src="${art(r.id, s.screenshot)}" alt="Screenshot after step ${k + 1}: ${esc(s.title)}">` : `<div class="empty small" style="aspect-ratio:16/10;display:grid;place-items:center">API check · no screenshot</div>`}
        <figcaption class="cap">${icon(s.status === "failed" ? "x-circle" : "check-circle-2", 13)}<span>${k + 1}. ${esc(s.title)}</span><span class="spacer"></span><span class="muted">${fmtDur(s.durationMs)}</span></figcaption></figure>`).join("")}</div></div></div>`;
  const manualCard = `<div class="card"><div class="card-head"><h2>${icon("list-checks", 17)}Manual test case</h2><span class="pill">${esc(c.priority || "")}</span></div><div class="card-body">
      <div class="small muted">Role${c.preconditions ? " · preconditions" : ""}</div><p style="margin:2px 0 10px">${esc(c.role || "")}${c.preconditions ? " · " + esc(c.preconditions) : ""}</p>
      <div class="small muted">Steps a tester follows</div><ol style="margin:4px 0 10px;padding-left:18px">${c.steps.map(s => `<li class="small">${esc(s)}</li>`).join("")}</ol>
      <div class="small muted">Expected result</div><p style="margin:2px 0 0">${esc(c.expected)}</p></div></div>`;
  const rca = x.status !== "failed" ? "" : `<div class="ai-box" data-testid="rca"><div class="ai-head">${icon("bot", 17)}Root-cause analysis ${a ? `<span class="pill ${CLS[a.classification] || ""}" data-testid="rca-class">${esc(a.classification)}</span>` : ""}</div>
      <div class="ai-body">${a ? `
        ${rv && rv.decision === "Edited" ? `<div class="small muted">Root cause <span class="pill ok" style="font-size:11px;padding:0 6px;margin-left:4px">Edited by ${esc(rv.by)}</span></div><p style="margin:2px 0 6px" data-testid="rca-root">${esc(rv.rootCause)}</p><details style="margin-bottom:10px"><summary class="small muted">AI draft ${src(a, "rootCause")}</summary><p class="small" style="margin:4px 0 0">${esc(a.rootCause)}</p></details>`
          : `<div class="small muted">Root cause ${src(a, "rootCause")}${a.llm && a.llm.confidence != null ? ` <span class="small muted">· model confidence ${Math.round(a.llm.confidence * 100)}%</span>` : ""}</div><p style="margin:2px 0 10px" data-testid="rca-root">${esc(a.rootCause)}</p>`}
        <div class="small muted">Affected component ${src(a, "component")}</div><p style="margin:2px 0 10px" class="mono">${esc(a.component)}</p>
        <div class="small muted">Evidence</div><ul style="margin:4px 0 4px;padding-left:18px">${a.evidence.map(e => `<li class="small">${esc(e)}</li>`).join("")}</ul>
        ${a.codeRefs && a.codeRefs.length ? `<details class="refs" style="margin-bottom:10px"><summary>Code references (${a.codeRefs.length})</summary><pre class="code">${a.codeRefs.map(c => esc(`${c.file}:${c.line}\n    ${c.text}`)).join("\n")}</pre></details>` : `<div style="height:6px"></div>`}
        <div class="small muted">Recommended next steps ${src(a, "nextSteps")}</div><ol style="margin:4px 0 0;padding-left:18px" data-testid="rca-next">${a.nextSteps.map(e => `<li>${esc(e)}</li>`).join("")}</ol>
        ${a.narrative ? `<hr class="sep"><div class="small muted">Summary ${src(a, "narrative")}</div><p style="margin:2px 0 0">${esc(a.narrative)}</p>` : ""}
        ${a.llm && a.ruleView ? `<details style="margin-top:10px" data-testid="rca-compare"><summary class="small">${a.agreesWithRules ? `${icon("check", 13)} Agrees` : `${icon("alert-triangle", 13)} Differs`} with the ${esc(a.ruleView.source === "Rules" ? "rule-based triage" : a.ruleView.source)} on classification</summary><p class="small" style="margin:4px 0 0"><b>${esc(a.ruleView.classification)}</b>: ${esc(a.ruleView.rootCause)}</p></details>` : ""}
        ${a.dbQueries && a.dbQueries.length ? `<details style="margin-top:10px" data-testid="rca-db" open><summary class="small"><b>Database checks by the AI</b> (${a.agentRun ? "read-only SQL on the live test database during the run" : "read-only SQL on the snapshot taken at failure"})</summary>${a.dbQueries.map(d => `<pre class="mono small" style="white-space:pre-wrap;margin:6px 0 2px">${esc(d.sql)}</pre><div class="small muted">${esc(d.why || "")} → ${d.error ? `error: ${esc(d.error)}` : `${d.rowCount} row(s)${d.sample && d.sample.length ? `: ${esc(JSON.stringify(d.sample).slice(0, 220))}` : ""}`}</div>`).join("")}${a.dbFindings ? `<p class="small" style="margin:6px 0 0"><b>Finding:</b> ${esc(a.dbFindings)}</p>` : ""}</details>` : ""}
        ${a.llmAudit ? `<p class="small" style="margin:10px 0 0"><a href="/qa-artifacts/${esc(r.id)}/${esc(a.llmAudit)}" target="_blank" data-testid="llm-audit">${icon("file-text", 13)} View the exact AI request and response</a> <span class="muted">(prompt, screenshot fingerprint, raw model output)</span></p>` : ""}
        <p class="small muted" style="margin:12px 0 0">${esc(a.engine)}${a.llm ? ` · ${(a.llm.latencyMs / 1000).toFixed(1)} s${a.llm.usage ? ` · ${a.llm.usage.input + a.llm.usage.output} tokens` : ""}${a.llm.costUsd != null ? ` · $${a.llm.costUsd.toFixed(4)}` : ""}` : ""}</p>
        <hr class="sep"><div data-testid="rca-review">${rv ? `<div class="row"><span class="pill ${rv.decision === "Rejected" ? "bad" : "ok"}" data-testid="rca-review-status">${icon(rv.decision === "Rejected" ? "x-circle" : "user-check", 13)}${esc(rv.decision)} by ${esc(rv.by)}</span><span class="small muted">${ago(rv.at)}${rv.comment ? ` · “${esc(rv.comment)}”` : ""}</span></div>`
          : `<div class="row"><span class="pill violet" data-testid="rca-review-status">${icon("circle-help", 13)}AI draft · awaiting QA review</span><span class="small muted">A person approves, edits or rejects the root cause before a defect is raised.</span></div>`}
          ${store.role === "Manager" ? "" : `<div class="row" style="margin-top:10px;flex-wrap:wrap"><button class="btn sm primary" data-rca="Approved" data-testid="rca-approve">${icon("check", 14)}Approve</button><button class="btn sm" data-rca="Edited" data-testid="rca-edit">${icon("pencil", 14)}Edit</button><button class="btn sm" data-rca="Rejected" data-testid="rca-reject">${icon("x", 14)}Reject</button>
          ${group.length > 1 ? `<label class="small row" style="gap:6px;margin-left:6px"><input type="checkbox" id="rca-all" checked> Apply to all ${group.length} cases with this cause</label>` : ""}</div>
          <div id="rca-form" style="display:none;margin-top:10px"><textarea class="input" id="rca-text" rows="4" style="width:100%" data-testid="rca-text"></textarea><div class="row" style="margin-top:6px"><button class="btn sm primary" id="rca-save" data-testid="rca-save">Save</button><button class="btn sm" id="rca-cancel">Cancel</button><span class="small muted" id="rca-hint"></span></div></div>`}</div>` : `<span class="muted">No analysis available for this failure.</span>`}</div></div>`;
  const fix = a && a.suggestedFix ? `<div class="card" style="margin-top:16px"><div class="card-head"><h2>${icon("wrench", 17)}${a.suggestedFix.type === "test" ? "Suggested test update (locator repair)" : "Suggested product fix"}</h2><span class="small muted"><span class="mono">${esc(a.suggestedFix.file)}</span> ${src(a, "fix")}</span></div><div class="card-body">
    <pre class="code" data-testid="suggested-fix">${a.suggestedFix.before.split("\n").map(l => `<span class="del">- ${esc(l)}</span>`).join("")}${a.suggestedFix.after ? a.suggestedFix.after.split("\n").map(l => `<span class="add">+ ${esc(l)}</span>`).join("") : ""}</pre>
    <p class="small muted" style="margin:8px 0 0">${esc(a.suggestedFix.note || "")}</p></div></div>` : "";
  const ok = rv && rv.decision !== "Rejected";
  const defect = a && a.defect && !(rv && rv.decision === "Rejected") ? `<div class="card" style="margin-top:16px" data-testid="defect"><div class="card-head"><h2>${icon("bug", 17)}${ok ? "Defect report" : "Draft defect report"}</h2><div class="row">${ok ? "" : `<span class="small muted">Approve the root cause to release it</span>`}<button class="btn sm" id="copy-defect" ${ok ? "" : "disabled"}>${icon("copy", 14)}Copy</button><button class="btn sm" id="dl-defect" ${ok ? "" : "disabled"}>${icon("download", 14)}.md</button><a class="btn sm${ok ? "" : " disabled"}" data-testid="dl-docx" ${ok ? `href="/api/qa/runs/${esc(r.id)}/${esc(x.caseId)}/report.docx"` : 'aria-disabled="true"'}>${icon("download", 14)}Word</a><a class="btn sm${ok ? "" : " disabled"}" data-testid="dl-pdf" ${ok ? `href="/api/qa/runs/${esc(r.id)}/${esc(x.caseId)}/report.pdf"` : 'aria-disabled="true"'}>${icon("download", 14)}PDF</a></div></div><div class="card-body">
    <div class="row" style="margin-bottom:8px"><b data-testid="defect-title">${esc(a.defect.title)}</b><span class="pill ${a.defect.severity.startsWith("High") ? "bad" : "warn"}">${esc(a.defect.severity)}</span></div>
    <div class="grid g2"><div><div class="small muted">Steps to reproduce</div><ol style="margin:4px 0 0;padding-left:18px">${a.defect.steps.map(s => `<li>${esc(s)}</li>`).join("")}</ol></div>
    <div><div class="small muted">Expected</div><p style="margin:2px 0 8px">${esc(a.defect.expected)}</p><div class="small muted">Actual</div><p style="margin:2px 0 0">${esc(a.defect.actual)}</p></div></div></div></div>` : "";
  const review = x.status !== "review" ? "" : `<div class="card" style="margin-bottom:16px" data-testid="review-panel"><div class="card-head"><h2>${icon("circle-help", 17)}${x.agent ? "AI verdict inconclusive · a QA engineer decides" : "Awaiting engineer approval"}</h2>${x.approval ? `<span class="pill ${x.approval.decision === "Approved" ? "ok" : "warn"}">${esc(x.approval.decision)} by ${esc(x.approval.by)} · ${ago(x.approval.at)}</span>` : ""}</div><div class="card-body">
    <p style="margin-top:0">${esc(x.reviewReason || "This test was written by the AI agent and has not yet been reviewed.")}</p>
    ${store.role === "Manager" ? `<p class="small muted" style="margin:0">Managers have view-only access; an engineer approves tests.</p>` : `<div class="row"><button class="btn primary" data-decision="Approved">${icon("check", 15)}${x.agent ? "Mark as passed" : "Approve test"}</button><button class="btn" data-decision="Changes requested">${x.agent ? "Needs investigation" : "Request changes"}</button></div>`}</div></div>`;

  view.innerHTML = pageHead(x.caseId, [["Home", "#/home"], ["Quality Engineering", "#/qa/runs"], [`Run ${r.id}`, `#/qa/runs/${r.id}`], [x.caseId, ""]], esc(x.title)) + `
  <div class="row" style="margin-bottom:14px"><a class="btn" href="#/qa/runs/${r.id}">${icon("arrow-left", 15)}Back to run</a>${pill(x.status)}<span class="small muted">${esc(x.area)} · ${esc(failLoc)} · ${fmtDur(x.durationMs)}</span><span class="spacer"></span>
    ${nav(-1) ? `<a class="btn sm" href="${nav(-1)}">${icon("arrow-left", 14)}Previous</a>` : ""}${nav(1) ? `<a class="btn sm" href="${nav(1)}">Next${icon("chevron-right", 14)}</a>` : ""}</div>
  ${review}
  ${x.status === "failed" ? `<div class="grid g2" style="align-items:start"><div class="stack">${whatFailed}${evidenceCard}</div><div class="stack">${x.agent ? agentCard(x.agent, r.id) : ""}${rca}${manualCard}</div></div>${fix}${defect}`
    : x.agent ? `<div class="grid g2" style="align-items:start"><div class="stack">${evidenceCard}</div><div class="stack">${agentCard(x.agent, r.id)}${manualCard}</div></div>`
    : `<div class="grid g-side" style="align-items:start">${evidenceCard}${manualCard}</div>`}`;
  $$("[data-shot]").forEach(f => f.onclick = () => { const s = x.steps[f.dataset.shot]; if (s.screenshot) modal(`Step ${Number(f.dataset.shot) + 1}: ${s.title}`, `<img src="${art(r.id, s.screenshot)}" alt="">`); });
  $$("[data-decision]").forEach(b => b.onclick = e => busy(e.currentTarget, async () => {
    try { await api("/api/qa/approvals", { method: "POST", body: { caseId: x.caseId, decision: b.dataset.decision } }); toast(`${x.caseId}: ${b.dataset.decision}`); test(view, id, idx); } catch (er) { toast(er.message, "error"); }
  }));
  $$("[data-rca]").forEach(b => b.onclick = () => {
    const d = b.dataset.rca, ids = $("#rca-all") && $("#rca-all").checked ? group : [x.caseId];
    const send = (body, el) => busy(el, async () => { try { await api("/api/qa/rca-review", { method: "POST", body: { runId: r.id, caseIds: ids, decision: d, ...body } }); toast(`Root cause ${d.toLowerCase()} for ${ids.length} case${ids.length > 1 ? "s" : ""}`); test(view, id, idx); } catch (er) { toast(er.message, "error"); } });
    if (d === "Approved") return send({}, b);
    $("#rca-form").style.display = ""; $("#rca-text").value = d === "Edited" ? (finalRoot || "") : ""; $("#rca-hint").textContent = d === "Edited" ? "Correct the root cause; the defect report uses your text." : "Say why the AI root cause is wrong (required).";
    $("#rca-text").focus(); $("#rca-cancel").onclick = () => { $("#rca-form").style.display = "none"; };
    $("#rca-save").onclick = e => send(d === "Edited" ? { rootCause: $("#rca-text").value } : { comment: $("#rca-text").value }, e.currentTarget);
  });
  if ($("#copy-defect")) {
    $("#copy-defect").onclick = async () => { try { await navigator.clipboard.writeText(defectMd); toast("Defect report copied"); } catch { toast("Clipboard is not available", "error"); } };
    $("#dl-defect").onclick = () => download(`${x.caseId}_defect.md`, defectMd, "text/markdown");
  }
}

// ------------------------------------------------------------------ catalog
export async function cases(view) {
  const [catalog, rid] = await Promise.all([api("/api/qa/catalog"), latestRunId()]);
  const run = rid ? await api("/api/qa/runs/" + rid) : null;
  const res = id => run && run.tests.find(t => t.caseId === id);
  view.innerHTML = pageHead("Test Case Catalog", [["Home", "#/home"], ["Quality Engineering", "#/qa/runs"], ["Test Cases", ""]], `${catalog.length} test cases: ${catalog.filter(c => c.clientRef).length} from the client TS_REGRESSION workbook (Smoke, Regression, Must Do, Combinations) plus ${catalog.filter(c => !c.clientRef).length} POC cases, each mapped to an AI-written Playwright test.`) + `
  <div class="card"><div class="table-wrap"><table class="tbl" data-testid="catalog-table"><thead><tr><th>Case</th><th>Client ref</th><th>Title</th><th>Suite</th><th>Priority</th><th class="num">Steps</th><th>Latest result</th></tr></thead><tbody>
  ${catalog.map(c => { const t = res(c.caseId); return `<tr ${t ? `class="clickable" data-go="#/qa/runs/${run.id}/${t.idx}"` : ""}><td class="mono">${c.caseId}</td><td class="mono small">${esc(c.clientRef || "—")}</td><td>${esc(c.title)}</td><td>${esc(c.suite || "")}</td><td>${esc(c.priority)}</td><td class="num">${c.steps.length}</td><td>${t ? pill(t.status) : `<span class="muted small">Not run</span>`}</td></tr>`; }).join("")}
  </tbody></table></div></div>`;
  $$("[data-go]").forEach(tr => tr.onclick = () => location.hash = tr.dataset.go);
}

// ------------------------------------------------------------------ manual timing (stopwatch)
export async function timing(view) {
  const [catalog, timings] = await Promise.all([api("/api/qa/catalog"), api("/api/qa/manual-timings")]);
  const canEdit = store.role !== "Manager";
  clearInterval(TICK); TICK = null;
  let sel = catalog[0].caseId, start = null, acc = 0;
  const fmt = s => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  view.innerHTML = pageHead("Manual Timing", [["Home", "#/home"], ["Quality Engineering", "#/qa/runs"], ["Manual Timing", ""]], "Time a tester executing each case by hand. These measurements feed the Manual vs AI comparison.") + `
  <div class="grid g-side" style="align-items:start">
    <div class="card"><div class="card-head"><h2>${icon("timer", 17)}Stopwatch</h2></div><div class="card-body">
      <div class="grid g2"><div class="field"><label for="case">Test case</label><select class="input" id="case" data-testid="timing-case">${catalog.map(c => `<option value="${c.caseId}">${c.caseId} · ${esc(c.title)}</option>`).join("")}</select></div>
      <div class="field"><label for="tester">Tester</label><input class="input" id="tester" value="${esc(store.user)}"></div></div>
      <div class="row" style="margin:18px 0"><span class="stopwatch" id="clock" data-testid="clock">00:00</span><span class="spacer"></span>
        <button class="btn primary" id="start">${icon("play", 15)}Start</button><button class="btn" id="pause" disabled>Pause</button><button class="btn" id="reset" disabled>${icon("rotate-ccw", 15)}Reset</button></div>
      <div class="row"><label class="small" for="result">Result</label><select class="input" id="result" style="width:130px"><option>Pass</option><option>Fail</option><option>Blocked</option></select><span class="spacer"></span><button class="btn primary" id="save" disabled data-testid="save-timing">Save timing</button></div>
      <hr class="sep"><div class="small muted">Steps to execute</div><ol id="steps" style="margin:6px 0 0;padding-left:18px"></ol><div class="small muted" style="margin-top:8px">Expected</div><p id="expected" style="margin:2px 0 0"></p>
      <div class="callout" style="margin-top:14px">Open the app in a second tab, press <b>Start</b>, perform the steps exactly as written, confirm the expected result, then press <b>Pause</b> and <b>Save timing</b>.</div>
    </div></div>
    <div class="card"><div class="card-head"><h2>Recorded timings</h2><span class="small muted" data-testid="timing-count">${timings.length} recorded</span></div>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>Case</th><th>Tester</th><th class="num">Time</th><th>Result</th><th></th></tr></thead><tbody>
      ${timings.slice().reverse().map(t => `<tr><td class="mono">${t.caseId}</td><td>${esc(t.tester)}</td><td class="num">${fmt(t.seconds)}</td><td>${esc(t.result)}</td><td>${canEdit ? `<button class="btn sm btn-icon" data-del="${t.id}" aria-label="Delete timing">${icon("x", 14)}</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="5"><div class="empty">No manual timings recorded yet.</div></td></tr>`}
      </tbody></table></div></div>
  </div>`;
  const showCase = () => { const c = catalog.find(k => k.caseId === sel); $("#steps").innerHTML = c.steps.map(s => `<li>${esc(s)}</li>`).join(""); $("#expected").textContent = c.expected; };
  const secs = () => acc + (start ? (Date.now() - start) / 1000 : 0);
  const draw = () => { const c = $("#clock"); if (!c) { clearInterval(TICK); return; } c.textContent = fmt(secs()); };
  const lock = on => { $("#case").disabled = on; };
  showCase();
  $("#case").onchange = e => { sel = e.target.value; showCase(); };
  $("#start").onclick = () => { start = Date.now(); clearInterval(TICK); TICK = setInterval(draw, 250); lock(true); $("#start").disabled = true; $("#pause").disabled = false; $("#reset").disabled = false; $("#save").disabled = true; };
  $("#pause").onclick = () => { acc = secs(); start = null; clearInterval(TICK); draw(); $("#start").disabled = false; $("#start").lastChild.textContent = "Resume"; $("#pause").disabled = true; $("#save").disabled = !canEdit || acc < 1; };
  $("#reset").onclick = () => { acc = 0; start = null; clearInterval(TICK); draw(); lock(false); $("#start").disabled = false; $("#start").lastChild.textContent = "Start"; $("#pause").disabled = true; $("#save").disabled = true; };
  $("#save").onclick = e => busy(e.currentTarget, async () => {
    try { await api("/api/qa/manual-timings", { method: "POST", body: { caseId: sel, tester: $("#tester").value, seconds: Math.round(acc), result: $("#result").value } }); toast(`Saved ${fmt(acc)} for ${sel}`); timing(view); } catch (er) { toast(er.message, "error"); }
  });
  $$("[data-del]").forEach(b => b.onclick = e => busy(e.currentTarget, async () => {
    if (start || acc) { toast("Save or reset the running timing first.", "error"); return; }
    if (!confirm("Delete this timing?")) return;
    try { await api("/api/qa/manual-timings", { method: "DELETE", body: { id: b.dataset.del } }); timing(view); } catch (er) { toast(er.message, "error"); }
  }));
  window.addEventListener("hashchange", () => { clearInterval(TICK); TICK = null; }, { once: true });
}

// ------------------------------------------------------------------ manual vs AI
export async function compare(view) {
  const [catalog, timings, rid] = await Promise.all([api("/api/qa/catalog"), api("/api/qa/manual-timings"), latestRunId(true)]);
  if (!rid) { view.innerHTML = pageHead("Manual vs AI", [["Home", "#/home"], ["Manual vs AI", ""]]) + `<div class="card"><div class="empty">Run the suite first (npm test).</div></div>`; return; }
  const run = await api("/api/qa/runs/" + rid);
  const avg = {}; timings.filter(t => t.seconds >= 1).forEach(t => (avg[t.caseId] = avg[t.caseId] || []).push(t.seconds));
  Object.keys(avg).forEach(k => avg[k] = avg[k].reduce((a, b) => a + b, 0) / avg[k].length);
  const measured = Object.keys(avg).length;
  const meanManual = measured ? Object.values(avg).reduce((a, b) => a + b, 0) / measured : PLAN_MIN * 60;
  const basis = measured ? `measured average of ${measured} timed case${measured > 1 ? "s" : ""}` : `planning estimate of ${PLAN_MIN} min per case (no manual timings recorded yet)`;
  const N = catalog.length;
  const manualSuiteSec = meanManual * N;
  const aiWallSec = run.durationMs / 1000;
  const speed = manualSuiteSec / aiWallSec;
  const proj = { cases: 300, runs: 22, hours: 140 };
  const perCaseAi = aiWallSec / run.tests.length;
  const steps = run.tests.reduce((a, x) => a + x.steps.length, 0), shots = run.tests.reduce((a, x) => a + x.steps.filter(s => s.screenshot).length, 0);
  const execSec = run.tests.reduce((a, x) => a + x.durationMs, 0) / 1000;
  view.innerHTML = pageHead("Manual vs AI", [["Home", "#/home"], ["Quality Engineering", "#/qa/runs"], ["Manual vs AI", ""]], `Run ${run.id} · manual basis: ${basis}`) + `
  ${measured ? "" : `<div class="callout" style="margin-bottom:16px" data-testid="estimate-banner">${icon("info", 15)} No manual timings have been recorded yet, so the manual side uses a <b>planning estimate</b> of ${PLAN_MIN} minutes per case (navigate, switch role where needed, perform 2–4 steps, check the result, capture a screenshot and log the outcome). Record real timings on the <a href="#/qa/timing">Manual Timing</a> page and this page updates with measured values.</div>`}
  <div class="grid g3" style="margin-bottom:16px">
    <div class="card kpi"><div class="label">${icon("user", 15)}Manual tester · ${N} cases</div><div class="value" data-testid="manual-total">${fmtMin(manualSuiteSec)}</div><div class="foot">${measured ? "measured" : "planning estimate"} · ${fmtMin(meanManual)} per case</div></div>
    <div class="card kpi"><div class="label">${icon("bot", 15)}AI agent · ${run.tests.length} cases</div><div class="value" data-testid="ai-total">${fmtDur(run.durationMs)}</div><div class="foot">measured, ${run.workers} parallel workers · ${fmtDur(execSec * 1000)} back to back</div></div>
    <div class="card kpi"><div class="label">${icon("timer", 15)}Time saved per regression run</div><div class="value">${fmtMin(manualSuiteSec - aiWallSec)}</div><div class="foot">${measured ? "measured manual vs measured AI" : "estimated manual vs measured AI"} · excludes human review of failures</div></div>
  </div>
  <div class="grid g2" style="align-items:start">
    <div class="card"><div class="card-head"><h2>Projection to the full EIM 360 inventory</h2></div><div class="card-body">
      <div class="grid g2" style="margin-bottom:12px">
        <div class="field"><label for="p-cases">Test cases</label><input class="input" type="number" id="p-cases" value="${proj.cases}" min="1"></div>
        <div class="field"><label for="p-hours">Tester hours / month</label><input class="input" type="number" id="p-hours" value="${proj.hours}" min="1"></div></div>
      <table class="tbl"><tbody id="proj"></tbody></table>
      <p class="small muted" style="margin-bottom:0">Defaults: ~300 cases from the walkthrough, 140 productive hours per tester per month; weekly = 4 runs, nightly = 22 working days. AI time scales this run's measured per-test time on ${run.workers} workers; the mock answers faster than the real EIM 360 will, so expect real runs to be slower. Building and maintaining the suite still needs engineering time, which is not shown here.</p></div></div>
    <div class="card"><div class="card-head"><h2>Run coverage</h2></div><table class="tbl"><tbody>
      ${[["Test cases executed", `${run.tests.length} (${run.totals.review} AI-written cases still in review)`], ["Steps executed in Chrome", steps], ["Screenshots captured", shots], ["Passed", run.totals.passed], ["Failed and triaged", run.totals.failed], ["Draft defect reports", run.tests.filter(t => t.analysis && t.analysis.defect).length], ["Locator repair suggestions", run.tests.filter(t => t.analysis && t.analysis.suggestedFix && t.analysis.suggestedFix.type === "test").length]]
        .map(([k, v]) => `<tr><td>${k}</td><td class="num"><b>${v}</b></td></tr>`).join("")}</tbody></table></div>
  </div>
  <div class="card" style="margin-top:16px"><div class="card-head"><h2>Per test case</h2><span class="small muted">Manual column: ${measured ? "measured where timed, otherwise the " : ""}${PLAN_MIN}-minute planning estimate${measured ? "" : " for every case"}</span></div><div class="table-wrap"><table class="tbl" data-testid="compare-table"><thead><tr><th>Case</th><th>Title</th><th class="num">Manual</th><th class="num">AI agent</th><th>Result</th></tr></thead><tbody>
  ${catalog.map(c => { const t = run.tests.find(k => k.caseId === c.caseId); const m = avg[c.caseId]; return `<tr><td class="mono">${c.caseId}</td><td>${esc(c.title)}</td><td class="num">${m ? `<b>${fmtMin(m)}</b>` : `<span class="muted">${PLAN_MIN} min</span>`}</td><td class="num">${t ? fmtDur(t.durationMs) : "—"}</td><td>${t ? pill(t.status) : "—"}</td></tr>`; }).join("")}
  </tbody></table></div></div>`;
  const drawProj = () => {
    const cases = Math.max(1, Math.round(+$("#p-cases").value) || 1), hours = Math.max(1, Math.round(+$("#p-hours").value) || 1);
    const col = runs => { const manH = meanManual * cases * runs / 3600, aiH = perCaseAi * cases * runs / 3600; return [`${Math.round(manH).toLocaleString()} h`, (manH / hours).toFixed(1), aiH < 1 ? `${Math.round(aiH * 60)} min` : `${aiH.toFixed(1)} h`]; };
    const w = col(4), n = col(22);
    $("#proj").innerHTML = `<tr><th></th><th class="num">Weekly</th><th class="num">Nightly</th></tr>` + [["Manual effort per month", w[0], n[0]], ["Testers needed (FTE)", w[1], n[1]], [`AI wall-clock per month (${run.workers} workers)`, w[2], n[2]]].map(([k, a, b]) => `<tr><td>${k}</td><td class="num"><b>${a}</b></td><td class="num"><b>${b}</b></td></tr>`).join("") +
      `<tr><td>One full regression · manual</td><td class="num" colspan="2"><b>${fmtMin(meanManual * cases)}</b></td></tr><tr><td>One full regression · AI agent</td><td class="num" colspan="2"><b>${fmtDur(perCaseAi * cases * 1000)}</b></td></tr>`;
  };
  $$("#p-cases,#p-hours").forEach(i => i.oninput = drawProj); drawProj();
}

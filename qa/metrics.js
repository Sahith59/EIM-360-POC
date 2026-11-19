// Summarises a run for the business case: npm run metrics [runId]
// Writes qa/runs/<id>/metrics.md and metrics.json and prints the markdown.
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const RUNS = path.join(ROOT, "qa", "runs");

const ids = fs.existsSync(RUNS) ? fs.readdirSync(RUNS).filter(d => fs.existsSync(path.join(RUNS, d, "run.json"))).sort() : [];
const id = process.argv[2] || ids[ids.length - 1];
if (!id) { console.error("No runs yet. Run npm test first."); process.exit(1); }
const run = JSON.parse(fs.readFileSync(path.join(RUNS, id, "run.json"), "utf8"));
const reviews = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, "data", "rca-reviews.json"), "utf8")); } catch { return {}; } })();
const T = run.tests, F = T.filter(t => t.status === "failed"), A = F.filter(t => t.analysis).map(t => t.analysis), tri = (run.ai && run.ai.triage) || {};
const rv = F.map(t => reviews[`${id}/${t.caseId}`]).filter(Boolean);
const bySuite = {}; T.forEach(t => { const s = t.suite || "POC platform"; bySuite[s] = bySuite[s] || { total: 0, passed: 0, failed: 0, review: 0 }; bySuite[s].total++; bySuite[s][t.status] = (bySuite[s][t.status] || 0) + 1; });
const byCls = {}; A.forEach(a => { byCls[a.classification] = (byCls[a.classification] || 0) + 1; });
const m = {
  runId: id, build: run.build.label, startedAt: run.startedAt, browser: run.browser, workers: run.workers,
  tests: run.totals.total, clientCases: T.filter(t => t.clientRef).length, passed: run.totals.passed, failed: run.totals.failed, inReview: run.totals.review,
  wallSeconds: +(run.durationMs / 1000).toFixed(1), steps: T.reduce((s, t) => s + t.steps.length, 0), screenshots: T.reduce((s, t) => s + t.steps.filter(x => x.screenshot).length, 0),
  bySuite, failuresByClassification: byCls, rootCauseGroups: new Set(A.map(a => a.signature)).size,
  llm: { provider: tri.provider || "off", model: tri.model || null, analysed: tri.llmAnalysed || 0, withScreenshot: tri.withScreenshot || 0, inputTokens: tri.inputTokens || 0, outputTokens: tri.outputTokens || 0, costUsd: tri.costUsd ?? null, avgLatencySeconds: tri.avgLatencyMs ? +(tri.avgLatencyMs / 1000).toFixed(1) : null, triageWallSeconds: tri.wallMs ? +(tri.wallMs / 1000).toFixed(1) : null, agreesWithRules: tri.agreesWithRules || 0, errors: tri.llmErrors || [] },
  humanReview: { reviewed: rv.length, approved: rv.filter(r => r.decision === "Approved").length, edited: rv.filter(r => r.decision === "Edited").length, rejected: rv.filter(r => r.decision === "Rejected").length, pending: F.length - rv.length },
};
const L = m.llm, H = m.humanReview;
const md = `# AI + Playwright run summary · ${id}

| Measure | Value |
|---|---|
| Build | ${m.build} |
| Tests executed (Playwright, ${m.browser}, ${m.workers} workers) | ${m.tests} (${m.clientCases} client cases) |
| Result | ${m.passed} passed · ${m.failed} failed · ${m.inReview} in review |
| Wall-clock run time | ${m.wallSeconds} s |
| Steps · screenshots | ${m.steps} · ${m.screenshots} |
| Failures by classification | ${Object.entries(byCls).map(([k, v]) => `${k}: ${v}`).join("; ") || "none"} |
| Root-cause groups | ${m.rootCauseGroups} |
| LLM triage | ${L.analysed ? `${L.provider} ${L.model}: ${L.analysed}/${m.failed} failures (${L.withScreenshot} with screenshot)` : `off${L.errors.length ? ` (error: ${L.errors[0]})` : ""}`} |
| LLM tokens · cost | ${L.analysed ? `${(L.inputTokens + L.outputTokens).toLocaleString()} tokens (${L.inputTokens.toLocaleString()} in / ${L.outputTokens.toLocaleString()} out)${L.costUsd != null ? ` · $${L.costUsd.toFixed(4)}` : ""}` : "-"} |
| LLM time | ${L.analysed ? `${L.avgLatencySeconds} s per failure · ${L.triageWallSeconds} s total` : "-"} |
| LLM agrees with rules / analyst notes (classification) | ${L.analysed ? `${L.agreesWithRules}/${L.analysed}` : "-"} |
| Human review of AI root causes | ${H.approved} approved · ${H.edited} edited · ${H.rejected} rejected · ${H.pending} pending |

## By suite
| Suite | Total | Passed | Failed | In review |
|---|---|---|---|---|
${Object.entries(bySuite).map(([k, v]) => `| ${k} | ${v.total} | ${v.passed || 0} | ${v.failed || 0} | ${v.review || 0} |`).join("\n")}
`;
fs.writeFileSync(path.join(RUNS, id, "metrics.json"), JSON.stringify(m, null, 2));
fs.writeFileSync(path.join(RUNS, id, "metrics.md"), md);
console.log(md + `\nSaved qa/runs/${id}/metrics.md and metrics.json`);

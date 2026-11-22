// Custom Playwright reporter: turns a run into qa/runs/<id>/run.json with step screenshots,
// statuses (passed / failed / in review) and AI triage for every failure.
const fs = require("fs");
const path = require("path");
const { analyze } = require("./triage");
const llm = require("./llm");

const ROOT = path.join(__dirname, "..");
const strip = s => String(s || "").replace(/\u001b\[[0-9;]*m/g, "");

class EimReporter {
  onBegin(config, suite) {
    this.id = process.env.QA_RUN_ID;
    this.dir = path.join(ROOT, "qa", "runs", this.id);
    fs.mkdirSync(this.dir, { recursive: true });
    this.started = new Date();
    this.workers = config.workers;
    this.results = [];
  }
  onTestEnd(test, result) { this.results.push({ test, result }); }

  async onEnd(full) {
    const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "catalog.json"), "utf8"));
    const build = await fetchBuild();
    const tests = [];
    let idx = 0;
    const jobs = [];
    // keep catalog order so the run reads like the test plan
    const order = id => { const k = catalog.findIndex(c => c.caseId === id); return k < 0 ? 999 : k; };
    this.results.sort((a, b) => order(caseOf(a.test.title)) - order(caseOf(b.test.title)));
    for (const { test, result } of this.results) {
      idx += 1;
      const caseId = caseOf(test.title);
      const c = catalog.find(k => k.caseId === caseId) || {};
      const tdir = path.join(this.dir, caseId);
      fs.mkdirSync(tdir, { recursive: true });
      const steps = [];
      let trace = null, dom = null, agentRes = null;
      for (const a of result.attachments) {
        if (a.name.startsWith("step|")) {
          const [, n, status, ...t] = a.name.split("|");
          let shot = null;
          if (a.path && a.contentType === "image/png" && fs.existsSync(a.path)) { shot = `${caseId}/${n.padStart(2, "0")}.png`; fs.copyFileSync(a.path, path.join(this.dir, shot)); }
          steps.push({ n: Number(n), title: t.join("|"), status, screenshot: shot });
        } else if (a.name === "trace" && a.path && fs.existsSync(a.path)) { trace = `${caseId}/trace.zip`; fs.copyFileSync(a.path, path.join(this.dir, trace)); }
        else if (a.name === "ai-agent") { try { agentRes = JSON.parse(a.body ? a.body.toString() : fs.readFileSync(a.path, "utf8")); } catch {} }
        else if (a.name === "dom-elements") { try { dom = JSON.parse(a.body ? a.body.toString() : fs.readFileSync(a.path, "utf8")); } catch {} }
      }
      steps.sort((a, b) => a.n - b.n);
      // step durations from Playwright's own step tree
      const pwSteps = result.steps.filter(s => s.category === "test.step");
      steps.forEach((s, k) => { const p = pwSteps[k]; s.durationMs = p ? p.duration : null; });
      const failed = result.status === "failed" || result.status === "timedOut";
      const tags = test.tags || [];
      const inconclusive = agentRes && agentRes.verdict === "inconclusive";
      const status = inconclusive ? "review" : failed ? "failed" : result.status === "skipped" ? "skipped" : tags.includes("@review") ? "review" : "passed";
      const entry = {
        idx, caseId, title: test.title.replace(/^(?:QA-)?[A-Z]{2,5}-\d+\s+/, ""), area: c.area || test.parent.title, suite: c.suite || "", clientRef: c.clientRef || "", role: c.role, priority: c.priority,
        file: path.relative(ROOT, test.location.file).split(path.sep).join("/") + ":" + test.location.line, tags, status, rawStatus: result.status,
        durationMs: result.duration, retries: result.retry, steps, artifacts: { trace },
      };
      if (agentRes) entry.agent = agentRes;
      if (inconclusive) entry.reviewReason = `The AI agent could not reach a reliable verdict${agentRes.harnessError ? " (the model call failed)" : ""}: ${agentRes.summary} A QA engineer decides this case.`;
      else if (status === "review") entry.reviewReason = "Written by the AI agent from the manual test case and not yet reviewed. It runs with the suite, but its result is not counted in the pass rate until an engineer approves it.";
      if (failed) {
        const err = result.errors[0] || result.error || {};
        const msg = strip(err.message);
        entry.error = { message: msg.split("\n").slice(0, 14).join("\n"), ...expectedActual(msg), location: err.location ? { file: path.relative(ROOT, err.location.file).split(path.sep).join("/"), line: err.location.line } : null };
        if (agentRes) Object.assign(entry.error, { expected: agentRes.expected || null, actual: agentRes.actual || null, location: null, byAgent: true });
        if (agentRes && agentRes.verdict === "fail") entry.analysis = fromAgent(agentRes, entry, c, build);
        else if (!agentRes) jobs.push(() => analyze({ entry, catalogCase: c, dom, build, root: ROOT, runId: this.id }).then(a => { entry.analysis = a; }));
      }
      tests.push(entry);
    }
    // triage runs after all tests finish; up to LLM_CONCURRENCY failures are analysed at once
    const t0 = Date.now(), cfg = llm.config(), limit = Math.max(1, Number(process.env.LLM_CONCURRENCY || 3));
    if (jobs.length) console.log(`\nTriaging ${jobs.length} failure(s) · LLM: ${cfg.ready ? `${cfg.provider} ${cfg.model}` : `off (${cfg.reason})`}`);
    await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, async () => { while (jobs.length) await jobs.shift()(); }));
    const A = tests.filter(t => t.analysis && !t.agent).map(t => t.analysis), L = A.filter(a => a.llm);
    const sum = f => L.reduce((s, a) => s + (f(a) || 0), 0);
    const ai = {
      testsAuthoredBy: "AI agent (LLM), reviewed by an engineer", executedBy: "Playwright (deterministic browser automation)",
      triage: { provider: cfg.ready ? cfg.provider : "off", model: cfg.ready ? cfg.model : null, failures: A.length, llmAnalysed: L.length, llmErrors: A.filter(a => a.llmError).map(a => a.llmError.message).slice(0, 5),
        inputTokens: sum(a => a.llm.usage && a.llm.usage.input), outputTokens: sum(a => a.llm.usage && a.llm.usage.output), costUsd: L.every(a => a.llm.costUsd != null) ? Number(sum(a => a.llm.costUsd).toFixed(4)) : null,
        avgLatencyMs: L.length ? Math.round(sum(a => a.llm.latencyMs) / L.length) : null, wallMs: Date.now() - t0, withScreenshot: L.filter(a => a.llm.usedScreenshot).length,
        agreesWithRules: L.filter(a => a.agreesWithRules).length, rootCauseGroups: new Set(A.map(a => a.signature)).size },
    };
    const G = tests.filter(t => t.agent).map(t => t.agent);
    if (G.length) {
      const gs = f => G.reduce((s, g) => s + (f(g) || 0), 0);
      ai.testsAuthoredBy = "None: the AI agent reads each manual test case and decides every step at run time";
      ai.executedBy = `Playwright, driven action by action by ${G[0].provider} ${G[0].model}`;
      ai.agent = { provider: G[0].provider, model: G[0].model, cases: G.length,
        verdicts: { pass: G.filter(g => g.verdict === "pass").length, fail: G.filter(g => g.verdict === "fail").length, inconclusive: G.filter(g => g.verdict === "inconclusive").length },
        calls: gs(g => g.calls), turns: gs(g => g.turns), actions: gs(g => g.actions), queries: gs(g => g.queries.length),
        inputTokens: gs(g => g.usage.input), cachedTokens: gs(g => g.usage.cached), outputTokens: gs(g => g.usage.output), costUsd: G.every(g => g.costUsd != null) ? Number(gs(g => g.costUsd).toFixed(4)) : null,
        llmMs: gs(g => g.llmMs), caseMs: gs(g => g.wallMs), avgCaseMs: Math.round(gs(g => g.wallMs) / G.length), avgLlmMsPerCase: Math.round(gs(g => g.llmMs) / G.length),
        avgCostPerCase: G.every(g => g.costUsd != null) ? Number((gs(g => g.costUsd) / G.length).toFixed(4)) : null, harnessErrors: G.filter(g => g.harnessError).length };
    }
    const totals = { total: tests.length, passed: tests.filter(t => t.status === "passed").length, failed: tests.filter(t => t.status === "failed").length, review: tests.filter(t => t.status === "review").length, skipped: tests.filter(t => t.status === "skipped").length };
    const conditions = { extraDefects: process.env.EXTRA_DEFECTS || null, latencyMs: Number(process.env.LATENCY_MS || 0) || null, playwrightMs: full.duration ?? null, triageMs: ai.triage.wallMs };
    const run = { id: this.id, ai, conditions, startedAt: this.started.toISOString(), finishedAt: new Date().toISOString(), durationMs: full.duration ?? (Date.now() - this.started), workers: this.workers, browser: (process.env.PW_CHANNEL || "chrome") === "chrome" ? "Chrome (headless)" : "Chromium (headless)", build, totals, tests };
    fs.writeFileSync(path.join(this.dir, "run.json"), JSON.stringify(run, null, 2));
    console.log(`\nEIM 360 AI test agent · ${this.id}: ${totals.passed} passed, ${totals.failed} failed (triaged), ${totals.review} in review · ${(run.durationMs / 1000).toFixed(1)}s`);
    if (ai.agent) console.log(`AI agent (${ai.agent.provider} ${ai.agent.model}): ${ai.agent.cases} cases · ${ai.agent.verdicts.pass} pass / ${ai.agent.verdicts.fail} fail / ${ai.agent.verdicts.inconclusive} inconclusive · ${ai.agent.calls} model calls · ${ai.agent.actions} browser actions · ${ai.agent.queries} SQL checks · ${ai.agent.costUsd != null ? "$" + ai.agent.costUsd.toFixed(4) : "cost n/a"} · avg ${(ai.agent.avgCaseMs / 1000).toFixed(1)} s per case`);
    if (ai.triage.failures) console.log(`AI triage: ${ai.triage.llmAnalysed}/${ai.triage.failures} failures analysed by ${ai.triage.model || "rules only"}${ai.triage.costUsd != null && ai.triage.llmAnalysed ? ` · $${ai.triage.costUsd.toFixed(4)}` : ""}${ai.triage.llmErrors.length ? ` · ${ai.triage.llmErrors.length} LLM error(s): ${ai.triage.llmErrors[0]}` : ""}`);
    console.log(`Open http://localhost:4360/#/qa/runs/${this.id}  ·  npm run metrics for a summary`);
  }
}

// failure analysis written by the AI agent itself (it ran the case, so no second triage call is needed)
function fromAgent(g, entry, c, build) {
  const CLASSES = ["Product defect", "Test script maintenance", "Environment / test data"];
  const cls = CLASSES.find(k => k.toLowerCase() === String(g.classification || "").toLowerCase()) || "Product defect";
  const a = {
    classification: cls, rootCause: g.rootCause || g.summary, component: g.component || entry.area, narrative: g.narrative || g.summary,
    evidence: g.evidence.length ? g.evidence : [g.actual].filter(Boolean), codeRefs: [], nextSteps: g.nextSteps, suggestedFix: null,
    sources: { classification: "LLM", rootCause: "LLM", component: "LLM", nextSteps: "LLM", narrative: "LLM" },
    dbQueries: g.queries.length ? g.queries : undefined, dbFindings: g.dbFindings || undefined,
    llm: { provider: g.provider, model: g.model, calls: g.calls, latencyMs: g.llmMs, usage: g.usage, costUsd: g.costUsd, confidence: g.confidence, usedScreenshot: true, dbAccess: "read-only (live, during the run)" },
    llmAudit: g.audit, agentRun: true,
    engine: `AI agent: ${g.provider} ${g.model} ran this case in Chrome (${g.actions} browser actions, ${g.queries.length} read-only SQL checks, ${g.calls} model calls)`,
    defect: null,
  };
  if (cls === "Product defect") a.defect = { title: g.defectTitle || `${entry.area}: ${c.title || entry.title}`, severity: /^(High|Medium|Low)$/i.test(g.severity) ? g.severity[0].toUpperCase() + g.severity.slice(1).toLowerCase() : "Medium",
    steps: g.reproSteps.length ? g.reproSteps : c.steps || [], expected: g.expected || c.expected || "", actual: g.actual || "" };
  a.signature = `${cls}|${a.defect ? a.defect.title : a.rootCause}`;
  return a;
}

function caseOf(title) { const m = title.match(/^((?:QA-)?[A-Z]{2,5}-\d+)/); return m ? m[1] : title; }
function expectedActual(msg) {
  const e = msg.match(/Expected(?: string| pattern| value)?: (.+)/), r = msg.match(/Received(?: string| value)?: (.+)/);
  return { expected: e ? e[1].trim() : null, actual: r ? r[1].trim() : null };
}
async function fetchBuild() {
  // the build each worker tested is defined by the BUILD env var used to start the app
  return process.env.BUILD === "fixed" ? { version: "2.4.1", label: "2.4.1 (fixed)" } : { version: "2.4.1-rc1", label: "2.4.1-rc1 (release candidate)" };
}
module.exports = EimReporter;

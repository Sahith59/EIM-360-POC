// Custom Playwright reporter: turns a run into qa/runs/<id>/run.json with step screenshots,
// statuses (passed / failed / in review) and AI triage for every failure.
const fs = require("fs");
const path = require("path");
const { analyze } = require("./triage");

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
      let trace = null, dom = null;
      for (const a of result.attachments) {
        if (a.name.startsWith("step|")) {
          const [, n, status, ...t] = a.name.split("|");
          let shot = null;
          if (a.path && a.contentType === "image/png" && fs.existsSync(a.path)) { shot = `${caseId}/${n.padStart(2, "0")}.png`; fs.copyFileSync(a.path, path.join(this.dir, shot)); }
          steps.push({ n: Number(n), title: t.join("|"), status, screenshot: shot });
        } else if (a.name === "trace" && a.path && fs.existsSync(a.path)) { trace = `${caseId}/trace.zip`; fs.copyFileSync(a.path, path.join(this.dir, trace)); }
        else if (a.name === "dom-elements") { try { dom = JSON.parse(a.body ? a.body.toString() : fs.readFileSync(a.path, "utf8")); } catch {} }
      }
      steps.sort((a, b) => a.n - b.n);
      // step durations from Playwright's own step tree
      const pwSteps = result.steps.filter(s => s.category === "test.step");
      steps.forEach((s, k) => { const p = pwSteps[k]; s.durationMs = p ? p.duration : null; });
      const failed = result.status === "failed" || result.status === "timedOut";
      const tags = test.tags || [];
      const status = failed ? "failed" : result.status === "skipped" ? "skipped" : tags.includes("@review") ? "review" : "passed";
      const entry = {
        idx, caseId, title: test.title.replace(/^(?:QA-)?[A-Z]{2,5}-\d+\s+/, ""), area: c.area || test.parent.title, suite: c.suite || "", clientRef: c.clientRef || "", role: c.role, priority: c.priority,
        file: path.relative(ROOT, test.location.file).split(path.sep).join("/") + ":" + test.location.line, tags, status, rawStatus: result.status,
        durationMs: result.duration, retries: result.retry, steps, artifacts: { trace },
      };
      if (status === "review") entry.reviewReason = "Written by the AI agent from the manual test case and not yet reviewed. It runs with the suite, but its result is not counted in the pass rate until an engineer approves it.";
      if (failed) {
        const err = result.errors[0] || result.error || {};
        const msg = strip(err.message);
        entry.error = { message: msg.split("\n").slice(0, 14).join("\n"), ...expectedActual(msg), location: err.location ? { file: path.relative(ROOT, err.location.file).split(path.sep).join("/"), line: err.location.line } : null };
        entry.analysis = await analyze({ entry, catalogCase: c, dom, build, root: ROOT, runId: this.id });
      }
      tests.push(entry);
    }
    const totals = { total: tests.length, passed: tests.filter(t => t.status === "passed").length, failed: tests.filter(t => t.status === "failed").length, review: tests.filter(t => t.status === "review").length, skipped: tests.filter(t => t.status === "skipped").length };
    const run = { id: this.id, startedAt: this.started.toISOString(), finishedAt: new Date().toISOString(), durationMs: full.duration ?? (Date.now() - this.started), workers: this.workers, browser: (process.env.PW_CHANNEL || "chrome") === "chrome" ? "Chrome (headless)" : "Chromium (headless)", build, totals, tests };
    fs.writeFileSync(path.join(this.dir, "run.json"), JSON.stringify(run, null, 2));
    console.log(`\nEIM 360 AI test agent · ${this.id}: ${totals.passed} passed, ${totals.failed} failed (triaged), ${totals.review} in review · ${(run.durationMs / 1000).toFixed(1)}s`);
    console.log(`Open http://localhost:4360/#/qa/runs/${this.id}`);
  }
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

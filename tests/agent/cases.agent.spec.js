// AI-driven run: Gemini (or the LLM set in .env) reads each manual test case and drives Chrome through Playwright,
// deciding test data, every action, the resolution steps and the checks. There is no scripted test code per case.
// Which cases: AGENT_CASES = "must" (default: the 30 Incident Management "Must Do" cases), "all", a suite name,
// or a comma-separated list of case ids (e.g. MST-13,MST-24).
const fs = require("fs");
const path = require("path");
const { test } = require("../fixtures");
const agent = require("../../qa/agent/agent");

const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "catalog.json"), "utf8"));
const sel = (process.env.AGENT_CASES || "must").trim();
const cases = sel === "all" ? catalog
  : sel.toLowerCase() === "must" ? catalog.filter(c => c.caseId.startsWith("MST-"))
  : /,|^[A-Z]+-\d+$/.test(sel) ? catalog.filter(c => sel.split(",").map(s => s.trim()).includes(c.caseId))
  : catalog.filter(c => (c.suite || "").toLowerCase() === sel.toLowerCase());

test.describe("AI agent", () => {
  for (const c of cases) test(`${c.caseId} ${c.title}`, async ({ page, app, step }, testInfo) => {
    const r = await agent.run({ page, app, step, testInfo, caseDef: c });
    if (r.verdict === "fail") {
      const e = new Error(`AI verdict: FAIL (${r.classification || "unclassified"}). ${r.summary}\nExpected: ${r.expected}\nActual: ${r.actual}`);
      e.stack = e.message; throw e;
    }
    if (r.harnessError) { const e = new Error(r.summary); e.stack = e.message; throw e; }
  });
});

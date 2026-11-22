// Offline stand-in for an LLM (LLM_PROVIDER=mock). It only exists so the pipeline can be tested without a key or
// network. Its answers are canned and must never be quoted as AI results.
module.exports = function mock(prompt) {
  if (/PLAYWRIGHT_SPEC/.test(prompt)) {
    const id = (prompt.match(/Test case (\S+)/) || [])[1] || "CASE-0";
    return { spec: `// mock draft\nconst { test, expect } = require("../fixtures");\ntest("${id} mock draft @review", async ({ page }) => {\n  await page.goto("/");\n  await expect(page).toHaveTitle(/EIM 360/);\n});\n`, notes: "mock" };
  }
  if (/^TEST CASE /.test(prompt) && /CURRENT PAGE \(turn (\d+)/.test(prompt)) {
    // AI agent loop: open the first incident, add a step, run one SQL check, then finish
    const turn = Number(prompt.match(/CURRENT PAGE \(turn (\d+)/)[1]);
    const inc = (prompt.match(/TEST DATA[^\n]*\n(\S+):/) || [])[1];
    const ref = label => (prompt.match(new RegExp(`\\[(e\\d+)\\][^\\n]*testid=${label}`)) || [])[1];
    const fail = /MST-24/.test(prompt);
    if (turn === 1) return { thought: "[mock] open an incident", step: "Open the incident in edit mode", actions: [{ type: "navigate", route: `#/incidents/edit/${inc}` }] };
    if (turn === 2) return { thought: "[mock] assign", step: "Assign the incident", actions: [{ type: "select", ref: ref("worked-by"), option: "Arjun Nair" }, { type: "query", sql: "SELECT number, status FROM incidents LIMIT 2", why: "[mock] check data" }] };
    return { thought: "[mock] done", step: "Verdict", actions: [{ type: "finish", verdict: fail ? "fail" : "pass", confidence: 0.5, summary: "[mock] canned agent verdict.", testData: inc, resolutionSteps: ["[mock] step"], expected: "x", actual: "y", evidence: ["[mock] evidence"], observations: [],
      classification: "Product defect", rootCause: "[mock] root cause", component: "[mock]", narrative: "[mock]", nextSteps: ["[mock]"], defectTitle: "[mock] defect", severity: "High", dbFindings: "[mock]", reproSteps: ["[mock] repro"] }] };
  }
  if (/READ-ONLY access/.test(prompt) && !/Queries you have run so far/.test(prompt)) return { action: "query", sql: "SELECT count(*) AS active_rows FROM swat_kb WHERE active_flag = 1", why: "[mock] check active KB rows" };
  const renamed = /no longer on the page|Closest element on the page/.test(prompt);
  return {
    classification: renamed ? "Test script maintenance" : "Product defect",
    rootCause: "[mock] Canned root cause used to test the pipeline offline.",
    component: "[mock]", confidence: 0.5, narrative: "[mock] Offline test response.",
    nextSteps: ["[mock] Configure a real LLM provider in .env."], action: "final", dbFindings: "[mock]", note: "[mock] draft note", defectTitle: renamed ? "" : "[mock] Draft defect", severity: "Medium", suggestedTestFix: "",
  };
};

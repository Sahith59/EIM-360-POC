// Offline stand-in for an LLM (LLM_PROVIDER=mock). It only exists so the pipeline can be tested without a key or
// network. Its answers are canned and must never be quoted as AI results.
module.exports = function mock(prompt) {
  if (/PLAYWRIGHT_SPEC/.test(prompt)) {
    const id = (prompt.match(/Test case (\S+)/) || [])[1] || "CASE-0";
    return { spec: `// mock draft\nconst { test, expect } = require("../fixtures");\ntest("${id} mock draft @review", async ({ page }) => {\n  await page.goto("/");\n  await expect(page).toHaveTitle(/EIM 360/);\n});\n`, notes: "mock" };
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

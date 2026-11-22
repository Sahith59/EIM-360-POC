// Page object + test-data helpers for the Incident Edit "AI Review" flows (client regression suite).
const { expect } = require("@playwright/test");

async function candidates(app) { return (await app.api("/api/test/candidates")).json; }
const KINDS = {
  kbPred: x => x.status === "Open" && x.hasPrediction && x.hasRec,             // AI prediction + KB recommendation
  predNoKb: x => x.status === "Open" && x.hasPrediction && !x.hasRec,          // AI prediction, no KB recipe
  noPred: x => x.status === "Open" && !x.hasPrediction,                        // no AI output at all
  noPredNoKb: x => x.status === "Open" && !x.hasPrediction && !x.hasRec,
  any: x => x.status === "Open",
};
async function pick(app, kind) {
  const c = (await candidates(app)).find(KINDS[kind]);
  if (!c) throw new Error(`No test data for "${kind}"`);
  return c;
}
async function backend(app, table) { return (await app.api("/api/backend/" + table)).json; }

function review(page) {
  const R = {
    page,
    async assign(name = "Arjun Nair") { await page.getByTestId("worked-by").selectOption(name); },
    async failure(decision, correction) {
      if (decision) await page.getByTestId(`failure-${decision}`).check();
      if (correction != null) await page.getByTestId("failure-correction").fill(correction);
    },
    // choosing a category reloads the KB recommendation; wait for it so later steps see the final state
    async category(decision, value) {
      const rec = () => page.waitForResponse(r => r.url().includes("/api/kb/recommend"), { timeout: 5000 }).catch(() => null); // no refetch if the value did not change
      if (decision === "approve") await Promise.all([rec(), page.getByTestId("category-approve").check()]);
      else if (decision) await page.getByTestId(`category-${decision}`).check();
      if (value) await Promise.all([rec(), page.getByTestId("category-select").selectOption(value)]);
    },
    async steps(decision) { await page.getByTestId(`steps-${decision}`).check(); },
    stepInputs: () => page.locator('[data-testid^="step-input-"]'),
    async addStep(text) {
      const before = await R.stepInputs().count();
      await page.getByTestId("add-step").click();
      await expect(R.stepInputs()).toHaveCount(before + 1);
      await R.stepInputs().last().fill(text);
    },
    async editStep(n, text) { await page.getByTestId(`step-input-${n}`).fill(text); },
    async deleteStep(n) { await page.getByTestId(`step-delete-${n}`).click(); },
    async act(name) {
      const id = { wip: "save-wip", sme: "send-sme", one: "approve-one-time", kb: "approve-add-kb", resolve: "approve-resolve", close: "close-incident" }[name];
      await page.getByTestId(id).click();
    },
    async toast(text) {
      const t = page.getByTestId("toast").last();
      if (text instanceof RegExp || typeof text === "string") await expect(t).toHaveText(text);
      else await expect(t).toBeVisible();
      return t.innerText();
    },
    // approve every AI section that has a prediction / recommendation
    async approveAll() {
      if (await page.getByTestId("failure-approve").count()) await R.failure("approve");
      if (await page.getByTestId("category-approve").count()) await R.category("approve");
      if (await page.getByTestId("steps-approve").count()) await R.steps("approve");
    },
    async savedSteps() { return page.locator('[data-testid="saved-steps"] li, [data-testid="kb-steps"] li').allInnerTexts(); },
  };
  return R;
}
module.exports = { pick, candidates, backend, review };

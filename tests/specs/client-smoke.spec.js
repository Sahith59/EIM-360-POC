// AI-generated (Claude) from the client's TS_REGRESSION.xlsx, sheet "SMOKE TESTING". One test per client test case.
const { test, expect } = require("../fixtures");
const { review } = require("../lib/review");
const f = require("../lib/flows");

const CASES = [
  ["SMK-01", "Verify Incident Edit Page Loads Successfully", f.pageLoads],
  ["SMK-02", "Verify Mandatory Field Validation", f.mandatory("resolve")],
  ["SMK-03", "Verify AI Prediction Details Load", f.aiDisplay],
  ["SMK-04", "Verify Issue Category Selection", f.categoryRetained],
  ["SMK-05", "Verify SWAT KB Recommendations Load", f.kbRecommendation],
  ["SMK-06", "Verify Add Resolution Step", f.addStep],
  ["SMK-07", "Verify Edit Resolution Step", f.editStep],
  ["SMK-08", "Verify Special Character Handling", f.specialChars(`Check the job's "GL" queue & rerun`)],
  ["SMK-09", "Verify Approve + Add KB Flow", f.approveAddKb],
  ["SMK-10", "Verify Save Work In Progress Incident", f.wip(true)],
  ["SMK-11", "Verify Resolution Details Update", f.resolutionDetails],
  ["SMK-12", "Verify Approve And Resolve Incident", f.approveAndResolve],
  ["SMK-13", "Verify Saved Data Persistence", f.persistence],
  ["SMK-14", "Verify Duplicate Prevention During Re-Save", f.noDuplicates],
  ["SMK-15", "Verify SCD2 Versioning After Resolution Step Update", f.scd2],
];

test.describe("Client \u00b7 Smoke", () => {
  for (const [id, title, flow] of CASES) test(`${id} ${title}`, async ({ page, app, step }) => flow({ page, app, step, R: review(page) }));
});

// AI-generated (Claude) from the client's TS_REGRESSION.xlsx, sheet "COMBINATIONS". One test per client test case.
const { test, expect } = require("../fixtures");
const { review } = require("../lib/review");
const f = require("../lib/flows");

const CASES = [
  ["CMB-01", "Verify Approval Of All AI Predictions", f.combo({})],
  ["CMB-02", "Verify Approval Of Failure Details And Category With Resolution Step Correction", f.combo({ steps: "reject" })],
  ["CMB-03", "Verify Approval Of Failure Details And Resolution Steps With Category Correction", f.combo({ category: "reject" })],
  ["CMB-04", "Verify Approval Of Category And Resolution Steps With Failure Detail Correction", f.combo({ failure: "reject" })],
  ["CMB-05", "Verify Correction Of Failure Details And Category With Resolution Approval", f.combo({ failure: "reject", category: "reject" })],
  ["CMB-06", "Verify Correction Of Failure Details And Resolution Steps With Category Approval", f.combo({ failure: "reject", steps: "reject" })],
  ["CMB-07", "Verify Correction Of Category And Resolution Steps With Failure Approval", f.combo({ category: "reject", steps: "reject" })],
  ["CMB-08", "Verify Correction Of All AI Predictions", f.combo({ failure: "reject", category: "reject", steps: "reject" })],
  ["CMB-09", "Verify Reject Failure Details Without Correction", f.rejectWithoutCorrection("failure")],
  ["CMB-10", "Verify Reject Category Without Selecting Corrected Category", f.rejectWithoutCorrection("category")],
  ["CMB-11", "Verify Reject Resolution Steps Without Providing Corrected Steps", f.rejectWithoutCorrection("steps")],
  ["CMB-12", "Verify No AI Failure Prediction Scenario", f.noPrediction()],
  ["CMB-13", "Verify Review Completed Read-Only Behavior", f.readOnlyAfterReview],
  ["CMB-14", "Verify AI Decision Persistence After Refresh", f.decisionPersistence],
  ["CMB-15", "Verify AI Review Updates Incident Data", f.syncToEvent],
  ["CMB-16", "AI Predictions Approved + Approve One Time", f.combo({ action: "one" })],
  ["CMB-17", "AI Predictions Approved + Approve & Add to KB", f.combo({ action: "kb" })],
  ["CMB-18", "AI Predictions Corrected + Approve One Time", f.combo({ failure: "reject", action: "one" })],
  ["CMB-19", "AI Predictions Corrected + Approve & Add to KB", f.combo({ failure: "reject", category: "reject", action: "kb" })],
  ["CMB-20", "No Prediction Available + Approve One Time", f.noPrediction({ complete: true })],
  ["CMB-21", "No Prediction Available + Approve & Add to KB", f.kbIntegrity],
  ["CMB-22", "Partial Prediction Approval + Approve One Time", f.combo({ category: "reject", action: "one" })],
  ["CMB-23", "Partial Prediction Approval + Approve & Add to KB", f.combo({ failure: "reject", action: "kb" })],
  ["CMB-24", "Existing KB Steps Accepted As-Is + Approve One Time", f.kbAcceptedAsIs],
  ["CMB-25", "Existing KB Steps Modified + Approve & Add to KB", f.scd2],
  ["CMB-26", "Existing KB Step Edited + Approve & Add to KB", f.scd2],
  ["CMB-27", "Corrected Prediction + New KB Creation", f.newKbFromCorrection],
];

test.describe("Client \u00b7 Combinations", () => {
  for (const [id, title, flow] of CASES) test(`${id} ${title}`, async ({ page, app, step }) => flow({ page, app, step, R: review(page) }));
});

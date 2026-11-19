// AI-generated (Claude) from the client's TS_REGRESSION.xlsx, sheet "MUST DO TEST CASES". One test per client test case.
const { test, expect } = require("../fixtures");
const { review } = require("../lib/review");
const f = require("../lib/flows");

const CASES = [
  ["MST-01", "Verify Incident Edit Page Loads Successfully", f.pageLoads],
  ["MST-02", "Verify Mandatory Field Validation", f.mandatory("resolve")],
  ["MST-03", "Verify AI Predicted Failure Details Display", f.aiDisplay],
  ["MST-04", "Verify Approval Of Predicted Issue Category", f.categoryRetained],
  ["MST-05", "Verify Reject And Correct Issue Category", f.rejectCategory],
  ["MST-06", "Verify KB Resolution Recommendations Load", f.kbRecommendation],
  ["MST-07", "Verify Add Manual Resolution Step", f.addStep],
  ["MST-08", "Verify Edit Existing Resolution Step", f.editStep],
  ["MST-09", "Verify Delete Resolution Step", f.deleteStep],
  ["MST-10", "Verify Save Work In Progress Incident", f.wip(true)],
  ["MST-11", "Verify Approve And Add KB Flow", f.approveAddKb],
  ["MST-12", "Verify Approve One Time Flow", f.approveOneTime],
  ["MST-13", "Verify Incident Closure", f.approveAndResolve],
  ["MST-14", "Verify Incident Data Persistence", f.persistence],
  ["MST-15", "Verify Read-Only State After Review Completed", f.readOnlyAfterReview],
  ["MST-16", "Verify Resolution Step Saved To Execution Table", f.executionTable],
  ["MST-17", "Verify Duplicate Step Prevention During Re-Save", f.noDuplicates],
  ["MST-18", "Verify KB Usage Counter Update", f.kbUsage],
  ["MST-19", "Verify AI Values Sync To Incident Task Event", f.syncToEvent],
  ["MST-20", "Verify Single Active Resolution Version Exists", f.scd2],
  ["MST-21", "Verify Resolution Step With Apostrophe Character", f.specialChars(`Don't rerun before 02:00`)],
  ["MST-22", "Verify Resolution Step With Double Quote Character", f.specialChars(`Check the "GL" queue`)],
  ["MST-23", "Verify Resolution Step With Ampersand Character", f.specialChars(`Notify DBA & SME`)],
  ["MST-24", "Verify Resolution Step With Backslash Character", f.specialChars(String.raw`Clear D:\landing\inbound before rerun`)],
  ["MST-25", "Verify Resolution Step With Multiple Special Characters", f.specialChars(String.raw`Don't move "C:\temp\gl.dat" & re-run <job> [1]`)],
  ["MST-26", "Verify Update Of Existing Step Containing Special Characters", f.specialChars(`Check 'RC=12' & "abend" (updated)`, { edit: true })],
  ["MST-27", "Verify Repeated Save Of Special Character Data", f.specialChars(`Re-check "queue" & logs`, { twice: true })],
  ["MST-28", "Verify Rejection Of AI Failure Prediction", f.combo({ failure: "reject" })],
  ["MST-29", "Verify No AI Prediction Scenario", f.noPrediction({ complete: true })],
  ["MST-30", "Verify No KB Match Scenario", f.noKbMatch({ addStep: true })],
];

test.describe("Client \u00b7 Must Do", () => {
  for (const [id, title, flow] of CASES) test(`${id} ${title}`, async ({ page, app, step }) => flow({ page, app, step, R: review(page) }));
});

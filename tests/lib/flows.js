// Reusable flows for the client's Incident Edit regression cases (TS_REGRESSION.xlsx).
// Each flow receives { page, app, step, R } and follows the manual steps of the case it automates.
const { expect } = require("@playwright/test");
const { pick, backend } = require("./review");

const CATS = ["Database Error", "Connectivity", "Missing Source File", "Data Quality", "Resource Exhaustion", "Authentication"];
const other = c => CATS.find(x => x !== c);
const open = async ({ app, step }, n, role = "SWAT") => step(`Open incident ${n} in edit mode`, () => app.open(`#/incidents/edit/${n}`, role));
const reload = async ({ page, step }, n) => step("Reopen the incident", async () => { await page.reload(); await expect(page.getByTestId("review-failure")).toBeVisible(); });
const assertKbUnchanged = async (app, before) => expect((await backend(app, "swat_kb")).length, "SWAT_KB row count").toBe(before);

// ---------------------------------------------------------------- page load & display
exports.pageLoads = async ctx => {
  const { page } = ctx;
  const c = await pick(ctx.app, "kbPred");
  await open(ctx, c.number);
  await ctx.step("Check incident details, AI review sections, category, resolution section and action buttons", async () => {
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Edit Incident - ${c.number}`);
    for (const id of ["review-failure", "review-category", "review-steps", "worked-by", "resolution-details", "save-wip", "approve-one-time", "approve-add-kb", "approve-resolve"]) await expect(page.getByTestId(id)).toBeVisible();
    await expect(page.getByTestId("page-error")).toHaveCount(0);
  });
};

exports.mandatory = (action = "resolve") => async ctx => {
  const { page, R, app } = ctx;
  const c = await pick(app, "kbPred");
  await open(ctx, c.number);
  await ctx.step(`Leave required fields blank and click ${action === "resolve" ? "Approve and Resolve" : "Approve One Time"}`, async () => {
    await R.act(action);
    await R.toast("Please correct the highlighted fields.");
    await expect(page.locator('[data-err="workedBy"]')).toHaveText("Select the assignee working on this incident.");
    await expect(page.locator('[data-err="failure"]')).toHaveText("Approve or reject the predicted failure details.");
    await expect(page.locator('[data-err="category"]')).toHaveText("Approve or reject the predicted issue category.");
  });
  await ctx.step("Confirm the incident did not move on", async () => expect((await app.incident(c.number)).status).toBe("Open"), { screenshot: false });
};

exports.aiDisplay = async ctx => {
  const { page, app } = ctx;
  const c = await pick(app, "kbPred");
  const inc = await app.incident(c.number);
  await open(ctx, c.number);
  await ctx.step("Review the AI-predicted failure details and category", async () => {
    await expect(page.getByTestId("ai-failure-prediction")).toHaveText(inc.aiPrediction.summary);
    await expect(page.getByTestId("ai-category")).toHaveText(inc.aiPrediction.category);
    await expect(page.getByTestId("review-category")).toContainText(/confidence \d+%/);
  });
};

// ---------------------------------------------------------------- category
exports.categoryRetained = async ctx => {
  const { page, R, app } = ctx;
  const c = await pick(app, "kbPred");
  await open(ctx, c.number);
  await ctx.step("Approve the issue category", () => R.category("approve"));
  await ctx.step("Save the incident", async () => { await page.getByTestId("save-wip").click(); await R.toast("Work in progress saved"); });
  await reload(ctx, c.number);
  await ctx.step("Check the category approval is retained", async () => {
    await expect(page.getByTestId("category-approve")).toBeChecked();
    expect((await app.incident(c.number)).review.category.decision).toBe("Approved");
  });
};

exports.rejectCategory = async ctx => {
  const { page, R, app } = ctx;
  const c = await pick(app, "kbPred");
  const corrected = other(c.category);
  await open(ctx, c.number);
  await ctx.step("Reject the category prediction and select the corrected category", async () => { await R.assign(); await R.failure("approve"); await R.category("reject", corrected); });
  await ctx.step("Add a resolution step if no KB recipe exists for the new category, then save", async () => {
    if (await page.getByTestId("no-kb-match").count()) await R.addStep("Rerun the job after the fix");
    else await R.steps("approve");
    await R.act("one"); await R.toast(/Approved/);
  });
  await ctx.step("Check the corrected category is persisted", async () => {
    await expect(page.getByTestId("final-category")).toHaveText(corrected);
    expect((await app.incident(c.number)).category).toBe(corrected);
  });
};

// ---------------------------------------------------------------- KB recommendation
exports.kbRecommendation = async ctx => {
  const { page, app } = ctx;
  const c = await pick(app, "kbPred");
  const rec = (await app.api(`/api/kb/recommend?interface=${c.interfaceCode}&category=${encodeURIComponent(c.category)}`)).json;
  await open(ctx, c.number);
  await ctx.step("Review the recommended resolution steps for the interface and category", async () => {
    await expect(page.getByTestId("steps-source")).toContainText(`Knowledge Base v${rec.version}`);
    await expect(page.getByTestId("kb-steps").locator("li")).toHaveText(rec.steps);
  });
};

// ---------------------------------------------------------------- steps: add / edit / delete
exports.addStep = async ctx => {
  const { page, R, app } = ctx;
  const c = await pick(app, "predNoKb");
  const text = "Restart the interface job stream in IWS";
  await open(ctx, c.number);
  await ctx.step("Add a new resolution step", () => R.addStep(text));
  await ctx.step("Save the incident", async () => { await page.getByTestId("save-wip").click(); await R.toast("Work in progress saved"); });
  await reload(ctx, c.number);
  await ctx.step("Check the step is displayed after reload", async () => expect(page.getByTestId("step-input-1")).toHaveValue(text));
};

exports.editStep = async ctx => {
  const { page, R, app } = ctx;
  const c = await pick(app, "kbPred");
  await open(ctx, c.number);
  await ctx.step("Edit an existing resolution step", async () => { await R.steps("reject"); await R.editStep(1, "Check sessions and locks on the target schema (edited)"); });
  await ctx.step("Save the incident", async () => { await page.getByTestId("save-wip").click(); await R.toast("Work in progress saved"); });
  await reload(ctx, c.number);
  await ctx.step("Check the updated step is displayed", async () => expect(page.getByTestId("step-input-1")).toHaveValue("Check sessions and locks on the target schema (edited)"));
};

exports.deleteStep = async ctx => {
  const { page, R, app } = ctx;
  const c = await pick(app, "kbPred");
  await open(ctx, c.number);
  let before;
  await ctx.step("Delete an existing resolution step", async () => { await R.steps("reject"); before = await R.stepInputs().count(); await R.deleteStep(2); await expect(R.stepInputs()).toHaveCount(before - 1); });
  await ctx.step("Save changes", async () => { await page.getByTestId("save-wip").click(); await R.toast("Work in progress saved"); });
  await reload(ctx, c.number);
  await ctx.step("Check the step was removed", async () => expect(R.stepInputs()).toHaveCount(before - 1));
};

// ---------------------------------------------------------------- special characters
exports.specialChars = (text, { twice = false, edit = false } = {}) => async ctx => {
  const { page, R, app } = ctx;
  const c = await pick(app, "predNoKb");
  await open(ctx, c.number);
  await ctx.step(edit ? "Edit an existing step that contains special characters" : `Enter a resolution step containing ${JSON.stringify(text)}`, async () => {
    await R.assign(); await R.failure("approve"); await R.category("approve");
    if (edit) { await R.addStep("Check log for 'RC=8' & \"abend\""); await page.getByTestId("save-wip").click(); await R.toast("Work in progress saved"); await R.editStep(1, text); }
    else await R.addStep(text);
  });
  if (twice) await ctx.step("Save the step, then save again", async () => { await page.getByTestId("save-wip").click(); await R.toast("Work in progress saved"); await page.getByTestId("save-wip").click(); await R.toast("Work in progress saved"); });
  await ctx.step("Save the incident (Approve One Time)", async () => { await R.act("one"); await R.toast("Approved one time"); });
  await ctx.step("Check the value displays exactly as entered", async () => {
    await expect(page.getByTestId("saved-steps").locator("li")).toHaveText([text]);
    const rows = (await backend(app, "resolution_execution")).filter(r => r.incident === c.number && r.active);
    expect(rows.map(r => r.step_text), "stored step text").toEqual([text]);
  });
};

// ---------------------------------------------------------------- approvals
async function completeReview(ctx, kind, opts = {}) {
  const { R, app, page } = ctx;
  const c = await pick(app, kind);
  await open(ctx, c.number);
  await ctx.step("Complete the required review actions", async () => {
    await R.assign();
    if (kind.startsWith("noPred")) { await R.failure(null, "Upstream file was not delivered before the 02:00 schedule."); await R.category(null, opts.category || "Missing Source File"); }
    else await R.approveAll();
    if (await page.getByTestId("no-kb-match").count()) await R.addStep(opts.step || "Rerun the job stream after the fix");
  });
  return c;
}
exports.completeReview = completeReview;

exports.approveAddKb = async ctx => {
  const { R, page, app } = ctx;
  const c = await completeReview(ctx, "kbPred");
  await ctx.step("Click Approve & Add to KB", async () => { await R.act("kb"); await R.toast(/Approved/); });
  await ctx.step("Check the approval completed", async () => {
    await expect(page.getByTestId("incident-status")).toHaveText("Can be Closed");
    await expect(page.getByTestId("review-status")).toHaveText("Completed");
    expect((await app.incident(c.number)).approved).toBe(true);
  });
};

exports.approveOneTime = async ctx => {
  const { R, page, app } = ctx;
  const kbBefore = (await backend(app, "swat_kb")).length;
  const c = await completeReview(ctx, "kbPred");
  await ctx.step("Select Approve One Time", async () => { await R.act("one"); await R.toast("Approved one time"); });
  await ctx.step("Check the incident is approved and the Knowledge Base is unchanged", async () => {
    await expect(page.getByTestId("incident-status")).toHaveText("Can be Closed");
    await assertKbUnchanged(app, kbBefore);
    expect((await backend(app, "resolution_execution")).filter(r => r.incident === c.number && r.active).length).toBeGreaterThan(0);
  });
};

exports.approveAndResolve = async ctx => {
  const { R, page } = ctx;
  await completeReview(ctx, "kbPred");
  await ctx.step("Click Approve and Resolve", async () => { await R.act("resolve"); await R.toast("Incident approved and resolved"); });
  await ctx.step("Check the incident is resolved", async () => expect(page.getByTestId("incident-status")).toHaveText("Closed"));
};

exports.closeIncident = async ctx => {
  const { R, page, app } = ctx;
  const c = await completeReview(ctx, "kbPred");
  await ctx.step("Approve the review", async () => { await R.act("one"); await R.toast("Approved one time"); });
  await ctx.step("Close the incident", async () => { await app.open(`#/incidents/edit/${c.number}`); await R.act("close"); await R.toast("Incident closed"); });
  await ctx.step("Check the incident is closed", async () => expect(page.getByTestId("incident-status")).toHaveText("Closed"));
};

exports.wip = (byLabel = true) => async ctx => {
  const { R, page, app } = ctx;
  const c = await pick(app, "kbPred");
  await open(ctx, c.number);
  await ctx.step("Update incident details", async () => { await R.assign(); await R.failure("approve"); });
  await ctx.step("Click Save Work In Progress", async () => {
    if (byLabel) await page.getByRole("button", { name: "Save Work In Progress" }).click({ timeout: 5000 });
    else await page.getByTestId("save-wip").click();
    await R.toast("Work in progress saved");
  });
  await ctx.step("Check it saved without closing", async () => {
    const inc = await app.incident(c.number);
    expect(inc.status).toBe("In Progress"); expect(inc.workedBy).toBe("Arjun Nair"); expect(inc.review.status).toBe("In progress");
  });
};

exports.resolutionDetails = async ctx => {
  const { R, page, app } = ctx;
  const c = await pick(app, "kbPred");
  await open(ctx, c.number);
  await ctx.step("Enter Resolution Details", () => page.getByTestId("resolution-details").fill("Vendor confirmed the outage window; job rerun at 04:30."));
  await ctx.step("Save the incident", async () => { await page.getByTestId("save-wip").click(); await R.toast("Work in progress saved"); });
  await reload(ctx, c.number);
  await ctx.step("Check Resolution Details persist", async () => expect(page.getByTestId("resolution-details")).toHaveValue("Vendor confirmed the outage window; job rerun at 04:30."));
};

exports.persistence = async ctx => {
  const { R, page, app } = ctx;
  const c = await pick(app, "kbPred");
  await open(ctx, c.number);
  await ctx.step("Update category, KB selection, steps and comments", async () => {
    await R.assign("Sneha Kulkarni"); await R.failure("approve"); await R.category("approve"); await R.steps("approve");
    await page.getByTestId("resolution-details").fill("Checked with DBA.");
  });
  await ctx.step("Save", async () => { await page.getByTestId("save-wip").click(); await R.toast("Work in progress saved"); });
  await reload(ctx, c.number);
  await ctx.step("Check every saved value is retained", async () => {
    await expect(page.getByTestId("worked-by")).toHaveValue("Sneha Kulkarni");
    for (const id of ["failure-approve", "category-approve", "steps-approve"]) await expect(page.getByTestId(id)).toBeChecked();
    await expect(page.getByTestId("kb-steps")).toBeVisible();
    await expect(page.getByTestId("resolution-details")).toHaveValue("Checked with DBA.");
  });
};

exports.noDuplicates = async ctx => {
  const { R, page, app } = ctx;
  const c = await completeReview(ctx, "kbPred");
  await ctx.step("Save the resolution steps, retrying the submission", async () => {
    await page.getByTestId("approve-one-time").dblclick();
    await R.toast("Approved one time");
    const retry = await app.api(`/api/incidents/${c.number}/review`, { method: "POST", body: { action: "one-time" } });
    expect(retry.status, "a repeated submission is refused").toBe(409);
  });
  await ctx.step("Check no duplicate records were created", async () => {
    const rows = (await backend(app, "resolution_execution")).filter(r => r.incident === c.number && r.active);
    const steps = (await app.incident(c.number)).resolution.steps.length;
    expect(rows.length).toBe(steps);
    expect(new Set(rows.map(r => r.step_no)).size).toBe(steps);
  });
};

// ---------------------------------------------------------------- SCD2 versioning
exports.scd2 = async ctx => {
  const { R, page, app } = ctx;
  const c = await pick(app, "kbPred");
  const key = `${c.interfaceCode}|${c.category}`;
  const before = (await backend(app, "swat_kb")).filter(r => r.kb_key === key);
  await open(ctx, c.number);
  await ctx.step("Edit an existing KB resolution step", async () => {
    await R.assign(); await R.failure("approve"); await R.category("approve"); await R.steps("reject");
    await R.editStep(1, "Check active sessions and locks on the target schema; capture the blocking SID");
  });
  await ctx.step("Click Approve & Add to KB", async () => { await R.act("kb"); await R.toast("Approved and added to the Knowledge Base"); });
  await ctx.step("Verify backend records (SWAT_KB)", async () => {
    const rows = (await backend(app, "swat_kb")).filter(r => r.kb_key === key);
    const active = rows.filter(r => r.active_flag);
    expect(rows.length, "one new version row").toBe(before.length + 1);
    expect(active.length, "active versions for this interface and category").toBe(1);
    expect(active[0].version).toBe(Math.max(...before.map(r => r.version)) + 1);
    expect(rows.find(r => r.version === before[0].version).eff_end, "previous version end date").not.toBeNull();
  }, { screenshot: false });
};

// ---------------------------------------------------------------- AI predictions: approve / reject combinations
const VALID_FAIL = "Database deadlock on the GL schema during the nightly load.";
exports.combo = ({ failure = "approve", category = "approve", steps = "approve", action = "one", kind = "kbPred" } = {}) => async ctx => {
  const { R, page, app } = ctx;
  const c = await pick(app, kind);
  const corrected = other(c.category);
  const kbBefore = (await backend(app, "swat_kb")).length;
  await open(ctx, c.number);
  await ctx.step(`${failure === "approve" ? "Approve" : "Reject and correct"} Failure Details`, async () => { await R.assign(); await R.failure(failure, failure === "reject" ? VALID_FAIL : undefined); });
  await ctx.step(`${category === "approve" ? "Approve" : "Reject and correct"} Issue Category`, () => R.category(category, category === "reject" ? corrected : undefined));
  await ctx.step(`${steps === "approve" ? "Approve" : "Reject and correct"} Resolution Steps`, async () => {
    if (await page.getByTestId("no-kb-match").count()) { await R.addStep("Rerun the job after confirming the fix"); return; }
    await R.steps(steps);
    if (steps === "reject") await R.editStep(1, "Corrected: confirm the root cause with the SME before rerun");
  });
  await ctx.step(`Save with ${action === "kb" ? "Approve & Add to KB" : "Approve One Time"}`, async () => { await R.act(action); await R.toast(/^Approved/); });
  await ctx.step("Check the review outcome is saved", async () => {
    const inc = await app.incident(c.number);
    expect(inc.review.status).toBe("Completed");
    expect(inc.review.failure.decision).toBe(failure === "approve" ? "Approved" : "Rejected");
    expect(inc.review.category.decision).toBe(category === "approve" ? "Approved" : "Rejected");
    if (failure === "reject") expect(inc.failureDetails).toBe(VALID_FAIL);
    expect(inc.category).toBe(category === "reject" ? corrected : c.category);
    await expect(page.getByTestId("review-failure")).toContainText(failure === "approve" ? "Approved" : "Corrected");
    if (action === "one") await assertKbUnchanged(app, kbBefore);
    else {
      const active = (await backend(app, "swat_kb")).filter(r => r.kb_key === `${inc.interfaceCode}|${inc.category}` && r.active_flag);
      expect(active.length).toBeGreaterThan(0);
      expect(active[0].steps).toBe(inc.resolution.steps.map(s => s.text).join(" | "));
    }
  });
};

exports.rejectWithoutCorrection = section => async ctx => {
  const { R, page, app } = ctx;
  const c = await pick(app, "kbPred");
  await open(ctx, c.number);
  await ctx.step(`Reject ${section} and leave the correction blank`, async () => {
    await R.assign();
    await R.failure(section === "failure" ? "reject" : "approve", section === "failure" ? "" : undefined);
    await R.category(section === "category" ? "reject" : "approve");
    await R.steps(section === "steps" ? "reject" : "approve");
    if (section === "steps") { const n = await R.stepInputs().count(); for (let k = n; k >= 1; k--) await R.deleteStep(k); }
  });
  await ctx.step("Save the review", async () => {
    await R.act("one"); await R.toast("Please correct the highlighted fields.");
    const msg = { failure: "Enter the corrected failure details (10-500 characters).", category: "Select the corrected issue category.", steps: "Enter the corrected resolution steps." }[section];
    await expect(page.locator(`[data-err="${section}"]`)).toHaveText(msg);
    expect((await app.incident(c.number)).review.status).toBe("Not started");
  });
};

exports.readOnlyAfterReview = async ctx => {
  const { R, page, app } = ctx;
  const c = await completeReview(ctx, "kbPred");
  await ctx.step("Complete the review", async () => { await R.act("one"); await R.toast("Approved one time"); });
  await ctx.step("Reopen the reviewed incident", () => app.open(`#/incidents/edit/${c.number}`));
  await ctx.step("Check the AI review controls are read-only", async () => {
    await expect(page.getByTestId("review-completed")).toBeVisible();
    await expect(page.getByTestId("failure-approve")).toBeDisabled();
    await expect(page.getByTestId("category-approve")).toBeDisabled();
    await expect(page.getByTestId("approve-one-time")).toHaveCount(0);
  });
};

exports.syncToEvent = async ctx => {
  const { R, page, app } = ctx;
  const c = await pick(app, "kbPred");
  const corrected = other(c.category);
  await open(ctx, c.number);
  await ctx.step("Approve or correct the AI values", async () => { await R.assign(); await R.failure("approve"); await R.category("reject", corrected); if (await page.getByTestId("no-kb-match").count()) await R.addStep("Rerun after the fix"); else await R.steps("approve"); });
  await ctx.step("Save and refresh", async () => { await R.act("one"); await R.toast("Approved one time"); await page.reload(); });
  await ctx.step("Check the incident task event record", async () => {
    const ev = (await backend(app, "incident_task_event")).filter(e => e.incident === c.number);
    expect(ev.length).toBe(1);
    expect(ev[0].issue_category).toBe(corrected);
    expect(ev[0].review_status).toBe("Completed");
    await expect(page.getByTestId("final-category")).toHaveText(corrected);
  });
};

exports.executionTable = async ctx => {
  const { R, app } = ctx;
  const c = await completeReview(ctx, "predNoKb", { step: "Escalate to the vendor and rerun" });
  await ctx.step("Add a second step and save", async () => { await R.addStep("Confirm the next run completes"); await R.act("one"); await R.toast("Approved one time"); });
  await ctx.step("Verify the resolution execution records", async () => {
    const rows = (await backend(app, "resolution_execution")).filter(r => r.incident === c.number && r.active);
    expect(rows.map(r => r.step_text)).toEqual(["Escalate to the vendor and rerun", "Confirm the next run completes"]);
  }, { screenshot: false });
};

exports.kbUsage = async ctx => {
  const { R, app } = ctx;
  const c = await pick(app, "kbPred");
  const key = `${c.interfaceCode}|${c.category}`;
  const before = (await backend(app, "swat_kb")).find(r => r.kb_key === key && r.active_flag).usage_count;
  await open(ctx, c.number);
  await ctx.step("Use the KB recommendation", async () => { await R.assign(); await R.approveAll(); });
  await ctx.step("Approve and save", async () => { await R.act("one"); await R.toast("Approved one time"); });
  await ctx.step("Check the KB usage count increased", async () => {
    const after = (await backend(app, "swat_kb")).find(r => r.kb_key === key && r.active_flag).usage_count;
    expect(after, "KB usage count after use").toBe(before + 1);
  }, { screenshot: false });
};

exports.backendErrorsHidden = async ctx => {
  const { R, page, app } = ctx;
  const c = await pick(app, "predNoKb");
  await open(ctx, c.number);
  await ctx.step("Trigger backend validation (16 resolution steps)", async () => {
    await R.assign(); await R.failure("approve"); await R.category("approve");
    for (let k = 1; k <= 16; k++) await R.addStep(`Step ${k}`);
  });
  await ctx.step("Save and observe the response", async () => {
    await R.act("one");
    const msg = await R.toast();
    expect(msg).toBe("Enter at most 15 resolution steps.");
    const text = await page.locator("body").innerText();
    expect(text).not.toMatch(/\bSQL\b|BigQuery|stack trace|Exception|at Object\.|\bSELECT\b|\bINSERT\b|ERR_|TypeError/);
  });
};

exports.noPrediction = ({ complete = false } = {}) => async ctx => {
  const { R, page, app } = ctx;
  const c = await pick(app, "noPred");
  await open(ctx, c.number);
  await ctx.step("Review page behaviour without AI output", async () => {
    await expect(page.getByTestId("review-failure")).toContainText("(No AI prediction available)");
    await expect(page.getByTestId("failure-correction")).toBeEditable();
    await expect(page.getByTestId("category-select")).toBeEnabled();
  });
  if (complete) {
    await ctx.step("Enter the values manually and save", async () => {
      await R.assign(); await R.failure(null, "Upstream file was not delivered before the 02:00 schedule."); await R.category(null, "Missing Source File");
      if (await page.getByTestId("no-kb-match").count()) await R.addStep("Request the file from the upstream team and rerun");
      else await R.steps("approve");
      await R.act("one"); await R.toast("Approved one time");
    });
    await ctx.step("Check the review completed", async () => expect(page.getByTestId("review-status")).toHaveText("Completed"));
  }
};

exports.noKbMatch = ({ addStep = false } = {}) => async ctx => {
  const { R, page, app } = ctx;
  const c = await pick(app, "predNoKb");
  await open(ctx, c.number);
  await ctx.step("Review the resolution section", async () => { await expect(page.getByTestId("no-kb-match")).toBeVisible(); await expect(page.getByTestId("add-step")).toBeEnabled(); });
  if (addStep) await ctx.step("Add resolution steps manually and save", async () => {
    await R.addStep("Engage the vendor and rerun"); await page.getByTestId("save-wip").click(); await R.toast("Work in progress saved");
    await expect(page.getByTestId("step-input-1")).toHaveValue("Engage the vendor and rerun");
  });
};

exports.decisionPersistence = async ctx => {
  const { R, page, app } = ctx;
  const c = await pick(app, "kbPred");
  await open(ctx, c.number);
  await ctx.step("Approve failure details and reject the category", async () => { await R.failure("approve"); await R.category("reject", other(c.category)); });
  await ctx.step("Save and refresh", async () => { await page.getByTestId("save-wip").click(); await R.toast("Work in progress saved"); await page.reload(); });
  await ctx.step("Check the decisions are still there", async () => {
    await expect(page.getByTestId("failure-approve")).toBeChecked();
    await expect(page.getByTestId("category-reject")).toBeChecked();
    await expect(page.getByTestId("category-select")).toHaveValue(other(c.category));
  });
};

exports.kbIntegrity = async ctx => {
  const { R, page, app } = ctx;
  const c = await completeReview(ctx, "predNoKb", { step: "Reset the partner certificate and rerun" });
  await ctx.step("Save with Approve & Add to KB", async () => { await R.act("kb"); await R.toast("Approved and added to the Knowledge Base"); });
  await ctx.step("Verify the SWAT_KB record and the incident page", async () => {
    const rows = (await backend(app, "swat_kb")).filter(r => r.kb_key === `${c.interfaceCode}|${c.category}`);
    expect(rows.length).toBe(1);
    expect(rows[0].steps).toBe("Reset the partner certificate and rerun");
    await expect(page.getByTestId("saved-steps").locator("li")).toHaveText(["Reset the partner certificate and rerun"]);
  });
  await ctx.step("Reopen the incident", async () => { await page.reload(); await expect(page.getByTestId("saved-steps").locator("li")).toHaveCount(1); });
};

exports.smeSync = async ctx => {
  const { page, app } = ctx;
  const kb = (await app.api("/api/kb")).json[0];
  await ctx.step(`Assign SMEs on Interface Edit for ${kb.interfaceCode}`, async () => {
    await app.open(`#/interfaces/edit/${kb.interfaceCode}`, "SME");
    await page.getByTestId("sme-onshore").selectOption("Chen, Laura");
    await page.getByTestId("sme-offshore").selectOption("Joseph, Neha");
  });
  await ctx.step("Save changes", async () => { await page.getByTestId("save-interface").click(); await expect(page.getByTestId("toast").last()).toHaveText("Interface saved"); });
  await ctx.step("Open the SWAT Knowledge Base entry", async () => {
    await app.open("#/kb", "SME");
    await page.getByPlaceholder("Search knowledge base").fill(kb.interfaceCode);
    const row = page.getByTestId("kb-table").locator("tbody tr").first();
    await expect(row).toContainText("Chen, Laura");
    await expect(row).toContainText("Joseph, Neha");
  });
};

exports.kbAcceptedAsIs = async ctx => {
  const { R, app } = ctx;
  const c = await pick(app, "kbPred");
  const key = `${c.interfaceCode}|${c.category}`;
  const before = (await backend(app, "swat_kb")).filter(r => r.kb_key === key).length;
  await completeReviewOn(ctx, c);
  await ctx.step("Accept the KB steps as-is and click Approve One Time", async () => { await R.act("one"); await R.toast("Approved one time"); });
  await ctx.step("Check no new KB history record was created", async () => expect((await backend(app, "swat_kb")).filter(r => r.kb_key === key).length).toBe(before), { screenshot: false });
};
async function completeReviewOn(ctx, c) {
  await open(ctx, c.number);
  await ctx.step("Accept all predictions and KB steps", async () => { await ctx.R.assign(); await ctx.R.approveAll(); });
}

exports.newKbFromCorrection = async ctx => {
  const { R, page, app } = ctx;
  const c = (await (async () => { const all = (await app.api("/api/test/candidates")).json; return all.find(x => x.status === "Open" && x.hasPrediction && x.noRecCategory); })());
  await open(ctx, c.number);
  await ctx.step("Correct the AI predictions and add new resolution steps", async () => {
    await R.assign(); await R.failure("reject", VALID_FAIL); await R.category("reject", c.noRecCategory);
    await expect(page.getByTestId("no-kb-match")).toBeVisible();
    await R.addStep("Correct the source records with SME approval"); await R.addStep("Rerun the load for the batch");
  });
  await ctx.step("Click Approve & Add to KB", async () => { await R.act("kb"); await R.toast("Approved and added to the Knowledge Base"); });
  await ctx.step("Check the corrected values and the new KB entry", async () => {
    const inc = await app.incident(c.number);
    expect(inc.category).toBe(c.noRecCategory); expect(inc.failureDetails).toBe(VALID_FAIL);
    const rows = (await backend(app, "swat_kb")).filter(r => r.kb_key === `${c.interfaceCode}|${c.noRecCategory}`);
    expect(rows.length).toBe(1); expect(rows[0].active_flag).toBe(true);
  });
};

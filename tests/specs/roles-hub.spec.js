// AI-generated from catalog cases QA-RBAC-* and QA-HUB-* (role-based access and the Resolution Hub).
const { test, expect } = require("../fixtures");

test.describe("Role-based access", () => {
  test("QA-RBAC-001 Role diagnostic switches the active role", async ({ page, app, step }) => {
    await step("Open Site Management", () => app.open("#/site"));
    await step("Select SME and click Apply", async () => {
      await page.getByTestId("role-select").selectOption("SME");
      await page.getByTestId("role-apply").click();
      await expect(page.getByTestId("current-role")).toContainText("Role: SME");
    });
  });

  test("QA-RBAC-003 Manager has view-only access to an incident", async ({ page, app, step }) => {
    const n = (await app.incidents("In Progress"))[0].number;
    await step("Switch role to Manager and open the edit URL directly", () => app.open(`#/incidents/edit/${n}`, "Manager"));
    await step("Check that fields are read-only and there is no Save button", async () => {
      await expect(page.getByTestId("worked-by")).toBeDisabled();
      await expect(page.getByTestId("approve-resolve")).toHaveCount(0);
      await expect(page.getByTestId("save-wip")).toHaveCount(0);
      await expect(page.getByTestId("read-only")).toBeVisible();
    });
  });

  test("QA-RBAC-004 Manager sees no edit actions in the incident list", async ({ page, app, step }) => {
    await step("Switch role to Manager and open Incident Management", () => app.open("#/incidents", "Manager"));
    await step("Check the Actions column", async () => {
      await expect(page.getByTestId("incident-table").locator("tbody tr")).toHaveCount(10);
      const edits = await page.getByRole("link", { name: /^Edit INCTSK/ }).count();
      expect(edits, "edit actions visible to a view-only Manager").toBe(0);
    });
  });

  test("QA-RBAC-005 Server rejects approval from a SWAT user", async ({ app, step }) => {
    const n = (await app.incidents("Awaiting SME Response"))[0].number;
    await step("Send an approval request for an incident with the SWAT role", async () => {
      const r = await app.api(`/api/incidents/${n}/approve`, { method: "POST", role: "SWAT", body: {} });
      expect(r.status).toBe(403);
      expect(r.json.error).toBe("Only SME or Admin users can approve resolution steps.");
    }, { screenshot: false });
  });
});

test.describe("Incident Resolution Hub", () => {
  test("QA-HUB-001 Resolution Hub lists every incident awaiting SME", async ({ page, app, step }) => {
    const expected = (await app.incidents("Awaiting SME Response")).length;
    await step("Switch role to SME and open Incident Resolution Hub", () => app.open("#/resolution-hub", "SME"));
    await step("Compare with the Awaiting SME Response tab", async () => {
      await expect(page.getByTestId("hub-awaiting")).toHaveText(String(expected));
      await expect(page.locator('[data-testid^="hub-INCTSK"]')).toHaveCount(expected);
    });
  });

  test("QA-HUB-002 SME approves a resolution from the Hub", async ({ page, app, step }) => {
    await step("Switch role to SME and open Incident Resolution Hub", () => app.open("#/resolution-hub", "SME"));
    const card = page.locator('[data-testid^="hub-INCTSK"]').filter({ has: page.locator("[data-approve]") }).first();
    const id = await card.getAttribute("data-testid");
    await step("Click Approve on the first incident", () => card.locator("[data-approve]").click());
    await step("Check the incident is approved and ready to close", async () => {
      await expect(page.getByTestId("toast").last()).toHaveText("Resolution approved");
      const inc = await app.incident(id.replace("hub-", ""));
      expect(inc.approved).toBe(true); expect(inc.status).toBe("Can be Closed");
    });
  });

  test("QA-HUB-003 Approve and add to Knowledge Base from the Hub", { tag: "@review" }, async ({ page, app, step }) => {
    let before;
    await step("Switch role to SME and open Incident Resolution Hub", () => app.open("#/resolution-hub", "SME"));
    await step("Note the Knowledge Base entry count", async () => { before = Number(await page.getByTestId("hub-kb").innerText()); });
    const target = [];
    for (const r of await app.incidents("Awaiting SME Response")) { const d = await app.incident(r.number); if (d.suggestion.source !== "Knowledge Base" && d.suggestion.steps.length && !d.approved && d.aiPrediction) { target.push(d.number); break; } }
    await step("Click Approve & add to KB on an incident without an exact KB entry", async () => {
      await page.getByTestId(`hub-${target[0]}`).locator("[data-approve-kb]").click();
      await expect(page.getByTestId("hub-kb")).toHaveText(String(before + 1));
    });
  });
});

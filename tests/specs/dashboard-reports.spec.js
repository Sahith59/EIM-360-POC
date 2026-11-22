// AI-generated from catalog cases QA-DSH-*, QA-RPT-* and QA-KB-*.
const { test, expect } = require("../fixtures");
const fs = require("fs");

test.describe("Dashboard and reporting", () => {
  test("QA-DSH-001 Home KPIs match the incident list", async ({ page, app, step }) => {
    const list = await app.api("/api/incidents");
    await step("Open Home", () => app.open("#/home"));
    await step("Compare Open, In progress and Awaiting SME with the list tabs", async () => {
      await expect(page.getByTestId("kpi-open").locator(".value")).toHaveText(String(list.json.tabs["Open"]));
      await expect(page.getByTestId("kpi-inprogress").locator(".value")).toHaveText(String(list.json.tabs["In Progress"]));
      await expect(page.getByTestId("kpi-awaiting").locator(".value")).toHaveText(String(list.json.tabs["Awaiting SME Response"]));
    });
  });

  test("QA-DSH-002 Dashboard period changes the totals", async ({ page, app, step }) => {
    const totals = [];
    await step("Open Incident Dashboard", () => app.open("#/dashboard", "Manager"));
    for (const d of ["7", "30", "90"]) await step(`Switch to the last ${d} days`, async () => {
      await page.getByTestId("period").selectOption(d);
      await expect(page.getByTestId("dash-total")).toContainText(`in the last ${d} days`);
      totals.push(Number(await page.getByTestId("dash-total").locator(".value").innerText()));
    });
    await step("Totals do not decrease as the period grows", async () => { expect(totals[1]).toBeGreaterThanOrEqual(totals[0]); expect(totals[2]).toBeGreaterThanOrEqual(totals[1]); }, { screenshot: false });
  });

  test("QA-DSH-003 Manager breakdown adds up to the period total", { tag: "@review" }, async ({ page, app, step }) => {
    await step("Open Incident Dashboard (30 days)", () => app.open("#/dashboard", "Manager"));
    await step("Add up the manager totals", async () => {
      const cells = await page.getByTestId("manager-table").locator("tbody td:nth-child(2)").allInnerTexts();
      const total = Number(await page.getByTestId("dash-total").locator(".value").innerText());
      expect(cells.reduce((a, b) => a + Number(b), 0)).toBe(total);
    });
  });

  test("QA-RPT-001 Standard report download matches the on-screen count", async ({ page, app, step }) => {
    let shown;
    await step("Open Reporting", () => app.open("#/reporting", "Manager"));
    const row = page.getByRole("row", { name: /Unassigned incidents/ });
    await step("Note the Unassigned incidents count", async () => { shown = Number(await row.locator("td.num").innerText()); });
    await step("Download Unassigned incidents", async () => {
      const [dl] = await Promise.all([page.waitForEvent("download"), row.getByRole("button", { name: "Download" }).click()]);
      const lines = fs.readFileSync(await dl.path(), "utf8").trim().split(/\r?\n/);
      expect(lines.length - 1).toBe(shown);
    });
  });

  test("QA-RPT-002 Excel export contains the visible rows", { tag: "@review" }, async ({ page, app, step }) => {
    await step("Open Incident Management, Open tab", async () => { await app.open("#/incidents"); await Promise.all([page.waitForResponse(x => new URL(x.url()).pathname === "/api/incidents" && x.request().method() === "GET"), page.getByTestId("tab-open").click()]); });
    await step("Click Excel and open the file", async () => {
      const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Excel" }).click()]);
      const xml = fs.readFileSync(await dl.path(), "utf8");
      const rows = (xml.match(/<Row>/g) || []).length;
      expect(rows - 1).toBe(Number(await page.getByTestId("count-open").innerText()));
    });
  });

  test("QA-KB-001 Knowledge Base search filters by interface code", async ({ page, app, step }) => {
    const code = (await app.api("/api/kb")).json[0].interfaceCode;
    await step("Open Interface Knowledge Base", () => app.open("#/kb"));
    await step(`Search for ${code}`, async () => {
      await page.getByPlaceholder("Search knowledge base").fill(code);
      const rows = page.getByTestId("kb-table").locator("tbody tr");
      await expect(rows.first()).toContainText(code);
      for (const t of await rows.locator("td:first-child .mono").allInnerTexts()) expect(t).toBe(code);
    });
  });
});

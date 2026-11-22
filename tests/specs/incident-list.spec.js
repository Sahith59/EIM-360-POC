// AI-generated from catalog cases QA-INC-* and QA-SYNC-* (Incident List and ServiceNow sync).
const { test, expect } = require("../fixtures");
const listLoaded = page => page.waitForResponse(r => /\/api\/incidents(\?|$)/.test(new URL(r.url()).pathname + new URL(r.url()).search.slice(0, 1)) && r.request().method() === "GET");
const fs = require("fs");

const entries = async page => Number((await page.getByTestId("pager-info").innerText()).match(/of (\d+) entries/)[1]);

test.describe("Incident List", () => {
  test("QA-INC-001 Incident list shows all active incidents", async ({ page, app, step }) => {
    await step("Open Incident Management", () => app.open("#/incidents"));
    await step("Check the incident total and the All tab", async () => {
      await expect(page.getByTestId("total-chip")).toHaveText("259 incidents");
      await expect(page.getByTestId("count-all")).toHaveText("259");
    });
    await step("Check the pager text", async () => expect(page.getByTestId("pager-info")).toHaveText("Showing 1 to 10 of 259 entries"));
  });

  for (const [id, tab, slug] of [["QA-INC-002", "Open", "open"], ["QA-INC-003", "In Progress", "in-progress"], ["QA-INC-004", "Awaiting SME Response", "awaiting-sme-response"], ["QA-INC-005", "Can be Closed", "can-be-closed"]]) {
    test(`${id} ${tab} tab count matches the incidents listed`, async ({ page, app, step }) => {
      await step("Open Incident Management", () => app.open("#/incidents"));
      await step(`Select the ${tab} tab`, async () => { await page.getByTestId(`tab-${slug}`).click(); await expect(page.getByTestId(`tab-${slug}`)).toHaveAttribute("aria-selected", "true"); });
      await step("Compare the tab count with the pager total", async () => {
        const badge = Number(await page.getByTestId(`count-${slug}`).innerText());
        expect(await entries(page), `entries listed under "${tab}" should equal the tab badge (${badge})`).toBe(badge);
      });
      if (tab === "Open") await step("Check the status of the listed incidents", async () => {
        for (const s of await page.getByTestId("incident-table").locator("tbody td .pill").allInnerTexts()) expect(s).toBe("Open");
      });
    });
  }

  test("QA-INC-006 Search filters incidents by interface code", async ({ page, app, step }) => {
    const code = (await app.incidents())[0].interfaceCode;
    await step("Open Incident Management", () => app.open("#/incidents"));
    await step(`Type ${code} into Search`, async () => { await page.getByTestId("filter-input").fill(code); await expect(page.getByTestId("pager-info")).not.toContainText("of 259"); });
    await step("Check every listed row", async () => {
      const codes = await page.getByTestId("incident-table").locator("tbody tr td:nth-child(4)").allInnerTexts();
      expect(codes.length).toBeGreaterThan(0);
      codes.forEach(c => expect(c).toBe(code));
    });
  });

  test("QA-INC-007 Page size and paging work", async ({ page, app, step }) => {
    await step("Open Incident Management", () => app.open("#/incidents"));
    await step("Set Show to 25 entries", async () => { await page.locator("#size").selectOption("25"); await expect(page.getByTestId("incident-table").locator("tbody tr")).toHaveCount(25); });
    await step("Click Next", async () => { await page.getByRole("button", { name: "Next" }).click(); await expect(page.getByTestId("pager-info")).toHaveText("Showing 26 to 50 of 259 entries"); });
  });

  test("QA-INC-008 Sort by Critical Flag puts P1 first", async ({ page, app, step }) => {
    await step("Open Incident Management", () => app.open("#/incidents"));
    await step("Click the Critical Flag header until ascending", async () => {
      // wait for each re-sort to load before clicking again (robust to slow networks)
      await Promise.all([listLoaded(page), page.getByRole("columnheader", { name: "Critical Flag" }).click()]);
      await expect(page).toHaveURL(/sort=critical/);
      await Promise.all([listLoaded(page), page.getByRole("columnheader", { name: "Critical Flag" }).click()]);
      await expect(page).toHaveURL(/sort=critical&dir=asc/);
    });
    await step("Check the first rows", async () => {
      const flags = await page.getByTestId("incident-table").locator("tbody .prio").allInnerTexts();
      expect(flags.slice(0, 10)).toEqual(Array(10).fill("P1"));
    });
  });

  test("QA-INC-009 Columns menu hides and restores a column", async ({ page, app, step }) => {
    const header = page.getByRole("columnheader", { name: "SME (Onshore)" });
    await step("Open Incident Management", () => app.open("#/incidents"));
    await step("Open Columns and untick SME (Onshore)", async () => { await page.getByRole("button", { name: "Columns" }).click(); await page.getByLabel("SME (Onshore)").uncheck(); await expect(header).toHaveCount(0); });
    await step("Tick it again", async () => { await page.getByLabel("SME (Onshore)").check(); await expect(header).toHaveCount(1); });
  });

  test("QA-INC-010 CSV export matches the selected tab", async ({ page, app, step }) => {
    let lines;
    await step("Open Incident Management", () => app.open("#/incidents"));
    await step("Select the Open tab", () => Promise.all([listLoaded(page), page.getByTestId("tab-open").click()]));
    await step("Click CSV and open the file", async () => {
      const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-csv").click()]);
      lines = fs.readFileSync(await dl.path(), "utf8").trim().split(/\r?\n/);
      expect(lines[0]).toBe("Incident Task Number,Resolution Progress,Interface Code,Interface Description,Critical Flag,SME (Onshore),Worked By,Status,Created");
      expect(lines.length - 1).toBe(Number(await page.getByTestId("count-open").innerText()));
    });
  });
});

test.describe("ServiceNow sync", () => {
  test("QA-SYNC-001 Update Incidents from ServiceNow imports new incidents", async ({ page, app, step }) => {
    let before;
    await step("Open Incident Management", () => app.open("#/incidents"));
    await step("Note the total and Last updated time", async () => { before = await page.getByTestId("last-updated").innerText(); await expect(page.getByTestId("total-chip")).toHaveText("259 incidents"); });
    await step("Click Update Incidents from ServiceNow", async () => {
      await page.getByRole("button", { name: "Update Incidents from ServiceNow" }).click({ timeout: 5000 });
      await expect(page.getByTestId("toast").last()).toHaveText("3 new incident(s) imported from ServiceNow");
      await expect(page.getByTestId("total-chip")).toHaveText("262 incidents");
      await expect(page.getByTestId("last-updated")).not.toHaveText(before);
    });
  });

  test("QA-SYNC-002 Manager cannot trigger a ServiceNow refresh", async ({ page, app, step }) => {
    await step("Switch role to Manager and open Incident Management", () => app.open("#/incidents", "Manager"));
    await step("Check that no refresh button is shown", async () => expect(page.getByRole("button", { name: /ServiceNow/ })).toHaveCount(0));
    await step("Try the refresh from the API as Manager", async () => expect((await app.api("/api/sync", { method: "POST", role: "Manager" })).status).toBe(403), { screenshot: false });
  });
});

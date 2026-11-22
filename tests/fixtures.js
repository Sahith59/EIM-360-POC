// Shared fixtures for the EIM 360 suite.
// - each worker starts its own isolated app instance (parallel-safe)
// - data is reset before every test
// - `step()` wraps test.step and captures a screenshot after every step (and at the point of failure)
// - `app` helpers: open a page as a role, query the API for test data
const base = require("@playwright/test");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const net = require("net");

exports.test = base.test.extend({
  appURL: [async ({}, use, workerInfo) => {
    // pick a free port so parallel workers (or another suite on the same machine) never share an app instance
    const port = await new Promise((ok, bad) => { const s = net.createServer(); s.unref(); s.on("error", bad); s.listen(0, () => { const p = s.address().port; s.close(() => ok(p)); }); });
    const proc = spawn(process.execPath, [path.join(__dirname, "..", "server", "index.js")], { env: { ...process.env, PORT: String(port) }, stdio: ["ignore", "ignore", "pipe"] });
    proc.stderr.on("data", d => process.stderr.write(`[app worker ${workerInfo.workerIndex}] ${d}`));
    const url = `http://localhost:${port}`;
    const want = process.env.BUILD === "fixed" ? "2.4.1" : "2.4.1-rc1";
    let meta = null;
    for (let i = 0; i < 100 && !meta; i++) { try { meta = await (await fetch(url + "/api/meta")).json(); } catch { await new Promise(r => setTimeout(r, 100)); } }
    if (!meta || meta.build.version !== want) { proc.kill(); throw new Error(`EIM 360 test app did not start on port ${port} (expected build ${want}).`); }
    await use(url);
    proc.kill();
  }, { scope: "worker" }],

  baseURL: async ({ appURL }, use) => use(appURL),

  step: async ({ page }, use, testInfo) => {
    let n = 0;
    const dir = testInfo.outputPath("steps");
    fs.mkdirSync(dir, { recursive: true });
    const shoot = async (title, status) => {
      n += 1;
      const file = path.join(dir, `${String(n).padStart(2, "0")}.png`);
      try { await page.screenshot({ path: file, timeout: 5000 }); await testInfo.attach(`step|${n}|${status}|${title}`, { path: file, contentType: "image/png" }); }
      catch { await testInfo.attach(`step|${n}|${status}|${title}`, { body: "", contentType: "text/plain" }); }
    };
    await use(async (title, fn, { screenshot = true } = {}) => base.test.step(title, async () => {
      try { await fn(); } catch (e) { await shoot(title, "failed"); throw e; }
      if (screenshot) await shoot(title, "passed"); else { n += 1; await testInfo.attach(`step|${n}|passed|${title}`, { body: "", contentType: "text/plain" }); }
    }));
  },

  app: async ({ page, appURL }, use, testInfo) => {
    await fetch(appURL + "/api/test/reset", { method: "POST" });
    const app = {
      url: appURL,
      async as(role) {
        await page.goto(appURL + "/#/home");
        await page.evaluate(r => localStorage.setItem("eim.role", r), role);
      },
      async open(hash, role = "SWAT") {
        await this.as(role);
        await page.goto(appURL + "/" + hash);
        await page.reload();
        await base.expect(page.locator("#view h1")).toBeVisible();
      },
      async api(p, { role = "SWAT", method = "GET", body } = {}) {
        const r = await fetch(appURL + p, { method, headers: { "Content-Type": "application/json", "X-Role": role }, body: body && JSON.stringify(body) });
        return { status: r.status, json: await r.json().catch(() => null) };
      },
      async incidents(status) { return (await this.api("/api/incidents" + (status ? "?status=" + encodeURIComponent(status) : ""))).json.rows; },
      async incident(n) { return (await this.api("/api/incidents/" + n)).json; },
    };
    await use(app);
    // on failure, keep a list of interactive elements so the triage engine can suggest healed locators
    if (testInfo.status !== testInfo.expectedStatus) {
      try {
        const els = await page.evaluate(() => [...document.querySelectorAll("button, a, [role=tab], input, select, textarea")].map(e => ({ tag: e.tagName.toLowerCase(), role: e.getAttribute("role") || (e.tagName === "A" ? "link" : e.tagName === "BUTTON" ? "button" : e.tagName.toLowerCase()), name: (e.getAttribute("aria-label") || e.innerText || e.getAttribute("placeholder") || "").trim().replace(/\s+/g, " ").slice(0, 80), testid: e.getAttribute("data-testid") })).filter(e => e.name || e.testid));
        await testInfo.attach("dom-elements", { body: JSON.stringify({ url: page.url(), elements: els }), contentType: "application/json" });
      } catch {}
      // snapshot the SQLite database exactly as it was when the test failed, so the AI can query that state read-only
      try {
        const caseId = (testInfo.title.match(/^((?:QA-)?[A-Z]{2,5}-\d+)/) || [])[1] || `test-${testInfo.testId}`;
        const file = path.join(__dirname, "..", "qa", "runs", process.env.QA_RUN_ID || "adhoc", "db", `${caseId}.sqlite`);
        await fetch(appURL + "/api/test/db-snapshot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file }) });
      } catch {}
    }
  },
});
exports.expect = base.expect;

// Playwright configuration for the EIM 360 AI test agent POC.
const { defineConfig } = require("@playwright/test");
const path = require("path");

const pad = n => String(n).padStart(2, "0");
const d = new Date();
process.env.QA_RUN_ID = process.env.QA_RUN_ID || `run-${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
const runDir = path.join(__dirname, "..", "qa", "runs", process.env.QA_RUN_ID);

module.exports = defineConfig({
  testDir: "./specs",
  outputDir: path.join(__dirname, "..", "qa", ".tmp"),
  fullyParallel: true,
  workers: Number(process.env.WORKERS || 4),
  retries: 0,
  timeout: 30000,
  expect: { timeout: 5000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: path.join(runDir, "report") }], [path.join(__dirname, "..", "qa", "reporter.js")]],
  use: { channel: process.env.PW_CHANNEL || "chrome", headless: true, viewport: { width: 1440, height: 900 }, trace: "retain-on-failure", acceptDownloads: true },
});

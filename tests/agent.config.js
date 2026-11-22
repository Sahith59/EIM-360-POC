// Playwright configuration for the AI-driven run (the LLM decides every action; Playwright executes them).
const base = require("./playwright.config");
module.exports = {
  ...base,
  testDir: "./agent",
  testMatch: /.*\.agent\.spec\.js/,
  workers: Number(process.env.AGENT_WORKERS || process.env.WORKERS || 4),
  timeout: Number(process.env.AGENT_TIMEOUT_MS || 600000),
};

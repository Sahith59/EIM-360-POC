// Runs AI-drafted tests in tests/drafts (not part of the regression suite) so an engineer can check them.
const base = require("./playwright.config");
module.exports = { ...base, testDir: "./drafts", reporter: [["list"]] };

// Live demo: run one or more cases with the AI driving a visible Chrome window.
//   npm run demo:ai MST-13                      (Gemini picks the incident)
//   npm run demo:ai MST-13 INCTSK0709519        (Gemini must use this incident, e.g. the one a tester just used)
//   npm run demo:ai MST-13,MST-24 INCTSK0709519
const { spawnSync } = require("child_process");
const [cases, incident] = process.argv.slice(2);
if (!cases) { console.log("Usage: npm run demo:ai <CASE-ID[,CASE-ID]> [INCIDENT NUMBER]"); process.exit(1); }
const env = { ...process.env, AGENT_CASES: cases, AGENT_WORKERS: "1" };
if (incident) env.AGENT_INCIDENT = incident;
const r = spawnSync("npx", ["playwright", "test", "-c", "tests/agent.config.js", "--headed"], { stdio: "inherit", env, shell: process.platform === "win32" });
process.exit(r.status ?? 1);

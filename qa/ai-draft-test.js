// AI test authoring: the configured LLM turns a manual test case into a Playwright test.
//   npm run ai:draft -- REG-012            draft one case from tests/catalog.json
//   npm run ai:draft -- SMK-01 SMK-02      several cases
// Drafts are written to tests/drafts/<case>.spec.js. An engineer reviews each draft, runs it with
// `npm run ai:draft:test`, and only then moves it into tests/specs. Nothing is added to the suite automatically.
const fs = require("fs");
const path = require("path");
const llm = require("./llm");

const ROOT = path.join(__dirname, "..");
const read = p => fs.readFileSync(path.join(ROOT, p), "utf8");

(async () => {
  const ids = process.argv.slice(2).filter(a => !a.startsWith("-"));
  const cfg = llm.config();
  if (!ids.length) { console.log("Usage: npm run ai:draft -- <caseId> [caseId ...]   e.g. npm run ai:draft -- REG-012"); process.exit(1); }
  if (!cfg.ready) { console.error(`No LLM available: ${cfg.reason}. Copy .env.example to .env and add your key.`); process.exit(1); }
  const catalog = JSON.parse(read("tests/catalog.json"));
  const system = `You are a senior SDET writing Playwright tests (JavaScript, CommonJS) for EIM 360, an incident-management web app.
Use only the helpers shown. A test file must:
- start with: const { test, expect } = require("../fixtures"); const { review, pick } = require("../lib/review"); and any flows it needs from require("../lib/flows")
- define exactly one test titled "<caseId> <title> @review" with the signature async ({ page, app, step }) => { ... }, create R = review(page) and wrap every user-visible action in await step("...", async () => { ... }) so a screenshot is captured after each step
- prefer getByTestId / getByRole locators and web-first assertions (expect(...).toHaveText, toBeVisible, toHaveValue)
Return JSON: {"spec": string (the complete file), "notes": string (assumptions a reviewer should check)}. The marker PLAYWRIGHT_SPEC confirms the task.`;
  let total = { input: 0, output: 0, cost: 0, ms: 0 };
  for (const id of ids) {
    const c = catalog.find(k => k.caseId.toLowerCase() === id.toLowerCase());
    if (!c) { console.error(`${id}: not in tests/catalog.json`); continue; }
    const prompt = `PLAYWRIGHT_SPEC\nTest case ${c.caseId}: ${c.title}\nSuite: ${c.suite} · area: ${c.area} · role: ${c.role}\nPreconditions: ${c.preconditions || "-"}\nSteps:\n${c.steps.map((s, k) => `${k + 1}. ${s}`).join("\n")}\nExpected result: ${c.expected}\n\n--- tests/lib/review.js (page object) ---\n${read("tests/lib/review.js")}\n\n--- tests/lib/flows.js (existing flows you may reuse or imitate) ---\n${read("tests/lib/flows.js")}\n\n--- example spec ---\n${read("tests/specs/client-smoke.spec.js")}`;
    process.stdout.write(`${c.caseId}: drafting with ${cfg.provider} ${cfg.model} ... `);
    try {
      const r = await llm.complete({ system, prompt, maxTokens: 4000, timeoutMs: 120000 });
      const spec = String(r.json.spec || "").trim();
      if (!/require\(["']\.\.\/fixtures["']\)/.test(spec) || !/\btest\(/.test(spec)) throw new Error("the model did not return a usable spec");
      const file = path.join(ROOT, "tests", "drafts", `${c.caseId}.spec.js`);
      const header = `// AI-drafted by ${r.provider} ${r.model} on ${new Date().toISOString().slice(0, 10)} from manual case ${c.caseId} (${c.clientRef || c.source || "catalog"}).\n// Status: IN REVIEW. An engineer must review and run it before it joins tests/specs.\n${r.json.notes ? `// Model notes: ${String(r.json.notes).replace(/\n/g, " ")}\n` : ""}`;
      fs.writeFileSync(file, header + spec + "\n");
      total.input += r.usage.input; total.output += r.usage.output; total.cost += r.costUsd || 0; total.ms += r.latencyMs;
      console.log(`done in ${(r.latencyMs / 1000).toFixed(1)} s · ${r.usage.input + r.usage.output} tokens${r.costUsd != null ? ` · $${r.costUsd.toFixed(4)}` : ""} → ${path.relative(ROOT, file)}`);
    } catch (e) { console.log(`failed: ${e.message}`); }
  }
  if (total.ms) console.log(`\nTotal: ${total.input + total.output} tokens${total.cost ? ` · $${total.cost.toFixed(4)}` : ""} · ${(total.ms / 1000).toFixed(1)} s. Review the drafts, then: npm run ai:draft:test`);
})();

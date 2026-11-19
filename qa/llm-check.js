// npm run llm:check · confirms the provider in .env answers, before a full run
const llm = require("./llm");
const cfg = llm.config();
if (!cfg.ready) { console.error(`LLM not ready: ${cfg.reason} (template: .env.example).`); process.exit(1); }
console.log(`Checking ${cfg.provider} ${cfg.model} ...`);
llm.complete({ prompt: 'Reply with JSON {"ok": true, "model": "<your model name>"}', maxTokens: 200 })
  .then(r => console.log(`OK · replied in ${(r.latencyMs / 1000).toFixed(1)} s · ${r.usage.input + r.usage.output} tokens · ${JSON.stringify(r.json)}`))
  .catch(e => { console.error(`Failed: ${e.message}`); process.exit(1); });

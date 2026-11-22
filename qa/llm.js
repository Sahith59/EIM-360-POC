// Pluggable LLM client for the AI test agent (no dependencies).
//
// Pick a provider with LLM_PROVIDER in the .env file at the repo root (see .env.example):
//   gemini     GEMINI_API_KEY      (default model gemini-3.5-flash)
//   anthropic  ANTHROPIC_API_KEY   (default model claude-sonnet-5-5)
//   openai     OPENAI_API_KEY      (default model gpt-6.2-sol)
//   azure      AZURE_OPENAI_API_KEY + AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_DEPLOYMENT
//   local      any OpenAI-compatible server: Ollama, LM Studio, vLLM, OpenRouter, Groq ...
//              LOCAL_LLM_BASE_URL (default http://localhost:11434/v1), LOCAL_LLM_MODEL, LOCAL_LLM_API_KEY (optional)
//   off        no LLM; triage uses rules and analyst notes only
// If LLM_PROVIDER is not set, the first provider with a key is used. LLM_MODEL overrides the model for any provider.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

// ---- .env loader: KEY=VALUE lines; real environment variables win ----
function loadEnv(file = path.join(ROOT, ".env")) {
  if (!fs.existsSync(file)) return false;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    let v = m[2].trim();
    if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1); else v = v.replace(/\s+#.*$/, "");
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
  return true;
}
loadEnv();

// USD per 1M input / output tokens (standard tier, accessed 19 Nov 2026):
// Gemini https://ai.google.dev/gemini-api/docs/pricing · Claude https://platform.claude.com/docs/en/about-claude/pricing · OpenAI https://developers.openai.com/api/docs/pricing
const PRICES = [
  [/^gemini-3\.1-pro/, 2, 12], [/^gemini-3\.5-flash/, 1.5, 9], [/^gemini-3-flash/, 0.5, 3], [/^gemini-3\.1-flash-lite/, 0.25, 1.5],
  [/^gemini-2\.5-pro/, 1.25, 10], [/^gemini-2\.5-flash-lite/, 0.1, 0.4], [/^gemini-2\.5-flash/, 0.3, 2.5],
  [/^claude-opus-5/, 4, 20], [/^claude-sonnet-5/, 2, 10], [/^claude-haiku-5/, 0.1, 0.5],
  [/^gpt-6\.2-sol/, 2, 10],
];
// Gemini bills input tokens served from its implicit prompt cache at 10% of the input price.
function costUsd(model, usage) {
  const p = PRICES.find(([re]) => re.test(model || ""));
  if (!p || !usage) return null;
  const cached = /^gemini/.test(model || "") ? Math.min(usage.cached || 0, usage.input) : 0;
  return ((usage.input - cached) * p[1] + cached * p[1] * 0.1 + usage.output * p[2]) / 1e6;
}

const DEFAULTS = { gemini: "gemini-3.5-flash", anthropic: "claude-sonnet-5-5", openai: "gpt-6.2-sol", azure: null, local: "llama3.1" };
const KEYS = { gemini: "GEMINI_API_KEY", anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", azure: "AZURE_OPENAI_API_KEY" };

function config() {
  const env = process.env;
  let provider = (env.LLM_PROVIDER || "").trim().toLowerCase();
  if (provider === "ollama" || provider === "openai-compatible") provider = "local";
  if (!provider) provider = ["gemini", "anthropic", "openai", "azure"].find(p => env[KEYS[p]]);
  if (!provider) return { provider: "off", ready: false, reason: "no LLM configured: set LLM_PROVIDER and its API key in .env" };
  if (["off", "none", "false", "0"].includes(provider)) return { provider: "off", ready: false, reason: "LLM_PROVIDER is off" };
  if (!(provider in DEFAULTS) && provider !== "mock") return { provider, ready: false, reason: `Unknown LLM_PROVIDER "${provider}" (use gemini, anthropic, openai, azure, local or off)` };
  const model = env.LLM_MODEL || (provider === "azure" ? env.AZURE_OPENAI_DEPLOYMENT : provider === "local" ? env.LOCAL_LLM_MODEL || DEFAULTS.local : provider === "mock" ? "mock" : DEFAULTS[provider]);
  if (KEYS[provider] && !env[KEYS[provider]]) return { provider, model, ready: false, reason: `${KEYS[provider]} is not set` };
  if (provider === "azure" && !(env.AZURE_OPENAI_ENDPOINT && env.AZURE_OPENAI_DEPLOYMENT)) return { provider, model, ready: false, reason: "AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_DEPLOYMENT are required" };
  return { provider, model, ready: true };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function post(url, headers, body, timeoutMs) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method: "POST", signal: ctl.signal, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    const text = await r.text();
    if (!r.ok) { const e = new Error(`HTTP ${r.status}: ${text.slice(0, 200).replace(/\s+/g, " ")}`); e.status = r.status; throw e; }
    return JSON.parse(text);
  } catch (e) { if (e.name === "AbortError") throw new Error(`timed out after ${timeoutMs / 1000}s`); throw e; }
  finally { clearTimeout(t); }
}

function parseJson(text) {
  const s = String(text || "").replace(/^```(?:json)?\s*|\s*```$/g, "");
  const i = s.indexOf("{"), j = s.lastIndexOf("}");
  if (i < 0 || j < i) throw new Error("model did not return JSON");
  return JSON.parse(s.slice(i, j + 1));
}

// Gemini 2.5+/3.x models think before answering and thinking tokens count against maxOutputTokens,
// so Gemini gets extra headroom (GEMINI_THINKING_HEADROOM, default 6000) on top of the answer budget.
// One call. prompt: string; images: [{ mime, base64 }]; json: ask for a JSON object.
// Returns { text, json, usage: {input, output}, costUsd, latencyMs, provider, model }.
async function complete({ system, prompt, images = [], json = true, maxTokens = 1500, timeoutMs = Number(process.env.LLM_TIMEOUT_MS || 60000) }) {
  const cfg = config();
  if (!cfg.ready) throw new Error(cfg.reason);
  const env = process.env, { provider, model } = cfg;
  const t0 = Date.now();
  let text = "", usage = null;
  for (let attempt = 1; ; attempt++) {
    try {
      if (provider === "gemini") {
        const base = env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta";
        const parts = [{ text: prompt }, ...images.map(i => ({ inline_data: { mime_type: i.mime, data: i.base64 } }))];
        const r = await post(`${base}/models/${encodeURIComponent(model)}:generateContent`, { "x-goog-api-key": env.GEMINI_API_KEY },
          { ...(system ? { system_instruction: { parts: [{ text: system }] } } : {}), contents: [{ role: "user", parts }], generationConfig: { maxOutputTokens: maxTokens + Number(env.GEMINI_THINKING_HEADROOM || 6000), temperature: 0.2, ...(json ? { responseMimeType: "application/json" } : {}) } }, timeoutMs);
        const cand = (r.candidates || [])[0];
        text = cand && cand.content ? (cand.content.parts || []).map(p => p.text || "").join("") : "";
        if (!text) throw new Error(`empty response${cand && cand.finishReason ? ` (${cand.finishReason})` : r.promptFeedback ? ` (${JSON.stringify(r.promptFeedback).slice(0, 80)})` : ""}`);
        const u = r.usageMetadata || {}; usage = { input: u.promptTokenCount || 0, output: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0), cached: u.cachedContentTokenCount || 0 };
      } else if (provider === "anthropic") {
        const base = env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
        const content = [...images.map(i => ({ type: "image", source: { type: "base64", media_type: i.mime, data: i.base64 } })), { type: "text", text: prompt + (json ? "\nReturn one JSON object only." : "") }];
        const r = await post(`${base}/v1/messages`, { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
          { model, max_tokens: maxTokens, temperature: 0.2, ...(system ? { system } : {}), messages: [{ role: "user", content }] }, timeoutMs);
        text = (r.content || []).map(c => c.text || "").join("");
        usage = { input: (r.usage || {}).input_tokens || 0, output: (r.usage || {}).output_tokens || 0 };
      } else if (provider === "mock") {
        // offline stand-in used only to test the pipeline without a key; never quote its output
        text = JSON.stringify(require("./llm-mock")(prompt)); usage = { input: Math.round(prompt.length / 4) + images.length * 1300, output: Math.round(text.length / 4) };
      } else {
        // OpenAI, Azure OpenAI and OpenAI-compatible servers share the Chat Completions format
        const content = [{ type: "text", text: prompt }, ...images.map(i => ({ type: "image_url", image_url: { url: `data:${i.mime};base64,${i.base64}` } }))];
        const messages = [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: images.length ? content : prompt }];
        let url, headers, body = { messages, ...(json ? { response_format: { type: "json_object" } } : {}) };
        if (provider === "azure") {
          url = `${env.AZURE_OPENAI_ENDPOINT.replace(/\/$/, "")}/openai/deployments/${encodeURIComponent(env.AZURE_OPENAI_DEPLOYMENT)}/chat/completions?api-version=${env.AZURE_OPENAI_API_VERSION || "2024-10-21"}`;
          headers = { "api-key": env.AZURE_OPENAI_API_KEY }; body.max_completion_tokens = maxTokens;
        } else if (provider === "openai") {
          url = `${(env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "")}/chat/completions`;
          headers = { authorization: `Bearer ${env.OPENAI_API_KEY}` }; body.model = model; body.max_completion_tokens = maxTokens;
        } else {
          url = `${(env.LOCAL_LLM_BASE_URL || "http://localhost:11434/v1").replace(/\/$/, "")}/chat/completions`;
          headers = env.LOCAL_LLM_API_KEY ? { authorization: `Bearer ${env.LOCAL_LLM_API_KEY}` } : {}; body.model = model; body.max_tokens = maxTokens; body.temperature = 0.2;
        }
        const r = await post(url, headers, body, timeoutMs);
        text = ((r.choices || [])[0] || {}).message ? r.choices[0].message.content || "" : "";
        if (Array.isArray(text)) text = text.map(p => p.text || "").join("");
        usage = { input: (r.usage || {}).prompt_tokens || 0, output: (r.usage || {}).completion_tokens || 0 };
      }
      break;
    } catch (e) {
      const retry = (e.status === 429 || e.status >= 500 || /timed out|fetch failed|ECONNRESET/.test(e.message)) && attempt < 4;
      if (!retry) throw e;
      await sleep(Math.min(20000, 2000 * 2 ** (attempt - 1)));
    }
  }
  const out = { text, usage, costUsd: costUsd(model, usage), latencyMs: Date.now() - t0, provider, model };
  if (json) out.json = parseJson(text);
  return out;
}

module.exports = { complete, config, loadEnv, costUsd };

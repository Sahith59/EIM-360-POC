// Failure triage for the AI test agent.
// 1. Rule-based analysis (always runs, deterministic): classifies the failure, gathers evidence
//    (expected vs actual, failing step, code references, live DOM) and proposes next steps.
//    For broken locators it searches the live page for the control the test meant and proposes a healed locator.
// 2. Known-issue match: if the same failure was already analysed (qa/known-issues.json), reuse that analysis.
// 3. Optional LLM pass: with ANTHROPIC_API_KEY set, Claude writes the root cause, fix and summary from the evidence.
const fs = require("fs");
const path = require("path");

const SRC_DIRS = ["server", "public/js"];

function listFiles(root) {
  const out = [];
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : /\.js$/.test(e.name) && out.push(p); });
  SRC_DIRS.forEach(d => fs.existsSync(path.join(root, d)) && walk(path.join(root, d)));
  return out;
}
function codeRefs(root, terms) {
  const hits = [];
  const files = listFiles(root);
  for (const t of terms.filter(t => t && t.length >= 4)) for (const f of files) {
    fs.readFileSync(f, "utf8").split("\n").forEach((line, k) => {
      if (line.includes(t) && hits.length < 6 && !hits.find(h => h.file === f && h.line === k + 1)) hits.push({ file: path.relative(root, f), line: k + 1, term: t, text: line.trim().slice(0, 140) });
    });
  }
  return hits;
}
const STOP = new Set(["the", "a", "an", "to", "from", "with", "of", "and", "or", "for", "in", "on"]);
const words = s => (String(s || "").toLowerCase().match(/[a-z0-9]+/g) || []).filter(w => !STOP.has(w));
// IDF-weighted token overlap: words that appear on many controls (e.g. "incidents") count less than rare ones (e.g. "servicenow")
function rankCandidates(wanted, elements) {
  const docs = elements.map(e => new Set(words(e.name + " " + (e.testid || "").replace(/[-_]/g, " "))));
  const df = t => docs.filter(d => d.has(t)).length;
  const idf = t => Math.log(1 + elements.length / (1 + df(t)));
  const W = [...new Set(words(wanted))];
  const total = W.reduce((s, t) => s + idf(t), 0) || 1;
  // acronyms of the wanted label (e.g. "Save Work In Progress" -> "wip") often survive in test ids
  const all = (String(wanted).toLowerCase().match(/[a-z0-9]+/g) || []), acr = new Set();
  for (let i = 0; i < all.length; i++) for (let j = i + 3; j <= all.length; j++) acr.add(all.slice(i, j).map(w => w[0]).join(""));
  return elements.map((e, k) => {
    const idTokens = (e.testid || "").toLowerCase().split(/[-_]/);
    const bonus = idTokens.some(t => acr.has(t)) ? 0.4 : 0;
    return { ...e, score: Math.min(1, W.filter(t => docs[k].has(t)).reduce((s, t) => s + idf(t), 0) / total + bonus) };
  }).sort((a, b) => b.score - a.score);
}
// code search: score each source line by the test's literals (weighted) and title words
function codeSearch(root, literals, titleWords) {
  const hits = [];
  for (const f of listFiles(root)) {
    if (/core\.js$|icons\.js$|data\.js$/.test(f)) continue;
    fs.readFileSync(f, "utf8").split("\n").forEach((line, k) => {
      if (/^\s*\/\//.test(line)) return;
      let score = 0; const matched = [];
      for (const [t, w] of literals) if (line.includes(t)) { score += w; matched.push(t); }
      for (const t of titleWords) if (line.toLowerCase().includes(t)) score += 0.5;
      if (matched.length) hits.push({ file: path.relative(root, f), line: k + 1, score, text: line.trim().slice(0, 150) });
    });
  }
  hits.sort((a, b) => b.score - a.score);
  const top = hits[0] ? hits[0].score : 0;
  return hits.filter(h => h.score >= 2 && h.score >= top * 0.75).slice(0, 3);
}

async function analyze({ entry, catalogCase, dom, build, root, runId }) {
  const e = entry.error;
  const msg = e.message;
  const failedStep = (entry.steps.find(s => s.status === "failed") || entry.steps[entry.steps.length - 1] || {}).title || "";
  const loc = e.location ? `${e.location.file}:${e.location.line}` : entry.file;
  const specFile = e.location && path.join(root, e.location.file);
  const specLine = specFile && fs.existsSync(specFile) ? fs.readFileSync(specFile, "utf8").split("\n")[e.location.line - 1].trim() : "";
  const evidence = [];
  const RULES = "Rules";
  const a = { classification: null, rootCause: "", component: "", evidence, codeRefs: [], nextSteps: [], suggestedFix: null, defect: null, sources: { rootCause: RULES, component: RULES, nextSteps: RULES }, engine: "" };

  const check = (msg.split("\n")[0].match(/^Error: (.+)/) || [])[1];
  const custom = check && !/^expect\(|^(Timeout|locator|page)\b/.test(check) ? check : null;
  const env = /net::ERR_|ECONNREFUSED|fetch failed|browserType\.launch|Executable doesn't exist|socket hang up|Target page, context or browser has been closed/.test(msg);
  const actionTimeout = /(locator|page)\.\w+: Timeout \d+ms exceeded/.test(msg);
  const notFound = /element\(s\) not found/.test(msg);
  const locM = msg.match(/waiting for (getBy\w+\((.+?)\)|locator\((.+?)\))\s*$/m);

  evidence.push(`Failed at step "${failedStep}" (${loc}).`);
  if (e.expected != null || e.actual != null) evidence.push(`Expected ${e.expected ?? "—"}, received ${e.actual ?? "—"}.`);
  const shot = entry.steps.find(s => s.status === "failed" && s.screenshot);
  if (shot) evidence.push(`Screenshot at the point of failure: ${shot.screenshot}.`);

  if (env) {
    a.classification = "Environment / test data";
    a.rootCause = "The browser, the application or one of its services was not available, so the step could not run. This is not evidence of a product defect.";
    a.component = "Test environment";
    a.nextSteps = ["Check that Chrome is installed and the EIM 360 test environment is up.", "Re-run the case once the environment is healthy.", "If it keeps failing, raise it with the environment team rather than development."];
  } else if ((actionTimeout || notFound) && locM) {
    const sig = locM[1];
    const nameStr = sig.match(/name: ['"](.+?)['"]/), nameRe = sig.match(/name: \/(.+?)\/[a-z]*/), roleM = sig.match(/getByRole\(['"](\w+)['"]/);
    const wanted = nameStr ? nameStr[1] : nameRe ? nameRe[1].replace(/[\^$\\]/g, "") : (sig.match(/\(['"](.+?)['"]/) || [])[1] || sig;
    const role = roleM ? roleM[1] : null;
    const pool = (dom && dom.elements || []).filter(x => !role || x.role === role);
    const exact = pool.find(x => nameRe ? new RegExp(nameRe[1]).test(x.name) : x.name.toLowerCase() === String(wanted).toLowerCase());
    const best = rankCandidates(wanted, pool)[0];
    evidence.push(`The test was waiting for ${role ? `a ${role} named` : ""} "${wanted}".`);
    if (exact) {
      a.classification = "Product defect";
      a.rootCause = `The ${role || "element"} "${exact.name}" is on the page but the step could not use it (for example it was hidden, disabled or covered).`;
      a.component = entry.area;
      evidence.push(`Found on the page: ${exact.role} "${exact.name}".`);
    } else if (best && best.score >= 0.35 && best.name.toLowerCase() !== String(wanted).toLowerCase()) {
      a.classification = "Test script maintenance";
      a.rootCause = `"${wanted}" is no longer on the page. The closest match is ${best.role} "${best.name}", which looks like the same control with a new label. The product changed; the test did not.`;
      a.component = `${entry.file.split(":")[0]} (test script)`;
      evidence.push(`Closest element on the page: ${best.role} "${best.name}"${best.testid ? ` (data-testid="${best.testid}")` : ""}, match score ${Math.round(best.score * 100)}% (shared words and test-id abbreviations).`);
      const after = best.testid ? specLine.replace(/page\.getByRole\([^)]*\}\)/, `page.getByTestId("${best.testid}")`) : specLine.replace(wanted, best.name);
      a.suggestedFix = { type: "test", file: loc, before: specLine, after, note: best.testid ? `Points the test at the control's stable data-testid ("${best.testid}"), so future label changes do not break it. A person applies the change; nothing is changed automatically.` : "Points the test at the new visible label. A person applies the change." };
      a.sources.fix = RULES;
      a.nextSteps = [`Confirm with the product owner that renaming "${wanted}" to "${best.name}" is intentional.`, `Apply the suggested locator update in ${loc}.`, "Update the manual test case wording to the new label.", `Re-run ${entry.caseId} to confirm it passes.`];
    } else {
      a.classification = "Product defect";
      a.rootCause = `"${wanted}" is missing from the page and nothing similar was found, so the control may have been removed or failed to render.`;
      a.component = entry.area;
    }
  } else {
    a.classification = "Product defect";
    a.rootCause = `${custom ? `The check "${custom}" failed` : `The assertion at step "${failedStep}" failed`}: expected ${e.expected ?? catalogCase.expected}, actual ${e.actual ?? "a different result"}.`;
    a.component = entry.area;
  }

  if (a.classification === "Product defect") {
    const lines = specFile && fs.existsSync(specFile) ? fs.readFileSync(specFile, "utf8").split("\n") : [];
    let start = e.location ? e.location.line - 1 : 0; while (start > 0 && !/\btest\(/.test(lines[start])) start--;
    const body = lines.slice(start, (e.location ? e.location.line : 0) + 3).join("\n");
    const lits = [...body.matchAll(/["'`]([^"'`$]{4,70})["'`]/g)].map(m => m[1]);
    const hot = (failedStep + " " + entry.title).toLowerCase();
    const JUNK = new Set(["true", "false", "null", "undefined", "Open", "SWAT", "button", "link", "aria-selected", "toast"]);
    const tw = entry.title.split(/\s+/), grams = [];
    for (let n = 2; n <= 3; n++) for (let k = 0; k + n <= tw.length; k++) grams.push(tw.slice(k, k + n).join(" "));
    const weighted = [...new Set(lits)].filter(t => t.length >= 5 && !JUNK.has(t)).map(t => [t, hot.includes(t.toLowerCase()) ? 3 : 2]).concat(grams.filter(g => /[A-Z]/.test(g)).map(g => [g, 3]));
    const refs = codeSearch(root, weighted, words(entry.title).filter(w => w.length >= 4));
    a.codeRefs = refs.map(r => ({ file: r.file.split(path.sep).join("/"), line: r.line, text: r.text }));
    if (refs[0]) { a.component = `${entry.area} · ${a.codeRefs[0].file}`; evidence.push(`Strings this test relies on appear in ${[...new Set(a.codeRefs.map(r => r.file))].join(", ")} (see code references).`); }
    a.nextSteps = [
      `Review the draft defect below and raise it against build ${build.version}.`,
      "Attach the step screenshots and the Playwright trace from this run.",
      refs[0] ? `Developer: start at ${a.codeRefs[0].file}:${a.codeRefs[0].line}.` : `Developer: review the ${entry.area} logic.`,
      `Keep ${entry.caseId} in the regression suite; it will confirm the fix.`,
    ];
    a.defect = {
      title: `${entry.area}: ${catalogCase.title || entry.title} (fails in ${build.version})`,
      severity: catalogCase.priority === "Low" ? "Low" : "Medium",
      steps: catalogCase.steps || [],
      expected: catalogCase.expected || e.expected || "",
      actual: e.actual != null ? `Expected ${e.expected}, got ${e.actual}${custom ? ` (${custom})` : ""}.` : msg.split("\n")[0].replace(/^Error: /, ""),
    };
  }

  // analyst note: written once for a failure that has been investigated, reused only when the same failure recurs
  const kiFile = path.join(root, "qa", "known-issues.json");
  if (fs.existsSync(kiFile)) {
    const ki = JSON.parse(fs.readFileSync(kiFile, "utf8")).find(k => (k.caseId === "*" || k.caseId === entry.caseId) && new RegExp(k.signature).test(msg));
    if (ki) {
      const tag = `${ki.id}`;
      a.knownIssue = { id: ki.id, author: ki.author };
      a.rootCause = ki.rootCause; a.sources.rootCause = tag;
      a.component = ki.component; a.sources.component = tag;
      if (ki.narrative) { a.narrative = ki.narrative; a.sources.narrative = tag; }
      if (ki.suggestedFix) { a.suggestedFix = ki.suggestedFix; a.sources.fix = tag; }
      if (ki.developerHint && a.nextSteps[2]) a.nextSteps[2] = ki.developerHint;
      if (a.defect) { if (ki.defectTitle) a.defect.title = ki.defectTitle; if (ki.defectActual) a.defect.actual = ki.defectActual; if (ki.severity) a.defect.severity = ki.severity; }
    }
  }

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const llm = await askClaude({ entry, catalogCase, a, specLine });
      if (llm) { Object.assign(a, llm); a.sources.rootCause = a.sources.nextSteps = a.sources.narrative = "LLM"; a.llm = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5"; }
    } catch (err) { a.llmError = err.message; }
  }
  a.engine = ["Rules" + (a.knownIssue ? ` + analyst note ${a.knownIssue.id} (${a.knownIssue.author})` : ""), a.llm ? `LLM: ${a.llm}` : a.llmError ? `LLM pass failed (${a.llmError})` : "LLM pass off (no ANTHROPIC_API_KEY set)"].join(" · ");
  return a;
}

async function askClaude({ entry, catalogCase, a, specLine }) {
  const prompt = `You are a senior QA engineer triaging an automated UI test failure.\nTest case: ${JSON.stringify(catalogCase)}\nFailing line: ${specLine}\nError: ${entry.error.message}\nRule-based classification: ${a.classification}\nEvidence: ${a.evidence.join(" | ")}\nReturn JSON only: {"rootCause": string, "narrative": string (2-3 sentences for a test lead), "nextSteps": string[] (3-5 items)}. Do not invent facts beyond the evidence.`;
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 30000);
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", signal: ctl.signal, headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5", max_tokens: 800, messages: [{ role: "user", content: prompt }] }) });
  clearTimeout(timer);
  if (!r.ok) throw new Error("HTTP " + r.status);
  const text = (await r.json()).content.map(c => c.text || "").join("");
  const j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  return { rootCause: j.rootCause || a.rootCause, narrative: j.narrative, nextSteps: Array.isArray(j.nextSteps) && j.nextSteps.length ? j.nextSteps : a.nextSteps };
}

module.exports = { analyze };

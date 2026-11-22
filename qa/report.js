// Defect report export (Word .docx and PDF) for a reviewed failure.
// The report uses the QA lead's decision: an edited root cause replaces the AI draft. It is only produced
// after the root cause has been approved or edited (human in the loop).
"use strict";
const fs = require("fs");
const path = require("path");

const RUNS = path.join(__dirname, "runs");

function model(run, t, rv) {
  const a = t.analysis, d = a.defect;
  const root = rv && rv.decision === "Edited" ? rv.rootCause : a.rootCause;
  const shot = (t.steps.find(s => s.status === "failed" && s.screenshot) || [...t.steps].reverse().find(s => s.screenshot) || {}).screenshot;
  return {
    id: `EIM-${t.caseId}-${run.id.replace(/^run-/, "").slice(0, 8)}`,
    title: d ? d.title : `${t.caseId}: ${a.classification}`,
    severity: d ? d.severity : "n/a", classification: a.classification,
    meta: [
      ["Defect ID", `EIM-${t.caseId}-${run.id.replace(/^run-/, "").slice(0, 8)}`], ["Severity", d ? d.severity : "n/a"], ["Classification", a.classification],
      ["Test case", `${t.caseId}${t.clientRef ? ` (client ${t.clientRef}, ${t.suite})` : ""}: ${t.title.replace(/^\S+\s/, "").replace(/\s@review$/, "")}`],
      ["Build", `${run.build.label} · ${run.browser}`], ["Run", `${run.id} · ${new Date(run.startedAt).toISOString().slice(0, 16).replace("T", " ")} UTC`],
      ["Root cause review", rv ? `${rv.decision} by ${rv.by} on ${new Date(rv.at).toISOString().slice(0, 16).replace("T", " ")} UTC${rv.comment ? ` · "${rv.comment}"` : ""}` : "Not reviewed"],
      ["Found by", `AI test agent (Playwright)${a.llm ? `; root cause drafted by ${a.llm.provider} ${a.llm.model}` : ""}`],
    ],
    steps: d ? d.steps : [], expected: d ? d.expected : "", actual: d ? d.actual : (t.error && t.error.message || "").split("\n")[0],
    root, aiDraft: rv && rv.decision === "Edited" ? a.rootCause : null, narrative: a.narrative || "", next: a.nextSteps || [],
    db: (a.dbQueries || []).map(q => ({ sql: q.sql, why: q.why, result: q.error ? `error: ${q.error}` : `${q.rowCount} row(s)${q.sample && q.sample.length ? `: ${JSON.stringify(q.sample).slice(0, 300)}` : ""}` })),
    dbFindings: a.dbFindings || "",
    evidence: a.evidence || [],
    shot: shot ? path.join(RUNS, run.id, shot) : null, shotCaption: shot ? `Screenshot at the failing step: ${(t.steps.find(s => s.screenshot === shot) || {}).title || ""}` : "",
    ai: a.llm ? `${a.llm.provider} ${a.llm.model} · ${a.llm.calls || 1} call(s) · ${a.llm.usage ? a.llm.usage.input + a.llm.usage.output : "?"} tokens${a.llm.costUsd != null ? ` · $${a.llm.costUsd.toFixed(4)}` : ""} · audit file ${a.llmAudit || "-"}` : "No LLM used",
  };
}

const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function html(m) {
  const img = m.shot && fs.existsSync(m.shot) ? `<figure><img src="data:image/png;base64,${fs.readFileSync(m.shot).toString("base64")}"><figcaption>${esc(m.shotCaption)}</figcaption></figure>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: Letter; margin: 0.6in; } body { font-family: "Times New Roman", Times, serif; color: #000; font-size: 11pt; }
  h1 { font-size: 17pt; margin: 0 0 4pt; } h2 { font-size: 12.5pt; margin: 14pt 0 4pt; border-bottom: 1px solid #999; padding-bottom: 2pt; }
  table { border-collapse: collapse; width: 100%; font-size: 10pt; } td { border: 1px solid #bbb; padding: 3pt 6pt; vertical-align: top; } td:first-child { width: 28%; font-weight: bold; background: #f2f2f2; }
  code, pre { font-family: Consolas, monospace; font-size: 9pt; } pre { white-space: pre-wrap; background: #f6f6f6; padding: 4pt; margin: 2pt 0; }
  img { max-width: 100%; border: 1px solid #bbb; } figcaption { font-size: 9pt; font-style: italic; } .muted { font-size: 9pt; color: #333; }
  </style></head><body>
  <h1>Defect report: ${esc(m.title)}</h1>
  <table>${m.meta.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table>
  ${m.narrative ? `<h2>Summary</h2><p>${esc(m.narrative)}</p>` : ""}
  ${m.steps.length ? `<h2>Steps to reproduce</h2><ol>${m.steps.map(s => `<li>${esc(s)}</li>`).join("")}</ol>` : ""}
  <h2>Expected and actual</h2><p><b>Expected:</b> ${esc(m.expected)}</p><p><b>Actual:</b> ${esc(m.actual)}</p>
  <h2>Root cause</h2><p>${esc(m.root)}</p>${m.aiDraft ? `<p class="muted"><b>AI draft before the QA lead's edit:</b> ${esc(m.aiDraft)}</p>` : ""}
  ${m.db.length || m.dbFindings ? `<h2>Database evidence (read-only queries by the AI)</h2>${m.db.map(q => `<pre>${esc(q.sql)}</pre><p class="muted">${esc(q.why)} → ${esc(q.result)}</p>`).join("")}${m.dbFindings ? `<p><b>Finding:</b> ${esc(m.dbFindings)}</p>` : ""}` : ""}
  ${m.next.length ? `<h2>Recommended actions</h2><ul>${m.next.map(s => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}
  <h2>Evidence</h2>${img}<ul>${m.evidence.map(s => `<li>${esc(s)}</li>`).join("")}</ul>
  <p class="muted">AI provenance: ${esc(m.ai)}</p></body></html>`;
}

async function pdf(m) {
  const { chromium } = require("@playwright/test");
  let browser;
  try { browser = await chromium.launch({ channel: process.env.PW_CHANNEL || "chrome" }); } catch { browser = await chromium.launch(); }
  try { const page = await browser.newPage(); await page.setContent(html(m), { waitUntil: "load" }); return await page.pdf({ format: "Letter", printBackground: true, margin: { top: "0.6in", bottom: "0.6in", left: "0.6in", right: "0.6in" } }); }
  finally { await browser.close(); }
}

async function docx(m) {
  const D = require("docx");
  const F = "Times New Roman";
  const T = (text, o = {}) => new D.TextRun({ text: String(text ?? ""), font: F, size: o.size || 22, bold: o.bold, italics: o.italics, color: "000000" });
  const P = (runs, o = {}) => new D.Paragraph({ children: Array.isArray(runs) ? runs : [T(runs, o)], spacing: { after: 80 }, ...o.p });
  const H = text => new D.Paragraph({ children: [T(text, { bold: true, size: 25 })], spacing: { before: 220, after: 80 }, border: { bottom: { style: D.BorderStyle.SINGLE, size: 4, color: "999999", space: 2 } } });
  const border = { style: D.BorderStyle.SINGLE, size: 4, color: "BBBBBB" }, borders = { top: border, bottom: border, left: border, right: border };
  const kids = [
    new D.Paragraph({ children: [T(`Defect report: ${m.title}`, { bold: true, size: 32 })], spacing: { after: 120 } }),
    new D.Table({ width: { size: 10080, type: D.WidthType.DXA }, columnWidths: [2800, 7280], rows: m.meta.map(([k, v]) => new D.TableRow({ children: [
      new D.TableCell({ borders, width: { size: 2800, type: D.WidthType.DXA }, shading: { fill: "F2F2F2", type: D.ShadingType.CLEAR }, margins: { top: 40, bottom: 40, left: 100, right: 100 }, children: [P(k, { bold: true, size: 20 })] }),
      new D.TableCell({ borders, width: { size: 7280, type: D.WidthType.DXA }, margins: { top: 40, bottom: 40, left: 100, right: 100 }, children: [P(v, { size: 20 })] }) ] })) }),
  ];
  if (m.narrative) kids.push(H("Summary"), P(m.narrative));
  if (m.steps.length) kids.push(H("Steps to reproduce"), ...m.steps.map((s, k) => P(`${k + 1}. ${s}`)));
  kids.push(H("Expected and actual"), P([T("Expected: ", { bold: true }), T(m.expected)]), P([T("Actual: ", { bold: true }), T(m.actual)]));
  kids.push(H("Root cause"), P(m.root)); if (m.aiDraft) kids.push(P([T("AI draft before the QA lead's edit: ", { bold: true, size: 19 }), T(m.aiDraft, { size: 19 })]));
  if (m.db.length || m.dbFindings) { kids.push(H("Database evidence (read-only queries by the AI)")); m.db.forEach(q => kids.push(P(q.sql, { size: 18, p: { shading: { fill: "F6F6F6", type: D.ShadingType.CLEAR } } }), P(`${q.why} → ${q.result}`, { size: 19, italics: true }))); if (m.dbFindings) kids.push(P([T("Finding: ", { bold: true }), T(m.dbFindings)])); }
  if (m.next.length) kids.push(H("Recommended actions"), ...m.next.map(s => P(`• ${s}`)));
  kids.push(H("Evidence"));
  if (m.shot && fs.existsSync(m.shot)) {
    const buf = fs.readFileSync(m.shot), w = buf.readUInt32BE(16), h = buf.readUInt32BE(20), W = 620;
    kids.push(new D.Paragraph({ children: [new D.ImageRun({ type: "png", data: buf, transformation: { width: W, height: Math.round(W * h / w) } })] }), P(m.shotCaption, { size: 18, italics: true }));
  }
  m.evidence.forEach(s => kids.push(P(`• ${s}`, { size: 20 })));
  kids.push(P(`AI provenance: ${m.ai}`, { size: 18, italics: true }));
  const doc = new D.Document({ styles: { default: { document: { run: { font: F, size: 22, color: "000000" } } } },
    sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } } }, children: kids }] });
  return D.Packer.toBuffer(doc);
}

module.exports = { model, html, pdf, docx };

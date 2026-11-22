// Database access for the AI triage agent.
// READ: the agent queries a snapshot of the app's SQLite database taken when the test failed. The snapshot is opened
//       read-only (SQLite readOnly + PRAGMA query_only), and only a single SELECT/WITH statement is accepted.
// WRITE: the only thing the agent can write is a draft note in its own sandbox table (data/ai-notes.sqlite,
//       ai_triage_notes). It is insert-only, never touches application data, and a person can delete or discard it.
"use strict";
process.removeAllListeners("warning"); process.on("warning", w => { if (w.name !== "ExperimentalWarning") console.warn(w); });
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

function openReadOnly(file) {
  if (!fs.existsSync(file)) return null;
  const db = new DatabaseSync(file, { readOnly: true });
  db.exec("PRAGMA query_only = ON");
  return db;
}

function schema(db) {
  const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  return tables.map(t => `${t.sql.replace(/\s+/g, " ")};  -- ${db.prepare(`SELECT count(*) n FROM "${t.name}"`).get().n} rows`).join("\n");
}

const MAX_ROWS = 25;
function query(db, sql) {
  const q = String(sql || "").trim().replace(/;\s*$/, "");
  if (!/^(select|with)\b/i.test(q)) return { error: "Only a single SELECT (or WITH ... SELECT) statement is allowed." };
  if (q.includes(";")) return { error: "Only one statement per query." };
  try {
    const rows = db.prepare(q).all();
    const cut = rows.slice(0, MAX_ROWS).map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "string" && v.length > 200 ? v.slice(0, 200) + "…" : v])));
    return { rowCount: rows.length, rows: cut, truncated: rows.length > MAX_ROWS };
  } catch (e) { return { error: String(e.message).slice(0, 200) }; }
}

function addNote(root, { runId, caseId, model, note }) {
  const file = path.join(root, "data", "ai-notes.sqlite");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("CREATE TABLE IF NOT EXISTS ai_triage_notes (id INTEGER PRIMARY KEY, run_id TEXT, case_id TEXT, model TEXT, note TEXT, status TEXT DEFAULT 'draft', created_at TEXT)");
  db.prepare("INSERT INTO ai_triage_notes (run_id, case_id, model, note, created_at) VALUES (?,?,?,?,?)").run(runId, caseId, model, String(note).slice(0, 2000), new Date().toISOString());
  db.close();
}

module.exports = { openReadOnly, schema, query, addNote };

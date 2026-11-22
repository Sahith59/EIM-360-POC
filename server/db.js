// SQLite backend for the EIM 360 mock (Node's built-in node:sqlite, no extra dependency).
// The app writes every change through to these tables in one transaction before it answers the request,
// so the database always holds the system of record: the UI's Data Explorer, the Playwright data checks
// and the AI's read-only queries all read from SQLite.
"use strict";
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS interfaces (
  code TEXT PRIMARY KEY, description TEXT, domain TEXT, frequency TEXT, iws_stream TEXT, workstation TEXT,
  sme_onshore TEXT, sme_offshore TEXT, manager TEXT, sla_hours INTEGER);
CREATE TABLE IF NOT EXISTS incidents (
  number TEXT PRIMARY KEY, interface_code TEXT REFERENCES interfaces(code), status TEXT, critical_flag TEXT,
  created_at TEXT, closed_at TEXT, short_description TEXT, job_name TEXT, worked_by TEXT,
  ai_predicted_category TEXT, ai_confidence REAL, failure_details TEXT, issue_category TEXT,
  review_status TEXT, resolution_source TEXT, resolution_details TEXT, kb_used INTEGER);
CREATE TABLE IF NOT EXISTS swat_kb (
  kb_id INTEGER PRIMARY KEY, kb_key TEXT, interface_code TEXT, issue_category TEXT, version INTEGER,
  active_flag INTEGER, eff_start TEXT, eff_end TEXT, usage_count INTEGER, steps TEXT, approved_by TEXT);
CREATE TABLE IF NOT EXISTS resolution_execution (
  id INTEGER PRIMARY KEY, incident TEXT REFERENCES incidents(number), step_no INTEGER, step_text TEXT,
  source TEXT, active INTEGER, eff_start TEXT, eff_end TEXT);
CREATE TABLE IF NOT EXISTS incident_task_event (
  id INTEGER PRIMARY KEY, incident TEXT REFERENCES incidents(number), failure_details TEXT, issue_category TEXT,
  resolution_steps INTEGER, resolution_source TEXT, review_status TEXT, approval_type TEXT, recorded_at TEXT);
CREATE INDEX IF NOT EXISTS ix_kb_key ON swat_kb(kb_key, active_flag);
CREATE INDEX IF NOT EXISTS ix_exec_incident ON resolution_execution(incident, active);
CREATE INDEX IF NOT EXISTS ix_event_incident ON incident_task_event(incident);`;

function open(file, { fresh = true } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fresh) for (const f of [file, file + "-journal", file + "-wal", file + "-shm"]) { try { fs.unlinkSync(f); } catch {} }
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = OFF; PRAGMA synchronous = NORMAL;");
  db.exec(SCHEMA);
  return db;
}

const b = v => (v ? 1 : 0);
// write the whole application state through to SQLite in one transaction (a few hundred rows, a few ms)
function sync(db, S) {
  db.exec("BEGIN");
  try {
    for (const t of ["interfaces", "incidents", "swat_kb", "resolution_execution", "incident_task_event"]) db.exec(`DELETE FROM ${t}`);
    const iI = db.prepare("INSERT INTO interfaces VALUES (?,?,?,?,?,?,?,?,?,?)");
    for (const f of S.interfaces) iI.run(f.code, f.description, f.domain, f.frequency, f.iwsStream, f.workstation, f.smeOnshore, f.smeOffshore, f.manager, f.slaHours);
    const iN = db.prepare("INSERT INTO incidents VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    for (const n of S.incidents) iN.run(n.number, n.interfaceCode, n.status, n.critical, n.createdAt, n.closedAt || null, n.shortDescription, n.jobName, n.workedBy || null,
      n.aiPrediction ? n.aiPrediction.category : null, n.aiPrediction ? n.aiPrediction.confidence : null, n.failureDetails || "", n.category || null,
      n.review ? n.review.status : null, n.resolution ? n.resolution.source : null, n.resolutionDetails || "", n.kbUsed || null);
    const iK = db.prepare("INSERT INTO swat_kb VALUES (?,?,?,?,?,?,?,?,?,?,?)");
    for (const k of S.kb) iK.run(k.id, k.kbKey, k.interfaceCode, k.category, k.version, b(k.active), k.effStart, k.effEnd || null, k.usage, k.steps.join(" | "), k.approvedBy || null);
    const iE = db.prepare("INSERT INTO resolution_execution (incident, step_no, step_text, source, active, eff_start, eff_end) VALUES (?,?,?,?,?,?,?)");
    for (const e of S.exec) iE.run(e.incident, e.step_no, e.step_text, e.source, b(e.active), e.eff_start, e.eff_end || null);
    const iV = db.prepare("INSERT INTO incident_task_event (incident, failure_details, issue_category, resolution_steps, resolution_source, review_status, approval_type, recorded_at) VALUES (?,?,?,?,?,?,?,?)");
    for (const v of S.events) iV.run(v.incident, v.failure_details ?? null, v.issue_category ?? null, v.resolution_steps ?? null, v.resolution_source ?? null, v.review_status ?? null, v.approval_type ?? null, v.recorded_at ?? null);
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
}

// read helpers used by the API (same column names the tests and the Data Explorer expect)
const read = {
  swat_kb: db => db.prepare("SELECT kb_id, kb_key, interface_code, issue_category, version, active_flag, eff_start, eff_end, usage_count, steps FROM swat_kb ORDER BY kb_id").all().map(r => ({ ...r, active_flag: !!r.active_flag })),
  resolution_execution: db => db.prepare("SELECT incident, step_no, step_text, source, active, eff_start, eff_end FROM resolution_execution ORDER BY id").all().map(r => ({ ...r, active: !!r.active })),
  incident_task_event: db => db.prepare("SELECT * FROM incident_task_event ORDER BY id").all().map(({ id, ...r }) => r),
};

module.exports = { open, sync, read, SCHEMA };

// Deterministic seed data for the EIM 360 mock. All names, codes and people are fictional.
"use strict";

function rng(seed) { // mulberry32
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const PEOPLE = {
  swat: ["Kavya Menon", "Rahul Verma", "Divya Pillai", "Arjun Nair", "Sneha Kulkarni", "Vikram Rao"],
  smeOnshore: ["Patel, Nikhil", "Morgan, Claire", "Reyes, Daniel", "Chen, Laura", "Brooks, Aaron", "Iyer, Meera"],
  smeOffshore: ["Krishnan, Anand", "Bose, Ritika", "Das, Sourav", "Joseph, Neha", "Reddy, Karthik"],
  managers: ["Harper, Jenna", "Walsh, Simon", "Ortiz, Maria"],
};

const DOMAINS = ["Claims", "Membership", "Provider", "Pharmacy", "Finance", "Data Warehouse", "Reconciliation"];
const IFACE_DESC = [
  ["CLM", "Claims", ["Claims Sourcing Daily Load", "Claims Adjudication Extract", "Claims Payment Feed", "Encounter Submission Batch", "Claims Pend Report Load"]],
  ["MBR", "Membership", ["Member Eligibility Sync", "Enrollment 834 Inbound", "Member Demographics Refresh", "COB Coordination Feed"]],
  ["PRV", "Provider", ["Provider Directory Load", "Provider Credentialing Feed", "Network Affiliation Refresh"]],
  ["RX", "Pharmacy", ["Pharmacy Claims Daily Load", "Formulary Update Feed", "PBM Accumulator Exchange"]],
  ["FIN", "Finance", ["GL Journal Posting", "Premium Billing Extract", "Capitation Payment Run"]],
  ["DW", "Data Warehouse", ["Server 2 Load Refresh", "Enterprise DW Nightly Build", "Quality Measures Mart Load", "Risk Adjustment Mart Load"]],
  ["REC", "Reconciliation", ["Vendor Data Reconciliation", "Eligibility Reconciliation", "Payment Reconciliation"]],
];

// Known error patterns (stands in for the cloud-hosted pattern file) -> category
const PATTERNS = [
  { re: /ORA-\d{5}|deadlock|lock wait timeout|snapshot too old/i, category: "Database Error" },
  { re: /connection (refused|timed out|reset)|SFTP|ECONNRESET|host unreachable/i, category: "Connectivity" },
  { re: /file not found|no such file|missing input file|0 byte file/i, category: "Missing Source File" },
  { re: /duplicate key|constraint violation|null value in column|invalid date format/i, category: "Data Quality" },
  { re: /out of memory|no space left|disk quota|tablespace full/i, category: "Resource Exhaustion" },
  { re: /authentication failed|password expired|401 Unauthorized|certificate expired/i, category: "Authentication" },
];

const LOGS = {
  "Database Error": ["ERROR ORA-00060: deadlock detected while waiting for resource", "ERROR ORA-01555: snapshot too old: rollback segment too small", "ERROR lock wait timeout exceeded; try restarting transaction"],
  "Connectivity": ["ERROR SFTP connection timed out after 30s (sftp-gw-02:22)", "ERROR connection refused by vendor endpoint 10.40.2.18:443", "ERROR ECONNRESET while streaming extract to landing zone"],
  "Missing Source File": ["ERROR missing input file /landing/inbound/{code}_{date}.dat", "ERROR 0 byte file received from upstream for {code}"],
  "Data Quality": ["ERROR duplicate key value violates unique constraint pk_{code}", "ERROR null value in column member_id violates not-null constraint", "ERROR invalid date format in column svc_from_dt (row 18234)"],
  "Resource Exhaustion": ["ERROR ORA-01653: tablespace full - unable to extend table STG_{code}", "ERROR java.lang.OutOfMemoryError: Java heap space"],
  "Authentication": ["ERROR authentication failed: password expired for svc_{code}", "ERROR certificate expired for partner gateway"],
  "Unknown": ["ERROR unexpected token '<' in response body", "ERROR job ended with RC=12 (no further detail in log)"],
};

const KB_STEPS = {
  "Database Error": ["Check active sessions and locks on the target schema", "Coordinate with DBA to clear the blocking session", "Restart the job from the last successful checkpoint in IWS"],
  "Connectivity": ["Confirm the endpoint is reachable from the job server (telnet / curl)", "Check with the vendor or network team for an outage", "Rerun the job once connectivity is restored"],
  "Missing Source File": ["Confirm file delivery status with the upstream team", "Place the received file in the landing folder", "Release the dependency and rerun the job stream in IWS"],
  "Data Quality": ["Identify the offending records from the reject file", "Correct or exclude the records with SME approval", "Rerun the load for the affected batch"],
  "Resource Exhaustion": ["Raise a request to extend the tablespace / increase memory", "Purge staging data older than the retention window", "Rerun the job after capacity is confirmed"],
  "Authentication": ["Reset the service account credential in the vault", "Update the credential in the IWS job definition", "Rerun the job and confirm a successful connection"],
};

function seed() {
  const r = rng(360);
  const pick = a => a[Math.floor(r() * a.length)];
  const now = Date.now(), H = 3600e3, D = 24 * H;

  // ---- interfaces ----
  const interfaces = [];
  let n = 10000;
  for (const [prefix, domain, descs] of IFACE_DESC) for (const d of descs) {
    n += 7 + Math.floor(r() * 400);
    interfaces.push({
      code: `SRC${prefix}${n}`, description: d, domain,
      frequency: pick(["Daily", "Daily", "Hourly", "Weekly", "Monthly"]),
      iwsStream: `${prefix}_${d.split(" ")[0].toUpperCase()}_JS`, workstation: pick(["IWSPRD01", "IWSPRD02", "IWSPRD03"]),
      smeOnshore: pick(PEOPLE.smeOnshore), smeOffshore: pick(PEOPLE.smeOffshore), manager: pick(PEOPLE.managers),
      slaHours: pick([2, 4, 6, 8, 24]),
    });
  }

  // ---- knowledge base (exact interface + category matches) ----
  const kb = [];
  let kbId = 1;
  for (const i of interfaces) {
    if (r() < 0.45) {
      const cat = pick(Object.keys(KB_STEPS));
      const at = new Date(now - (10 + Math.floor(r() * 120)) * D).toISOString();
      kb.push({ id: kbId++, kbKey: `${i.code}|${cat}`, interfaceCode: i.code, category: cat, version: 1, active: true, effStart: at, effEnd: null, usage: Math.floor(r() * 40), steps: KB_STEPS[cat].slice(), approvedBy: i.smeOnshore, approvedAt: at });
    }
  }

  // ---- incidents ----
  const incidents = [];
  const plan = [["Open", 223], ["In Progress", 7], ["Awaiting SME Response", 12], ["Can be Closed", 17], ["Closed", 380]];
  let num = 709400;
  for (const [status, count] of plan) for (let k = 0; k < count; k++) {
    const iface = pick(interfaces);
    const cats = Object.keys(LOGS);
    // bias categories to the interface's KB entry so some exact matches exist
    const kbHit = kb.find(e => e.interfaceCode === iface.code);
    const category = kbHit && r() < 0.55 ? kbHit.category : pick(cats);
    const ageH = status === "Closed" ? 48 + r() * 28 * 24 : status === "Open" ? r() * 14 * 24 : r() * 6 * 24;
    const created = new Date(now - ageH * H);
    const line = pick(LOGS[category]).replace(/\{code\}/g, iface.code).replace(/\{date\}/g, created.toISOString().slice(0, 10).replace(/-/g, ""));
    const crit = r() < 0.16 ? "P1" : r() < 0.45 ? "P2" : "P3";
    const hasPrediction = category !== "Unknown" && r() < 0.78;
    const inc = {
      number: "INCTSK0" + (num += 1 + Math.floor(r() * 140)),
      interfaceCode: iface.code, critical: crit, status,
      createdAt: created.toISOString(),
      shortDescription: `${iface.iwsStream} abended on ${iface.workstation}`,
      assignmentGroup: "EIM-SWAT-L2",
      jobName: iface.iwsStream.replace(/_JS$/, "_") + pick(["LOAD", "EXTRACT", "XFER", "BUILD"]),
      log: [`${created.toISOString().slice(11, 19)} INFO job started by IWS (${iface.workstation})`, `${created.toISOString().slice(11, 19)} INFO reading source for ${iface.code}`, `${created.toISOString().slice(11, 19)} ${line}`, `${created.toISOString().slice(11, 19)} INFO job stream held in IWS (abend)`],
      aiPrediction: hasPrediction ? { category, confidence: 0.71 + Math.round(r() * 26) / 100, summary: summaryFor(category, line) } : null,
      workedBy: status === "Open" && r() < 0.8 ? null : pick(PEOPLE.swat),
      failureDetails: status === "Open" ? "" : line.replace(/^ERROR\s+/, ""),
      resolution: null, approved: false,
      closedAt: status === "Closed" ? new Date(created.getTime() + (2 + r() * 40) * H).toISOString() : null,
      history: [{ at: created.toISOString(), by: "ServiceNow", action: "Incident imported (Open)" }],
    };
    if (status !== "Open") {
      const match = kb.find(e => e.interfaceCode === iface.code && e.category === category);
      const steps = match ? match.steps : (KB_STEPS[category] || ["Review job log with SME", "Rerun job after fix"]);
      const done = status === "In Progress" ? 1 : status === "Awaiting SME Response" ? 0 : steps.length;
      inc.resolution = { source: match ? "Knowledge Base" : KB_STEPS[category] ? "Similar past incident" : "Manual entry", steps: steps.map((t, x) => ({ text: t, done: x < done })) };
      inc.approved = ["Can be Closed", "Closed"].includes(status);
      inc.history.push({ at: new Date(created.getTime() + 0.5 * H).toISOString(), by: inc.workedBy, action: "Picked up by SWAT (In Progress)" });
    }
    incidents.push(inc);
  }
  // a few incidents that the ServiceNow sync will deliver on the next refresh
  const queue = [["Connectivity", 3], ["Missing Source File", 14], ["Database Error", 25]].map(([category, k], x) => {
    const iface = interfaces[k % interfaces.length];
    const t = new Date(now).toISOString().slice(11, 19);
    const line = LOGS[category][0].replace(/\{code\}/g, iface.code).replace(/\{date\}/g, new Date(now).toISOString().slice(0, 10).replace(/-/g, ""));
    return {
      number: "INCTSK0" + (num += 50 + x), interfaceCode: iface.code, critical: x === 0 ? "P1" : "P2", status: "Open", createdAt: new Date(now).toISOString(),
      shortDescription: `${iface.iwsStream} abended on ${iface.workstation}`, assignmentGroup: "EIM-SWAT-L2", jobName: iface.iwsStream.replace(/_JS$/, "_LOAD"),
      log: [`${t} INFO job started by IWS (${iface.workstation})`, `${t} INFO reading source for ${iface.code}`, `${t} ${line}`, `${t} INFO job stream held in IWS (abend)`],
      aiPrediction: { category, confidence: 0.88, summary: summaryFor(category, line) }, workedBy: null, failureDetails: "", resolution: null, approved: false, closedAt: null, history: [],
    };
  });
  incidents.forEach(inc => { inc.review = { status: ["Can be Closed", "Closed"].includes(inc.status) ? "Completed" : "Not started", failure: { decision: null, correction: "" }, category: { decision: null, value: "" }, steps: { decision: null } }; inc.category = inc.aiPrediction ? inc.aiPrediction.category : null; inc.resolutionDetails = ""; inc.kbUsed = null; });
  queue.forEach(inc => { inc.review = { status: "Not started", failure: { decision: null, correction: "" }, category: { decision: null, value: "" }, steps: { decision: null } }; inc.category = inc.aiPrediction.category; inc.resolutionDetails = ""; inc.kbUsed = null; });
  return { exec: [], events: [], interfaces, kb, incidents, queue, lastSync: new Date(now - 95 * 60e3).toISOString(), people: PEOPLE, kbSeq: kbId };
}

function summaryFor(cat, line) {
  const m = {
    "Database Error": "Database contention on the target schema caused the load to abort.",
    "Connectivity": "The job could not reach the remote endpoint; likely network or vendor-side outage.",
    "Missing Source File": "The expected upstream file was missing or empty when the job ran.",
    "Data Quality": "Source records violated a target constraint and the batch was rejected.",
    "Resource Exhaustion": "The job ran out of database or memory capacity.",
    "Authentication": "The service account could not authenticate with the target system.",
  };
  return m[cat] + " Evidence: " + line.replace(/^ERROR\s+/, "");
}

module.exports = { seed, PATTERNS, KB_STEPS, PEOPLE, CATEGORIES: Object.keys(KB_STEPS) };

import { icon } from "../icons.js";
import { api, state, store, esc, fmtUtc, fmtDur, ago, toast, download, pageHead, busy, STATUS_PILL, $, $$ } from "../core.js";

const kpi = (label, value, ic, href, testid, foot = "") => `<div class="card kpi ${href ? "link" : ""}" ${href ? `data-href="${href}"` : ""} data-testid="${testid}"><div class="label">${icon(ic, 15)}${label}</div><div class="value">${value}</div>${foot ? `<div class="foot">${foot}</div>` : ""}</div>`;
const wireKpis = () => $$("[data-href]").forEach(c => c.onclick = () => location.hash = c.dataset.href);
const csvOf = rows => rows.map(r => r.map(v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v).join(",")).join("\r\n");

// ------------------------------------------------------------------ home
export async function home(view) {
  const [s, list, runs] = await Promise.all([api("/api/summary"), api("/api/incidents"), api("/api/qa/runs")]);
  const p1 = list.rows.filter(r => r.critical === "P1").slice(0, 6);
  const run = runs[0];
  view.innerHTML = pageHead("Operational Summary", [["Home", ""]], `Incidents imported from ServiceNow · last sync ${ago(s.lastSync)}`) + `
  <div class="grid g3" style="margin-bottom:16px">
    ${kpi("Received today", s.receivedToday, "circle-dot", null, "kpi-today")}
    ${kpi("Open", s.open, "hourglass", "#/incidents?tab=Open", "kpi-open", `${s.unassigned} unassigned`)}
    ${kpi("In progress", s.inProgress, "server", "#/incidents?tab=In%20Progress", "kpi-inprogress")}
    ${kpi("Awaiting SME response", s.awaitingSme, "clock", "#/incidents?tab=Awaiting%20SME%20Response", "kpi-awaiting")}
    ${kpi("Can be closed", s.canBeClosed, "check", "#/incidents?tab=Can%20be%20Closed", "kpi-cbc")}
    ${kpi("Backlog (older than 3 days)", s.backlog, "history", null, "kpi-backlog")}
  </div>
  <div class="grid g-side">
    <div class="card"><div class="card-head"><h2>${icon("alert-triangle", 17)}Active P1 incidents</h2><a class="small" href="#/incidents?q=P1">View all</a></div>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>Incident</th><th>Interface</th><th>Status</th><th>Worked by</th><th>Age</th></tr></thead><tbody>
      ${p1.map(r => `<tr><td><a class="mono" href="#/incidents/view/${r.number}">${r.number}</a></td><td>${esc(r.interfaceDescription)}<div class="small muted mono">${r.interfaceCode}</div></td><td><span class="pill ${STATUS_PILL[r.status]}">${r.status}</span></td><td>${esc(r.workedBy || "Unassigned")}</td><td class="small muted">${ago(r.createdAt).replace(" ago", "")}</td></tr>`).join("")}
      </tbody></table></div></div>
    <div class="stack">
      <div class="card"><div class="card-head"><h2>${icon("gauge", 17)}Active by priority</h2></div><div class="card-body">
        ${[["P1", s.p1], ["P2", s.p2], ["P3", s.p3]].map(([k, v]) => `<div class="hbar" style="grid-template-columns:50px 1fr 40px"><span class="prio ${k}" style="justify-self:start">${k}</span><span class="track"><i style="width:${v / (s.p1 + s.p2 + s.p3) * 100}%"></i></span><span class="num" data-testid="kpi-${k.toLowerCase()}">${v}</span></div>`).join("")}
        <hr class="sep"><div class="row small"><span class="muted">${icon("bot", 14)} No AI prediction</span><span class="spacer"></span><b>${s.noPrediction}</b></div></div></div>
      <div class="card"><div class="card-head"><h2>${icon("flask-conical", 17)}AI test agent · latest run</h2><a class="small" href="#/qa/runs">Open</a></div><div class="card-body">
        ${run ? `<div class="row" style="justify-content:space-between"><span class="small muted">Build ${esc(run.build.version)} · ${ago(run.startedAt)}</span><span class="small">${fmtDur(run.durationMs)}</span></div>
        <div class="result-strip" style="margin:10px 0"><i style="width:${run.totals.passed / run.totals.total * 100}%;background:var(--ok)"></i><i style="width:${run.totals.failed / run.totals.total * 100}%;background:var(--bad)"></i><i style="width:${run.totals.review / run.totals.total * 100}%;background:var(--violet)"></i></div>
        <div class="row small"><span><b>${run.totals.passed}</b> passed</span><span><b>${run.totals.failed}</b> failed</span><span><b>${run.totals.review}</b> in review</span></div>` : `<span class="muted small">No test runs yet. Run <span class="mono">npm test</span>.</span>`}
      </div></div>
    </div>
  </div>`;
  wireKpis();
}

// ------------------------------------------------------------------ jobhub
export async function jobhub(view) {
  const jobs = await api("/api/jobs");
  const only = new URLSearchParams(location.hash.split("?")[1] || "").get("only");
  const rows = jobs.filter(j => only !== "abended" || j.status === "Abended");
  view.innerHTML = pageHead("JobHub", [["Home", "#/home"], ["JobHub", ""]], "IWS job streams feeding EIM 360 and their latest run.") + `
  <div class="card"><div class="toolbar"><span class="meta-chip"><b>${jobs.length}</b> job streams</span><span class="meta-chip"><b>${jobs.filter(j => j.status === "Abended").length}</b> abended</span><span class="spacer"></span>
    <div class="btn-group"><button class="btn sm ${only ? "" : "primary"}" data-only="">All</button><button class="btn sm ${only ? "primary" : ""}" data-only="abended">Abended only</button></div></div>
  <div class="table-wrap"><table class="tbl"><thead><tr><th>Job stream</th><th>Interface</th><th>Workstation</th><th>Frequency</th><th>Last run</th><th>Status</th><th>Incident</th></tr></thead><tbody>
  ${rows.map(j => `<tr><td class="mono">${j.stream}</td><td class="mono">${j.interfaceCode}</td><td>${j.workstation}</td><td>${j.frequency}</td><td class="small muted">${fmtUtc(j.lastRun)}</td>
    <td>${j.status === "Abended" ? `<span class="pill bad">${icon("x-circle", 12)}Abended</span>` : `<span class="pill ok">${icon("check-circle-2", 12)}Succeeded</span>`}</td>
    <td>${j.incident ? `<a class="mono" href="#/incidents/view/${j.incident}">${j.incident}</a>` : "—"}</td></tr>`).join("")}
  </tbody></table></div></div>`;
  $$("[data-only]").forEach(b => b.onclick = () => location.hash = "#/jobhub" + (b.dataset.only ? "?only=abended" : ""));
}

// ------------------------------------------------------------------ dashboard
export async function dashboard(view) {
  const days0 = Number(new URLSearchParams(location.hash.split("?")[1] || "").get("days"));
  const days = [7, 30, 90].includes(days0) ? days0 : 30;
  const d = await api("/api/dashboard?days=" + days);
  const max = Math.max(1, ...d.series.map(x => Math.max(x.created, x.closed)));
  const W = 900, H = 220, pad = 28, bw = (W - pad * 2) / d.series.length;
  const bars = d.series.map((x, k) => {
    const X = pad + k * bw, h1 = x.created / max * (H - 50), h2 = x.closed / max * (H - 50);
    return `<rect x="${X + bw * .12}" y="${H - 24 - h1}" width="${bw * .36}" height="${h1}" rx="2" fill="#1d5fa8"><title>${x.date}: ${x.created} created</title></rect>
      <rect x="${X + bw * .52}" y="${H - 24 - h2}" width="${bw * .36}" height="${h2}" rx="2" fill="#9cc3e8"><title>${x.date}: ${x.closed} closed</title></rect>
      ${k % Math.ceil(d.series.length / 10) === 0 ? `<text x="${X + bw / 2}" y="${H - 8}" font-size="11" fill="#7a8696" text-anchor="middle">${x.date.slice(5)}</text>` : ""}`;
  }).join("");
  const grid = [0, .5, 1].map(f => `<line x1="${pad}" x2="${W - pad}" y1="${H - 24 - f * (H - 50)}" y2="${H - 24 - f * (H - 50)}" stroke="#eef1f5"/><text x="${pad - 6}" y="${H - 20 - f * (H - 50)}" font-size="11" fill="#7a8696" text-anchor="end">${Math.round(max * f)}</text>`).join("");
  const cats = Object.entries(d.categories).sort((a, b) => b[1] - a[1]);
  const cmax = Math.max(...cats.map(c => c[1]));
  view.innerHTML = pageHead("Incident Dashboard", [["Home", "#/home"], ["Incidents", "#/incidents"], ["Dashboard", ""]], `<label class="row small" style="gap:8px;margin-top:6px">Period <select class="input" id="period" data-testid="period" style="width:150px;height:32px">${[7, 30, 90].map(n => `<option value="${n}" ${n === days ? "selected" : ""}>Last ${n} days</option>`).join("")}</select></label>`) + `
  <div class="grid g4" style="margin-bottom:16px">
    ${kpi("Incidents created", d.total, "circle-dot", null, "dash-total", `in the last ${d.days} days`)}
    ${kpi("Closed", d.closed, "check-circle-2", null, "dash-closed")}
    ${kpi("Mean time to resolve", d.mttrHours + " h", "timer", null, "dash-mttr", "created → closed")}
    ${kpi("P1 incidents", d.managers.reduce((a, m) => a + m.p1, 0), "alert-triangle", null, "dash-p1")}
  </div>
  <div class="card" style="margin-bottom:16px"><div class="card-head"><h2>Created vs closed per day</h2><div class="legend"><span><i style="background:#1d5fa8"></i>Created</span><span><i style="background:#9cc3e8"></i>Closed</span></div></div>
    <div class="card-body chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Incidents created and closed per day">${grid}${bars}</svg></div></div>
  <div class="grid g2">
    <div class="card"><div class="card-head"><h2>By manager</h2><button class="btn sm" id="report" data-testid="generate-report">${icon("download", 14)}Generate report</button></div>
      <div class="table-wrap"><table class="tbl" data-testid="manager-table"><thead><tr><th>Manager</th><th class="num">Total</th><th class="num">Active</th><th class="num">Closed</th><th class="num">P1</th></tr></thead><tbody>
      ${d.managers.map(m => `<tr><td>${esc(m.manager)}</td><td class="num">${m.total}</td><td class="num">${m.active}</td><td class="num">${m.closed}</td><td class="num">${m.p1}</td></tr>`).join("")}
      </tbody></table></div></div>
    <div class="card"><div class="card-head"><h2>${icon("bot", 17)}AI-predicted failure category</h2></div><div class="card-body">
      ${cats.map(([c, n]) => `<div class="hbar"><span>${esc(c)}</span><span class="track"><i style="width:${n / cmax * 100}%;${c === "No prediction" ? "background:#c3cad4" : ""}"></i></span><span class="num">${n}</span></div>`).join("")}</div></div>
  </div>
  <div class="card" style="margin-top:16px"><div class="card-head"><h2>Top failing interfaces</h2></div><div class="table-wrap"><table class="tbl"><thead><tr><th>Interface</th><th>Description</th><th class="num">Incidents</th></tr></thead><tbody>
    ${d.top.map(t => `<tr><td class="mono">${t.code}</td><td>${esc(t.description)}</td><td class="num">${t.incidents}</td></tr>`).join("")}</tbody></table></div></div>`;
  $("#period").onchange = e => location.hash = "#/dashboard?days=" + e.target.value;
  $("#report").onclick = () => { download(`eim360_manager_report_${d.days}d.csv`, csvOf([["Manager", "Total", "Active", "Closed", "P1"], ...d.managers.map(m => [m.manager, m.total, m.active, m.closed, m.p1])]), "text/csv"); toast("Report downloaded"); };
}

// ------------------------------------------------------------------ reporting
export async function reporting(view) {
  const list = await api("/api/incidents");
  const reports = [
    ["Open incidents by priority", "All open incidents sorted by critical flag.", () => list.rows.filter(r => r.status === "Open").sort((a, b) => a.critical.localeCompare(b.critical))],
    ["Aging backlog (older than 3 days)", "Active incidents created more than 72 hours ago.", () => list.rows.filter(r => Date.now() - new Date(r.createdAt) > 3 * 864e5)],
    ["Unassigned incidents", "Active incidents with no SWAT assignee.", () => list.rows.filter(r => !r.workedBy)],
    ["Awaiting SME response", "Incidents waiting on SME review and approval.", () => list.rows.filter(r => r.status === "Awaiting SME Response")],
  ];
  view.innerHTML = pageHead("Reporting", [["Home", "#/home"], ["Incidents", "#/incidents"], ["Reporting", ""]], "Standard operational reports. Downloads are CSV and open in Excel.") + `
  <div class="card"><div class="table-wrap"><table class="tbl"><thead><tr><th>Report</th><th>Description</th><th class="num">Rows</th><th></th></tr></thead><tbody>
  ${reports.map(([n, desc, fn], k) => `<tr><td><b>${n}</b></td><td class="muted">${desc}</td><td class="num">${fn().length}</td><td style="text-align:right"><button class="btn sm" data-r="${k}">${icon("download", 14)}Download</button></td></tr>`).join("")}
  </tbody></table></div></div>`;
  $$("[data-r]").forEach(b => b.onclick = () => {
    const [n, , fn] = reports[b.dataset.r];
    download(n.toLowerCase().replace(/[^a-z0-9]+/g, "_") + ".csv", csvOf([["Incident", "Status", "Critical", "Interface", "Description", "SME (Onshore)", "Worked by", "Created (UTC)"], ...fn().map(r => [r.number, r.status, r.critical, r.interfaceCode, r.interfaceDescription, r.smeOnshore, r.workedBy || "", r.createdAt])]), "text/csv");
    toast(`${n} downloaded`);
  });
}

// ------------------------------------------------------------------ interfaces
export async function interfaces(view) {
  const rows = await api("/api/interfaces");
  view.innerHTML = pageHead("Interfaces List", [["Home", "#/home"], ["Interface Management", "#/interfaces"], ["Interfaces", ""]], `${rows.length} interfaces monitored`) + `
  <div class="card"><div class="toolbar"><div class="search">${icon("search", 15)}<input class="input" id="q" placeholder="Search interfaces" aria-label="Search interfaces"></div></div>
  <div class="table-wrap"><table class="tbl"><thead><tr><th>Interface code</th><th>Description</th><th>Domain</th><th>Frequency</th><th>IWS job stream</th><th>SME (Onshore / Offshore)</th><th class="num">Active incidents</th><th class="num">KB entries</th><th></th></tr></thead><tbody id="tb"></tbody></table></div></div>`;
  const draw = q => $("#tb").innerHTML = rows.filter(r => !q || [r.code, r.description, r.domain, r.frequency, r.iwsStream, r.smeOnshore, r.smeOffshore].join(" ").toLowerCase().includes(q)).map(r => `<tr><td class="mono" style="white-space:nowrap">${r.code}</td><td style="min-width:200px">${esc(r.description)}</td><td>${r.domain}</td><td>${r.frequency}</td><td class="mono" style="white-space:nowrap">${r.iwsStream}</td><td>${esc(r.smeOnshore)}<div class="small muted">${esc(r.smeOffshore)}</div></td><td class="num">${r.activeIncidents ? `<a href="#/incidents?q=${r.code}">${r.activeIncidents}</a>` : 0}</td><td class="num">${r.kbEntries}</td><td>${state.meta.permissions.edit && ["SME", "Admin"].includes(store.role) ? `<a class="btn btn-icon sm" href="#/interfaces/edit/${r.code}" aria-label="Edit ${r.code}" data-testid="edit-iface-${r.code}">${icon("pencil", 14)}</a>` : ""}</td></tr>`).join("");
  draw(""); $("#q").oninput = e => { draw(e.target.value.trim().toLowerCase()); if (!$("#tb").children.length) $("#tb").innerHTML = `<tr><td colspan="8"><div class="empty">No interfaces match the search.</div></td></tr>`; };
}

// ------------------------------------------------------------------ knowledge base
export async function kb(view) {
  const rows = await api("/api/kb");
  view.innerHTML = pageHead("Interface Knowledge Base", [["Home", "#/home"], ["Interface Management", "#/interfaces"], ["Knowledge Base", ""]], "SME-approved resolution steps, matched on interface code and failure category.") + `
  <div class="card"><div class="toolbar"><div class="search">${icon("search", 15)}<input class="input" id="q" placeholder="Search knowledge base" aria-label="Search knowledge base"></div><span class="meta-chip" data-testid="kb-count"><b>${rows.length}</b> entries</span></div>
  <div class="table-wrap"><table class="tbl" data-testid="kb-table"><thead><tr><th>Interface</th><th>Category</th><th>Resolution steps</th><th>SME (Onshore / Offshore)</th><th class="num">Version</th><th class="num">Used</th><th>Approved</th></tr></thead><tbody id="tb"></tbody></table></div></div>`;
  const draw = q => $("#tb").innerHTML = rows.filter(r => !q || [r.interfaceCode, r.interfaceDescription, r.category, r.approvedBy, ...r.steps].join(" ").toLowerCase().includes(q)).map(r => `<tr><td><span class="mono">${r.interfaceCode}</span><div class="small muted">${esc(r.interfaceDescription)}</div></td><td><span class="pill violet">${esc(r.category)}</span></td><td><ol style="margin:0;padding-left:18px">${r.steps.map(s => `<li>${esc(s)}</li>`).join("")}</ol></td><td>${esc(r.smeOnshore)}<div class="small muted">${esc(r.smeOffshore)}</div></td><td class="num">v${r.version}</td><td class="num">${r.usage}</td><td class="small muted">${esc(r.approvedBy)}<div>${ago(r.approvedAt)}</div></td></tr>`).join("");
  draw(""); $("#q").oninput = e => { draw(e.target.value.trim().toLowerCase()); if (!$("#tb").children.length) $("#tb").innerHTML = `<tr><td colspan="5"><div class="empty">No knowledge base entries match the search.</div></td></tr>`; };
}

// ------------------------------------------------------------------ IFG governance
export async function ifg(view) {
  const rows = (await api("/api/governance")).filter(r => r.closed).sort((a, b) => a.rate - b.rate);
  view.innerHTML = pageHead("IFG Reports", [["Home", "#/home"], ["IFG Governance", "#/ifg"], ["Reports", ""]], "Interface resolution performance against target (target = 4 × the interface SLA, closed incidents only).") + `
  <div class="card"><div class="table-wrap"><table class="tbl"><thead><tr><th>Interface</th><th>Domain</th><th class="num">SLA (h)</th><th class="num">Closed</th><th class="num">Within target</th><th>Rate</th></tr></thead><tbody>
  ${rows.map(r => `<tr><td><span class="mono">${r.code}</span><div class="small muted">${esc(r.description)}</div></td><td>${r.domain}</td><td class="num">${r.slaHours}</td><td class="num">${r.closed}</td><td class="num">${r.withinTarget}</td><td><span class="tracker"><span class="bar" style="width:110px"><i style="width:${r.rate}%;background:${r.rate < 60 ? "var(--bad)" : r.rate < 85 ? "#d59a2a" : "var(--ok)"}"></i></span><b>${r.rate}%</b></span></td></tr>`).join("")}
  </tbody></table></div></div>`;
}

// ------------------------------------------------------------------ site management
export async function site(view) {
  const m = state.meta;
  view.innerHTML = pageHead("Site Management", [["Home", "#/home"], ["Administration", "#/site"], ["Site Management", ""]]) + `
  <div class="grid g2">
    <div class="card"><div class="card-head"><h2>${icon("user", 17)}Role diagnostics <span class="pill warn">Non-production only</span></h2></div><div class="card-body">
      <p class="muted small" style="margin-top:0">Switch the active role to verify role-based access. SWAT works incidents, SME approves resolutions, Manager is view-only, Admin has full access.</p>
      <div class="row"><label for="role" class="small"><b>View as role</b></label><select class="input" id="role" data-testid="role-select" style="width:180px">${m.roles.map(r => `<option ${r === store.role ? "selected" : ""}>${r}</option>`).join("")}</select>
      <button class="btn primary" id="apply" data-testid="role-apply">Apply</button></div></div></div>
    <div class="card"><div class="card-head"><h2>${icon("refresh-cw", 17)}ServiceNow integration</h2></div><div class="card-body">
      <dl class="kv" style="grid-template-columns:1fr 1fr;margin:0"><div><dt>Direction</dt><dd>Read from ServiceNow (no write-back)</dd></div><div><dt>Refresh interval</dt><dd>About every 90 minutes</dd></div><div><dt>Manual refresh</dt><dd>Incident Management · Update from ServiceNow</dd></div><div><dt>Closure</dt><dd>Closed manually in ServiceNow</dd></div></dl></div></div>
    <details class="card" style="grid-column:1/-1"><summary class="card-head" style="cursor:pointer"><h2>${icon("flask-conical", 17)}Demo configuration</h2><span class="small muted">POC only</span></summary><div class="card-body">
      <dl class="kv"><div><dt>Environment</dt><dd>${m.env}</dd></div><div><dt>Build under test</dt><dd>${esc(m.build.label)}</dd></div><div><dt>Seeded issues in this build</dt><dd>${m.build.defects.length}</dd></div></dl>
      <p class="small muted" style="margin-bottom:0">For the POC, the release-candidate build carries ${m.build.defects.length} intentionally seeded issues (three product defects and one changed button label) so the AI test agent can demonstrate detection, root-cause analysis and defect reporting. Start the app with <span class="mono">npm run start:fixed</span> to run the corrected build.</p></div></details>
  </div>`;
  $("#apply").onclick = () => { store.role = $("#role").value; toast("Role switched to " + store.role); setTimeout(() => location.reload(), 250); };
}

// ------------------------------------------------------------------ interface edit (SME assignment)
export async function interfaceEdit(view, code) {
  const f = (await api("/api/interfaces")).find(x => x.code === code);
  if (!f) throw new Error(`Interface ${code} was not found.`);
  const P = state.meta.people;
  const canEdit = ["SME", "Admin"].includes(store.role);
  view.innerHTML = pageHead(`Edit Interface - ${code}`, [["Home", "#/home"], ["Interface Management", "#/interfaces"], ["Edit", ""]], esc(f.description)) + `
  <div class="card" style="max-width:760px"><div class="card-head"><h2>${icon("user", 17)}SME assignment</h2></div><div class="card-body">
    <div class="grid g2"><div class="field"><label for="on">SME (Onshore)</label><select class="input" id="on" data-testid="sme-onshore" ${canEdit ? "" : "disabled"}>${P.smeOnshore.map(p => `<option ${p === f.smeOnshore ? "selected" : ""}>${esc(p)}</option>`).join("")}</select></div>
    <div class="field"><label for="off">SME (Offshore)</label><select class="input" id="off" data-testid="sme-offshore" ${canEdit ? "" : "disabled"}>${P.smeOffshore.map(p => `<option ${p === f.smeOffshore ? "selected" : ""}>${esc(p)}</option>`).join("")}</select></div></div>
    <p class="small muted">SME assignments are shown on every SWAT Knowledge Base entry for this interface.</p>
    <div class="row"><a class="btn" href="#/interfaces">Cancel</a><span class="spacer"></span>${canEdit ? `<button class="btn primary" id="save" data-testid="save-interface">Save Changes</button>` : ""}</div></div></div>`;
  if ($("#save")) $("#save").onclick = e => busy(e.currentTarget, async () => {
    try { await api("/api/interfaces/" + code, { method: "PUT", body: { smeOnshore: $("#on").value, smeOffshore: $("#off").value } }); toast("Interface saved"); location.hash = "#/interfaces"; } catch (er) { toast(er.message, "error"); }
  });
}

// ------------------------------------------------------------------ data explorer (backend tables, read-only)
export async function data(view) {
  const t = new URLSearchParams(location.hash.split("?")[1] || "").get("t") || "swat_kb";
  const TABLES = { swat_kb: "SWAT_KB (SCD2 history)", resolution_execution: "Resolution execution", incident_task_event: "Incident task event" };
  const rows = await api("/api/backend/" + (TABLES[t] ? t : "swat_kb"));
  const q = (new URLSearchParams(location.hash.split("?")[1] || "").get("q") || "").trim();
  const shown = rows.filter(r => !q || Object.values(r).join(" ").toLowerCase().includes(q.toLowerCase())).slice(0, 200);
  const cols = rows[0] ? Object.keys(rows[0]) : [];
  view.innerHTML = pageHead("Data Explorer", [["Home", "#/home"], ["Administration", "#/site"], ["Data Explorer", ""]], "Read-only view of the SQLite backend tables behind the incident review (non-production).") + `
  <div class="card"><div class="tabs">${Object.entries(TABLES).map(([k, l]) => `<button class="tab ${k === t ? "active" : ""}" data-t="${k}" data-testid="table-${k}">${l}<span class="count">${k === t ? rows.length : ""}</span></button>`).join("")}</div>
  <div class="toolbar"><div class="search">${icon("search", 15)}<input class="input" id="q" placeholder="Filter rows" value="${esc(q)}" aria-label="Filter rows" data-testid="data-filter"></div><span class="meta-chip" data-testid="data-count"><b>${shown.length}</b> rows${shown.length === 200 ? " (first 200)" : ""}</span></div>
  <div class="table-wrap"><table class="tbl" data-testid="data-table"><thead><tr>${cols.map(c => `<th>${c}</th>`).join("")}</tr></thead><tbody>${shown.map(r => `<tr>${cols.map(c => `<td class="${typeof r[c] === "number" ? "num" : ""} small">${esc(r[c] === null ? "NULL" : r[c])}</td>`).join("")}</tr>`).join("") || `<tr><td><div class="empty">No rows.</div></td></tr>`}</tbody></table></div></div>`;
  $$("[data-t]").forEach(b => b.onclick = () => location.hash = "#/data?t=" + b.dataset.t);
  let tm; $("#q").oninput = e => { clearTimeout(tm); tm = setTimeout(() => { location.hash = `#/data?t=${t}&q=${encodeURIComponent(e.target.value.trim())}`; }, 300); };
}

import { icon } from "../icons.js";
import { api, state, store, esc, fmtDate, fmtUtc, ago, toast, download, pageHead, busy, STATUS_PILL, $, $$ } from "../core.js";

const TABS = ["All", "Open", "In Progress", "Awaiting SME Response", "Can be Closed"];
const TAB_ICON = { "All": "list-todo", "Open": "hourglass", "In Progress": "server", "Awaiting SME Response": "clock", "Can be Closed": "check" };
const COLS = [
  ["number", "Incident Task Number"], ["progress", "Resolution Progress"], ["interfaceCode", "Interface Code"], ["interfaceDescription", "Interface Description"],
  ["critical", "Critical Flag"], ["smeOnshore", "SME (Onshore)"], ["workedBy", "Worked By"], ["status", "Status"], ["createdAt", "Created"],
];
const DEFAULT_COLS = ["number", "progress", "interfaceCode", "interfaceDescription", "critical", "smeOnshore", "workedBy", "status"];
const loadCols = () => { try { const v = JSON.parse(localStorage.getItem("eim.cols")); return Array.isArray(v) && v.length ? v : DEFAULT_COLS; } catch { return DEFAULT_COLS; } };

// ------------------------------------------------------------------ list
export async function list(view) {
  const qs = new URLSearchParams((location.hash.split("?")[1]) || "");
  const st = { tab: TABS.includes(qs.get("tab")) ? qs.get("tab") : "All", q: qs.get("q") || "", page: Math.max(1, parseInt(qs.get("page"), 10) || 1), size: [10, 25, 50, 100].includes(Number(qs.get("size"))) ? Number(qs.get("size")) : 10, sort: COLS.some(c => c[0] === qs.get("sort")) ? qs.get("sort") : "createdAt", dir: qs.get("dir") === "asc" ? "asc" : "desc" };
  const t0 = performance.now();
  const data = await api("/api/incidents" + (st.tab !== "All" ? "?status=" + encodeURIComponent(st.tab) : ""));
  const loadMs = performance.now() - t0;
  const perms = state.meta.permissions;
  const syncLabel = "Update Incidents from ServiceNow";
  let cols = [...new Set(["number", ...loadCols().filter(c => COLS.some(x => x[0] === c))])];

  const hashFor = n => { const p = new URLSearchParams(); for (const k of ["tab", "q", "page", "size", "sort", "dir"]) if (n[k] !== ({ tab: "All", q: "", page: 1, size: 10, sort: "createdAt", dir: "desc" })[k]) p.set(k, n[k]); return "#/incidents" + (p.toString() ? "?" + p : ""); };
  const go = patch => { location.hash = hashFor({ ...st, ...patch }); };
  const remember = () => history.replaceState(null, "", location.pathname + hashFor(st));

  const filtered = () => {
    const q = st.q.toLowerCase();
    let r = data.rows.filter(x => !q || [x.number, x.interfaceCode, x.interfaceDescription, x.smeOnshore, x.critical, x.workedBy, x.status].join(" ").toLowerCase().includes(q));
    r.sort((a, b) => { const av = st.sort === "progress" ? a.progress.done / a.progress.total : a[st.sort] ?? ""; const bv = st.sort === "progress" ? b.progress.done / b.progress.total : b[st.sort] ?? ""; return (av > bv ? 1 : av < bv ? -1 : 0) * (st.dir === "asc" ? 1 : -1); });
    return r;
  };
  const cell = (c, r) => {
    if (c === "number") return `<td><a href="#/incidents/view/${r.number}" class="mono">${r.number}</a></td>`;
    if (c === "progress") return `<td><span class="tracker" title="${r.progress.done} of ${r.progress.total} resolution steps done"><span class="bar"><i style="width:${r.progress.total ? r.progress.done / r.progress.total * 100 : 0}%"></i></span><span class="small muted">${r.progress.done}/${r.progress.total}</span></span></td>`;
    if (c === "interfaceCode") return `<td class="mono">${esc(r.interfaceCode)}</td>`;
    if (c === "critical") return `<td><span class="prio ${r.critical}">${r.critical}</span></td>`;
    if (c === "workedBy") return `<td>${r.workedBy ? esc(r.workedBy) : `<span class="muted">Unassigned</span>`}</td>`;
    if (c === "status") return `<td><span class="pill ${STATUS_PILL[r.status]}">${esc(r.status)}</span></td>`;
    if (c === "createdAt") return `<td class="small muted" title="${fmtUtc(r.createdAt)}">${ago(r.createdAt)}</td>`;
    return `<td>${esc(r[c])}</td>`;
  };

  view.innerHTML = pageHead("Incident List", [["Home", "#/home"], ["Incidents", "#/incidents"], ["List", ""]]) + `
  <div class="card" data-testid="incident-list">
    <div class="toolbar">
      <div class="search">${icon("search", 15)}<input class="input" id="q" placeholder="Search incidents, interfaces, SMEs" value="${esc(st.q)}" aria-label="Filter incidents" data-testid="filter-input"></div>
      <span class="meta-chip" data-testid="total-chip"><b>${data.total}</b> incidents</span>
      <span class="meta-chip hide-md">Loaded in <b>${Math.max(0.01, loadMs / 1000).toFixed(2)} s</b></span>
      <span class="meta-chip" data-testid="last-updated">Last updated: <b>${fmtUtc(data.lastSync)}</b></span>
      <span class="spacer"></span>
      ${perms.sync ? `<button class="btn primary" id="sync" data-testid="sync-incidents">${icon("refresh-cw", 15)}${syncLabel}</button>` : ""}
    </div>
    <div class="tabs" role="tablist">${TABS.map(t => `<button class="tab ${st.tab === t ? "active" : ""}" role="tab" aria-selected="${st.tab === t}" data-tab="${t}" data-testid="tab-${t.replace(/\s+/g, "-").toLowerCase()}">${icon(TAB_ICON[t], 15)}${t}<span class="count" data-testid="count-${t.replace(/\s+/g, "-").toLowerCase()}">${t === "All" ? data.total : data.tabs[t]}</span></button>`).join("")}</div>
    <div class="toolbar">
      <label class="small muted row" style="gap:6px">Show <select class="input" id="size" style="width:76px;height:30px">${[10, 25, 50, 100].map(n => `<option ${n === st.size ? "selected" : ""}>${n}</option>`).join("")}</select> entries</label>
      <span class="spacer"></span>
      <div class="row" style="gap:6px;position:relative">
        <button class="btn sm" id="cols-btn" aria-expanded="false">${icon("columns-3", 14)}Columns</button>
        <div class="card" id="cols-menu" style="display:none;position:absolute;top:32px;left:0;z-index:4;padding:8px 12px;width:220px">${COLS.map(([k, l]) => `<label class="row small" style="padding:3px 0"><input type="checkbox" value="${k}" ${cols.includes(k) ? "checked" : ""} ${k === "number" ? "disabled" : ""}> ${l}</label>`).join("")}</div>
        <button class="btn sm" id="x-excel">${icon("file-spreadsheet", 14)}Excel</button>
        <button class="btn sm" id="x-csv" data-testid="export-csv">${icon("file-text", 14)}CSV</button>
        <button class="btn sm" id="x-pdf">${icon("file-down", 14)}PDF</button>
        <button class="btn sm" id="x-copy">${icon("copy", 14)}Copy</button>
      </div>
    </div>
    <div class="table-wrap"><table class="tbl" data-testid="incident-table"><thead id="thead"></thead><tbody id="tbody"></tbody></table></div>
    <div class="pager"><span id="pager-info" data-testid="pager-info"></span><div class="btn-group" id="pager"></div></div>
  </div>`;

  const draw = () => {
    $("#thead").innerHTML = `<tr><th>Actions</th>${COLS.filter(c => cols.includes(c[0])).map(([k, l]) => `<th class="sortable" data-sort="${k}">${l}${st.sort === k ? icon(st.dir === "asc" ? "chevron-up" : "chevron-down", 13) : ""}</th>`).join("")}</tr>`;
    $$("[data-sort]").forEach(th => th.onclick = () => go({ sort: th.dataset.sort, dir: st.sort === th.dataset.sort && st.dir === "desc" ? "asc" : "desc", page: 1 }));
    const rows = filtered(); const pages = Math.max(1, Math.ceil(rows.length / st.size));
    if (st.page > pages) st.page = pages;
    const slice = rows.slice((st.page - 1) * st.size, st.page * st.size);
    $("#tbody").innerHTML = slice.length ? slice.map(r => `<tr data-testid="row-${r.number}"><td><div class="actions">
        <a class="btn btn-icon sm" href="#/incidents/view/${r.number}" title="View incident" aria-label="View ${r.number}">${icon("eye", 15)}</a>
        ${perms.showEditInList ? `<a class="btn btn-icon sm" href="#/incidents/edit/${r.number}" title="Edit incident" aria-label="Edit ${r.number}" data-testid="edit-${r.number}">${icon("pencil", 15)}</a>` : ""}
      </div></td>${COLS.filter(c => cols.includes(c[0])).map(c => cell(c[0], r)).join("")}</tr>`).join("")
      : `<tr><td colspan="12"><div class="empty">No incidents match the current filter.</div></td></tr>`;
    $("#pager-info").textContent = rows.length ? `Showing ${(st.page - 1) * st.size + 1} to ${Math.min(st.page * st.size, rows.length)} of ${rows.length} entries` : "Showing 0 entries";
    const btns = [["Previous", st.page - 1, st.page === 1]];
    const span = []; for (let p = Math.max(1, st.page - 2); p <= Math.min(pages, st.page + 2); p++) span.push(p);
    span.forEach(p => btns.push([String(p), p, false, p === st.page]));
    btns.push(["Next", st.page + 1, st.page === pages]);
    $("#pager").innerHTML = btns.map(([l, p, dis, cur]) => `<button class="btn sm ${cur ? "primary" : ""}" data-page="${p}" ${dis ? "disabled" : ""} ${cur ? 'aria-current="page"' : ""}>${l}</button>`).join("");
    $$("#pager [data-page]").forEach(b => b.onclick = () => { st.page = Number(b.dataset.page); draw(); remember(); });
    return rows;
  };
  draw();

  let qTimer; $("#q").oninput = e => { clearTimeout(qTimer); qTimer = setTimeout(() => { st.q = e.target.value.trim(); st.page = 1; draw(); remember(); }, 150); };
  $$("[data-tab]").forEach(b => b.onclick = () => go({ tab: b.dataset.tab, page: 1 }));
  $("#size").onchange = e => { st.size = Number(e.target.value); st.page = 1; draw(); remember(); };
  $("#cols-btn").onclick = () => { const m = $("#cols-menu"); const open = m.style.display === "none"; m.style.display = open ? "block" : "none"; $("#cols-btn").setAttribute("aria-expanded", open); };
  $$("#cols-menu input").forEach(cb => cb.onchange = () => { cols = ["number", ...$$("#cols-menu input:checked").map(x => x.value).filter(v => v !== "number")]; localStorage.setItem("eim.cols", JSON.stringify(cols)); draw(); });
  document.addEventListener("click", e => { const m = $("#cols-menu"); if (m && !e.target.closest("#cols-menu, #cols-btn")) { m.style.display = "none"; $("#cols-btn").setAttribute("aria-expanded", false); } });
  if ($("#sync")) $("#sync").onclick = e => busy(e.currentTarget, async () => {
    try { const r = await api("/api/sync", { method: "POST" }); toast(r.added ? `${r.added} new incident(s) imported from ServiceNow` : "Already up to date with ServiceNow"); list(view); }
    catch (er) { toast(er.message, "error"); }
  });
  const tableRows = () => filtered().map(r => [r.number, `${r.progress.done}/${r.progress.total}`, r.interfaceCode, r.interfaceDescription, r.critical, r.smeOnshore, r.workedBy || "", r.status, fmtUtc(r.createdAt)]);
  const header = ["Incident Task Number", "Resolution Progress", "Interface Code", "Interface Description", "Critical Flag", "SME (Onshore)", "Worked By", "Status", "Created"];
  $("#x-csv").onclick = () => {
    const q = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v;
    const rows = tableRows();
    download(`eim360_incidents${st.tab !== "All" ? "_" + st.tab.replace(/\s+/g, "_").toLowerCase() : ""}.csv`, [header, ...rows].map(r => r.map(q).join(",")).join("\r\n") + "\r\n", "text/csv");
    toast(`CSV export downloaded (${rows.length} rows)`);
  };
  $("#x-excel").onclick = () => {
    const x = s => esc(s);
    const xml = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Incidents"><Table>` +
      [header, ...tableRows()].map(r => `<Row>${r.map(v => `<Cell><Data ss:Type="String">${x(v)}</Data></Cell>`).join("")}</Row>`).join("") + `</Table></Worksheet></Workbook>`;
    download("eim360_incidents.xls", xml, "application/vnd.ms-excel"); toast("Excel export downloaded");
  };
  $("#x-pdf").onclick = () => window.print();
  $("#x-copy").onclick = async () => {
    const rows = tableRows();
    try { await navigator.clipboard.writeText([header, ...rows].map(r => r.join("\t")).join("\n")); toast(`Copied ${rows.length} rows to the clipboard`); }
    catch { toast("Clipboard is not available in this browser", "error"); }
  };
}

// ------------------------------------------------------------------ detail (edit / view) with AI review
export async function detail(view, mode, number) {
  const i = await api("/api/incidents/" + number);
  const f = i.interface;
  const pred = i.aiPrediction;
  const done = i.review.status === "Completed" || i.status === "Closed";
  const editable = mode === "edit" && i.permissions.edit && !done;
  const cats = state.meta.categories;
  const people = state.meta.people.swat;
  const wipLabel = state.meta.build.defects.includes("UI2") ? "Save Draft" : "Save Work In Progress";
  // page state
  const st = {
    failure: { decision: pred ? i.review.failure.decision : "Manual", correction: i.review.failure.correction || (pred ? "" : i.failureDetails || "") },
    category: { decision: pred ? i.review.category.decision : "Manual", value: i.review.category.value || (pred ? "" : i.category || "") },
    steps: { decision: i.review.steps.decision },
    rec: i.recommendation,
    items: i.resolution ? i.resolution.steps.map(x => x.text) : (i.recommendation ? i.recommendation.steps.slice() : []),
  };
  const acc = (id, ic, title, body, open = true) => `<section class="acc ${open ? "" : "closed"}" id="${id}"><button class="acc-head" aria-expanded="${open}">${icon(ic, 18)}${title}<span class="chev">${icon("chevron-down", 18)}</span></button><div class="acc-body">${body}</div></section>`;
  const kv = pairs => `<dl class="kv">${pairs.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>`;
  const dis = editable ? "" : "disabled";
  const radios = (key, testid) => pred && key !== "steps" || (key === "steps" && st.rec) ? `<div class="seg" role="radiogroup" aria-label="Review decision">
      <label class="seg-opt"><input type="radio" name="${key}-decision" value="Approved" ${st[key].decision === "Approved" ? "checked" : ""} ${dis} data-testid="${testid}-approve"> Approve</label>
      <label class="seg-opt"><input type="radio" name="${key}-decision" value="Rejected" ${st[key].decision === "Rejected" ? "checked" : ""} ${dis} data-testid="${testid}-reject"> Reject</label></div>` : "";
  const decisionPill = d => d === "Approved" ? `<span class="pill ok">Approved</span>` : d === "Rejected" ? `<span class="pill warn">Corrected</span>` : d === "Manual" ? `<span class="pill">Manual entry</span>` : `<span class="pill">Pending review</span>`;

  view.innerHTML = pageHead(`${mode === "edit" ? "Edit" : "View"} Incident - ${i.number}`, [["Home", "#/home"], ["Incidents", "#/incidents"], [mode === "edit" ? "Edit" : "View", ""]]) + `
  <div class="row" style="margin-bottom:14px">
    <a class="btn" href="#/incidents">${icon("arrow-left", 15)}Back to List</a><span class="spacer"></span>
    <span class="pill ${STATUS_PILL[i.status]}" data-testid="incident-status">${esc(i.status)}</span><span class="prio ${i.critical}">${i.critical}</span>
    ${mode === "edit" ? `<a class="btn primary" href="#/incidents/view/${i.number}">${icon("eye", 15)}View Incident</a>` : (i.permissions.edit && i.status !== "Closed" ? `<a class="btn primary" href="#/incidents/edit/${i.number}" data-testid="edit-incident">${icon("pencil", 15)}Edit Incident</a>` : "")}
  </div>
  ${acc("basic", "alert-triangle", `Incident Basic Information: ${i.number}`, kv([
    ["Incident Task Number", `<span class="mono">${i.number}</span>`], ["ServiceNow short description", esc(i.shortDescription)], ["Assignment group", i.assignmentGroup],
    ["Created", fmtUtc(i.createdAt)], ["Critical flag", `<span class="prio ${i.critical}">${i.critical}</span>`], ["Age", ago(i.createdAt).replace(" ago", "")]]), mode === "view")}
  ${acc("iface", "arrow-left-right", "Interface &amp; IWS Information", kv([
    ["Interface code", `<span class="mono">${f.code}</span>`], ["Interface description", esc(f.description)], ["Domain", f.domain],
    ["IWS job stream", `<span class="mono">${f.iwsStream}</span>`], ["Job name", `<span class="mono">${esc(i.jobName)}</span>`], ["Workstation", f.workstation],
    ["Frequency", f.frequency], ["SME (Onshore)", esc(f.smeOnshore)], ["SME (Offshore)", esc(f.smeOffshore)]]) +
    `<div style="margin-top:14px"><div class="small muted" style="margin-bottom:6px">Job log (last run)</div><div class="logbox" data-testid="job-log">${i.log.map(l => /ERROR/.test(l) ? `<span class="e">${esc(l)}</span>` : esc(l)).join("\n")}</div></div>`, mode === "edit")}
  ${acc("edit", "file-pen-line", `Incident Editable Details ${editable ? `<span class="muted small" style="font-weight:400">(fields marked <span style="color:var(--bad)">*</span> are required)</span>` : ""}`, `
    <div class="grid g2" style="margin-top:14px">
      <div class="field"><label for="workedBy">Worked By ${editable ? '<span class="req">*</span>' : ""}</label>
        <select class="input" id="workedBy" data-testid="worked-by" ${dis}><option value="">Select assignee</option>${people.map(p => `<option ${p === i.workedBy ? "selected" : ""}>${esc(p)}</option>`).join("")}</select>
        <span class="err" data-err="workedBy"></span></div>
      <div class="field"><label>Task Status</label><div class="kv-text">${esc(i.status)}</div></div>
    </div>
    <div class="row" style="margin:18px 0 10px"><strong style="font-size:14.5px">${icon("bot", 17)} AI Review</strong><span class="pill ${i.review.status === "Completed" ? "ok" : i.review.status === "In progress" ? "warn" : ""}" data-testid="review-status">${esc(i.review.status)}</span>
      ${done ? `<span class="small muted" data-testid="review-completed">Review completed · read-only</span>` : ""}</div>
    <div class="stack">
      <div class="ai-box" data-testid="review-failure"><div class="ai-head">1. Failure Details ${pred ? `<span class="small muted" style="font-weight:400">AI prediction</span>` : `<span class="small muted" style="font-weight:500" data-testid="ai-category">No prediction</span>`}<span class="spacer"></span><span id="failure-pill">${decisionPill(st.failure.decision)}</span></div>
        <div class="ai-body">${pred ? `<p style="margin:0 0 10px" data-testid="ai-failure-prediction">${esc(pred.summary)}</p>` : `<p class="mono muted" style="margin:0 0 10px">(No AI prediction available)</p>`}
          ${radios("failure", "failure")}
          <div class="field" id="failure-corr" style="margin-top:10px;${!pred || st.failure.decision === "Rejected" ? "" : "display:none"}"><label for="failureCorrection">${pred ? "Corrected failure details" : "Failure details"} ${editable ? '<span class="req">*</span>' : ""}</label>
            <textarea class="input" id="failureCorrection" data-testid="failure-correction" maxlength="500" placeholder="Enter failure details (10-500 characters)…" ${dis}>${esc(st.failure.correction)}</textarea>
            <div class="hint"><span></span><span id="fc-count">${st.failure.correction.length} / 500</span></div></div>
          <span class="err" data-err="failure"></span></div></div>
      <div class="ai-box" data-testid="review-category"><div class="ai-head">2. Issue Category ${pred ? `<span class="pill violet" data-testid="ai-category">${esc(pred.category)}</span><span class="small muted" style="font-weight:400">confidence ${Math.round(pred.confidence * 100)}%</span>` : ""}<span class="spacer"></span><span id="category-pill">${decisionPill(st.category.decision)}</span></div>
        <div class="ai-body">${radios("category", "category")}
          <div class="field" id="category-corr" style="margin-top:10px;${!pred || st.category.decision === "Rejected" ? "" : "display:none"}"><label for="categorySelect">${pred ? "Corrected issue category" : "Issue category"} ${editable ? '<span class="req">*</span>' : ""}</label>
            <select class="input" id="categorySelect" data-testid="category-select" ${dis} style="max-width:340px"><option value="">Select category</option>${cats.map(c => `<option ${c === st.category.value ? "selected" : ""}>${c}</option>`).join("")}</select></div>
          ${done ? `<p style="margin:8px 0 0" class="small">Final category: <b data-testid="final-category">${esc(i.category || "—")}</b></p>` : ""}
          <span class="err" data-err="category"></span></div></div>
      <div class="ai-box" data-testid="review-steps"><div class="ai-head">3. Resolution Steps <span class="small muted" style="font-weight:400" data-testid="steps-source" id="steps-source"></span><span class="spacer"></span><span id="steps-pill"></span></div>
        <div class="ai-body"><div id="steps-radios"></div><div id="steps-area"></div><span class="err" data-err="steps"></span></div></div>
      <div class="field"><label for="resolutionDetails">Resolution Details</label><textarea class="input" id="resolutionDetails" data-testid="resolution-details" maxlength="1000" placeholder="Comments for the resolution (optional)" ${dis}>${esc(i.resolutionDetails || "")}</textarea></div>
    </div>
    ${i.status === "Can be Closed" || i.status === "Closed" ? `<div class="callout" style="margin-top:14px" data-testid="sn-note">${icon("info", 15)} ServiceNow is not updated automatically. Close the task in ServiceNow after closing it here.</div>` : ""}
    ${editable ? `<hr class="sep"><div class="row" data-testid="review-actions"><button class="btn" id="a-wip" data-testid="save-wip">${wipLabel}</button>${i.status === "In Progress" ? `<button class="btn" id="a-sme" data-testid="send-sme">Send to SME</button>` : ""}<span class="spacer"></span>
        <button class="btn" id="a-one" data-testid="approve-one-time">Approve One Time</button><button class="btn" id="a-kb" data-testid="approve-add-kb">Approve &amp; Add to KB</button><button class="btn primary" id="a-res" data-testid="approve-resolve">Approve and Resolve</button></div>` : ""}
    ${mode === "edit" && i.permissions.edit && i.status === "Can be Closed" ? `<hr class="sep"><div class="row"><span class="small muted">The AI review is complete.</span><span class="spacer"></span><button class="btn primary" id="a-close" data-testid="close-incident">Close Incident</button></div>` : ""}
    ${mode === "edit" && !i.permissions.edit ? `<div class="callout" style="margin-top:14px" data-testid="read-only">${icon("info", 15)} Your role (${esc(store.role)}) has view-only access to incidents.</div>` : ""}
    ${mode === "edit" && i.permissions.edit && i.status === "Closed" ? `<div class="callout" style="margin-top:14px" data-testid="read-only">${icon("info", 15)} This incident is closed and can no longer be edited.</div>` : ""}
  `)}
  ${acc("activity", "history", "Activity", `<ul class="timeline" style="margin-top:14px" data-testid="history">${i.history.slice().reverse().map(h => `<li><b>${esc(h.action)}</b><div class="small muted">${esc(h.by || "System")} · ${fmtUtc(h.at)}</div></li>`).join("")}</ul>`, mode === "view")}`;

  $$(".acc-head").forEach(b => b.onclick = () => { b.parentElement.classList.toggle("closed"); b.setAttribute("aria-expanded", !b.parentElement.classList.contains("closed")); });

  // ----- resolution steps card
  const drawSteps = () => {
    const rec = st.rec;
    const useRec = rec && st.steps.decision !== "Rejected";
    $("#steps-source").textContent = rec ? `Knowledge Base v${rec.version} · used ${rec.usage} time${rec.usage === 1 ? "" : "s"}` : "No KB match";
    $("#steps-pill").innerHTML = rec ? decisionPill(st.steps.decision) : `<span class="pill">Manual entry</span>`;
    $("#steps-radios").innerHTML = rec ? `<div class="seg" role="radiogroup" aria-label="Review decision">
      <label class="seg-opt"><input type="radio" name="steps-decision" value="Approved" ${st.steps.decision === "Approved" ? "checked" : ""} ${dis} data-testid="steps-approve"> Approve</label>
      <label class="seg-opt"><input type="radio" name="steps-decision" value="Rejected" ${st.steps.decision === "Rejected" ? "checked" : ""} ${dis} data-testid="steps-reject"> Reject</label></div>` : `<div class="callout" style="margin-bottom:10px" data-testid="no-kb-match">No Knowledge Base recommendation exists for this interface and category. Add the resolution steps manually.</div>`;
    const list = useRec && !(i.resolution && i.resolution.source !== "Knowledge Base") ? rec.steps : st.items;
    if (useRec && (!i.resolution || i.resolution.source === "Knowledge Base")) {
      $("#steps-area").innerHTML = `<ol class="steps-ro" data-testid="kb-steps">${rec.steps.map(t => `<li>${esc(t)}</li>`).join("")}</ol>`;
    } else if (!editable) {
      $("#steps-area").innerHTML = st.items.length ? `<ol class="steps-ro" data-testid="saved-steps">${st.items.map(t => `<li>${esc(t)}</li>`).join("")}</ol>` : `<p class="muted small">No resolution steps.</p>`;
    } else {
      $("#steps-area").innerHTML = `<div data-testid="steps-editor">${st.items.map((t, k) => `<div class="row step-row" style="margin-bottom:8px;flex-wrap:nowrap"><span class="n" style="width:22px;height:22px;border-radius:50%;background:var(--line-2);display:grid;place-items:center;font-size:12px;font-weight:650;flex:none">${k + 1}</span>
          <input class="input" value="${esc(t)}" data-step-input="${k}" data-testid="step-input-${k + 1}" aria-label="Resolution step ${k + 1}" maxlength="300">
          <button class="btn btn-icon sm" data-step-del="${k}" data-testid="step-delete-${k + 1}" aria-label="Delete step ${k + 1}">${icon("x", 14)}</button></div>`).join("")}
        <button class="btn sm" id="add-step" data-testid="add-step">${icon("pencil", 13)}Add step</button></div>`;
      $$("[data-step-input]").forEach(inp => inp.oninput = () => { st.items[inp.dataset.stepInput] = inp.value; });
      $$("[data-step-del]").forEach(b => b.onclick = () => { st.items.splice(Number(b.dataset.stepDel), 1); drawSteps(); });
      $("#add-step").onclick = () => { st.items.push(""); drawSteps(); const last = $$("[data-step-input]").pop(); if (last) last.focus(); };
    }
    $$('input[name="steps-decision"]').forEach(r => r.onchange = () => {
      st.steps.decision = r.value;
      if (r.value === "Rejected" && st.rec && (!st.items.length || i.resolution == null)) st.items = st.rec.steps.slice();
      i.resolution = r.value === "Rejected" ? { source: "Manual entry", steps: [] } : null;
      drawSteps();
    });
  };
  drawSteps();

  // ----- failure / category decisions
  $$('input[name="failure-decision"]').forEach(r => r.onchange = () => { st.failure.decision = r.value; $("#failure-corr").style.display = r.value === "Rejected" ? "" : "none"; $("#failure-pill").innerHTML = decisionPill(r.value); });
  $$('input[name="category-decision"]').forEach(r => r.onchange = async () => {
    st.category.decision = r.value; $("#category-corr").style.display = r.value === "Rejected" ? "" : "none"; $("#category-pill").innerHTML = decisionPill(r.value);
    if (r.value === "Approved") await refreshRec(pred.category);
  });
  const fc = $("#failureCorrection"); if (fc) fc.oninput = () => { st.failure.correction = fc.value; $("#fc-count").textContent = `${fc.value.length} / 500`; };
  async function refreshRec(category) {
    st.rec = category ? await api(`/api/kb/recommend?interface=${encodeURIComponent(i.interfaceCode)}&category=${encodeURIComponent(category)}`) : null;
    if (!st.rec) { st.steps.decision = null; if (!i.resolution || i.resolution.source === "Knowledge Base") { st.items = []; i.resolution = { source: "Manual entry", steps: [] }; } }
    else if (st.steps.decision !== "Rejected") { i.resolution = null; st.items = st.rec.steps.slice(); }
    drawSteps();
  }
  const cs = $("#categorySelect"); if (cs) cs.onchange = async () => { st.category.value = cs.value; await refreshRec(cs.value); };

  // ----- actions
  const showErr = errs => {
    $$("[data-err]").forEach(e => e.textContent = errs[e.dataset.err] || "");
    $("#workedBy").classList.toggle("invalid", !!errs.workedBy);
    if (fc) fc.classList.toggle("invalid", !!errs.failure);
    if (cs) cs.classList.toggle("invalid", !!errs.category);
  };
  const payload = action => ({
    action, workedBy: $("#workedBy").value, resolutionDetails: $("#resolutionDetails").value,
    failure: { decision: pred ? st.failure.decision : "Manual", correction: fc ? fc.value : "" },
    category: { decision: pred ? st.category.decision : "Manual", value: cs ? cs.value : "" },
    steps: { decision: st.rec ? st.steps.decision : null, items: st.rec && st.steps.decision !== "Rejected" && (!i.resolution || i.resolution.source === "Knowledge Base") ? st.rec.steps : st.items },
  });
  const run = action => e => busy(e.currentTarget, async () => {
    try { const r = await api(`/api/incidents/${i.number}/review`, { method: "POST", body: payload(action) }); showErr({}); toast(r.message); detail(view, action === "wip" || action === "send-sme" ? "edit" : "view", number); }
    catch (er) { showErr(er.errors || {}); toast(er.message, "error"); }
  });
  if ($("#a-wip")) { $("#a-wip").onclick = run("wip"); $("#a-one").onclick = run("one-time"); $("#a-kb").onclick = run("add-kb"); $("#a-res").onclick = run("resolve"); }
  if ($("#a-sme")) $("#a-sme").onclick = run("send-sme");
  if ($("#a-close")) $("#a-close").onclick = e => busy(e.currentTarget, async () => { try { await api(`/api/incidents/${i.number}/close`, { method: "POST" }); toast("Incident closed"); detail(view, "view", number); } catch (er) { toast(er.message, "error"); } });
}

// ------------------------------------------------------------------ resolution hub
export async function hub(view) {
  const [awaiting, cbc, kb] = await Promise.all([api("/api/incidents?status=Awaiting%20SME%20Response"), api("/api/incidents?status=Can%20be%20Closed"), api("/api/kb")]);
  const canApprove = state.meta.permissions.approve;
  const details = await Promise.all(awaiting.rows.map(r => api("/api/incidents/" + r.number)));
  view.innerHTML = pageHead("Incident Resolution Hub", [["Home", "#/home"], ["Incidents", "#/incidents"], ["Resolution Hub", ""]], "SME review queue for proposed resolution steps.") + `
  <div class="grid g3" style="margin-bottom:16px">
    <div class="card kpi"><div class="label">${icon("clock", 15)}Awaiting SME response</div><div class="value" data-testid="hub-awaiting">${awaiting.rows.length}</div></div>
    <div class="card kpi"><div class="label">${icon("check", 15)}Ready to close</div><div class="value">${cbc.rows.length}</div></div>
    <div class="card kpi"><div class="label">${icon("book-open", 15)}Knowledge Base entries</div><div class="value" data-testid="hub-kb">${kb.length}</div></div>
  </div>
  ${canApprove ? "" : `<div class="callout" style="margin-bottom:16px">${icon("info", 15)} You are viewing as <b>${esc(store.role)}</b>. Only SME and Admin users can approve resolution steps.</div>`}
  <div class="stack">${details.map(d => `<div class="card" data-testid="hub-${d.number}"><div class="card-head"><h2><a class="mono" href="#/incidents/view/${d.number}">${d.number}</a><span class="prio ${d.critical}">${d.critical}</span><span class="muted" style="font-weight:400">${esc(d.interface.description)}</span></h2>
      <span class="small muted">Worked by ${esc(d.workedBy || "—")} · ${ago(d.createdAt)}</span></div>
      <div class="card-body grid g2">
        <div><div class="small muted">AI-predicted category</div><div style="margin:4px 0 10px">${d.aiPrediction ? `<span class="pill violet">${esc(d.aiPrediction.category)}</span>` : `<span class="muted">No prediction</span>`}</div>
          <div class="small muted">Failure details</div><div>${esc(d.failureDetails || "—")}</div></div>
        <div><div class="row small muted" style="margin-bottom:4px">Proposed steps <span class="pill ${d.suggestion.source === "Knowledge Base" ? "ok" : "info"}">${esc(d.suggestion.source === "None" ? "No suggestion" : d.suggestion.source)}</span></div>
          <ol style="margin:0;padding-left:18px">${d.suggestion.steps.map(s => `<li>${esc(s.text)}</li>`).join("") || "<li class='muted'>No steps proposed</li>"}</ol>
          ${canApprove && d.suggestion.steps.length && !d.approved ? `<div class="row" style="margin-top:10px"><button class="btn sm primary" data-approve-kb="${d.number}">Approve &amp; add to KB</button><button class="btn sm" data-approve="${d.number}">Approve</button><button class="btn sm" data-sendback="${d.number}">Send back</button></div>` : d.approved ? `<div style="margin-top:10px"><span class="pill ok">SME approved</span></div>` : ""}
        </div></div></div>`).join("") || `<div class="card"><div class="empty">No incidents are waiting for SME review.</div></div>`}</div>`;
  const act = kbFlag => e => { const b = e.currentTarget; const n = b.dataset.approve || b.dataset.approveKb; return busy(b, async () => {
    $$(`[data-approve="${n}"],[data-approve-kb="${n}"],[data-sendback="${n}"]`).forEach(x => x.disabled = true);
    try { const r = await api(`/api/incidents/${n}/approve`, { method: "POST", body: { addToKb: kbFlag } }); toast(kbFlag ? (r.kbAdded ? "Approved and added to the Knowledge Base" : "Approved (a Knowledge Base entry already exists)") : "Resolution approved"); hub(view); } catch (er) { toast(er.message, "error"); }
  }); };
  $$("[data-approve]").forEach(b => b.onclick = act(false)); $$("[data-approve-kb]").forEach(b => b.onclick = act(true));
  $$("[data-sendback]").forEach(b => b.onclick = e => busy(e.currentTarget, async () => {
    const d = details.find(x => x.number === b.dataset.sendback);
    try { await api("/api/incidents/" + d.number, { method: "PUT", body: { workedBy: d.workedBy, failureDetails: d.failureDetails, status: "In Progress", user: store.user } }); toast(`${d.number} sent back to In Progress`); hub(view); } catch (er) { toast(er.message, "error"); }
  }));
}

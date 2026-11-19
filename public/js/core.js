// Shared helpers: API, formatting, toasts, modal, state.
export const state = { meta: null };
const USERS = { SWAT: "Kavya Menon", SME: "Nikhil Patel", Manager: "Jenna Harper", Admin: "Platform Admin" };

export const store = {
  get role() { let r; try { r = localStorage.getItem("eim.role"); } catch {} return USERS[r] ? r : "SWAT"; },
  set role(v) { try { localStorage.setItem("eim.role", v); } catch {} },
  get user() { return USERS[this.role]; },
};

export async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", "X-Role": store.role, ...(opts.headers || {}) },
    body: opts.body && typeof opts.body !== "string" ? JSON.stringify(opts.body) : opts.body });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data.error || r.statusText); e.status = r.status; e.errors = data.errors || {}; throw e; }
  return data;
}

export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const fmtDate = iso => iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
export const fmtUtc = iso => iso ? new Date(iso).toISOString().replace("T", " ").slice(0, 19) + " UTC" : "—";
export const fmtDur = ms => { if (ms == null) return "—"; if (ms < 1000) return Math.round(ms) + " ms"; const s = ms / 1000; if (s < 60) return s.toFixed(1) + " s"; if (s < 3600) { const m = Math.floor(s / 60), r = Math.round(s % 60); return r ? `${m} min ${r} s` : `${m} min`; } return fmtMin(s); };
export const fmtMin = sec => { if (sec == null) return "—"; if (sec < 60) return `${Math.round(sec)} s`; if (sec < 3600) return `${Math.round(sec / 60)} min`; const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60); return m ? `${h} h ${m} min` : `${h} h`; };
export const ago = iso => { const m = Math.round((Date.now() - new Date(iso)) / 60000); if (m < 1) return "just now"; if (m < 60) return `${m} min ago`; const h = Math.round(m / 60); if (h < 48) return `${h} h ago`; return `${Math.round(h / 24)} days ago`; };
export const initials = n => n.replace(/,/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join("").toUpperCase();

export function toast(msg, type = "info") {
  const el = document.createElement("div");
  el.className = "toast" + (type === "error" ? " error" : "");
  el.setAttribute("data-testid", "toast");
  el.textContent = msg;
  document.getElementById("toasts").appendChild(el);
  setTimeout(() => el.remove(), 4000);
}
export function modal(title, html) {
  const root = document.getElementById("modal");
  root.innerHTML = `<div class="modal" role="dialog" aria-label="${esc(title)}"><div class="modal-head"><span>${esc(title)}</span><button class="btn sm" data-close>Close</button></div>${html}</div>`;
  const close = () => { root.innerHTML = ""; document.removeEventListener("keydown", onKey); };
  const onKey = e => { if (e.key === "Escape") close(); };
  root.onclick = e => { if (e.target === root || e.target.closest("[data-close]")) close(); };
  document.addEventListener("keydown", onKey);
}
export function download(name, content, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type })); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
}
// run a request with the button disabled, so double-clicks cannot send it twice
export async function busy(btn, fn) {
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  try { return await fn(); } finally { if (btn.isConnected) btn.disabled = false; }
}
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export function pageHead(title, crumbs, sub = "", right = "") {
  return `<div class="page-head"><div><h1>${esc(title)}</h1>${sub ? `<p>${sub}</p>` : ""}</div>
    <div class="row">${right}<nav class="crumbs" aria-label="Breadcrumb">${crumbs.map((c, i) => i < crumbs.length - 1 ? `<a href="${c[1]}">${esc(c[0])}</a><span>/</span>` : `<span>${esc(c[0])}</span>`).join("")}</nav></div></div>`;
}
export const STATUS_PILL = { "Open": "info", "In Progress": "warn", "Awaiting SME Response": "violet", "Can be Closed": "ok", "Closed": "" };

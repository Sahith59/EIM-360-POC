import { icon } from "./icons.js";
import { api, state, store, esc, initials, $, $$ } from "./core.js";
import * as inc from "./views/incidents.js";
import * as ops from "./views/operations.js";
import * as tr from "./views/trace.js";
import * as qa from "./views/qa.js";

const NAV = [
  ["General", [["Home", "#/home", "house"], ["JobHub", "#/jobhub", "briefcase"]]],
  ["Incidents", [["Incident Dashboard", "#/dashboard", "bar-chart-3"], ["Incident Management", "#/incidents", "wrench"], ["Incident Resolution Hub", "#/resolution-hub", "git-branch"], ["Reporting", "#/reporting", "folder-open"]]],
  ["Interface Management", [["Interfaces List", "#/interfaces", "network"], ["Interface Knowledge Base", "#/kb", "book-open"]]],
  ["IFG Governance", [["IFG Reports", "#/ifg", "line-chart"]]],
  ["Quality Engineering", [["AI Test Runs", "#/qa/runs", "flask-conical", "POC"], ["Test Case Catalog", "#/qa/cases", "list-checks"], ["Manual Timing", "#/qa/timing", "timer"], ["Manual vs AI", "#/qa/compare", "scale"]]],
  ["Administration", [["Site Management", "#/site", "settings"], ["Data Explorer", "#/data", "server"]]],
];

const ROUTES = [
  [/^#\/home$/, ops.home], [/^#\/jobhub(?:\?.*)?$/, ops.jobhub], [/^#\/dashboard(?:\?.*)?$/, ops.dashboard], [/^#\/reporting$/, ops.reporting],
  [/^#\/interfaces$/, ops.interfaces], [/^#\/interfaces\/edit\/(\w+)$/, ops.interfaceEdit], [/^#\/data(?:\?.*)?$/, ops.data], [/^#\/kb$/, ops.kb], [/^#\/ifg$/, ops.ifg], [/^#\/site$/, ops.site],
  [/^#\/incidents(?:\?.*)?$/, inc.list], [/^#\/incidents\/(edit|view)\/(INCTSK\d+)$/, inc.detail], [/^#\/resolution-hub$/, inc.hub],
  [/^#\/qa\/runs$/, qa.runs], [/^#\/qa\/runs\/([\w-]+)(?:\?.*)?$/, qa.run], [/^#\/qa\/runs\/([\w-]+)\/(\d+)$/, qa.test], [/^#\/qa\/runs\/([\w-]+)\/(\d+)\/trace$/, tr.trace],
  [/^#\/qa\/cases$/, qa.cases], [/^#\/qa\/timing$/, qa.timing], [/^#\/qa\/compare(\?.*)?$/, qa.compare],
];

function renderNav() {
  const closed = JSON.parse(localStorage.getItem("eim.navClosed") || "[]");
  $("#sidebar").innerHTML = `<div class="logo"><div class="logo-mark">EIM</div><div class="logo-text">EIM 360<small>Incident &amp; Interface Management</small></div></div>` +
    NAV.map(([g, items]) => `<div class="nav-group ${closed.includes(g) ? "closed" : ""}" data-group="${esc(g)}">
      <button class="nav-head" aria-expanded="${!closed.includes(g)}">${esc(g)}${icon("chevron-down", 14)}</button>
      <div class="nav-items">${items.map(([t, h, ic, tag]) => `<a href="${h}" data-nav="${h}">${icon(ic, 17)}<span>${esc(t)}</span>${tag ? `<span class="tag">${tag}</span>` : ""}</a>`).join("")}</div></div>`).join("");
  $$(".nav-head").forEach(b => b.onclick = () => {
    const g = b.parentElement; g.classList.toggle("closed");
    const list = $$(".nav-group.closed").map(x => x.dataset.group); localStorage.setItem("eim.navClosed", JSON.stringify(list));
    b.setAttribute("aria-expanded", !g.classList.contains("closed"));
  });
}
function renderTop() {
  $("#nav-toggle").innerHTML = icon("menu", 20);
  $("#nav-toggle").onclick = () => document.querySelector(".shell").classList.toggle("collapsed");
  $("#env").textContent = state.meta.env;
  $("#build").textContent = "Build " + state.meta.build.version;
  $("#user").innerHTML = `<div class="avatar">${initials(store.user)}</div><div class="user-meta">${esc(store.user)}<small>Role: ${esc(store.role)}</small></div>`;
}
async function route() {
  const h = location.hash || "#/home";
  $$("[data-nav]").forEach(a => {
    const n = a.dataset.nav;
    a.classList.toggle("active", h === n || h.startsWith(n + "/") || h.startsWith(n + "?") || (n === "#/incidents" && h.startsWith("#/incidents")));
  });
  const view = $("#view");
  for (const [re, fn] of ROUTES) {
    const m = h.match(re);
    if (m) {
      try { await fn(view, ...m.slice(1)); }
      catch (e) { view.innerHTML = `<div class="page-head"><div><h1>Something went wrong</h1></div></div><div class="card"><div class="empty" data-testid="page-error">${icon("circle-alert", 20)}<p>${esc(e.message)}</p></div></div>`; }
      document.title = (view.querySelector("h1")?.textContent || "EIM 360") + " · EIM 360";
      window.scrollTo(0, 0);
      return;
    }
  }
  location.hash = "#/home";
}
(async () => {
  state.meta = await api("/api/meta");
  renderNav(); renderTop();
  window.addEventListener("hashchange", route);
  window.addEventListener("storage", e => { if (e.key === "eim.role") location.reload(); }); // keep tabs on the same role
  route();
})();

/* TimeLens side-panel dashboard. Reads chrome.storage.local only. */
let liveBase = null;     // snapshot for the 1s live ticker

/* today's total minus yesterday's by the same time of day, or null without enough data */
function vsYesterday(v, total) {
  const yd = new Date(); yd.setDate(yd.getDate() - 1);
  const y = v[dayKey(yd)];
  if (!y) return null;
  /* full hours before now, plus the same fraction of the current hour today has had */
  const n = new Date(), h = n.getHours();
  const ySoFar = y.hours.slice(0, h).reduce((a, s) => a + s, 0) + y.hours[h] * n.getMinutes() / 60;
  return ySoFar >= 60 ? total - ySoFar : null;
}

async function render() {
  const store = await chrome.storage.local.get(["v1", "challenge", "trail", ...CAT_KEYS]);
  const v = store.v1 || {};
  const cats = catsFrom(store);
  const [live, tab] = await Promise.all([getLive(), activeTab()]);
  const day = v[dayKey()] = addLive(v[dayKey()] || blankDay(), live);
  const entries = Object.entries(day.domains).sort((a, b) => b[1].s - a[1].s);
  const total = daySeconds(day);
  const visits = entries.reduce((a, [, e]) => a + e.v, 0);
  const roll = rollup(entries, cats);

  $("todayTotal").textContent = fmt(total);
  const diff = vsYesterday(v, total);
  $("trend").textContent = diff === null
    ? (entries.length ? `${plural(entries.length, "site")} · ${plural(visits, "visit")}` : "Nothing tracked yet today.")
    : `${diff > 0 ? "↑" : "↓"} ${fmt(Math.abs(diff))} ${diff > 0 ? "more" : "less"} than yesterday at this time`;
  renderStack($("catStack"), $("catLegend"), roll, total, cats);

  const drift = driftState(store.trail, cats);
  const now = renderNow($("nowBox"), tab, live, day, cats);
  liveBase = { ...now, total, at: Date.now() };
  renderMascot($("mascot"), mascotMood({ onSite: !!(tab && domainOf(tab.url)), tracking: now.tracking, total,
    drift: drift.ongoing, streak: drift.streak, why: live && live.why }));
  renderDriftList($("driftSum"), $("driftList"), $("driftMore"), drift.drifts);
  renderPath($("pathStrip"), $("pathLabels"), store.trail, cats);

  $("sitesCount").textContent = entries.length ? `${entries.length} today` : "";
  patch($("siteRows"), entries.length
    ? entries.map(([dom, e]) => `<li class="row"><img src="${favicon(dom)}" alt=""><span class="row-main">${esc(dom)}</span>
        <span class="meta">${fmt(e.s)}</span>${catToggleHTML(`site:${dom}`, dom, catFor(dom, cats), cats)}</li>`).join("")
    : `<li class="meta">Nothing tracked yet today. Sites appear here as you browse.</li>`);

  patch($("catRows"), [...cats.list].sort((a, b) => roll[b].s - roll[a].s).map(cat =>
    `<li class="row${roll[cat].s ? "" : " is-empty"}"><i class="dot" style="background:${colorFor(cat, cats)}"></i>
      <button class="quiet row-main" data-rename="${esc(cat)}" title="Rename">${esc(cat)}</button>
      <span class="meta">${fmt(roll[cat].s)}</span></li>`).join(""));
  catState = { cats, challenge: store.challenge };
}

/* ---------- categories: rename / add ---------- */
let catState = null;
$("catRows").addEventListener("click", async e => {
  const b = e.target.closest("[data-rename]");
  if (!b || !catState) return;
  const cat = b.dataset.rename, { cats, challenge } = catState;
  const name = (prompt("Rename category:", cat) || "").trim();
  if (!name || name === cat) return;
  if (cats.list.includes(name)) { alert(`There's already a category called "${name}".`); return; }
  await chrome.storage.local.set(renameCategory(cats, {}, challenge, cat, name));
});
$("addCat").onclick = async () => {
  const name = (prompt("New category name:") || "").trim();
  if (!name) return;
  const cats = await getCats();
  if (cats.list.includes(name)) { alert(`There's already a category called "${name}".`); return; }
  cats.list.push(name);
  await chrome.storage.local.set({ catList: cats.list });
};
$("exportBtn").onclick = async () => {
  const d = await chrome.storage.local.get(null);
  const blob = new Blob([JSON.stringify(d, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `timelens-export-${dayKey()}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};
$("resetBtn").onclick = async () => {
  if (confirm("Delete all TimeLens data? Your time, drifts and categories will be erased. This can't be undone."))
    await chrome.storage.local.clear();
};
$("ver").textContent = `Stays on this PC · v${chrome.runtime.getManifest().version}`;

/* Re-render only when something changed: saved data (local), what's being tracked
   (session) or the active tab. Bursts collapse into one render; no polling timer. */
const requestRender = scheduler(render);
chrome.storage.onChanged.addListener(requestRender);
chrome.tabs.onActivated.addListener(requestRender);
chrome.tabs.onUpdated.addListener((id, info, tab) => { if (tab.active && info.url) requestRender(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden) requestRender(); });
startTicker(() => liveBase, $("todayTotal"));
requestRender();

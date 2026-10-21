/* TimeLens popup — what's being tracked right now + today at a glance.
   External file (MV3 blocks inline scripts). */
let liveBase = null;

async function renderPopup() {
  const store = await chrome.storage.local.get(["v1", "trail", ...CAT_KEYS]);
  const cats = catsFrom(store);
  const [live, tab] = await Promise.all([getLive(), activeTab()]);
  const day = addLive((store.v1 || {})[dayKey()] || blankDay(), live);
  const entries = Object.entries(day.domains).sort((a,b) => b[1].s - a[1].s);
  const total = daySeconds(day);
  const drift = driftState(store.trail, cats);

  const now = renderNow($("pNow"), tab, live, day, cats, { compact: true, drift: drift.ongoing });
  liveBase = { ...now, total, at: Date.now() };
  renderMascot($("pMascot"), mascotMood({
    onSite: !!(tab && domainOf(tab.url)), tracking: now.tracking, total, drift: drift.ongoing, streak: drift.streak }));
  $("pTotal").textContent = fmt(total);
  $("pSub").textContent = entries.length
    ? `${plural(entries.length, "site")} · ${plural(entries.reduce((a,[,e]) => a + e.v, 0), "visit")}`
    : "Tracking starts when you use a website.";
  renderStack($("pStack"), $("pLegend"), rollup(entries, cats), total, cats);

  const top = $("pTop");
  top.innerHTML = "";
  entries.slice(0, 3).forEach(([d, e]) => top.appendChild(el("div", "srow",
    `<img src="${favicon(d)}" alt=""><span class="dom">${esc(d)}</span><span class="meta">${fmt(e.s)}</span>`)));
}

/* sidePanel.open needs the click's user gesture, so the window id is fetched up front:
   awaiting anything before the call can drop the gesture. */
let winId = null;
chrome.windows.getCurrent().then(w => { winId = w.id; }).catch(() => {});
const openAsTab = () => chrome.tabs.create({ url: chrome.runtime.getURL("panel.html") });
$("openPanel").onclick = () => {
  if (winId === null) return openAsTab();
  chrome.sidePanel.open({ windowId: winId }).then(() => window.close(), openAsTab);
};
chrome.storage.onChanged.addListener(() => renderPopup());
startTicker(() => liveBase, $("pTotal"));
renderPopup();
setInterval(renderPopup, 5000);

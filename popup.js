/* TimeLens popup — today's number, what's tracked now, and Lens. External file (MV3 blocks inline scripts). */
let liveBase = null;

/* While this port is open the worker counts Chrome as in front: on Windows the popup takes
   keyboard focus, which would otherwise look like you switched to another app. */
chrome.runtime.connect({ name: "popup" });

/* old background worker still running after an update: say so, and reload in one click */
function showStale(live) { $("staleNote").hidden = !workerStale(live); }
$("reloadBtn").onclick = () => chrome.runtime.reload();

async function renderPopup() {
  const store = await chrome.storage.local.get(["v1", "trail", "pages", ...CAT_KEYS]);
  setFaviconPages(store.pages);
  const cats = catsFrom(store);
  const [live, tab] = await Promise.all([getLive(), activeTab()]);
  showStale(live);
  const day = addLive((store.v1 || {})[dayKey()] || blankDay(), live);
  const total = daySeconds(day);
  const drift = driftState(store.trail, cats);

  $("pTotal").textContent = fmt(total);
  renderStack($("pStack"), $("pLegend"), Object.entries(day.domains), total, cats);
  const now = renderNow($("pNow"), tab, live, day, cats);
  liveBase = { ...now, total, at: Date.now() };
  const said = await lensSays(mascotMood({ onSite: !!now.domain, tracking: now.tracking, total,
    drift: drift.ongoing, streak: drift.streak, why: live && live.why, bg: live && live.bg }));
  renderMascot($("pMascot"), said);
  renderRate($("pMascot"), said);
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
const requestRender = scheduler(renderPopup);
chrome.storage.onChanged.addListener(requestRender);
startTicker(() => liveBase, $("pTotal"));
requestRender();

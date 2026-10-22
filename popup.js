/* TimeLens popup — today's number, what's tracked now, and Lens. External file (MV3 blocks inline scripts). */
let liveBase = null;

async function renderPopup() {
  const store = await chrome.storage.local.get(["v1", "trail", ...CAT_KEYS]);
  const cats = catsFrom(store);
  const [live, tab] = await Promise.all([getLive(), activeTab()]);
  const day = addLive((store.v1 || {})[dayKey()] || blankDay(), live);
  const entries = Object.entries(day.domains);
  const total = daySeconds(day);
  const drift = driftState(store.trail, cats);

  $("pTotal").textContent = fmt(total);
  renderStack($("pStack"), $("pLegend"), rollup(entries, cats), total, cats);
  const now = renderNow($("pNow"), tab, live, day, cats);
  liveBase = { ...now, total, at: Date.now() };
  renderMascot($("pMascot"), mascotMood({
    onSite: !!(tab && domainOf(tab.url)), tracking: now.tracking, total, drift: drift.ongoing, streak: drift.streak }));
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

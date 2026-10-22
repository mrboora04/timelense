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

/* old background worker still running after an update: say so, and reload in one click */
function showStale(live) { $("staleNote").hidden = !workerStale(live); }
$("reloadBtn").onclick = () => chrome.runtime.reload();

async function render() {
  const store = await chrome.storage.local.get(["v1", "challenge", "trail", ...CAT_KEYS]);
  const v = store.v1 || {};
  const cats = catsFrom(store);
  const [live, tab] = await Promise.all([getLive(), activeTab()]);
  showStale(live);
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
  renderMascot($("mascot"), mascotMood({ onSite: !!now.domain, tracking: now.tracking, total,
    drift: drift.ongoing, streak: drift.streak, why: live && live.why }));
  renderDriftList($("driftSum"), $("driftList"), $("driftMore"), drift.drifts);
  renderPath($("pathStrip"), $("pathLabels"), store.trail, cats);

  $("sitesCount").textContent = entries.length ? `${entries.length} today` : "";
  patch($("siteRows"), entries.length
    ? entries.map(([dom, e]) => `<li class="row"><img src="${favicon(dom)}" alt=""><span class="row-main">${esc(dom)}</span>
        <span class="meta">${fmt(e.s)}</span>${catToggleHTML(`site:${dom}`, dom, catFor(dom, cats), cats)}</li>`).join("")
    : `<li class="meta">Nothing tracked yet today. Sites appear here as you browse.</li>`);

  catState = { cats, roll, challenge: store.challenge };
  if (!editing) showCatRows();   // leave the list alone while you're typing in it
}

/* ---------- categories: rename / add, edited in place ---------- */
const NEW_CAT = "\u0000new";
let catState = null;             // { cats, roll, challenge } from the last render
let editing = null;              // category being renamed, or NEW_CAT while adding one
let draft = "", editError = "", committing = false;

function editRowHTML(cat) {
  const label = cat === NEW_CAT ? "New category name" : `Rename ${cat}`;
  return `<li class="row is-editing">
    <input class="inline-edit row-main" data-edit value="${esc(draft)}" maxlength="30" aria-label="${esc(label)}"
      ${editError ? `aria-invalid="true" aria-describedby="catErr"` : ""}>
    <span class="meta">Enter to save · Esc to cancel</span>
    ${editError ? `<p id="catErr" class="field-error" role="alert">${esc(editError)}</p>` : ""}</li>`;
}
function showCatRows(focus = false) {
  if (!catState) return;
  const { cats, roll } = catState;
  const rows = [...cats.list].sort((a, b) => (roll[b] || {}).s - (roll[a] || {}).s).map(cat => cat === editing ? editRowHTML(cat) :
    `<li class="row${(roll[cat] || {}).s ? "" : " is-empty"}"><i class="dot" style="background:${colorFor(cat, cats)}"></i>
      <button class="quiet row-main" data-rename="${esc(cat)}" aria-label="Rename ${esc(cat)}">${esc(cat)}</button>
      <span class="meta">${fmt((roll[cat] || {}).s || 0)}</span></li>`);
  if (editing === NEW_CAT) rows.push(editRowHTML(NEW_CAT));
  const had = document.activeElement && document.activeElement.dataset.rename;   // keep keyboard focus across redraws
  patch($("catRows"), rows.join(""));
  if (had && !focus) {
    const b = $("catRows").querySelector(`[data-rename="${CSS.escape(had)}"]`);
    if (b && document.activeElement !== b) b.focus({ preventScroll: true });
  }
  $("addCat").hidden = editing === NEW_CAT;
  if (focus) {
    const input = $("catRows").querySelector("[data-edit]");
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
}
function startEdit(cat) {
  editing = cat; draft = cat === NEW_CAT ? "" : cat; editError = "";
  showCatRows(true);
}
/* focus returns to the category's button (under its new name after a save) */
function stopEdit(savedAs = null) {
  const was = editing;
  editing = null; editError = "";
  showCatRows();
  const name = savedAs || (was === NEW_CAT ? null : was);
  const back = name ? $("catRows").querySelector(`[data-rename="${CSS.escape(name)}"]`) : $("addCat");
  if (back) back.focus();
}
async function commitEdit(value) {
  if (committing || !editing) return;
  const name = value.trim(), was = editing, { cats, challenge } = catState;
  if (!name || name === was) return stopEdit();
  if (cats.list.includes(name)) {
    draft = name;
    editError = `There's already a category called "${name}". Try another name.`;
    committing = true; showCatRows(true); committing = false;
    return;
  }
  committing = true;
  await chrome.storage.local.set(was === NEW_CAT ? { catList: [...cats.list, name] }
                                                 : renameCategory(cats, {}, challenge, was, name));
  committing = false;
  catState.cats = await getCats();   // so the list redraws with the new name right away
  stopEdit(name);
}
$("catRows").addEventListener("click", e => {
  const b = e.target.closest("[data-rename]");
  if (b) startEdit(b.dataset.rename);
});
$("catRows").addEventListener("keydown", e => {
  if (!e.target.matches("[data-edit]")) return;
  if (e.key === "Enter") { e.preventDefault(); commitEdit(e.target.value); }
  if (e.key === "Escape") { e.preventDefault(); stopEdit(); }
});
$("catRows").addEventListener("focusout", e => {   // clicking away saves, like most inline editors
  if (e.target.matches("[data-edit]") && !committing) commitEdit(e.target.value);
});
$("addCat").onclick = () => startEdit(NEW_CAT);
$("exportBtn").onclick = async () => {
  const d = await chrome.storage.local.get(null);
  const blob = new Blob([JSON.stringify(d, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `timelens-export-${dayKey()}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};
/* delete-all asks in place; "Keep my data" gets focus, so Enter is the safe choice */
function askReset(open) {
  $("footActions").hidden = open;
  $("resetConfirm").hidden = !open;
  (open ? $("resetNo") : $("resetBtn")).focus();
}
$("resetBtn").onclick = () => askReset(true);
$("resetNo").onclick = () => askReset(false);
$("resetConfirm").addEventListener("keydown", e => { if (e.key === "Escape") askReset(false); });
$("resetYes").onclick = async () => {
  await chrome.storage.local.clear();
  askReset(false);
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

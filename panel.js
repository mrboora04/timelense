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
  const store = await chrome.storage.local.get(["v1", "challenge", "trail", ...CAT_KEYS, ...BLOCK_KEYS]);
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
  renderStack($("catStack"), $("catLegend"), entries, total, cats);

  const drift = driftState(store.trail, cats);
  const now = renderNow($("nowBox"), tab, live, day, cats);
  liveBase = { ...now, total, at: Date.now() };
  renderMascot($("mascot"), mascotMood({ onSite: !!now.domain, tracking: now.tracking, total,
    drift: drift.ongoing, streak: drift.streak, why: live && live.why, bg: live && live.bg }));
  renderDriftList($("driftSum"), $("driftList"), $("driftMore"), drift.drifts);
  renderPath($("pathStrip"), $("pathLabels"), store.trail, cats);
  renderUsage(v);

  $("sitesCount").textContent = entries.length ? `${entries.length} today` : "";
  const limits = store.limits || {};
  /* sites with a timer stay listed on days you haven't opened them, so the timer can be changed */
  const timed = Object.keys(limits).filter(site => !day.domains[site]).map(site => [site, { s: 0, v: 0 }]);
  siteState = { entries: [...entries, ...timed], block: { limits, focus: store.focus || null, cats, day } };
  if (!typingTimer()) showSiteRows();   // leave the rows alone while you're typing a timer
  showFocus(store.focus || null, cats);

  catState = { cats, roll, challenge: store.challenge, focus: store.focus || null };
  if (!editing) showCatRows();   // leave the list alone while you're typing in it
}

/* ---------- site timers: a daily limit per site, set in the site's row ---------- */
let siteState = null;            // { entries, block: blockReason's state } from the last render
let timerError = null;           // { site, msg, draft } after an invalid custom timer
const typingTimer = () => !!(document.activeElement && document.activeElement.matches("[data-limit-input]"));

/* the row's timer button and the choices it opens; a timer on youtube.com also covers m.youtube.com */
function timerToggleHTML(dom, { limits, day }) {
  const site = timerFor(dom, limits) || dom, limit = limits[site] || 0;
  const left = limit - siteUsed(day, site), key = `timer:${dom}`, open = openPickers.has(key);
  const label = !limit ? "Timer" : left > 0 ? `${fmt(left)} left` : "Time's up";
  const err = timerError && timerError.site === site ? timerError : null;
  const custom = limit && !TIMER_MINS.includes(limit / 60) ? String(limit / 60) : "";
  return `<button class="choice timer${limit && left <= 0 ? " is-up" : ""}" data-toggle="${esc(key)}" aria-expanded="${open}"
      aria-label="Daily timer for ${esc(site)}: ${limit ? esc(label) : "none"}">${esc(label)}</button>
    <div class="chips" role="group" aria-label="Daily timer for ${esc(site)}"${open ? "" : " hidden"}>
      ${TIMER_MINS.map(m => `<button class="chip" data-limit-site="${esc(site)}" data-limit="${m * 60}"
        aria-pressed="${limit === m * 60}">${minsLabel(m)}</button>`).join("")}
      <input class="inline-edit timer-mins" data-limit-input="${esc(site)}" inputmode="numeric" maxlength="4"
        value="${esc(err ? err.draft : custom)}" placeholder="Other" aria-label="Other daily timer for ${esc(site)}, in minutes"
        ${err ? `aria-invalid="true" aria-describedby="timerErr"` : ""}>
      ${limit ? `<button class="chip" data-limit-site="${esc(site)}" data-limit="0">No timer</button>` : ""}
      ${err ? `<p id="timerErr" class="field-error" role="alert">${esc(err.msg)}</p>` : ""}
      <p class="meta">Minutes a day. Resets at midnight. When time's up, ${esc(site)} is paused for the rest of the day.</p>
    </div>`;
}
function showSiteRows(focusSite = null) {
  if (!siteState) return;
  const { entries, block } = siteState;
  patch($("siteRows"), entries.length
    ? entries.map(([dom, e]) => `<li class="row${blockReason(dom, block) ? " is-paused" : ""}"><img src="${favicon(dom)}" alt="">
        <span class="row-main">${esc(dom)}</span><span class="meta">${fmt(e.s)}</span>
        ${catToggleHTML(`site:${dom}`, dom, catFor(dom, block.cats), block.cats)}${timerToggleHTML(dom, block)}</li>`).join("")
    : `<li class="meta">Nothing tracked yet today. Sites appear here as you browse.</li>`);
  if (focusSite) {
    const input = [...$("siteRows").querySelectorAll(`[data-limit-input="${CSS.escape(focusSite)}"]`)]
      .find(i => !i.closest("[hidden]"));
    if (input) { input.focus(); input.select(); }
  }
}
async function setLimit(site, secs) {
  const limits = (await chrome.storage.local.get("limits")).limits || {};
  if (secs) limits[site] = secs; else delete limits[site];
  timerError = null;
  await chrome.storage.local.set({ limits });
}
async function commitTimer(input, refocus) {
  const site = input.dataset.limitInput, draft = input.value.trim();
  if (!draft) return;
  const mins = Number(draft);
  if (!Number.isInteger(mins) || mins < 1 || mins > 1440) {
    timerError = { site, draft, msg: "Enter whole minutes, from 1 to 1440." };
    return showSiteRows(refocus ? site : null);
  }
  if ((siteState.block.limits[site] || 0) !== mins * 60) await setLimit(site, mins * 60);
}
$("siteRows").addEventListener("click", e => {
  const b = e.target.closest("[data-limit]");
  if (b) setLimit(b.dataset.limitSite, Number(b.dataset.limit));
});
$("siteRows").addEventListener("keydown", e => {
  if (!e.target.matches("[data-limit-input]")) return;
  if (e.key === "Enter") { e.preventDefault(); commitTimer(e.target, true); }
  if (e.key === "Escape") { e.preventDefault(); timerError = null; e.target.value = ""; e.target.blur(); }
});
$("siteRows").addEventListener("focusout", e => {   // clicking away saves, like the category editor
  if (e.target.matches("[data-limit-input]")) commitTimer(e.target, false);
});

/* ---------- Focus mode: pause distracting sites, with short breaks ---------- */
const andList = a => (a.length < 2 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`);
function showFocus(focus, cats, now = Date.now()) {
  const on = !!(focus && focus.on), paused = focusCats(focus, cats);
  const sites = paused.length ? `${andList(paused)} sites` : "";
  $("focusSwitch").setAttribute("aria-checked", String(on));
  $("focusStatus").textContent = !on ? (sites ? `Pauses ${sites} while you work.` : "Pick the categories to pause below.")
    : onBreak(focus, now) ? `On a break until ${timeOf(focus.breakUntil)}.`
    : sites ? `On. ${sites} are paused.` : "On. Pick the categories to pause below.";
  patch($("focusBreak"), !on ? "" : onBreak(focus, now)
    ? `<button class="quiet" data-break="0">End break now</button>`
    : `<div class="chips" role="group" aria-labelledby="breakLabel"><span id="breakLabel" class="meta break-label">Take a break</span>${
        BREAK_MINS.map(m => `<button class="chip" data-break="${m}">${m} min</button>`).join("")}</div>`);
  patch($("focusCats"), cats.list.map(c =>
    `<button class="chip" data-focus-cat="${esc(c)}" aria-pressed="${paused.includes(c)}">${esc(c)}</button>`).join(""));
}
async function updateFocus(change) {
  const { focus, ...rest } = await chrome.storage.local.get(["focus", ...CAT_KEYS]);
  const cur = focus || { on: false, breakUntil: null };
  await chrome.storage.local.set({ focus: { ...cur, ...change(cur, catsFrom(rest)) } });
}
$("focusSwitch").onclick = () => updateFocus(f => ({ on: !f.on, breakUntil: null }));
$("focusBreak").addEventListener("click", e => {
  const b = e.target.closest("[data-break]");
  if (!b) return;
  const mins = Number(b.dataset.break);
  updateFocus(() => ({ breakUntil: mins ? Date.now() + mins * 60000 : null }));
});
$("focusCats").addEventListener("click", e => {
  const b = e.target.closest("[data-focus-cat]");
  if (!b) return;
  const cat = b.dataset.focusCat;
  updateFocus((f, cats) => {
    const list = focusCats(f, cats);
    return { cats: list.includes(cat) ? list.filter(c => c !== cat) : [...list, cat] };
  });
});

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
    `<li class="row${(roll[cat] || {}).s ? "" : " is-empty"}">
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
  const name = value.trim(), was = editing, { cats, challenge, focus } = catState;
  if (!name || name === was) return stopEdit();
  if (cats.list.includes(name)) {
    draft = name;
    editError = `There's already a category called "${name}". Try another name.`;
    committing = true; showCatRows(true); committing = false;
    return;
  }
  committing = true;
  await chrome.storage.local.set(was === NEW_CAT ? { catList: [...cats.list, name] }
                                                 : renameCategory(cats, {}, challenge, was, name, focus));
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

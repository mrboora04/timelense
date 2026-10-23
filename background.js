/* TimeLens engine — MV3 service worker. 100% local: chrome.storage only.
   Every event funnels into sync(), which asks "what is the user looking at right now?"
   and keeps, switches or pauses the session to match. Changes run one at a time (serial)
   so overlapping events can't double-count time or overwrite each other's writes.
   Session state lives in chrome.storage.session so time survives worker suspension.
   Site timers and Focus mode pause sites with declarativeNetRequest block rules, which Chrome
   applies locally; nothing about the pages is read or sent anywhere. */
importScripts("lib.js");

const IDLE_SECS = 60;
const KEEP_DAYS = 30;
const TRAIL_DAYS = 2;
const MAX_CREDIT_MS = 2 * 60 * 1000; // the tick banks time every minute; a bigger gap means the PC slept
const SES = "liveSession";
try { chrome.idle.setDetectionInterval(IDLE_SECS); } catch (e) {}

/* keeps the newest `days` day keys */
function prune(byDay, days) {
  const keys = Object.keys(byDay).sort();
  while (keys.length > days) delete byDay[keys.shift()];
}

/* session: { tabId, domain, start, visitMs }. start is null while paused (Chrome unfocused
   or idle), so coming back to the same tab and site isn't counted as a new visit.
   visitMs is the time already saved for this visit, for the live "this visit" timer. */
let memCur;
async function getSession() {
  if (memCur === undefined) memCur = (await chrome.storage.session.get(SES))[SES] || null;
  return memCur;
}
async function setSession(s) {
  memCur = s;
  await chrome.storage.session.set({ [SES]: s });
}

/* One read-modify-write for a whole change. ops: [{ domain, ms?, visit? }] add time/visits to v1.
   mark: { d: domain or null (paused), t } appends to the trail (the order you moved between sites,
   used for drift detection); fresh: first mark since Chrome started, closes a trail left open.
   Returns the seconds actually credited per op. */
async function record(ops, mark = null, fresh = false, when = new Date()) {
  const credited = ops.map(o => (o.ms >= 1000 ? Math.round(Math.min(o.ms, MAX_CREDIT_MS) / 1000) : 0));
  const touchV1 = ops.some((o, i) => credited[i] || o.visit);
  if (!touchV1 && !mark) return credited;
  const withUrl = ops.filter(o => o.url);
  const d = await chrome.storage.local.get([...(mark ? ["v1", "trail", "seen"] : ["v1"]), ...(withUrl.length ? ["pages"] : [])]);
  const upd = {};
  if (touchV1) {
    const v = d.v1 || {};
    const k = dayKey(when);
    const day = v[k] || blankDay();
    ops.forEach((o, i) => {
      if (!day.first && (o.visit || credited[i])) day.first = when.getTime();   // first visit of the day
      const e = day.domains[o.domain] || { s: 0, v: 0 };
      e.s += credited[i];
      if (o.visit) e.v += 1;
      day.domains[o.domain] = e;
      day.hours[when.getHours()] += credited[i];
      if (credited[i]) {   // dh: seconds per site per hour (sparse), for stacked hourly charts
        const dh = day.dh || (day.dh = {}), hh = dh[o.domain] || (dh[o.domain] = {}), h = when.getHours();
        hh[h] = (hh[h] || 0) + credited[i];
      }
    });
    v[k] = day; prune(v, KEEP_DAYS);
    upd.v1 = v;
    upd.seen = when.getTime(); // last time anything was counted
  }
  /* pages: one page you visited per site, so the icon lookup asks Chrome's local icon cache
     with an address it has an icon for (it files icons under real pages, e.g. www.youtube.com/...) */
  if (withUrl.length) {
    upd.pages = d.pages || {};
    for (const o of withUrl) upd.pages[o.domain] = o.url;
  }
  if (mark) {
    const trail = d.trail || {};
    const add = m => (trail[dayKey(new Date(m.t))] = trail[dayKey(new Date(m.t))] || []).push(m);
    if (fresh) {
      /* Chrome quit without a pause: end the old trail where counting last happened */
      const last = trailEntries(trail, mark.t).pop();
      if (last && last.d) add({ d: null, t: Math.max(last.t, Math.min(d.seen || last.t, mark.t)) });
    }
    add(mark);
    prune(trail, TRAIL_DAYS);
    upd.trail = trail;
  }
  await chrome.storage.local.set(upd);
  return credited;
}

let queue = Promise.resolve();
function serial(fn) {
  const run = queue.then(() => fn());
  queue = run.catch(e => console.error("TimeLens:", e));
  return run;
}

/* The toolbar popup takes keyboard focus on Windows, so Chrome reports no focused window
   while it's open. The popup keeps a port open; while it does, Chrome counts as in front. */
let popupOpen = 0;
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== "popup") return;
  popupOpen++;
  resync();
  port.onDisconnect.addListener(() => { popupOpen--; resync(); });
});

const DEVTOOLS = "devtools";
/* The active tab of the focused Chrome window; DEVTOOLS when an undocked DevTools window is
   focused. When another app is in front, a tab playing sound (music, a video, a call) still
   counts and is marked background; otherwise null. Incognito is never recorded. */
async function focusedTab() {
  const w = await chrome.windows.getLastFocused({ populate: true, windowTypes: ["normal", "popup", "devtools"] })
    .catch(() => null);
  if (w && !w.incognito && (w.focused || popupOpen)) {
    if (w.type === "devtools") return w.focused ? DEVTOOLS : null;
    return (w.tabs || []).find(t => t.active) || null;
  }
  const playing = (await chrome.tabs.query({ audible: true }).catch(() => []))
    .filter(t => !t.incognito && !(t.mutedInfo && t.mutedInfo.muted));
  return playing.length ? { ...playing[0], background: true } : null;
}

async function sync() {
  let [tab, state] = await Promise.all([
    focusedTab(), chrome.idle.queryState(IDLE_SECS).catch(() => "active")]);
  /* debugging the page in undocked DevTools: keep the current session going while active */
  if (tab === DEVTOOLS) {
    if (state === "active") return;
    tab = null;
  }
  /* videos and calls produce no keyboard/mouse input, so an audible tab still counts */
  const present = state === "active" || (state === "idle" && tab && tab.audible);
  const domain = present && tab ? domainOf(tab.url) : null;
  /* shown in the UI while paused, so a pause is never a mystery */
  const why = !tab ? "Chrome isn't the window in front"
    : !present ? (state === "locked" ? "screen locked" : "no activity for a minute")
    : !domain ? "this tab isn't a website" : null;
  const cur = await getSession();
  const now = Date.now();
  const bg = !!(tab && tab.background);
  const same = cur && tab && cur.tabId === tab.id && cur.domain === domain;
  if (cur && cur.start && same && !!cur.bg === bg) return; // same tab and site (e.g. in-app navigation): keep going

  const ops = [];
  let mark = null;
  if (cur && cur.start) {
    /* idle is only reported after IDLE_SECS without input, so that stretch wasn't real use */
    const trim = state === "idle" && !present ? IDLE_SECS * 1000 : 0;
    ops.push({ domain: cur.domain, ms: now - cur.start - trim });
    if (!domain) mark = { d: null, t: Math.max(cur.start, now - trim) };
  }
  if (domain && !same) ops.push({ domain, visit: true, url: tab.url });
  /* started, switched or resumed; b marks background audio so drift detection can skip it */
  if (domain) mark = bg ? { d: domain, t: now, b: 1 } : { d: domain, t: now };
  const credited = await record(ops, mark, cur === null);

  if (domain) await setSession({ tabId: tab.id, domain, start: now, bg,
    visitMs: same ? (cur.visitMs || 0) + (cur.start ? credited[0] * 1000 : 0) : 0 });
  else if (cur && cur.start) await setSession({ ...cur, start: null, visitMs: (cur.visitMs || 0) + credited[0] * 1000, why });
  else if (!cur || cur.why !== why) await setSession({ ...(cur || {}), start: null, why });
}

/* periodic commit: every 60s the worker wakes, re-checks what's in front, banks elapsed time */
async function tick() {
  await sync();
  const cur = await getSession();
  if (cur && cur.start) {
    const now = Date.now();
    const [s] = await record([{ domain: cur.domain, ms: now - cur.start }]);  // time only, no trail mark
    await setSession({ ...cur, start: now, visitMs: (cur.visitMs || 0) + s * 1000 });
  }
}

/* ---------- site timers and Focus mode ---------- */
const PAUSED_PAGE = "blocked.html";
const RULE_IDS = { timer: 1, focus: 2 };

/* { limits, focus, cats, day }: today's time includes the session being timed right now */
async function blockState() {
  const d = await chrome.storage.local.get(["v1", ...BLOCK_KEYS, ...CAT_KEYS]);
  const day = (d.v1 || {})[dayKey()] || blankDay();
  const cur = await getSession();
  if (cur && cur.start) {
    const e = day.domains[cur.domain] || (day.domains[cur.domain] = { s: 0, v: 0 });
    e.s += Math.min(Date.now() - cur.start, MAX_CREDIT_MS) / 1000;
  }
  return { limits: d.limits || {}, focus: d.focus || null, cats: catsFrom(d), day };
}

/* Chrome's block rules: sites whose timer ran out, and the sites in Focus mode's categories.
   Only whole pages are cancelled (main_frame), so a video embedded on another site still plays.
   Focus mode lists every known site in its categories and spares more specific ones that belong
   elsewhere (aws.amazon.com is Work, amazon.com is Shopping); sites it only knows by a guess
   are caught when their tab opens (pauseTabs). */
function blockRules({ limits, focus, cats, day }, now = Date.now()) {
  const rule = (id, domains, spared) => ({ id, priority: 1, action: { type: "block" },
    condition: { requestDomains: domains, resourceTypes: ["main_frame"],
                 ...(spared.length ? { excludedRequestDomains: spared } : {}) } });
  const rules = [];
  const done = Object.keys(limits).filter(site => siteUsed(day, site) >= limits[site]).sort();
  if (done.length) rules.push(rule(RULE_IDS.timer, done, []));
  if (focusActive(focus, now)) {
    const paused = focusCats(focus, cats);
    const known = [...new Set([...Object.keys(BUILTIN_CATS), ...Object.keys(cats.map)])].sort();
    const hit = known.filter(d => paused.includes(catFor(d, cats)));
    const spared = known.filter(d => !hit.includes(d) && hit.some(h => underSite(d, h)));
    if (hit.length) rules.push(rule(RULE_IDS.focus, hit, spared));
  }
  return rules;
}

/* Rules stop new page loads; tabs already open on a paused site go to the paused page, the way
   Android closes an app when its timer runs out. */
async function pauseTabs(state, now) {
  for (const tab of await chrome.tabs.query({}).catch(() => [])) {
    const url = tab.pendingUrl || tab.url || "";
    const domain = domainOf(url);
    if (domain && blockReason(domain, state, now)) {
      await chrome.tabs.update(tab.id, { url: chrome.runtime.getURL(`${PAUSED_PAGE}?u=${encodeURIComponent(url)}`) })
        .catch(() => {});
    }
  }
}

let ruleSig = null;   // the rules last given to Chrome, so unchanged rules aren't rewritten
async function applyBlocks() {
  const now = Date.now(), state = await blockState();
  const rules = blockRules(state, now), sig = JSON.stringify(rules);
  if (sig !== ruleSig) {
    const old = await chrome.declarativeNetRequest.getSessionRules();
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: old.map(r => r.id), addRules: rules });
    ruleSig = sig;
  }
  await pauseTabs(state, now);
  /* wake exactly when the timer of the site being used runs out, not at the next minute tick */
  const cur = await getSession();
  const site = cur && cur.start && timerFor(cur.domain, state.limits);
  const left = site ? state.limits[site] - siteUsed(state.day, site) : 0;
  if (left > 0) chrome.alarms.create("limit", { when: now + left * 1000 });
  else await chrome.alarms.clear("limit");
  if (onBreak(state.focus, now)) chrome.alarms.create("focusBreak", { when: state.focus.breakUntil });
  return state;
}
/* a break ended: clear it, which re-applies Focus mode through storage.onChanged */
async function endBreak() {
  const { focus } = await chrome.storage.local.get("focus");
  if (focus && focus.breakUntil && focus.breakUntil <= Date.now()) {
    await chrome.storage.local.set({ focus: { ...focus, breakUntil: null } });
  }
}

const resync = () => serial(async () => { await sync(); await applyBlocks(); });
chrome.tabs.onActivated.addListener(resync);
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.audible !== undefined || (tab.active && info.url)) resync();   // any tab starting/stopping sound
  else if (info.url) serial(applyBlocks);    // a background tab opening a paused site
});
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && [...BLOCK_KEYS, ...CAT_KEYS].some(k => k in changes)) serial(applyBlocks);
});
chrome.tabs.onRemoved.addListener(resync);
chrome.windows.onFocusChanged.addListener(resync);
chrome.idle.onStateChanged.addListener(resync);
chrome.runtime.onStartup.addListener(resync);
chrome.alarms.onAlarm.addListener(a => {
  if (a.name === "tick" || a.name === "limit") serial(async () => { await tick(); await applyBlocks(); });
  if (a.name === "focusBreak") serial(endBreak);
});
/* create once; re-creating on every worker start would keep resetting the timer */
chrome.alarms.get("tick").then(a => { if (!a) chrome.alarms.create("tick", { periodInMinutes: 1 }); });

/* live readout for popup/panel (display only) */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "getLive") {
    getSession().then(cur => {
      if (!cur) return sendResponse({ build: TL_BUILD, tracking: false, domain: null });
      const elapsed = cur.start ? Math.min(Date.now() - cur.start, MAX_CREDIT_MS) : 0;
      sendResponse({ build: TL_BUILD, domain: cur.domain, tracking: !!cur.start, bg: !!(cur.start && cur.bg), elapsed,
                     visitMs: (cur.visitMs || 0) + elapsed, why: cur.start ? null : cur.why || null });
    });
    return true;
  }
  /* the paused page asks why its site is paused, after any pending change has been applied */
  if (msg && msg.type === "whyPaused") {
    serial(async () => {
      const state = await applyBlocks();
      sendResponse({ build: TL_BUILD, reason: blockReason(msg.domain, state), focus: state.focus });
    }).catch(() => sendResponse(null));
    return true;
  }
});

resync();

/* Shared: categories, dates, formatting, drift detection. Loaded by the background worker
   (importScripts), the popup and the side panel. No dependencies. */
const DEFAULT_CATS = ["Work", "Social", "News", "Entertainment", "Shopping", "Learning", "Other"];
/* Built-in sites per category. Matched against the domain and every parent domain, so
   youtube.com also covers m.youtube.com, and aws.amazon.com (Work) beats amazon.com (Shopping). */
const SITE_LISTS = {
  Work: `github.com gitlab.com bitbucket.org stackoverflow.com stackexchange.com serverfault.com
    superuser.com linkedin.com gmail.com mail.google.com docs.google.com sheets.google.com
    slides.google.com drive.google.com calendar.google.com meet.google.com keep.google.com
    outlook.office.com outlook.live.com office.com microsoft365.com teams.microsoft.com sharepoint.com
    onedrive.live.com slack.com zoom.us notion.so notion.site figma.com miro.com canva.com trello.com
    asana.com atlassian.net atlassian.com linear.app clickup.com monday.com airtable.com dropbox.com
    box.com vercel.com netlify.com render.com railway.app heroku.com aws.amazon.com portal.azure.com
    console.cloud.google.com firebase.google.com cloudflare.com digitalocean.com npmjs.com pypi.org
    developer.mozilla.org devdocs.io readthedocs.io docker.com kaggle.com huggingface.co replit.com
    codesandbox.io codepen.io jsfiddle.net postman.com claude.ai anthropic.com chatgpt.com
    chat.openai.com platform.openai.com gemini.google.com aistudio.google.com notebooklm.google.com
    perplexity.ai copilot.microsoft.com muse.ai deepwiki.com gitdiagram.com workable.com lever.co
    greenhouse.io naukri.com indeed.com wellfound.com glassdoor.com upwork.com fiverr.com`,
  Social: `instagram.com facebook.com messenger.com twitter.com x.com reddit.com tiktok.com
    snapchat.com pinterest.com tumblr.com threads.net bsky.app mastodon.social quora.com discord.com
    web.telegram.org telegram.org web.whatsapp.com whatsapp.com sharechat.com`,
  Entertainment: `youtube.com netflix.com primevideo.com hotstar.com jiocinema.com sonyliv.com zee5.com
    disneyplus.com hulu.com max.com twitch.tv kick.com spotify.com music.apple.com soundcloud.com
    gaana.com jiosaavn.com crunchyroll.com imdb.com 9gag.com steampowered.com epicgames.com
    chess.com lichess.org roblox.com miniclip.com`,
  News: `bbc.com bbc.co.uk cnn.com theguardian.com nytimes.com washingtonpost.com reuters.com apnews.com
    bloomberg.com wsj.com ft.com economist.com aljazeera.com news.google.com news.ycombinator.com
    techcrunch.com theverge.com wired.com arstechnica.com engadget.com indiatimes.com
    hindustantimes.com thehindu.com indianexpress.com ndtv.com news18.com indiatoday.in livemint.com
    moneycontrol.com business-standard.com scroll.in thewire.in medium.com substack.com`,
  Shopping: `amazon.com amazon.in amazon.ca amazon.co.uk ebay.com flipkart.com myntra.com ajio.com
    meesho.com nykaa.com snapdeal.com bigbasket.com blinkit.com zeptonow.com swiggy.com zomato.com
    doordash.com ubereats.com walmart.com target.com bestbuy.com etsy.com aliexpress.com temu.com
    shein.com ikea.com croma.com reliancedigital.in`,
  Learning: `coursera.org udemy.com edx.org khanacademy.org nptel.ac.in swayam.gov.in
    onlinedegree.iitm.ac.in unacademy.com byjus.com physicswallah.com pw.live geeksforgeeks.org
    leetcode.com hackerrank.com codechef.com codeforces.com freecodecamp.org w3schools.com
    duolingo.com brilliant.org skillshare.com udacity.com pluralsight.com datacamp.com wikipedia.org
    scholar.google.com arxiv.org researchgate.net quizlet.com chegg.com`,
};
const BUILTIN_CATS = {};
for (const [cat, list] of Object.entries(SITE_LISTS)) {
  for (const d of list.trim().split(/\s+/)) BUILTIN_CATS[d] = cat;
}
/* Sites not in the lists are guessed from their name (checked in order, first match wins). */
const GUESS_RULES = [
  [/^(localhost|127\.0\.0\.1|\[::1\])$|\.(local|test|localhost)$/, "Work"],
  [/\.(edu|ac\.[a-z]{2}|edu\.[a-z]{2})$/, "Learning"],
  [/^(docs|mail|calendar|meet|jira|confluence|console|dashboard|admin|wiki|git)\./, "Work"],
  [/news|times|herald|journal|tribune|gazette/, "News"],
  [/shop|store|mart|deals|cart|bazaar/, "Shopping"],
  [/game|gaming|anime|movie|stream|music|manga|comic/, "Entertainment"],
  [/learn|course|academy|tutor|school|college|universit|study|quiz/, "Learning"],
  [/forum|community|social/, "Social"],
];
function guessCat(domain) {
  const rule = GUESS_RULES.find(([re]) => re.test(domain));
  return rule ? rule[1] : null;
}
const CAT_KEYS = ["catList", "catMap", "catAlias"];
/* Bump with every change. Chrome reloads the dashboard's files from disk on their own, but
   keeps running the old background worker until the extension is reloaded; the pages
   compare this number with the worker's to notice that and offer a reload. */
const TL_BUILD = 160;

const pad = n => String(n).padStart(2, "0");
function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function blankDay() { return { domains: {}, hours: new Array(24).fill(0) }; }
function domainOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch { return null; }
}

/* catList: category names in display order. catMap: user's per-domain picks.
   catAlias: built-in name -> current name (e.g. Work -> Job), so built-in sites follow renames.
   Keys are only built-in names, so a lookup is one hop. */
function catsFrom(d) {
  return { list: d.catList || DEFAULT_CATS.slice(), map: d.catMap || {}, alias: d.catAlias || {} };
}
async function getCats() {
  return catsFrom(await chrome.storage.local.get(CAT_KEYS));
}
function resolveCat(cat, cats) {
  return cats.alias[cat] || cat;
}
const BUILTIN_NAMES = [...new Set([...Object.values(BUILTIN_CATS), "Other"])];
/* Storage updates for renaming category `from` to `to`, or null if the rename isn't valid. */
function renameCategory(cats, targets, challenge, from, to, focus = null) {
  to = (to || "").trim();
  if (!to || to === from || !cats.list.includes(from) || cats.list.includes(to)) return null;
  const swap = c => (c === from ? to : c);
  const catMap = {};
  for (const d in cats.map) catMap[d] = swap(cats.map[d]);
  const catAlias = {};
  for (const orig of BUILTIN_NAMES) {
    const next = swap(resolveCat(orig, cats));
    if (next !== orig) catAlias[orig] = next;
  }
  const t = {};
  for (const c in targets) t[swap(c)] = targets[c];
  const upd = { catList: cats.list.map(swap), catMap, catAlias, targets: t };
  if (challenge && challenge.cat === from) upd.challenge = { ...challenge, cat: to };
  if (focus && focus.cats && focus.cats.includes(from)) upd.focus = { ...focus, cats: focus.cats.map(swap) };
  return upd;
}
/* Your pick first, then the built-in list (most specific domain wins:
   mail.google.com, then google.com), then a guess from the name, then Other. */
function catFor(domain, cats) {
  for (let d = domain; d; ) {
    if (cats.map[d]) return cats.map[d];
    if (BUILTIN_CATS[d]) return resolveCat(BUILTIN_CATS[d], cats);
    const i = d.indexOf(".");
    d = i < 0 ? "" : d.slice(i + 1);
  }
  return resolveCat(guessCat(domain) || "Other", cats);
}

/* { build, domain, tracking, elapsed: ms not yet saved, visitMs: ms on this visit so far, why }
   or null when the worker didn't answer */
async function getLive() {
  try { return await chrome.runtime.sendMessage({ type: "getLive" }); } catch { return null; }
}
/* Adds the in-progress (not yet saved) session to a day, for display only. */
function addLive(day, live) {
  if (live && live.tracking && live.elapsed >= 1000) {
    const s = Math.round(live.elapsed / 1000);
    const e = day.domains[live.domain] || (day.domains[live.domain] = { s: 0, v: 0 });
    e.s += s;
    day.hours[new Date().getHours()] += s;
  }
  return day;
}
/* true when the running worker is missing or older than these files */
function workerStale(live) {
  return !live || live.build !== TL_BUILD;
}
function daySeconds(day) {
  return day ? Object.values(day.domains).reduce((a, e) => a + e.s, 0) : 0;
}

/* ---------- drift: sliding from focus into distraction ---------- */
const FOCUS_CATS = ["Work", "Learning"];
const DISTRACT_CATS = ["Social", "Entertainment", "News", "Shopping"];
const DRIFT_MIN_SECS = 5 * 60;   // shorter detours aren't drifts
const DOOM_MIN_SECS = 20 * 60;   // distraction with no focus site before it (pure doomscrolling)
const BREAK_SECS = 10 * 60;      // a pause this long starts a fresh stretch

/* trail: { dayKey: [{ d: domain or null, t: ms }] }, written by the worker; d null = paused.
   Returns yesterday + today in time order, so a drift across midnight stays whole. */
function trailEntries(trail, now = Date.now()) {
  const yd = new Date(now); yd.setDate(yd.getDate() - 1);
  return [...((trail || {})[dayKey(yd)] || []), ...((trail || {})[dayKey(new Date(now))] || [])]
    .sort((a, b) => a.t - b.t);
}
function siteKind(domain, cats) {
  const c = catFor(domain, cats);
  if (FOCUS_CATS.some(x => resolveCat(x, cats) === c)) return "focus";
  if (DISTRACT_CATS.some(x => resolveCat(x, cats) === c)) return "distract";
  return "neutral";
}
/* A drift starts when you go from a focus site (Work, Learning) to a distracting one and lasts
   until you're back on a focus site or take a long break. Returns
   { drifts: oldest first, ongoing: the drift happening right now or null, streak: focus secs now }.
   drift: { from, leftAt, end, secs, sites: [domains in order], returned, backTo, ongoing } */
/* trail entries -> time ranges spent on each site: [{ d, start, end, open }] */
function trailSegments(entries, now = Date.now()) {
  const segs = [];
  entries.forEach((e, i) => {
    const end = i + 1 < entries.length ? entries[i + 1].t : now;
    if (e.d && end > e.t) segs.push({ d: e.d, start: e.t, end, open: i === entries.length - 1, bg: !!e.b });
  });
  return segs;
}
function findDrifts(entries, cats, now = Date.now()) {
  const segs = trailSegments(entries, now);
  const drifts = [];
  let anchor = null, cur = null, lastEnd = -Infinity, streak = 0;
  const keep = d => d.secs >= (d.from ? DRIFT_MIN_SECS : DOOM_MIN_SECS);
  const close = () => { if (cur && keep(cur)) drifts.push(cur); cur = null; };
  for (const s of segs) {
    if (s.bg) continue;   // music playing while you work elsewhere isn't a drift
    const secs = (s.end - s.start) / 1000;
    if ((s.start - lastEnd) / 1000 > BREAK_SECS) { close(); anchor = null; streak = 0; }
    const kind = siteKind(s.d, cats);
    if (kind === "focus") {
      if (cur) { cur.returned = true; cur.backTo = s.d; close(); }
      anchor = s.d;
      streak += secs;
    } else {
      streak = 0;
      if (!cur && kind === "distract") {
        cur = { from: anchor, leftAt: s.start, end: s.end, secs: 0, sites: [], returned: false, ongoing: false };
      }
      if (cur) {
        cur.secs += secs; cur.end = s.end;
        if (!cur.sites.includes(s.d)) cur.sites.push(s.d);
      }
    }
    lastEnd = s.end;
  }
  const last = segs[segs.length - 1];
  const live = !!(last && last.open);
  let ongoing = null;
  if (cur && keep(cur)) {
    cur.ongoing = live;
    drifts.push(cur);
    if (live) ongoing = cur;
  }
  return { drifts, ongoing, streak: live && siteKind(last.d, cats) === "focus" ? streak : 0 };
}

/* ---------- site timers and Focus mode (Android Digital Wellbeing style) ---------- */
/* limits: { site: daily seconds }; a timer covers the site and its subdomains, resets at midnight.
   focus: { on, cats: categories it pauses (missing = the distracting ones), breakUntil: ms or null } */
const BLOCK_KEYS = ["limits", "focus"];
const TIMER_MINS = [15, 30, 60, 120];
const BREAK_MINS = [5, 15, 30];
/* a timer length in minutes, as people say it: 15 min, 2 h, 1h 30m */
const minsLabel = m => (m < 60 ? `${m} min` : m % 60 ? fmt(m * 60) : `${m / 60} h`);
const underSite = (domain, site) => domain === site || domain.endsWith("." + site);
/* seconds spent on a site and its subdomains in one day */
function siteUsed(day, site) {
  let s = 0;
  for (const d in day.domains) if (underSite(d, site)) s += day.domains[d].s;
  return s;
}
/* the timer that covers domain, most specific first (m.youtube.com, then youtube.com), or null */
function timerFor(domain, limits) {
  for (let d = domain; d; ) {
    if (limits[d]) return d;
    const i = d.indexOf(".");
    d = i < 0 ? "" : d.slice(i + 1);
  }
  return null;
}
function focusCats(focus, cats) {
  return (focus && focus.cats) || DISTRACT_CATS.map(c => resolveCat(c, cats));
}
const onBreak = (focus, now = Date.now()) => !!(focus && focus.on && focus.breakUntil > now);
const focusActive = (focus, now = Date.now()) => !!(focus && focus.on) && !onBreak(focus, now);
/* Why a domain is paused right now, or null.
   state: { limits, focus, cats, day: today with the live session added }
   -> { kind: "timer", site, limit, used } or { kind: "focus", cat } */
function blockReason(domain, { limits = {}, focus, cats, day }, now = Date.now()) {
  const site = timerFor(domain, limits);
  if (site) {
    const used = siteUsed(day, site);
    if (used >= limits[site]) return { kind: "timer", site, limit: limits[site], used };
  }
  if (focusActive(focus, now)) {
    const cat = catFor(domain, cats);
    if (focusCats(focus, cats).includes(cat)) return { kind: "focus", cat };
  }
  return null;
}

function timeOf(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
/* What Lens (the mascot) looks like and says. Plain text; the UI escapes it. */
function mascotMood({ onSite, tracking, total, drift, streak, why, bg }) {
  if (!onSite) return { mood: "happy", text: "Open a website and I'll start counting." };
  if (!tracking) return { mood: "sleep", text: `Paused: ${why || "waiting for activity"}. I'll wait right here.` };
  if (bg) return { mood: "happy", text: "Counting what's playing in the background." };
  if (drift && !drift.from) {
    return { mood: "worried", text: `${fmt(drift.secs)} of scrolling on ${drift.sites.slice(-2).join(", ")}. Break time?` };
  }
  if (drift && drift.secs >= 15 * 60) {
    return { mood: "worried",
      text: `You left ${drift.from} at ${timeOf(drift.leftAt)}. ${fmt(drift.secs)} later you're on ${drift.sites[drift.sites.length - 1]}. Still on track?` };
  }
  if (drift) return { mood: "curious", text: `Wandered off ${drift.from}? It's one click away.` };
  if (streak >= 25 * 60) return { mood: "proud", text: `${fmt(streak)} of focus in a row. Nice!` };
  if (total < 120) return { mood: "wave", text: "Hi, I'm Lens! I'll keep an eye on where your time goes." };
  return { mood: "happy", text: `All good. ${fmt(total)} browsed today.` };
}

function fmt(s) {
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h) return h + "h " + m + "m";
  if (m) return m + "m";
  return s + "s";
}
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
/* stopwatch style for live timers: 4:07, 1:02:33 */
function clock(s) {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? h + ":" + pad(m) : m) + ":" + pad(sec);
}
function favicon(domain) {
  return chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent("https://" + domain)}&size=32`);
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

/* Shared UI for popup + side panel. Needs lib.js loaded first.
   Speed: every block is built as an HTML string and written only when it changed (patch),
   so a refresh with nothing new touches no DOM and re-requests no icons. Clicks go through
   one delegated listener instead of handlers rebuilt on every render. */
const CHART_COLORS = 6;   // --chart-color-1..6 in styles.css
const $ = id => document.getElementById(id);

/* write html into el only if it differs from what's already there */
function patch(el, html) {
  if (el._html !== html) { el.innerHTML = html; el._html = html; }
}
/* coalesces bursts of refresh requests (a tab switch fires several) into one render */
function scheduler(render, wait = 120) {
  let timer = null, running = false, again = false;
  const run = async () => {
    timer = null;
    if (running) { again = true; return; }
    running = true;
    try { await render(); } catch (e) { console.error("TimeLens:", e); }
    running = false;
    if (again) { again = false; request(); }
  };
  const request = () => { if (!timer) timer = setTimeout(run, wait); };
  return request;
}

/* category colour as a design token, never a raw hex */
function colorFor(cat, cats) {
  const other = resolveCat("Other", cats);
  if (cat === other) return "var(--chart-color-other)";
  const i = cats.list.filter(c => c !== other).indexOf(cat);
  return i < 0 ? "var(--chart-color-other)" : `var(--chart-color-${(i % CHART_COLORS) + 1})`;
}
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  return tab || null;
}

/* time per category for a day's entries: { cat: { s } } */
function rollup(entries, cats) {
  const roll = {};
  cats.list.forEach(c => roll[c] = { s: 0 });
  for (const [dom, e] of entries) {
    const c = catFor(dom, cats);
    (roll[c] || (roll[c] = { s: 0 })).s += e.s;
  }
  return roll;
}

/* ---------- category toggle + choices (delegated clicks) ---------- */
const openPickers = new Set();
function catToggleHTML(key, domain, cat, cats) {
  const open = openPickers.has(key);
  const chips = cats.list.map(c =>
    `<button class="chip" data-domain="${esc(domain)}" data-cat="${esc(c)}" aria-pressed="${c === cat}"
      style="--chip-color:${colorFor(c, cats)}">${esc(c)}</button>`).join("");
  return `<button class="choice" data-toggle="${esc(key)}" aria-expanded="${open}">
      <i class="dot" style="background:${colorFor(cat, cats)}"></i>${esc(cat)}</button>
    <div class="chips" role="group" aria-label="Category for ${esc(domain)}"${open ? "" : " hidden"}>${chips}</div>`;
}
document.addEventListener("click", async e => {
  const t = e.target.closest("[data-toggle], [data-cat]");
  if (!t) return;
  if (t.dataset.toggle) {
    const key = t.dataset.toggle, open = !openPickers.has(key);
    open ? openPickers.add(key) : openPickers.delete(key);
    t.setAttribute("aria-expanded", String(open));
    t.nextElementSibling.hidden = !open;   // immediate; the next render string agrees
  } else {
    const map = (await chrome.storage.local.get("catMap")).catMap || {};
    map[t.dataset.domain] = t.dataset.cat;
    await chrome.storage.local.set({ catMap: map });
  }
});

/* category share as a stacked bar + text legend, with a text alternative */
function renderStack(bar, legend, roll, total, cats) {
  const parts = Object.entries(roll).filter(([, r]) => r.s > 0).sort((a, b) => b[1].s - a[1].s);
  bar.hidden = legend.hidden = !parts.length;
  const pct = s => Math.round(s / total * 100);
  bar.setAttribute("role", "img");
  bar.setAttribute("aria-label", "Today by category: " + parts.map(([c, r]) => `${c} ${pct(r.s)}%`).join(", "));
  patch(bar, parts.map(([c, r]) => `<i style="inline-size:${(r.s / total * 100).toFixed(2)}%;background:${colorFor(c, cats)}"></i>`).join(""));
  patch(legend, parts.slice(0, 4).map(([c, r]) =>
    `<span><i class="dot" style="background:${colorFor(c, cats)}"></i>${esc(c)} ${pct(r.s)}%</span>`).join(""));
}

/* drift state from stored trail: { drifts, ongoing, streak } */
function driftState(trail, cats) {
  return findDrifts(trailEntries(trail), cats);
}

/* The "now" row: site, live timers, category toggle. Returns the 1s ticker's snapshot.
   Timer digits are written by the ticker, so they're left out of the patched string. */
function renderNow(box, tab, live, day, cats) {
  const domain = tab ? domainOf(tab.url) : null;
  if (!domain) {
    patch(box, `<p class="now-empty">This tab isn't a website, so it isn't tracked.</p>`);
    return { tracking: false };
  }
  const tracking = !!(live && live.tracking && live.domain === domain);
  const visit = tracking ? live.visitMs / 1000 : 0;
  const site = (day.domains[domain] || { s: 0 }).s;
  patch(box, `<div class="now"><img src="${favicon(domain)}" alt="">
     <div class="now-main"><b class="dom">${esc(domain)}</b>
       <span class="meta">${tracking
         ? `<span class="rec" aria-hidden="true"></span><span class="visitT"></span> this visit · <span class="siteT"></span> today`
         : `Paused — ${esc((live && live.why) || "waiting for activity")} · <span class="siteT"></span> today`}</span></div>
     ${catToggleHTML("now", domain, catFor(domain, cats), cats)}</div>`);
  const v = box.querySelector(".visitT"), s = box.querySelector(".siteT");
  if (v) v.textContent = clock(visit);
  if (s) s.textContent = fmt(site);
  return { tracking, visit, site };
}

/* Moves the live timers every second between refreshes (text only, no layout work). */
function startTicker(getBase, totalEl) {
  setInterval(() => {
    const b = getBase();
    if (!b || !b.tracking || document.hidden) return;
    const d = (Date.now() - b.at) / 1000;
    totalEl.textContent = fmt(b.total + d);
    const v = document.querySelector(".visitT"), s = document.querySelector(".siteT");
    if (v) v.textContent = clock(b.visit + d);
    if (s) s.textContent = fmt(b.site + d);
  }, 1000);
}

/* ---------- drift (side panel) ---------- */
const isoTime = ms => new Date(ms).toISOString();
/* Today's path: one strip from the first site of the day to now, shaded by category.
   Positions are rounded so the string (and the DOM) only changes when the picture does. */
function renderPath(strip, labels, trail, cats, now = Date.now()) {
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  const segs = trailSegments(trailEntries(trail, now), now)
    .filter(s => s.end > midnight.getTime())
    .map(s => ({ ...s, start: Math.max(s.start, midnight.getTime()) }));
  strip.hidden = labels.hidden = !segs.length;
  if (!segs.length) return;
  const t0 = segs[0].start, span = Math.max(now - t0, 1);
  strip.setAttribute("role", "img");
  strip.setAttribute("aria-label",
    `Today's path from ${timeOf(t0)} to now, across ${plural(new Set(segs.map(s => s.d)).size, "site")}`);
  patch(strip, segs.map(s =>
    `<i style="inset-inline-start:${((s.start - t0) / span * 100).toFixed(1)}%;inline-size:${Math.max(0.4, (s.end - s.start) / span * 100).toFixed(1)}%;background:${colorFor(catFor(s.d, cats), cats)}" title="${esc(s.d)}"></i>`).join(""));
  patch(labels, `<time datetime="${isoTime(t0)}">${timeOf(t0)}</time><span>now</span>`);
}
/* summary line + vertical timeline of today's drifts (<ol> + <time>) */
function renderDriftList(sum, list, more, drifts, now = Date.now()) {
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  const today = drifts.filter(d => d.end > midnight.getTime());
  more.hidden = !today.length;
  if (!today.length) {
    patch(sum, `No drifts today. <span class="meta">You drift when you leave Work or Learning for 5+ minutes.</span>`);
    return;
  }
  const total = today.reduce((a, d) => a + d.secs, 0);
  const last = today[today.length - 1];
  patch(sum, `${plural(today.length, "drift")}, ${fmt(total)} off track. ` +
    `<span class="meta">Latest: ${last.from ? `left ${esc(last.from)} ` : ""}at <time datetime="${isoTime(last.leftAt)}">${timeOf(last.leftAt)}</time>` +
    `${last.ongoing ? ", still going" : ""}.</span>`);
  patch(list, today.slice().reverse().map(d => {
    const chain = [d.from, ...d.sites].filter(Boolean).map(esc).join(" → ");
    const status = d.ongoing ? "still going" : d.returned ? `back to ${esc(d.backTo)}` : "didn't return";
    return `<li><time datetime="${isoTime(d.leftAt)}">${timeOf(d.leftAt)}</time>
       <span class="dt-chain">${chain}</span><span class="meta">${fmt(d.secs)} · ${status}</span></li>`;
  }).join(""));
}

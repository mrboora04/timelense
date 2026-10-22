/* Shared UI for popup + side panel: category colors, category picker, the "now" row,
   charts (each with a text alternative), drift timeline. Needs lib.js loaded first. */
const CHART_COLORS = 6;   // --chart-color-1..6 in styles.css (Wong palette, colorblind-safe)
const $ = id => document.getElementById(id);

/* category colour as a design token, never a raw hex */
function colorFor(cat, cats) {
  if (resolveCat("Other", cats) === cat) return "var(--chart-color-other)";
  const i = cats.list.filter(c => c !== resolveCat("Other", cats)).indexOf(cat);
  return i < 0 ? "var(--chart-color-other)" : `var(--chart-color-${(i % CHART_COLORS) + 1})`;
}
function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  return tab || null;
}

/* time per category for a day's entries: { cat: { s, sites: [[domain, entry]] } } */
function rollup(entries, cats) {
  const roll = {};
  cats.list.forEach(c => roll[c] = { s: 0, sites: [] });
  for (const [dom, e] of entries) {
    const c = catFor(dom, cats);
    if (!roll[c]) roll[c] = { s: 0, sites: [] };
    roll[c].s += e.s; roll[c].sites.push([dom, e]);
  }
  return roll;
}

async function setSiteCat(domain, cat) {
  const map = (await chrome.storage.local.get("catMap")).catMap || {};
  map[domain] = cat;
  await chrome.storage.local.set({ catMap: map });
}
/* one button per category; the current one is pressed */
function catPicker(domain, current, cats) {
  const wrap = el("div", "chips");
  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", `Category for ${domain}`);
  cats.list.forEach(c => {
    const b = el("button", "chip");
    b.textContent = c;
    b.dataset.k = `chip:${domain}:${c}`;
    b.setAttribute("aria-pressed", String(c === current));
    b.style.setProperty("--chip-color", colorFor(c, cats));
    b.onclick = () => setSiteCat(domain, c);
    wrap.appendChild(b);
  });
  return wrap;
}
/* "Work ▾" button that opens the category choices; open state survives re-renders */
const openPickers = new Set();
function catToggle(key, domain, cat, cats) {
  const btn = el("button", "choice", `<i class="dot" style="background:${colorFor(cat, cats)}"></i>${esc(cat)}`);
  btn.dataset.k = `toggle:${key}`;
  const picker = catPicker(domain, cat, cats);
  const sync = () => {
    picker.hidden = !openPickers.has(key);
    btn.setAttribute("aria-expanded", String(!picker.hidden));
  };
  btn.onclick = () => { openPickers.has(key) ? openPickers.delete(key) : openPickers.add(key); sync(); };
  sync();
  return [btn, picker];
}

/* category share as a stacked bar (visualizing-data: part-to-whole) + text legend */
function renderStack(bar, legend, roll, total, cats) {
  bar.innerHTML = ""; legend.innerHTML = "";
  const parts = Object.entries(roll).filter(([, r]) => r.s > 0).sort((a, b) => b[1].s - a[1].s);
  bar.hidden = legend.hidden = !parts.length;
  const pct = s => Math.round(s / total * 100);
  bar.setAttribute("role", "img");
  bar.setAttribute("aria-label", "Today by category: " + parts.map(([c, r]) => `${c} ${pct(r.s)}%`).join(", "));
  parts.forEach(([cat, r]) => {
    const seg = el("i");
    seg.style.inlineSize = (r.s / total * 100) + "%";
    seg.style.background = colorFor(cat, cats);
    bar.appendChild(seg);
  });
  legend.innerHTML = parts.slice(0, 4)
    .map(([c, r]) => `<span><i class="dot" style="background:${colorFor(c, cats)}"></i>${esc(c)} ${pct(r.s)}%</span>`).join("");
}

/* drift state from stored trail: { drifts, ongoing, streak } */
function driftState(trail, cats) {
  return findDrifts(trailEntries(trail), cats);
}

/* The "now" row: site, live timers, category toggle. Returns the 1s ticker's snapshot. */
function renderNow(box, tab, live, day, cats) {
  box.innerHTML = "";
  const domain = tab ? domainOf(tab.url) : null;
  if (!domain) {
    box.appendChild(el("p", "now-empty", "This tab isn't a website, so it isn't tracked."));
    return { tracking: false };
  }
  const tracking = !!(live && live.tracking && live.domain === domain);
  const visit = tracking ? live.visitMs / 1000 : 0;
  const site = (day.domains[domain] || { s: 0 }).s;
  const row = el("div", "now",
    `<img src="${favicon(domain)}" alt="">
     <div class="now-main">
       <b class="dom">${esc(domain)}</b>
       <span class="meta">${tracking
         ? `<span class="rec" aria-hidden="true"></span><span class="visitT">${clock(visit)}</span> this visit · <span class="siteT">${fmt(site)}</span> today`
         : `Paused — no activity · ${fmt(site)} today`}</span>
     </div>`);
  const [btn, picker] = catToggle("now", domain, catFor(domain, cats), cats);
  row.appendChild(btn);
  box.append(row, picker);
  return { tracking, visit, site };
}

/* Moves the live timers every second between full refreshes. */
function startTicker(getBase, totalEl) {
  setInterval(() => {
    const b = getBase();
    if (!b || !b.tracking) return;
    const d = (Date.now() - b.at) / 1000;
    totalEl.textContent = fmt(b.total + d);
    const v = document.querySelector(".visitT"), s = document.querySelector(".siteT");
    if (v) v.textContent = clock(b.visit + d);
    if (s) s.textContent = fmt(b.site + d);
  }, 1000);
}

/* ---------- drift (side panel) ---------- */
const isoTime = ms => new Date(ms).toISOString();
/* Today's path: one strip from the first site of the day to now, coloured by category. */
function renderPath(strip, labels, trail, cats, now = Date.now()) {
  strip.innerHTML = ""; labels.innerHTML = "";
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
  for (const s of segs) {
    const seg = el("i");
    seg.style.insetInlineStart = ((s.start - t0) / span * 100) + "%";
    seg.style.inlineSize = Math.max(0.4, (s.end - s.start) / span * 100) + "%";
    seg.style.background = colorFor(catFor(s.d, cats), cats);
    seg.title = `${s.d} · ${timeOf(s.start)}–${timeOf(s.end)}`;
    strip.appendChild(seg);
  }
  labels.innerHTML = `<time datetime="${isoTime(t0)}">${timeOf(t0)}</time><span>now</span>`;
}
/* summary line + vertical timeline of today's drifts (displaying-timelines: <ol> + <time>) */
function renderDriftList(sum, list, more, drifts, now = Date.now()) {
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  const today = drifts.filter(d => d.end > midnight.getTime());
  list.innerHTML = "";
  more.hidden = !today.length;
  if (!today.length) {
    sum.innerHTML = `No drifts today. <span class="meta">You drift when you leave Work or Learning for 5+ minutes.</span>`;
    return;
  }
  const total = today.reduce((a, d) => a + d.secs, 0);
  const last = today[today.length - 1];
  sum.innerHTML = `${plural(today.length, "drift")}, ${fmt(total)} off track. ` +
    `<span class="meta">Latest: ${last.from ? `left ${esc(last.from)} ` : ""}at <time datetime="${isoTime(last.leftAt)}">${timeOf(last.leftAt)}</time>` +
    `${last.ongoing ? ", still going" : ""}.</span>`;
  today.slice().reverse().forEach(d => {
    const chain = [d.from, ...d.sites].filter(Boolean).map(esc).join(" → ");
    const status = d.ongoing ? "still going" : d.returned ? `back to ${esc(d.backTo)}` : "didn't return";
    list.appendChild(el("li", "dt" + (d.ongoing ? " live" : ""),
      `<time datetime="${isoTime(d.leftAt)}">${timeOf(d.leftAt)}</time>
       <span class="dt-chain">${chain}</span>
       <span class="meta">${fmt(d.secs)} · ${status}</span>`));
  });
}

/* 7-day sparkline (visualizing-data: compact trend) with a text alternative */
function sparkline(values, keys) {
  const w = 84, h = 24, max = Math.max(...values, 1);
  const pts = values.map((v, i) => [i / (values.length - 1) * (w - 4) + 2, h - 3 - v / max * (h - 6)]);
  const [lx, ly] = pts[pts.length - 1];
  const label = "Last 7 days: " + keys.map((k, i) =>
    `${new Date(k + "T12:00").toLocaleDateString(undefined, { weekday: "short" })} ${fmt(values[i])}`).join(", ");
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">
    <polyline points="${pts.map(p => p.join(",")).join(" ")}"/><circle cx="${lx}" cy="${ly}" r="2.5"/></svg>`;
}

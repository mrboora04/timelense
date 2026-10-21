/* Shared UI for popup + side panel: colors, category picker, live "Now" card, category bar,
   Lens the mascot, drift timeline. Needs lib.js loaded first. */
const PALETTE = ["#38bdf8","#a78bfa","#f472b6","#fbbf24","#34d399","#fb7185","#f97316","#94a3b8"];
const FALLBACK_COLOR = "#94a3b8";
const $ = id => document.getElementById(id);

function colorFor(cat, cats) {
  const i = cats.list.indexOf(cat);
  return i < 0 ? FALLBACK_COLOR : PALETTE[i % PALETTE.length];
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
/* one big button per category; the current one is filled */
function catPicker(domain, current, cats) {
  const wrap = el("div", "chips");
  cats.list.forEach(c => {
    const b = el("button", "chip" + (c === current ? " on" : ""));
    b.textContent = c;
    b.dataset.k = `chip:${domain}:${c}`;
    b.setAttribute("aria-pressed", String(c === current));
    b.style.setProperty("--c", colorFor(c, cats));
    b.onclick = () => setSiteCat(domain, c);
    wrap.appendChild(b);
  });
  return wrap;
}

/* stacked bar + legend of today's categories */
function renderStack(bar, legend, roll, total, cats) {
  bar.innerHTML = ""; legend.innerHTML = "";
  const parts = Object.entries(roll).filter(([, r]) => r.s > 0).sort((a, b) => b[1].s - a[1].s);
  bar.hidden = legend.hidden = !parts.length;
  parts.forEach(([cat, r]) => {
    const seg = el("i");
    seg.style.width = (r.s / total * 100) + "%";
    seg.style.background = colorFor(cat, cats);
    seg.title = `${cat} · ${fmt(r.s)}`;
    bar.appendChild(seg);
    legend.appendChild(el("span", null,
      `<i style="background:${colorFor(cat, cats)}"></i>${esc(cat)} <b>${Math.round(r.s / total * 100)}%</b>`));
  });
}

/* drift state from stored trail: { drifts, ongoing, streak } */
function driftState(trail, cats) {
  return findDrifts(trailEntries(trail), cats);
}

/* Live "Now" card. Returns what the 1s ticker needs to keep the timers moving.
   compact (popup): category buttons stay folded behind one "Work ▾" button.
   drift: the ongoing drift, shown as a warning with where you started. */
let nowPickerOpen = false;
function renderNow(box, tab, live, day, cats, { compact = false, drift = null } = {}) {
  box.innerHTML = "";
  const domain = tab ? domainOf(tab.url) : null;
  if (!domain) {
    box.appendChild(el("div", "card now",
      `<div class="lbl">Now</div><div class="muted">This tab isn't a website, so it isn't tracked.</div>`));
    return { tracking: false };
  }
  const tracking = !!(live && live.tracking && live.domain === domain);
  const visit = tracking ? live.visitMs / 1000 : 0;
  const site = (day.domains[domain] || { s: 0 }).s;
  const cat = catFor(domain, cats);
  const warn = drift
    ? `<div class="driftwarn" role="status">${drift.from
        ? `Drifting <b>${fmt(drift.secs)}</b> · you left <b>${esc(drift.from)}</b> at ${timeOf(drift.leftAt)}`
        : `Scrolling <b>${fmt(drift.secs)}</b> without a break`}</div>`
    : "";
  const card = el("div", "card now" + (drift ? " drifting" : ""),
    `<div class="lbl">${tracking ? '<i class="rec"></i>Tracking now' : "Paused · no activity"}</div>
     <div class="nowsite"><img src="${favicon(domain)}" alt=""><b>${esc(domain)}</b></div>
     ${warn}
     <div class="nowstats">
       <div><b class="visitT">${clock(visit)}</b><span>this visit</span></div>
       <div><b class="siteT">${fmt(site)}</b><span>today on this site</span></div>
     </div>
     <div class="catline"><span class="muted">Category for this site</span></div>`);
  const picker = catPicker(domain, cat, cats);
  if (compact) {
    const pill = el("button", "pill", `${esc(cat)} ▾`);
    pill.dataset.k = "nowpill";
    pill.setAttribute("aria-expanded", String(nowPickerOpen));
    pill.style.setProperty("--c", colorFor(cat, cats));
    pill.onclick = () => {
      nowPickerOpen = !nowPickerOpen;
      picker.hidden = !nowPickerOpen;
      pill.setAttribute("aria-expanded", String(nowPickerOpen));
    };
    picker.hidden = !nowPickerOpen;
    card.querySelector(".catline").appendChild(pill);
  }
  card.appendChild(picker);
  box.appendChild(card);
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

/* ---------- Lens, the mascot ----------
   Built from separate SVG parts (body, eyes, mouth, extras) so CSS can animate each one
   with transforms around its own centre: bob, blink, tilt. Faces per mood below. */
const LENS_FACES = {
  happy:   { eyes: "dots", mouth: "M22 33 Q28 38 34 33" },
  wave:    { eyes: "dots", mouth: "M22 33 Q28 38 34 33", extra: "spark" },
  proud:   { eyes: "arcs", mouth: "M21 32 Q28 40 35 32" },
  curious: { eyes: "curious", mouth: "o" },
  worried: { eyes: "dots", brows: true, mouth: "M22 36 Q25 33 28 36 Q31 39 34 36", extra: "drop" },
  sleep:   { eyes: "closed", mouth: "M26 34 L30 34", extra: "zzz" },
};
function lensSVG(mood) {
  const f = LENS_FACES[mood] || LENS_FACES.happy;
  const eyes = {
    dots: `<circle class="lm-eye" cx="22" cy="26" r="2.6"/><circle class="lm-eye" cx="34" cy="26" r="2.6"/>`,
    curious: `<circle class="lm-eye" cx="22" cy="26.5" r="2.4"/><circle class="lm-eye" cx="34" cy="25" r="3.4"/>`,
    arcs: `<path class="lm-line" d="M19.5 27 Q22 23.5 24.5 27"/><path class="lm-line" d="M31.5 27 Q34 23.5 36.5 27"/>`,
    closed: `<path class="lm-line" d="M19.5 26 Q22 28.5 24.5 26"/><path class="lm-line" d="M31.5 26 Q34 28.5 36.5 26"/>`,
  }[f.eyes];
  const brows = f.brows ? `<path class="lm-line" d="M19 21 L25 22.5"/><path class="lm-line" d="M37 21 L31 22.5"/>` : "";
  const mouth = f.mouth === "o" ? `<circle class="lm-line" cx="30" cy="35" r="2"/>` : `<path class="lm-line" d="${f.mouth}"/>`;
  const extra = {
    spark: `<path class="lm-spark" d="M52 6 L54 11 L59 13 L54 15 L52 20 L50 15 L45 13 L50 11 Z"/>`,
    drop: `<path class="lm-drop" d="M47 12 Q50 17 47 19 Q44 17 47 12 Z"/>`,
    zzz: `<text class="lm-z" x="46" y="14">z</text><text class="lm-z lm-z2" x="52" y="8">z</text>`,
  }[f.extra] || "";
  return `<svg class="lens mood-${mood}" viewBox="0 0 64 64" aria-hidden="true">
    <defs><linearGradient id="lensGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#38bdf8"/><stop offset="1" stop-color="#818cf8"/></linearGradient></defs>
    <g class="lm-body">
      <line x1="45" y1="45" x2="57" y2="57" stroke="url(#lensGrad)" stroke-width="7" stroke-linecap="round"/>
      <circle cx="28" cy="28" r="22" fill="url(#lensGrad)"/>
      <circle cx="28" cy="28" r="16.5" fill="#0b1220"/>
      <circle cx="20.5" cy="19.5" r="3" fill="#fff" opacity=".25"/>
      <g class="lm-face">${eyes}${brows}${mouth}</g>
    </g>${extra}
  </svg>`;
}
/* Keeps the same SVG while the mood holds (so animations don't restart every refresh). */
function renderMascot(box, { mood, text }) {
  if (box.dataset.mood !== mood) {
    box.innerHTML = `${lensSVG(mood)}<p class="bubble" role="status" aria-live="polite"></p>`;
    box.dataset.mood = mood;
  }
  const b = box.querySelector(".bubble");
  if (b.textContent !== text) b.textContent = text;
}

/* ---------- drift timeline (side panel) ---------- */
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
  for (const s of segs) {
    const seg = el("i");
    seg.style.insetInlineStart = ((s.start - t0) / span * 100) + "%";
    seg.style.width = Math.max(0.4, (s.end - s.start) / span * 100) + "%";
    seg.style.background = colorFor(catFor(s.d, cats), cats);
    seg.title = `${s.d} · ${timeOf(s.start)}–${timeOf(s.end)}`;
    strip.appendChild(seg);
  }
  labels.innerHTML = `<span>${timeOf(t0)}</span><span>now</span>`;
}
function renderDriftList(sum, list, drifts, now = Date.now()) {
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  const today = drifts.filter(d => d.end > midnight.getTime());
  list.innerHTML = "";
  if (!today.length) {
    sum.innerHTML = `No drifts today. A drift is leaving Work or Learning for Social, Entertainment, News or Shopping for 5+ minutes.`;
    return;
  }
  const total = today.reduce((a, d) => a + d.secs, 0);
  const longest = today.reduce((a, d) => (d.secs > a.secs ? d : a));
  sum.innerHTML = `<b>${plural(today.length, "drift")}</b> · ${fmt(total)} off track · longest ${fmt(longest.secs)}` +
    (longest.from ? ` from ${esc(longest.from)} at ${timeOf(longest.leftAt)}` : "");
  today.slice().reverse().slice(0, 8).forEach(d => {
    const chain = [d.from, ...d.sites].filter(Boolean)
      .map((s, i) => `<span class="hop${i === 0 && d.from ? " from" : ""}"><img src="${favicon(s)}" alt="">${esc(s)}</span>`)
      .join(`<span class="arrow" aria-hidden="true">→</span>`);
    const status = d.ongoing ? `<span class="tag now">happening now</span>`
      : d.returned ? `<span class="tag back">back to ${esc(d.backTo)}</span>`
      : `<span class="tag lost">didn't return</span>`;
    list.appendChild(el("li", "dt" + (d.ongoing ? " live" : ""),
      `<span class="dt-dot" aria-hidden="true"></span>
       <div class="dt-time">${timeOf(d.leftAt)}</div>
       <div class="dt-chain">${chain}</div>
       <div class="dt-meta">${fmt(d.secs)} ${status}</div>`));
  });
}

/* 7-day sparkline for the KPI card */
function sparkline(values) {
  const w = 84, h = 26, max = Math.max(...values, 1);
  const pts = values.map((v, i) => [i / (values.length - 1) * (w - 4) + 2, h - 3 - v / max * (h - 6)]);
  const [lx, ly] = pts[pts.length - 1];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <polyline points="${pts.map(p => p.join(",")).join(" ")}"/>
    <circle cx="${lx}" cy="${ly}" r="2.5"/></svg>`;
}

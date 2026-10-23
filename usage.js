/* Usage — the phone-style day/week view at the bottom of the side panel, a modern take on
   iPhone Screen Time and Android Digital Wellbeing.
   - Day / Week, ‹ › through the last 30 days; a one-line summary instead of another big number
   - columns stacked focus / distracting / other (the dataviz-validated tones), scaled to the
     busiest column, an average line in Week, a tooltip on hover and focus; hovering one
     column dims the rest
   - Most used sites; a site opens its own detail (daily average, 7 days, visits, the hour
     it's usually used)
   - comparisons only when they're fair: today vs other days *by this time*, and weeks only
     when the earlier week was mostly tracked
   Needs lib.js and ui.js. */
const usage = { range: "day", offset: 0, showAll: false, open: null, v: null, cats: null };

const DAY_MS = 864e5;
const keyToDate = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
const shortDay = k => keyToDate(k).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
function dayTitle(k) {
  if (k === dayKey()) return "Today";
  const y = new Date(); y.setDate(y.getDate() - 1);
  return k === dayKey(y) ? "Yesterday" : shortDay(k);
}
function shiftDay(k, n) { const d = keyToDate(k); d.setDate(d.getDate() + n); return dayKey(d); }
/* Monday-start week containing day key k */
function weekKeys(k) {
  const d = keyToDate(k), back = (d.getDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => shiftDay(k, i - back));
}
const hourName = h => new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: "numeric" });
const mean = xs => xs.reduce((a, x) => a + x, 0) / xs.length;

/* seconds by kind for a set of site entries */
function byKind(entries, cats) {
  const out = { focus: 0, distract: 0, neutral: 0 };
  for (const [d, e] of entries) out[siteKind(d, cats)] += typeof e === "number" ? e : e.s;
  return out;
}
/* per hour, by kind, from the per-site-per-hour map (recorded from v1.7 on); null for older days */
function hoursByKind(day, cats) {
  if (!day.dh) return null;
  const hours = Array.from({ length: 24 }, () => ({ focus: 0, distract: 0, neutral: 0 }));
  for (const [d, hh] of Object.entries(day.dh)) {
    const k = siteKind(d, cats);
    for (const [h, s] of Object.entries(hh)) hours[h][k] += s;
  }
  return hours;
}
function siteTotals(v, keys) {
  const out = {};
  for (const k of keys) {
    for (const [d, e] of Object.entries((v[k] || {}).domains || {})) {
      const r = out[d] || (out[d] = { s: 0, v: 0 });
      r.s += e.s; r.v += e.v;
    }
  }
  return Object.entries(out).sort((a, b) => b[1].s - a[1].s);
}
/* your usual time on other tracked days, by this time of day for today; null below 3 days */
function usual(v, k) {
  const others = Object.keys(v).filter(x => x !== k && daySeconds(v[x]) > 0);
  if (others.length < 3) return null;
  if (k !== dayKey()) return mean(others.map(x => daySeconds(v[x])));
  const n = new Date(), h = n.getHours(), frac = n.getMinutes() / 60;
  return mean(others.map(x => v[x].hours.slice(0, h).reduce((a, s) => a + s, 0) + v[x].hours[h] * frac));
}

/* ---------- chart ---------- */
const SCALE = [300, 600, 900, 1200, 1800, 2700, 3600, 5400, 7200, 10800, 14400, 21600, 28800, 43200];
const niceMax = m => SCALE.find(s => s >= m) || Math.ceil(m / 3600) * 3600;

/* cols: [{ total, parts: {focus, distract, neutral} | null, tip, label, day? }] */
function plotHTML(cols, { avg = 0 } = {}) {
  const max = niceMax(Math.max(...cols.map(c => c.total), avg, 60));
  const pct = s => (s / max * 100).toFixed(2);
  const bars = cols.map((c, i) => {
    const segs = !c.total ? "" : c.parts
      ? ["neutral", "distract", "focus"].filter(k => c.parts[k] > 0)
          .map(k => `<i class="seg is-${k}" style="flex-grow:${c.parts[k]}"></i>`).join("")
      : `<i class="seg is-all" style="flex-grow:1"></i>`;
    const stack = `<span class="colstack" style="block-size:${c.total ? Math.max(1.5, +pct(c.total)) : 0}%;--i:${i}">${segs}</span>`;
    const attrs = `class="col" data-tip="${esc(c.tip)}" aria-label="${esc(c.tip)}"`;
    return c.day ? `<button ${attrs} data-day="${c.day}">${stack}</button>` : `<span ${attrs} tabindex="0">${stack}</span>`;
  }).join("");
  const line = avg ? `<span class="avg" style="inset-block-end:${pct(avg)}%"><b>avg</b></span>` : "";
  /* .plot keeps a strip at the top for the tooltip, so it never covers the text above */
  return `<div class="plot"><div class="plot-area">
      <div class="cols${cols.length > 7 ? " is-dense" : ""}">${bars}</div>${line}</div></div>
    <div class="col-labels" aria-hidden="true">${cols.map(c => `<span>${c.label}</span>`).join("")}</div>`;
}
function partsTip(p) {
  return p ? " — " + KINDS.filter(([k]) => p[k] >= 60).map(([k, name]) => `${name} ${fmt(p[k])}`).join(" · ") : "";
}
function legendHTML(p) {
  return `<p class="legend">${KINDS.map(([k, name]) =>
    `<span><i class="key" style="background:${toneFor(k)}"></i>${name} ${fmt(p[k])}</span>`).join("")}</p>`;
}

/* ---------- most used ---------- */
function siteDetailHTML(domain) {
  const { v } = usage, days = Array.from({ length: 7 }, (_, i) => shiftDay(dayKey(), i - 6));
  const vals = days.map(k => ((v[k] || {}).domains || {})[domain]?.s || 0);
  const visits = days.reduce((a, k) => a + (((v[k] || {}).domains || {})[domain]?.v || 0), 0);
  const active = vals.filter(s => s > 0).length;
  const hourTotals = Array(24).fill(0);
  for (const k of days) for (const [h, s] of Object.entries(((v[k] || {}).dh || {})[domain] || {})) hourTotals[h] += s;
  const peak = Math.max(...hourTotals);
  const kind = siteKind(domain, usage.cats);
  const cols = days.map((k, i) => ({ total: vals[i], parts: { focus: 0, distract: 0, neutral: 0, [kind]: vals[i] },
    tip: `${shortDay(k)} · ${fmt(vals[i])}`, label: keyToDate(k).toLocaleDateString(undefined, { weekday: "narrow" }) }));
  return `<div class="detail-inner">
      <p class="meta"><b>${fmt(active ? vals.reduce((a, s) => a + s, 0) / 7 : 0)}</b> a day over the last 7 days ·
        ${plural(visits, "visit")}${peak ? ` · usually around ${hourName(hourTotals.indexOf(peak))}` : ""}</p>
      <div class="chart is-mini">${plotHTML(cols)}</div></div>`;
}
function mostUsedHTML(keys) {
  const { v, cats } = usage;
  const head = `<h3 class="eyebrow">Most used</h3>`;
  const rows = siteTotals(v, keys);
  if (!rows.length) return head + `<p class="meta">Nothing tracked yet — sites show up here as you browse.</p>`;
  const shown = usage.showAll ? rows : rows.slice(0, 6), max = rows[0][1].s || 1;
  return head + `<ul class="rows">${shown.map(([d, e]) => {
    const open = usage.open === d;
    return `<li><button class="row usage-row" data-site="${esc(d)}" aria-expanded="${open}">
        <img src="${favicon(d)}" alt=""><span class="row-main">${esc(d)}
          <span class="meter"><i style="inline-size:${(e.s / max * 100).toFixed(1)}%;background:${toneFor(siteKind(d, cats))}"></i></span></span>
        <span class="meta">${fmt(e.s)}<small>${plural(e.v, "visit")}</small></span></button>
      <div class="detail${open ? " is-open" : ""}">${open ? siteDetailHTML(d) : `<div class="detail-inner"></div>`}</div></li>`;
  }).join("")}</ul>
    ${rows.length > 6 ? `<button class="quiet" data-usage="all">${usage.showAll ? "Show fewer" : `Show all ${rows.length}`}</button>` : ""}`;
}

/* ---------- render ---------- */
function renderUsage(v, cats) {
  usage.v = v; usage.cats = cats;
  const today = dayKey();
  const earliest = Object.keys(v).sort()[0] || today;
  let title, body, prevOk, nextOk;

  if (usage.range === "day") {
    const k = shiftDay(today, -usage.offset), day = v[k] || blankDay();
    const total = daySeconds(day), parts = byKind(Object.entries(day.domains), cats);
    const hk = hoursByKind(day, cats), base = usual(v, k);
    const visits = Object.values(day.domains).reduce((a, e) => a + e.v, 0);
    const diff = base === null || !total ? null : total - base;
    const facts = [
      diff !== null && Math.abs(diff) >= 60 ? `${fmt(Math.abs(diff))} ${diff > 0 ? "more" : "less"} than usual${k === today ? " by now" : ""}` : "",
      day.first ? `first visit ${timeOf(day.first)}` : "", visits ? plural(visits, "visit") : "",
    ].filter(Boolean).join(" · ");
    title = dayTitle(k);
    prevOk = k > earliest; nextOk = usage.offset > 0;
    body = !total ? `<p class="lede">Nothing tracked ${k === today ? "yet today" : `on ${shortDay(k)}`}.</p>`
      : `<p class="lede"><strong>${fmt(total)}</strong> ${k === today ? "today" : `on ${shortDay(k)}`},
           ${Math.round(parts.focus / total * 100)}% of it focus.</p>
         ${facts ? `<p class="meta">${facts}</p>` : ""}
         <div class="chart">${plotHTML(day.hours.map((s, h) => ({ total: s, parts: hk && hk[h],
           tip: `${hourName(h)} · ${fmt(s)}${partsTip(hk && hk[h])}`, label: h % 6 === 0 ? hourName(h) : "" })))}</div>
         ${legendHTML(parts)}${hk ? "" : `<p class="meta hint">Hour-by-hour colours start from v1.7.</p>`}
         ${mostUsedHTML([k])}`;
  } else {
    const keys = weekKeys(shiftDay(today, -7 * usage.offset)), past = keys.filter(k => k <= today);
    const cols = keys.map(k => {
      const day = v[k];
      const parts = day ? byKind(Object.entries(day.domains), cats) : null, total = k > today ? 0 : daySeconds(day);
      return { total, parts, day: k <= today && total ? k : null,
        tip: `${shortDay(k)} · ${k > today ? "not yet" : fmt(total)}${partsTip(parts)}`,
        label: keyToDate(k).toLocaleDateString(undefined, { weekday: "narrow" }) };
    });
    const total = cols.reduce((a, c) => a + c.total, 0), avg = total / Math.max(past.length, 1);
    const prev = keys.map(k => shiftDay(k, -7)), prevDays = prev.filter(k => daySeconds(v[k]) > 0).length;
    const prevAvg = prev.reduce((a, k) => a + daySeconds(v[k]), 0) / 7;
    const change = prevDays >= 5 && prevAvg ? Math.round((avg - prevAvg) / prevAvg * 100) : null;
    const parts = byKind(siteTotals(v, past), cats);
    title = usage.offset === 0 ? "This week" : usage.offset === 1 ? "Last week" : `${shortDay(keys[0])} – ${shortDay(keys[6])}`;
    prevOk = keys[0] > earliest; nextOk = usage.offset > 0;
    body = !total ? `<p class="lede">Nothing tracked this week yet.</p>`
      : `<p class="lede"><strong>${fmt(avg)}</strong> a day on average, ${Math.round(parts.focus / total * 100)}% of it focus.</p>
         <p class="meta">${[change !== null ? `${change >= 0 ? "↑" : "↓"} ${Math.abs(change)}% from the week before` : "",
                            `${fmt(total)} in total`].filter(Boolean).join(" · ")}</p>
         <div class="chart">${plotHTML(cols, { avg })}</div>${legendHTML(parts)}
         ${mostUsedHTML(past)}`;
  }

  $("uTitle").textContent = title;
  $("uPrev").disabled = !prevOk;
  $("uNext").disabled = !nextOk;
  for (const b of document.querySelectorAll("[data-range]")) b.setAttribute("aria-pressed", String(b.dataset.range === usage.range));
  patch($("usageBody"), body);
}

/* columns grow in once when you change what you're looking at (not on every refresh) */
function rerender() {
  $("uTip").hidden = true;
  const box = $("usageBody");
  box.classList.add("is-entering");
  renderUsage(usage.v, usage.cats);
  setTimeout(() => box.classList.remove("is-entering"), 700);
}
document.querySelector(".usage").addEventListener("click", e => {
  const t = e.target.closest("[data-range], #uPrev, #uNext, [data-day], [data-usage], [data-site]");
  if (!t || !usage.v) return;
  if (t.dataset.site) {   // open/close a site's detail in place (grid-rows transition)
    const d = t.dataset.site, li = t.parentElement, detail = li.querySelector(".detail");
    usage.open = usage.open === d ? null : d;
    for (const other of document.querySelectorAll(".usage .detail.is-open")) if (other !== detail) other.classList.remove("is-open");
    for (const b of document.querySelectorAll(".usage [data-site]")) b.setAttribute("aria-expanded", String(b.dataset.site === usage.open));
    if (usage.open) detail.innerHTML = siteDetailHTML(d);
    detail.classList.toggle("is-open", !!usage.open);
    return;
  }
  if (t.dataset.range) { usage.range = t.dataset.range; usage.offset = 0; usage.open = null; }
  else if (t.id === "uPrev") usage.offset++;
  else if (t.id === "uNext") usage.offset = Math.max(0, usage.offset - 1);
  else if (t.dataset.day) {
    usage.range = "day";
    usage.offset = Math.round((keyToDate(dayKey()) - keyToDate(t.dataset.day)) / DAY_MS);
  } else { usage.showAll = !usage.showAll; renderUsage(usage.v, usage.cats); return; }
  rerender();
});

/* one tooltip for every column, on hover and on keyboard focus; text only */
function showTip(target) {
  const tip = $("uTip");
  if (!target) { tip.hidden = true; return; }
  tip.textContent = target.dataset.tip;
  tip.hidden = false;
  const plot = target.closest(".plot").getBoundingClientRect(), r = target.getBoundingClientRect();
  const box = document.querySelector(".usage").getBoundingClientRect();
  tip.style.insetInlineStart = Math.min(Math.max(r.left + r.width / 2 - box.left - tip.offsetWidth / 2, 0), box.width - tip.offsetWidth) + "px";
  tip.style.insetBlockStart = (plot.top - box.top) + "px";   // in the plot's reserved top strip
}
const usageBox = document.querySelector(".usage");
usageBox.addEventListener("pointerover", e => showTip(e.target.closest("[data-tip]")));
usageBox.addEventListener("pointerleave", () => showTip(null));
usageBox.addEventListener("focusin", e => showTip(e.target.closest("[data-tip]")));
usageBox.addEventListener("focusout", () => showTip(null));

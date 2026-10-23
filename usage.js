/* Usage — the phone-style daily/weekly view at the bottom of the side panel, modeled on
   iPhone Screen Time (Day / Week switch, swipe through past days, daily average, most used,
   first pickup) and Android Digital Wellbeing (time per site per day, times opened).
   Charts follow the dataviz skill: one series in one tone (no legend needed, the title names
   it), columns <= 24px with 4px rounded tops and 2px gaps, a hairline average with a direct
   label, every column focusable with a tooltip, and the same numbers in the list below.
   Needs lib.js and ui.js. */
const usage = { range: "day", offset: 0, showAll: false, v: null };

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
/* average over days that have data, leaving out the ones in `except` */
function dailyAverage(v, except = []) {
  const ks = Object.keys(v).filter(k => !except.includes(k) && daySeconds(v[k]) > 0);
  return ks.length ? ks.reduce((a, k) => a + daySeconds(v[k]), 0) / ks.length : null;
}

/* column chart: one series; the hit target is the full column, bigger than the mark */
function columnsHTML(values, { labels, tips, keys, avg, max }) {
  const top = Math.max(max || 0, ...values, avg || 0, 1);
  const cols = values.map((s, i) => {
    const h = s ? Math.max(4, s / top * 100) : 0;
    const attrs = `data-tip="${esc(tips[i])}" aria-label="${esc(tips[i])}"`;
    const bar = `<i style="block-size:${h.toFixed(1)}%"></i>`;
    return keys ? `<button class="col" data-day="${keys[i]}" ${attrs}>${bar}</button>` : `<span class="col" ${attrs}>${bar}</span>`;
  }).join("");
  const line = avg ? `<span class="avg" style="inset-block-end:${(avg / top * 100).toFixed(1)}%"><span>avg ${fmt(avg)}</span></span>` : "";
  return `<div class="cols${keys ? " is-days" : ""}">${cols}${line}</div>
    <div class="col-labels">${labels.map(l => `<span>${l}</span>`).join("")}</div>`;
}

function mostUsedHTML(rows) {
  if (!rows.length) return `<p class="meta">Nothing tracked on this ${usage.range}.</p>`;
  const shown = usage.showAll ? rows : rows.slice(0, 6), max = rows[0][1].s || 1;
  return `<h3 class="eyebrow">Most used</h3><ul class="rows">${shown.map(([d, e]) =>
    `<li class="row usage-row"><img src="${favicon(d)}" alt=""><span class="row-main">${esc(d)}
       <span class="meter"><i style="inline-size:${(e.s / max * 100).toFixed(1)}%"></i></span></span>
       <span class="meta">${fmt(e.s)} · ${plural(e.v, "visit")}</span></li>`).join("")}</ul>
    ${rows.length > 6 ? `<button class="quiet" data-usage="all">${usage.showAll ? "Show fewer" : `Show all ${rows.length}`}</button>` : ""}`;
}

function renderUsage(v) {
  usage.v = v;
  const today = dayKey();
  const earliest = Object.keys(v).sort()[0] || today;
  let title, body, prevOk, nextOk;

  if (usage.range === "day") {
    const k = shiftDay(today, -usage.offset), day = v[k] || blankDay();
    const total = daySeconds(day), avg = dailyAverage(v, [k]);
    const visits = Object.values(day.domains).reduce((a, e) => a + e.v, 0);
    const busiest = day.hours.indexOf(Math.max(...day.hours));
    const facts = [
      avg !== null && total ? `${total >= avg ? "↑" : "↓"} ${fmt(Math.abs(total - avg))} ${total >= avg ? "above" : "below"} your daily average` : "",
      day.first ? `first visit ${timeOf(day.first)}` : "",
      visits ? plural(visits, "visit") : "",
    ].filter(Boolean).join(" · ");
    title = dayTitle(k);
    prevOk = k > earliest; nextOk = usage.offset > 0;
    body = `<p class="stat">${fmt(total)}</p><p class="meta">${facts || "Nothing tracked on this day."}</p>
      <div class="chart" role="group" aria-label="${esc(total ? `Time by hour, busiest ${busiest}:00` : "No time by hour")}">
        ${columnsHTML(day.hours, { labels: day.hours.map((_, h) => (h % 6 === 0 ? String(h) : "")),
                                   tips: day.hours.map((s, h) => `${h}:00–${h + 1}:00 · ${fmt(s)}`), max: 3600 })}</div>
      ${mostUsedHTML(siteTotals(v, [k]))}`;
  } else {
    const keys = weekKeys(shiftDay(today, -7 * usage.offset));
    const vals = keys.map(k => (k > today ? 0 : daySeconds(v[k])));
    const elapsed = keys.filter(k => k <= today).length;
    const total = vals.reduce((a, s) => a + s, 0), avg = total / Math.max(elapsed, 1);
    const prevKeys = keys.map(k => shiftDay(k, -7)), prevTotal = prevKeys.reduce((a, k) => a + daySeconds(v[k]), 0);
    const change = prevTotal ? Math.round((avg - prevTotal / 7) / (prevTotal / 7) * 100) : null;
    title = usage.offset === 0 ? "This week" : usage.offset === 1 ? "Last week"
      : `${shortDay(keys[0])} – ${shortDay(keys[6])}`;
    prevOk = keys[0] > earliest; nextOk = usage.offset > 0;
    body = `<p class="stat">${fmt(avg)} <span class="meta">daily average</span></p>
      <p class="meta">${[change !== null ? `${change >= 0 ? "↑" : "↓"} ${Math.abs(change)}% from the week before` : "",
                         `${fmt(total)} total`].filter(Boolean).join(" · ")}</p>
      <div class="chart">${columnsHTML(vals, {
        labels: keys.map(k => keyToDate(k).toLocaleDateString(undefined, { weekday: "narrow" })),
        tips: keys.map((k, i) => `${shortDay(k)} · ${k > today ? "not yet" : fmt(vals[i])}`),
        keys, avg: total ? avg : 0 })}</div>
      <p class="meta hint">Select a day to see it.</p>
      ${mostUsedHTML(siteTotals(v, keys.filter(k => k <= today)))}`;
  }

  $("uTitle").textContent = title;
  $("uPrev").disabled = !prevOk;
  $("uNext").disabled = !nextOk;
  for (const b of document.querySelectorAll("[data-range]")) b.setAttribute("aria-pressed", String(b.dataset.range === usage.range));
  patch($("usageBody"), body);
}

/* controls: Day/Week, ‹ ›, a week's column opens that day, Show all */
document.querySelector(".usage").addEventListener("click", e => {
  const t = e.target.closest("[data-range], #uPrev, #uNext, [data-day], [data-usage]");
  if (!t || !usage.v) return;
  if (t.dataset.range) { usage.range = t.dataset.range; usage.offset = 0; }
  else if (t.id === "uPrev") usage.offset++;
  else if (t.id === "uNext") usage.offset = Math.max(0, usage.offset - 1);
  else if (t.dataset.day) {
    usage.range = "day";
    usage.offset = Math.round((keyToDate(dayKey()) - keyToDate(t.dataset.day)) / DAY_MS);
  } else usage.showAll = !usage.showAll;
  $("uTip").hidden = true;
  renderUsage(usage.v);
});

/* one tooltip for every column: on hover and on keyboard focus, text only */
function showTip(target) {
  const tip = $("uTip");
  if (!target) { tip.hidden = true; return; }
  tip.textContent = target.dataset.tip;
  tip.hidden = false;
  const r = target.getBoundingClientRect(), box = document.querySelector(".usage").getBoundingClientRect();
  tip.style.insetInlineStart = Math.min(Math.max(r.left + r.width / 2 - box.left - tip.offsetWidth / 2, 0), box.width - tip.offsetWidth) + "px";
  tip.style.insetBlockStart = (r.top - box.top - tip.offsetHeight - 6) + "px";
}
document.querySelector(".usage").addEventListener("pointerover", e => showTip(e.target.closest("[data-tip]")));
document.querySelector(".usage").addEventListener("pointerleave", () => showTip(null));
document.querySelector(".usage").addEventListener("focusin", e => showTip(e.target.closest("[data-tip]")));
document.querySelector(".usage").addEventListener("focusout", () => showTip(null));

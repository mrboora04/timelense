/* TimeLens side-panel dashboard. Reads chrome.storage.local only. */
const HISTORY_TTL = 60 * 1000;
let liveBase = null;     // snapshot for the 1s live ticker

/* n day keys ending `skip` days ago, oldest first */
function lastNDays(n, skip = 0) {
  const out = [];
  for (let i = n - 1 + skip; i >= skip; i--) { const d = new Date(); d.setDate(d.getDate() - i); out.push(dayKey(d)); }
  return out;
}
function ago(ms) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + "m ago";
  const h = Math.round(m / 60);
  return h < 24 ? h + "h ago" : Math.round(h / 24) + "d ago";
}
const sumDays = (v, ks) => ks.reduce((a, k) => a + daySeconds(v[k]), 0);
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

async function render() {
  const store = await chrome.storage.local.get(["v1", "targets", "challenge", "trail", ...CAT_KEYS]);
  const v = store.v1 || {};
  const cats = catsFrom(store);
  const targets = store.targets || {};
  const [live, tab] = await Promise.all([getLive(), activeTab()]);
  const day = v[dayKey()] = addLive(v[dayKey()] || blankDay(), live);
  const entries = Object.entries(day.domains).sort((a, b) => b[1].s - a[1].s);
  const total = daySeconds(day);
  const visits = entries.reduce((a, [, e]) => a + e.v, 0);
  const roll = rollup(entries, cats);

  /* hero: the number first (creating-dashboards KPI: value, change vs comparison, sparkline) */
  $("todayTotal").textContent = fmt(total);
  const diff = vsYesterday(v, total);
  $("trend").textContent = diff === null
    ? (entries.length ? `${plural(entries.length, "site")} · ${plural(visits, "visit")}` : "Nothing tracked yet today.")
    : `${diff > 0 ? "↑" : "↓"} ${fmt(Math.abs(diff))} ${diff > 0 ? "more" : "less"} than yesterday at this time`;
  const week = lastNDays(7);
  $("spark").innerHTML = sparkline(week.map(k => daySeconds(v[k])), week);
  renderStack($("catStack"), $("catLegend"), roll, total, cats);

  const drift = driftState(store.trail, cats);
  const now = renderNow($("nowBox"), tab, live, day, cats);
  liveBase = { ...now, total, at: Date.now() };
  renderMascot($("mascot"), mascotMood({
    onSite: !!(tab && domainOf(tab.url)), tracking: now.tracking, total, drift: drift.ongoing, streak: drift.streak }));
  renderDriftList($("driftSum"), $("driftList"), $("driftMore"), drift.drifts);
  renderPath($("pathStrip"), $("pathLabels"), store.trail, cats);

  renderSites(entries, cats);
  renderCats(roll, total, cats, targets, store.challenge);
  renderChallenges(v, cats, store.challenge);
  renderPatterns(v, day, roll, total, visits, targets);
  await renderHistory(v);
}

/* ---------- sites ---------- */
function renderSites(entries, cats) {
  const list = $("siteRows");
  $("sitesCount").textContent = entries.length ? `${entries.length} today` : "";
  list.innerHTML = entries.length ? "" : `<li class="meta">Nothing tracked yet today. Sites appear here as you browse.</li>`;
  for (const [dom, e] of entries) {
    const li = el("li", "row",
      `<img src="${favicon(dom)}" alt=""><span class="row-main">${esc(dom)}</span>
       <span class="meta">${fmt(e.s)} · ${plural(e.v, "visit")}</span>`);
    const [btn, picker] = catToggle(`site:${dom}`, dom, catFor(dom, cats), cats);
    li.append(btn, picker);   // picker wraps onto its own line inside the row
    list.appendChild(li);
  }
}

/* ---------- categories & targets ---------- */
function renderCats(roll, total, cats, targets, challenge) {
  const list = $("catRows");
  list.innerHTML = "";
  [...cats.list].sort((a, b) => roll[b].s - roll[a].s).forEach(cat => {
    const r = roll[cat], col = colorFor(cat, cats), t = targets[cat];
    const share = total ? Math.round(r.s / total * 100) : 0;
    const li = el("li", "row cat-row" + (r.s ? "" : " is-empty"),
      `<i class="dot" style="background:${col}"></i>
       <button class="quiet row-main" data-k="rename:${esc(cat)}" title="Rename">${esc(cat)}</button>
       <span class="meta">${fmt(r.s)}${t ? ` of ${fmt(t)}` : r.s ? ` · ${share}%` : ""}</span>`);
    li.querySelector("button").onclick = () => renameCat(cat, cats, targets, challenge);
    if (t) {
      const pct = Math.round(r.s / t * 100);
      const bar = el("div", "progress" + (pct > 100 ? " is-over" : ""), `<i style="inline-size:${Math.min(100, pct)}%"></i>`);
      bar.setAttribute("role", "progressbar");
      bar.setAttribute("aria-label", `${cat}: ${pct}% of daily target`);
      bar.setAttribute("aria-valuenow", String(Math.min(pct, 100)));
      li.appendChild(bar);
    }
    const tb = el("button", "quiet small", t ? "Change target" : "Set target");
    tb.dataset.k = `target:${cat}`;
    tb.onclick = async () => {
      const m = prompt(`Daily target for ${cat}, in minutes (0 removes it):`, t ? String(Math.round(t / 60)) : "60");
      if (m === null || isNaN(+m)) return;
      if (+m > 0) targets[cat] = Math.round(+m) * 60; else delete targets[cat];
      await chrome.storage.local.set({ targets });
    };
    li.appendChild(tb);
    list.appendChild(li);
  });
}
async function renameCat(cat, cats, targets, challenge) {
  const name = (prompt("Rename category:", cat) || "").trim();
  if (!name || name === cat) return;
  if (cats.list.includes(name)) { alert(`There's already a category called "${name}".`); return; }
  await chrome.storage.local.set(renameCategory(cats, targets, challenge, cat, name));
}

/* ---------- patterns ---------- */
function insights(v, day, roll, total, visits, targets) {
  if (total < 120) return ["Patterns show up after a few minutes of browsing."];
  const out = [];
  const [topCat, top] = Object.entries(roll).sort((a, b) => b[1].s - a[1].s)[0];
  out.push(`<b>${esc(topCat)}</b> took ${Math.round(top.s / total * 100)}% of your browsing today.`);
  for (const [cat, t] of Object.entries(targets)) {
    const s = roll[cat] ? roll[cat].s : 0;
    if (s > t) out.push(`<b>${esc(cat)}</b> is ${fmt(s - t)} over its daily target.`);
    else if (s >= t * 0.8) out.push(`<b>${esc(cat)}</b> is at ${Math.round(s / t * 100)}% of its daily target.`);
  }
  if (visits >= 5) out.push(`You switch sites about every <b>${fmt(total / visits)}</b>.`);
  let pk = 0, pv = 0;
  day.hours.forEach((s, h) => { if (s > pv) { pv = s; pk = h; } });
  if (pv) out.push(`Busiest hour: <b>${pk}:00–${pk + 1}:00</b> (${fmt(pv)}).`);
  /* only compare weeks once the earlier week was mostly tracked, or a new install reads as +500% */
  const prev = lastNDays(7, 7);
  const s7 = sumDays(v, lastNDays(7)), sp = sumDays(v, prev);
  if (sp > 0 && prev.filter(k => daySeconds(v[k]) > 0).length >= 5) {
    const d = Math.round((s7 - sp) / sp * 100);
    out.push(`This week: <b>${d >= 0 ? "+" : ""}${d}%</b> browsing time vs the week before.`);
  }
  return out;
}
function bars(box, labels, values, labelFor, tickFor, current, summary) {
  box.innerHTML = ""; labels.innerHTML = "";
  box.setAttribute("role", "img");
  box.setAttribute("aria-label", summary);
  const max = Math.max(...values, 1);
  values.forEach((s, i) => {
    const b = el("div", (s ? "" : "is-empty") + (i === current ? " is-current" : ""));
    b.style.blockSize = Math.max(4, Math.round(s / max * 100)) + "%";
    b.title = `${labelFor(i)} — ${fmt(s)}`;
    box.appendChild(b);
    labels.appendChild(el("span", null, tickFor(i)));
  });
}
function renderPatterns(v, day, roll, total, visits, targets) {
  $("insights").innerHTML = insights(v, day, roll, total, visits, targets).map(t => `<li>${t}</li>`).join("");
  const nowH = new Date().getHours();
  const busiest = day.hours.indexOf(Math.max(...day.hours));
  bars($("hours"), $("hourLabels"), day.hours, h => `${h}:00`, h => (h % 6 === 0 ? String(h) : ""), nowH,
    total ? `Active hours today, busiest ${busiest}:00` : "No activity yet today");
  const days = lastNDays(7), vals = days.map(k => daySeconds(v[k]));
  const name = k => new Date(k + "T12:00").toLocaleDateString(undefined, { weekday: "short" });
  bars($("week"), $("weekLabels"), vals, i => name(days[i]), i => name(days[i]).slice(0, 2), 6,
    "Last 7 days: " + days.map((k, i) => `${name(k)} ${fmt(vals[i])}`).join(", "));
}

/* ---------- history (Chrome history + TimeLens time) ---------- */
let histCache = null, histAt = 0;
async function historyByDomain() {
  if (histCache && Date.now() - histAt < HISTORY_TTL) return histCache;
  const items = await chrome.history.search({ text: "", startTime: Date.now() - 7 * 864e5, maxResults: 2000 });
  const byDom = {};
  items.forEach(h => {
    const d = domainOf(h.url);
    if (!d) return;
    const r = byDom[d] || (byDom[d] = { pages: 0, last: 0 });
    r.pages += 1;   // distinct pages; visitCount is lifetime, not "last 7 days"
    r.last = Math.max(r.last, h.lastVisitTime || 0);
  });
  histCache = byDom; histAt = Date.now();
  return byDom;
}
async function renderHistory(v) {
  const list = $("histRows");
  let byDom;
  try { byDom = await historyByDomain(); }
  catch { list.innerHTML = `<li class="meta">Chrome history isn't available right now.</li>`; return; }
  const tracked = {};
  lastNDays(7).forEach(k => {
    if (v[k]) for (const [d, e] of Object.entries(v[k].domains)) tracked[d] = (tracked[d] || 0) + e.s;
  });
  const top = Object.entries(byDom).sort((a, b) => b[1].pages - a[1].pages).slice(0, 20);
  list.innerHTML = top.length ? top.map(([d, r]) =>
    `<li class="row"><img src="${favicon(d)}" alt=""><span class="row-main">${esc(d)}</span>
     <span class="meta">${tracked[d] ? fmt(tracked[d]) : "—"} · ${plural(r.pages, "page")} · ${ago(r.last)}</span></li>`).join("")
    : `<li class="meta">No history from the last 7 days.</li>`;
}

/* ---------- challenges ---------- */
const CHALLENGE_PRESETS = [
  { id: "detox7",     name: "Social detox", cat: "Social",   op: "<=", limitMin: 30,  days: 7, icon: "🌿" },
  { id: "deepwork5",  name: "Deep work",    cat: "Work",     op: ">=", limitMin: 180, days: 5, icon: "🎯" },
  { id: "newsdiet7",  name: "News diet",    cat: "News",     op: "<=", limitMin: 20,  days: 7, icon: "📰" },
  { id: "learndaily", name: "Learn daily",  cat: "Learning", op: ">=", limitMin: 30,  days: 7, icon: "📚" },
];
function challengeDayKeys(ch) {
  const [y, m, dd] = ch.startDay.split("-").map(Number);
  const out = [];
  for (let i = 0; i < ch.days; i++) out.push(dayKey(new Date(y, m - 1, dd + i)));
  return out;
}
function catSeconds(v, cats, cat, dk) {
  const day = v[dk];
  if (!day) return 0;
  return Object.entries(day.domains).reduce((a, [dom, e]) => a + (catFor(dom, cats) === cat ? e.s : 0), 0);
}
const ruleText = (op, min, cat, days) => `${cat} ${op === "<=" ? "under" : "at least"} ${min} min a day, ${days} days`;
function renderChallenges(v, cats, ch) {
  const box = $("challengeBox");
  box.innerHTML = "";
  if (!ch) {
    $("challengeState").textContent = "";
    const list = el("ul", "rows");
    CHALLENGE_PRESETS.forEach(p => {
      const cat = resolveCat(p.cat, cats);   // presets follow renamed categories
      const li = el("li");
      const b = el("button", "row preset", `<span class="row-main">${p.icon} ${p.name}</span><span class="meta">${esc(ruleText(p.op, p.limitMin, cat, p.days))}</span>`);
      b.dataset.k = `preset:${p.id}`;
      b.onclick = () => chrome.storage.local.set({ challenge: { ...p, cat, startDay: dayKey() } });
      li.appendChild(b);
      list.appendChild(li);
    });
    box.appendChild(list);
    return;
  }

  const keys = challengeDayKeys(ch);
  const today = dayKey();
  const over = today > keys[keys.length - 1];
  const tIdx = keys.indexOf(today);
  const lim = ch.limitMin * 60;
  let passed = 0;
  const days = keys.map(k => {
    const sec = catSeconds(v, cats, ch.cat, k);
    const ok = ch.op === "<=" ? sec <= lim : sec >= lim;
    if (k < today && ok) passed++;
    const state = k < today ? (ok ? "passed" : "missed") : k === today ? "today" : "upcoming";
    return `<li class="day is-${state}" title="${k}: ${fmt(sec)}"><span class="sr-only">${k} ${state}</span></li>`;
  }).join("");
  const todaySec = tIdx >= 0 ? catSeconds(v, cats, ch.cat, today) : 0;
  $("challengeState").textContent = over ? `${ch.name} finished` : `${ch.name}, day ${tIdx + 1} of ${ch.days}`;

  box.innerHTML =
    `<p><b>${ch.icon} ${esc(ch.name)}</b>${over ? ` · ${passed} of ${ch.days} days passed` : ""}</p>
     <p class="meta">${esc(ruleText(ch.op, ch.limitMin, ch.cat, ch.days))}${over ? "" : ` · today ${fmt(todaySec)}`}</p>
     <ol class="days" aria-label="Challenge days">${days}</ol>`;
  const btn = el("button", "quiet", over ? "Start another challenge" : "Quit challenge");
  btn.onclick = () => {
    if (over || confirm(`Quit "${ch.name}"? Your progress on it will be lost.`)) chrome.storage.local.remove("challenge");
  };
  box.appendChild(btn);
}

/* ---------- render scheduling ----------
   One render at a time (overlapping renders used to duplicate the challenge card), and
   none while the user is typing in a field, so a refresh can't wipe what they're entering.
   Focused buttons carry data-k, so keyboard focus is put back on the rebuilt button. */
let busy = false, again = false;
function isEditing() {
  const a = document.activeElement;
  return !!a && (a.tagName === "INPUT" || a.tagName === "SELECT");
}
async function requestRender() {
  if (busy || isEditing()) { again = true; return; }
  busy = true;
  const focusKey = document.activeElement && document.activeElement.dataset.k;
  try { await render(); } catch (e) { console.error("TimeLens:", e); }
  if (focusKey && document.activeElement === document.body) {
    const b = document.querySelector(`[data-k="${CSS.escape(focusKey)}"]`);
    if (b) b.focus({ preventScroll: true });
  }
  busy = false;
  if (again) { again = false; requestRender(); }
}
document.addEventListener("focusout", () => setTimeout(() => {
  if (again) { again = false; requestRender(); }
}, 0));

$("addCat").onclick = async () => {
  const name = (prompt("New category name:") || "").trim();
  if (!name) return;
  const cats = await getCats();
  if (cats.list.includes(name)) { alert(`There's already a category called "${name}".`); return; }
  cats.list.push(name);
  await chrome.storage.local.set({ catList: cats.list });
};
$("exportBtn").onclick = async () => {
  const d = await chrome.storage.local.get(null);
  const blob = new Blob([JSON.stringify(d, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `timelens-export-${dayKey()}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};
$("resetBtn").onclick = async () => {
  if (confirm("Delete all TimeLens data? Your history, categories, targets and challenges will be erased. This can't be undone."))
    await chrome.storage.local.clear();
};
$("ver").textContent = `Stays on this PC · v${chrome.runtime.getManifest().version}`;

/* local: saved data changed. session: the worker switched, paused or resumed what it tracks. */
chrome.storage.onChanged.addListener(() => requestRender());
/* tab switches the worker doesn't record (e.g. between two non-website tabs) */
chrome.tabs.onActivated.addListener(() => requestRender());
startTicker(() => liveBase, $("todayTotal"));
requestRender();
setInterval(requestRender, 10000);

/* TimeLens side-panel dashboard. Reads chrome.storage.local only. */
const HISTORY_TTL = 60 * 1000;
let openPicker = null;   // domain whose category buttons are expanded in "Sites today"
let liveBase = null;     // snapshot for the 1s live ticker

function dayLabel(ds) {
  const [y,m,dd] = ds.split("-").map(Number);
  return new Date(y, m-1, dd).toLocaleDateString(undefined, { weekday:"short", month:"short", day:"numeric" });
}
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
  const entries = Object.entries(day.domains).sort((a,b) => b[1].s - a[1].s);
  const total = daySeconds(day);
  const visits = entries.reduce((a,[,e]) => a + e.v, 0);
  const roll = rollup(entries, cats);
  const firstDay = Object.keys(v).length <= 1 && total < 5 * 60;

  $("dateLine").textContent =
    new Date().toLocaleDateString(undefined, { weekday:"long", month:"long", day:"numeric" });
  $("todayTotal").textContent = fmt(total);
  $("todaySub").textContent = entries.length
    ? `${plural(entries.length, "site")} · ${plural(visits, "visit")}` : "Nothing tracked yet today";
  const diff = vsYesterday(v, total);
  $("trend").innerHTML = diff === null ? ""
    : `<span class="${diff > 0 ? "up" : "down"}">${diff > 0 ? "▲" : "▼"} ${fmt(Math.abs(diff))}</span> vs yesterday at this time`;
  $("spark").innerHTML = sparkline(lastNDays(7).map(k => daySeconds(v[k])));
  renderStack($("catStack"), $("catLegend"), roll, total, cats);

  const drift = driftState(store.trail, cats);
  const now = renderNow($("nowBox"), tab, live, day, cats, { drift: drift.ongoing });
  liveBase = { ...now, total, at: Date.now() };
  renderMascot($("mascot"), mascotMood({
    onSite: !!(tab && domainOf(tab.url)), tracking: now.tracking, total, drift: drift.ongoing, streak: drift.streak }));
  $("welcome").hidden = !firstDay;
  renderDriftList($("driftSum"), $("driftList"), drift.drifts);
  renderPath($("pathStrip"), $("pathLabels"), store.trail, cats);

  renderCats(roll, total, cats, targets, store.challenge);
  renderChallenges(v, cats, store.challenge);
  renderSites(entries, cats);
  renderPatterns(v, day, entries, roll, total, visits, targets);
  await renderHistory(v);
}

/* ---------- categories ---------- */
function renderCats(roll, total, cats, targets, challenge) {
  const cc = $("catCards"), empty = $("catEmpty");
  cc.innerHTML = "";
  const shown = cats.list.filter(c => roll[c].s > 0 || targets[c])
    .sort((a, b) => roll[b].s - roll[a].s);
  const idle = cats.list.filter(c => !shown.includes(c));
  shown.forEach(cat => cc.appendChild(catCard(cat, roll[cat], total, cats, targets, challenge)));
  /* empty categories as one quiet line instead of a stack of "0s" cards */
  empty.innerHTML = "";
  if (idle.length) {
    empty.appendChild(el("span", "muted", shown.length ? "No time yet: " : "Your categories: "));
    idle.forEach(cat => {
      const b = el("button", "linkish", esc(cat));
      b.title = "Click to rename";
      b.dataset.k = `cat:${cat}`;
      b.onclick = () => renameCat(cat, cats, targets, challenge);
      empty.appendChild(b);
    });
  }
}
function catCard(cat, r, total, cats, targets, challenge) {
  const col = colorFor(cat, cats);
  const share = total ? Math.round(r.s / total * 100) : 0;
  const top = r.sites.sort((a,b) => b[1].s - a[1].s).slice(0,3)
    .map(([d,e]) => `${esc(d)} ${fmt(e.s)}`).join(" · ");
  const card = el("div", "card");
  let bar, tgt;
  if (targets[cat]) {
    const pct = Math.round(r.s / targets[cat] * 100);
    bar = `<div class="bar"><i style="width:${Math.min(100, pct)}%;background:${pct > 100 ? "#f87171" : col}"></i></div>`;
    tgt = `<div class="tgt">daily target <input type="number" min="0" value="${Math.round(targets[cat]/60)}"> min · ${pct}%</div>`;
  } else {
    bar = `<div class="bar"><i style="width:${share}%;background:${col}"></i></div>`;
    tgt = `<div class="tgt">${share}% of today · <a href="#" class="setT" style="color:${col}">set a daily target</a></div>`;
  }
  card.innerHTML =
    `<div class="row1"><span class="dot" style="background:${col}"></span>` +
    `<span class="name" title="Click to rename">${esc(cat)}</span>` +
    `<span class="time">${fmt(r.s)}</span></div>` + bar + tgt +
    `<div class="topsites">${top || "no time yet"}</div>`;
  card.querySelector(".name").onclick = () => renameCat(cat, cats, targets, challenge);
  const setT = card.querySelector(".setT");
  if (setT) setT.onclick = async (e) => {
    e.preventDefault();
    const m = prompt(`Daily target for "${cat}" (minutes):`, "60");
    if (m !== null && +m > 0) { targets[cat] = (+m) * 60; await chrome.storage.local.set({ targets }); }
  };
  const inp = card.querySelector("input");
  if (inp) inp.onchange = async () => {
    const m = +inp.value;
    if (m > 0) targets[cat] = m * 60; else delete targets[cat];
    inp.blur();
    await chrome.storage.local.set({ targets });
  };
  return card;
}
async function renameCat(cat, cats, targets, challenge) {
  const name = (prompt("Rename category:", cat) || "").trim();
  if (!name || name === cat) return;
  if (cats.list.includes(name)) { alert(`"${name}" already exists.`); return; }
  await chrome.storage.local.set(renameCategory(cats, targets, challenge, cat, name));
}

/* ---------- sites today ---------- */
function renderSites(entries, cats) {
  const sr = $("siteRows");
  sr.innerHTML = entries.length ? "" : `<div class="muted">Nothing tracked yet. Browse and come back.</div>`;
  const maxS = entries.length ? Math.max(entries[0][1].s, 1) : 1;
  for (const [dom, e] of entries) {
    const c = catFor(dom, cats);
    const col = colorFor(c, cats);
    const row = el("div", "site",
      `<div class="srow"><img src="${favicon(dom)}" alt=""><span class="dom">${esc(dom)}</span>
         <span class="meta">${fmt(e.s)} · ${plural(e.v, "visit")}</span>
         <button class="pill" style="--c:${col}" data-k="pill:${esc(dom)}">${esc(c)} ▾</button></div>
       <div class="meter"><i style="width:${Math.round(e.s/maxS*100)}%;background:${col}"></i></div>`);
    row.querySelector(".pill").onclick = () => {
      openPicker = openPicker === dom ? null : dom;
      requestRender();
    };
    if (openPicker === dom) row.appendChild(catPicker(dom, c, cats));
    sr.appendChild(row);
  }
}

/* ---------- patterns ---------- */
function insights(v, day, entries, roll, total, visits, targets) {
  if (total < 120) return ["Patterns show up after a few minutes of browsing."];
  const out = [];
  const [topCat, top] = Object.entries(roll).sort((a,b) => b[1].s - a[1].s)[0];
  out.push(`<b>${esc(topCat)}</b> took ${Math.round(top.s / total * 100)}% of your browsing today (${fmt(top.s)}).`);
  for (const [cat, t] of Object.entries(targets)) {
    const s = roll[cat] ? roll[cat].s : 0;
    if (s > t) out.push(`<b>${esc(cat)}</b> is ${fmt(s - t)} over its daily target.`);
    else if (s >= t * 0.8) out.push(`<b>${esc(cat)}</b> is at ${Math.round(s / t * 100)}% of its daily target.`);
  }
  if (visits >= 5) out.push(`You switch sites about every <b>${fmt(total / visits)}</b> (${visits} visits today).`);
  let pk = 0, pv = 0;
  day.hours.forEach((s,h) => { if (s > pv) { pv = s; pk = h; } });
  if (pv) out.push(`Busiest hour: <b>${pk}:00–${pk+1}:00</b> (${fmt(pv)}).`);
  /* only compare weeks once the earlier week was mostly tracked, or a new install reads as +500% */
  const prev = lastNDays(7, 7);
  const s7 = sumDays(v, lastNDays(7)), sp = sumDays(v, prev);
  if (sp > 0 && prev.filter(k => daySeconds(v[k]) > 0).length >= 5) {
    const d = Math.round((s7 - sp) / sp * 100);
    out.push(`This week: <b>${d >= 0 ? "+" : ""}${d}%</b> browsing time vs the week before.`);
  }
  return out;
}
function renderPatterns(v, day, entries, roll, total, visits, targets) {
  const ins = $("insights");
  ins.innerHTML = "";
  insights(v, day, entries, roll, total, visits, targets).forEach(t => ins.appendChild(el("div", "insight", t)));
  $("charts").hidden = total < 120 && Object.keys(v).length <= 1;

  const hb = $("hours"), hl = $("hourLabels");
  hb.innerHTML = ""; hl.innerHTML = "";
  const hmax = Math.max(...day.hours, 1), nowH = new Date().getHours();
  day.hours.forEach((s,h) => {
    const b = el("div", (!s ? "dim" : "") + (h === nowH ? " cur" : ""));
    b.style.height = Math.max(2, Math.round(s / hmax * 56)) + "px";
    b.title = `${h}:00 — ${fmt(s)}`;
    hb.appendChild(b);
    hl.appendChild(el("span", null, h % 3 === 0 ? String(h) : ""));
  });
  const wb = $("week"), wl = $("weekLabels");
  wb.innerHTML = ""; wl.innerHTML = "";
  const days7 = lastNDays(7);
  const wvals = days7.map(k => daySeconds(v[k]));
  const wmax = Math.max(...wvals, 1);
  days7.forEach((k,i) => {
    const b = el("div", (!wvals[i] ? "dim" : "") + (i === 6 ? " cur" : ""));
    b.style.height = Math.max(2, Math.round(wvals[i] / wmax * 56)) + "px";
    b.title = `${dayLabel(k)} — ${fmt(wvals[i])}`;
    wb.appendChild(b);
    wl.appendChild(el("span", null, ["S","M","T","W","T","F","S"][new Date(k+"T12:00").getDay()]));
  });
}

/* ---------- history (Chrome history + TimeLens time) ---------- */
let histCache = null, histAt = 0;
async function historyByDomain() {
  if (histCache && Date.now() - histAt < HISTORY_TTL) return histCache;
  const items = await chrome.history.search({ text: "", startTime: Date.now() - 7*864e5, maxResults: 2000 });
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
  const hr = $("histRows");
  let byDom;
  try { byDom = await historyByDomain(); }
  catch { hr.innerHTML = `<div class="muted">History unavailable.</div>`; return; }
  const tracked = {};
  lastNDays(7).forEach(k => {
    if (v[k]) for (const [d, e] of Object.entries(v[k].domains)) tracked[d] = (tracked[d] || 0) + e.s;
  });
  hr.innerHTML = "";
  Object.entries(byDom).sort((a,b) => b[1].pages - a[1].pages).slice(0,20).forEach(([d, r]) => {
    const t = tracked[d] ? `${fmt(tracked[d])} tracked` : "no time tracked";
    hr.appendChild(el("div", "srow",
      `<img src="${favicon(d)}" alt=""><span class="dom">${esc(d)}</span>
       <span class="meta">${t} · ${plural(r.pages, "page")} · ${ago(r.last)}</span>`));
  });
  if (!Object.keys(byDom).length) hr.innerHTML = `<div class="muted">No history in range.</div>`;
}

/* ---------- challenges ---------- */
const CHALLENGE_PRESETS = [
  { id:"detox7",    name:"Social Detox", cat:"Social",   op:"<=", limitMin:30,  days:7, icon:"🌿" },
  { id:"deepwork5", name:"Deep Work",    cat:"Work",     op:">=", limitMin:180, days:5, icon:"🎯" },
  { id:"newsdiet7", name:"News Diet",    cat:"News",     op:"<=", limitMin:20,  days:7, icon:"📰" },
  { id:"learndaily",name:"Learn Daily",  cat:"Learning", op:">=", limitMin:30,  days:7, icon:"📚" },
];
function challengeDayKeys(ch) {
  const [y,m,dd] = ch.startDay.split("-").map(Number);
  const out = [];
  for (let i = 0; i < ch.days; i++) out.push(dayKey(new Date(y, m-1, dd+i)));
  return out;
}
function catSeconds(v, cats, cat, dk) {
  const day = v[dk];
  if (!day) return 0;
  return Object.entries(day.domains).reduce((a,[dom,e]) => a + (catFor(dom, cats) === cat ? e.s : 0), 0);
}
function renderChallenges(v, cats, ch) {
  const box = $("challengeBox");
  box.innerHTML = "";
  if (!ch) {
    const wrap = el("div", "chpresets");
    CHALLENGE_PRESETS.forEach(p => {
      const cat = resolveCat(p.cat, cats);   // presets follow renamed categories
      const b = el("button", "ghost chpreset");
      b.dataset.k = `preset:${p.id}`;
      b.textContent = `${p.icon} ${p.name} · ${cat} ${p.op === "<=" ? "under" : "at least"} ${p.limitMin}m/day · ${p.days} days`;
      b.onclick = () => chrome.storage.local.set({ challenge: { ...p, cat, startDay: dayKey() } });
      wrap.appendChild(b);
    });
    box.appendChild(wrap);
    return;
  }

  const keys = challengeDayKeys(ch);
  const today = dayKey();
  const over = today > keys[keys.length-1];
  const tIdx = keys.indexOf(today);
  const lim = ch.limitMin * 60;
  let dots = "", passed = 0;
  keys.forEach(k => {
    const sec = catSeconds(v, cats, ch.cat, k);
    const ok = ch.op === "<=" ? sec <= lim : sec >= lim;
    let sym = "·";
    if (k < today) { sym = ok ? "✓" : "✗"; if (ok) passed++; }
    else if (k === today) sym = "◐";
    dots += `<span title="${k} · ${fmt(sec)}">${sym}</span> `;
  });
  const todaySec = tIdx >= 0 ? catSeconds(v, cats, ch.cat, today) : 0;
  const pct = Math.min(100, Math.round(todaySec / lim * 100));
  const failing = ch.op === "<=" && todaySec > lim;

  const card = el("div", "card");
  if (over) {
    card.innerHTML =
      `<div class="row1"><span class="emoji">${passed === ch.days ? "🏆" : "💪"}</span>` +
      `<span class="name">${esc(ch.name)} — finished</span></div>` +
      `<div class="topsites">${passed}/${ch.days} days passed.</div>` +
      `<div class="dots">${dots}</div>` +
      `<button class="ghost" style="margin-top:8px">Start a new one</button>`;
    card.querySelector("button").onclick = () => chrome.storage.local.remove("challenge");
  } else {
    card.innerHTML =
      `<div class="row1"><span class="emoji">${ch.icon}</span>` +
      `<span class="name">${esc(ch.name)}</span>` +
      `<span class="time">day ${tIdx+1}/${ch.days}</span></div>` +
      `<div class="dots">${dots}</div>` +
      `<div class="bar"><i style="width:${pct}%;background:${failing ? "#f87171" : ch.op === "<=" ? "#34d399" : "#38bdf8"}"></i></div>` +
      `<div class="tgt">today ${fmt(todaySec)} of ${ch.op === "<=" ? "max" : "goal"} ${ch.limitMin}m ${esc(ch.cat)}
       <a href="#" class="quit">quit</a></div>`;
    card.querySelector(".quit").onclick = (e) => {
      e.preventDefault();
      if (confirm("Quit this challenge?")) chrome.storage.local.remove("challenge");
    };
  }
  box.appendChild(card);
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
  if (cats.list.includes(name)) { alert(`"${name}" already exists.`); return; }
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
  if (confirm("Delete ALL TimeLens data on this PC?")) await chrome.storage.local.clear();
};
$("ver").textContent = `100% local — nothing leaves this PC. v${chrome.runtime.getManifest().version}`;

/* local: saved data changed. session: the worker switched, paused or resumed what it tracks. */
chrome.storage.onChanged.addListener(() => requestRender());
/* tab switches the worker doesn't record (e.g. between two non-website tabs) */
chrome.tabs.onActivated.addListener(() => requestRender());
startTicker(() => liveBase, $("todayTotal"));
requestRender();
setInterval(requestRender, 10000);

/* Train Lens: rate many of Lens's lines in a row, in the side panel.
   In the bubble Lens writes one line per situation and you can rate it once, so a day gives a
   handful of ratings. Here the same model writes a fresh line for a situation you pick (or the
   least-rated one), you rate it, and the next one appears at once. Lines go through the same
   checks as live ones. Names, times and durations are examples. Votes are saved to lensVotes
   like any other, marked lab: 1. Loads after lib.js, talk.js and ui.js (it uses $ and esc at once). */
const LAB_TODS = ["morning", "afternoon", "evening", "night"], LAB_AMTS = ["light", "usual", "heavy"];
/* what is going on when Lens says each kind of line, so the rater can judge if it fits */
const LAB_WHEN = {
  idle: "you're on a page that isn't a website",
  paused: "tracking is paused",
  bg: "music or a video is playing in the background",
  doom: "15+ minutes on distracting sites, with no focus site before",
  start: "you started on a distracting site, a few minutes ago",
  drift_long: "you left a focus site 15+ minutes ago",
  drift: "you left a focus site a few minutes ago",
  streak: "25+ minutes of focus in a row",
  hello: "the first minutes of the day",
  ok: "an ordinary day, nothing to flag",
};
const LAB_VS = { more: "more than yesterday so far", less: "less than yesterday so far", same: "about the same as yesterday", none: "nothing to compare with yet" };
const LAB_DR = { none: "no drifts yet today", some: "a drift or two today", many: "several drifts today" };
const LAB_EXAMPLE = { top: "youtube.com", site: "youtube.com", dur: "18m", from: "github.com", at: "2:15 PM",
  sites: "youtube.com, reddit.com", total: "2h 10m", why: "screen locked" };
const LAB_AMT_WORDS = { light: "a light day", usual: "a usual day", heavy: "a heavy day" };
const lab = { sample: null, prev: null, busy: false };

/* the next line to rate: from the chosen situation, or the one rated least so far; lines you
   haven't rated yet come first. Returns { say, line, tod, amt, again } or null without a model. */
async function labNext(choice = "mix", rand = Math.random) {
  const M = await lensLoad();
  if (!M) return null;
  const { lensVotes = [] } = await chrome.storage.local.get("lensVotes");
  const sits = Object.keys(M.slots), n = s => lensVotes.filter(v => v.say === s).length;
  let say = choice;
  if (!sits.includes(say)) {
    const least = Math.min(...sits.map(n)), pool = sits.filter(s => n(s) === least);
    say = pool[Math.floor(rand() * pool.length)];
  }
  const rated = new Set(lensVotes.filter(v => v.say === say).map(v => v.line));
  const score = lensScores(lensVotes);
  let fresh = null, repeat = null;
  for (let i = 0; i < 40 && !fresh; i++) {
    const tod = LAB_TODS[Math.floor(rand() * LAB_TODS.length)];
    const amt = say === "hello" ? "light" : LAB_AMTS[Math.floor(rand() * LAB_AMTS.length)];
    const pick = a => a[Math.floor(rand() * a.length)];
    const [vs, dr] = say === "hello" ? ["none", "none"] : [pick(Object.keys(LAB_VS)), pick(Object.keys(LAB_DR))];
    const prompt = `<${say}> <${tod}> <${amt}> <${vs}> <${dr}>`, line = lensGenerate(M, prompt, rand);
    if (!lensValid(line, M.slots[say]) || !lensKnown(line, M.pairs) || !lensFits(line, prompt) || (lab.sample && line === lab.sample.line)
        || score[lensKey(say, line)] < 0) continue;
    if (rated.has(line)) repeat = repeat || { say, line, tod, amt, vs, dr, again: true };
    else fresh = { say, line, tod, amt, vs, dr, again: false };
  }
  return fresh || repeat;
}

function labCount(votes = []) {
  const sits = new Set(votes.map(v => v.say)).size;
  return votes.length ? `${votes.length} rated · ${sits} of ${Object.keys(LAB_WHEN).length} situations` : "";
}
async function labPaint() {
  const s = lab.sample, off = !s;
  $("labLine").textContent = s ? lensFill(s.line, LAB_EXAMPLE) : "Lens's model couldn't load, so there's nothing to rate.";
  $("labWhen").textContent = s
    ? `When ${LAB_WHEN[s.say]} · ${s.tod} · ${LAB_AMT_WORDS[s.amt]}${s.say === "hello" ? "" : ` · ${LAB_VS[s.vs]} · ${LAB_DR[s.dr]}`}${s.again ? " · you've rated every line Lens has written here" : ""}`
    : "";
  for (const b of document.querySelectorAll("#labRate [data-v]")) b.disabled = off;
  $("labUndo").hidden = !lab.prev;
  const { lensVotes } = await chrome.storage.local.get("lensVotes");
  $("labCount").textContent = labCount(lensVotes);
}
async function labShow() {
  lab.sample = await labNext($("labSit").value);
  await labPaint();
}
async function labVoteNow(v) {
  const s = lab.sample;
  if (!s || lab.busy) return;
  lab.busy = true;
  try {
    lab.prev = { t: await lensLog(s.say, s.line, s.tod, s.amt, v, true, { vs: s.vs, dr: s.dr }), sample: s };
    await labShow();
  } finally { lab.busy = false; }
}
async function labUndoNow() {
  if (!lab.prev || lab.busy) return;
  const { t, sample } = lab.prev;
  lab.prev = null;
  await lensUnlog(t);
  lab.sample = sample;
  await labPaint();
}

/* wiring (the side panel only) */
if (typeof document !== "undefined" && document.getElementById("lab")) {
  $("labSit").innerHTML = `<option value="mix">All situations, least rated first</option>` +
    Object.entries(LAB_WHEN).map(([k, w]) => `<option value="${k}">${esc(k.replace("_", " "))}: ${esc(w)}</option>`).join("");
  $("labRate").addEventListener("click", e => {
    const b = e.target.closest("[data-v]");
    if (b) labVoteNow(b.dataset.v);
  });
  $("labUndo").onclick = labUndoNow;
  $("labSit").onchange = () => { lab.prev = null; labShow(); };
  $("lab").addEventListener("toggle", () => { if ($("lab").open && !lab.sample) labShow(); });
  chrome.storage.local.get("lensVotes").then(({ lensVotes }) => { $("labCount").textContent = labCount(lensVotes); });
  if ($("lab").open && !lab.sample) labShow();   // open from the start while Lens is being tested
}

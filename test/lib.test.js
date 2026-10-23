const test = require("node:test");
const assert = require("node:assert/strict");
const { loadLib } = require("./fake-chrome");

const L = loadLib();
const cats = (extra = {}) => L.catsFrom(extra);
/* objects made inside the vm sandbox have its own Object prototype */
const plain = x => JSON.parse(JSON.stringify(x));

test("built-in categories match subdomains", () => {
  const c = cats();
  assert.equal(L.catFor("mail.google.com", c), "Work");
  assert.equal(L.catFor("m.youtube.com", c), "Entertainment");
  assert.equal(L.catFor("jobs.lever.co", c), "Work");
  assert.equal(L.catFor("example.org", c), "Other");
});

test("the user's pick wins, most specific domain first", () => {
  const c = cats({ catMap: { "youtube.com": "Learning", "music.youtube.com": "Entertainment" } });
  assert.equal(L.catFor("youtube.com", c), "Learning");
  assert.equal(L.catFor("m.youtube.com", c), "Learning");
  assert.equal(L.catFor("music.youtube.com", c), "Entertainment");
});

test("built-in sites follow a renamed category", () => {
  const c = cats({ catList: ["Job", "Misc"], catAlias: { Work: "Job", Other: "Misc" } });
  assert.equal(L.catFor("github.com", c), "Job");
  assert.equal(L.catFor("example.org", c), "Misc");
});

/* applies renameCategory's updates the way chrome.storage.local.set would */
function rename(state, from, to) {
  const upd = L.renameCategory(L.catsFrom(state), state.targets || {}, state.challenge, from, to);
  return upd ? { ...state, ...upd } : null;
}

test("successive renames keep built-in sites in the right category", () => {
  let s = rename({}, "Work", "Job");
  s = rename(s, "Social", "Work");          // reuse a built-in name for another category
  const c = L.catsFrom(s);
  assert.equal(L.catFor("github.com", c), "Job");
  assert.equal(L.catFor("reddit.com", c), "Work");
  s = rename(rename({}, "Work", "Job"), "Job", "Work");   // and back again
  assert.equal(L.catFor("github.com", L.catsFrom(s)), "Work");
  assert.deepEqual(plain(s.catAlias), {});
});

test("rename carries user picks, targets and the running challenge", () => {
  const s = rename({ catMap: { "x.com": "Learning" }, targets: { Learning: 600 },
                     challenge: { cat: "Learning", days: 7 } }, "Learning", "Study");
  assert.equal(s.catMap["x.com"], "Study");
  assert.deepEqual(plain(s.targets), { Study: 600 });
  assert.equal(s.challenge.cat, "Study");
});

test("rename rejects duplicates and unknown categories", () => {
  assert.equal(rename({}, "Work", "Social"), null);
  assert.equal(rename({}, "Nope", "X"), null);
  assert.equal(rename({}, "Work", "  "), null);
});

test("formatting", () => {
  assert.equal(L.fmt(42), "42s");
  assert.equal(L.fmt(125), "2m");
  assert.equal(L.fmt(3725), "1h 2m");
  assert.equal(L.clock(247), "4:07");
  assert.equal(L.clock(3753), "1:02:33");
  assert.equal(L.esc(`<a href="x">'`), "&lt;a href=&quot;x&quot;&gt;&#39;");
});

test("domainOf ignores non-web pages", () => {
  assert.equal(L.domainOf("https://www.GitHub.com/x"), "github.com");
  assert.equal(L.domainOf("chrome://extensions"), null);
  assert.equal(L.domainOf("not a url"), null);
});

test("addLive only adds a session that is tracking", () => {
  const day = L.addLive(L.blankDay(), { domain: "a.com", tracking: true, elapsed: 5000 });
  assert.equal(day.domains["a.com"].s, 5);
  const paused = L.addLive(L.blankDay(), { domain: "a.com", tracking: false, elapsed: 0 });
  assert.deepEqual(plain(Object.keys(paused.domains)), []);
});

/* ---------- site timers and Focus mode ---------- */
const dayWith = domains => ({ domains, hours: new Array(24).fill(0) });

test("a timer covers the site and its subdomains, most specific first", () => {
  const limits = { "youtube.com": 600, "music.youtube.com": 1800 };
  assert.equal(L.timerFor("m.youtube.com", limits), "youtube.com");
  assert.equal(L.timerFor("music.youtube.com", limits), "music.youtube.com");
  assert.equal(L.timerFor("github.com", limits), null);
  assert.equal(L.siteUsed(dayWith({ "youtube.com": { s: 100 }, "m.youtube.com": { s: 50 }, "notyoutube.com": { s: 9 } }),
    "youtube.com"), 150);
});

test("blockReason: a used-up timer, then Focus mode, then nothing", () => {
  const c = cats();
  const day = dayWith({ "youtube.com": { s: 600 } });
  assert.equal(L.blockReason("youtube.com", { limits: { "youtube.com": 601 }, cats: c, day }), null);
  assert.equal(L.blockReason("youtube.com", { limits: { "youtube.com": 600 }, cats: c, day }).kind, "timer");
  const focus = { on: true };
  assert.deepEqual(plain(L.blockReason("reddit.com", { focus, cats: c, day })), { kind: "focus", cat: "Social" });
  assert.equal(L.blockReason("github.com", { focus, cats: c, day }), null);
  assert.equal(L.blockReason("reddit.com", { focus: { on: true, breakUntil: Date.now() + 1000 }, cats: c, day }), null);
  assert.equal(L.blockReason("reddit.com", { focus: { on: false }, cats: c, day }), null);
});

test("Focus mode's default categories follow renames, and a rename carries picked ones", () => {
  assert.deepEqual(plain(L.focusCats(null, cats({ catAlias: { Social: "Friends" } }))),
    ["Friends", "Entertainment", "News", "Shopping"]);
  const upd = L.renameCategory(L.catsFrom({}), {}, null, "News", "Headlines", { on: true, cats: ["News", "Social"] });
  assert.deepEqual(plain(upd.focus), { on: true, cats: ["Headlines", "Social"] });
});

test("timer lengths read the way people say them", () => {
  assert.equal(L.minsLabel(15), "15 min");
  assert.equal(L.minsLabel(120), "2 h");
  assert.equal(L.minsLabel(90), "1h 30m");
});

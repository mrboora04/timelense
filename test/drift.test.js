const test = require("node:test");
const assert = require("node:assert/strict");
const { loadLib } = require("./fake-chrome");

const L = loadLib();
const cats = L.catsFrom({});
const MIN = 60 * 1000;
const T0 = new Date(2026, 9, 16, 14, 0, 0).getTime();
/* builds a trail from [minutesFromT0, domain or null] pairs */
const trail = pairs => pairs.map(([m, d]) => ({ d, t: T0 + m * MIN }));

test("the built-in list covers more than 100 sites", () => {
  assert.ok(Object.keys(L.BUILTIN_CATS).length > 100);
});

test("unknown sites are guessed from their name", () => {
  assert.equal(L.catFor("cs.stanford.edu", cats), "Learning");
  assert.equal(L.catFor("iitm.ac.in", cats), "Learning");
  assert.equal(L.catFor("localhost", cats), "Work");
  assert.equal(L.catFor("dailynews.example", cats), "News");
  assert.equal(L.catFor("bestshop.example", cats), "Shopping");
  assert.equal(L.catFor("docs.python.org", cats), "Work");
  assert.equal(L.catFor("plain-site.example", cats), "Other");
});

test("leaving a focus site for distraction is a drift, ended by coming back", () => {
  const { drifts, ongoing } = L.findDrifts(trail([
    [0, "github.com"], [20, "reddit.com"], [28, "youtube.com"], [40, "github.com"],
  ]), cats, T0 + 50 * MIN);
  assert.equal(drifts.length, 1);
  const d = drifts[0];
  assert.equal(d.from, "github.com");
  assert.equal(d.leftAt, T0 + 20 * MIN);
  assert.equal(d.secs, 20 * 60);
  assert.deepEqual([...d.sites], ["reddit.com", "youtube.com"]);
  assert.equal(d.returned, true);
  assert.equal(d.backTo, "github.com");
  assert.equal(ongoing, null);
});

test("a drift still going on is reported as ongoing", () => {
  const { ongoing, streak } = L.findDrifts(trail([[0, "claude.ai"], [10, "instagram.com"]]), cats, T0 + 22 * MIN);
  assert.equal(ongoing.from, "claude.ai");
  assert.equal(ongoing.secs, 12 * 60);
  assert.equal(streak, 0);
});

test("short detours and long breaks are not drifts", () => {
  const short = L.findDrifts(trail([[0, "github.com"], [10, "x.com"], [13, "github.com"]]), cats, T0 + 20 * MIN);
  assert.equal(short.drifts.length, 0);
  /* a 30-minute pause, then reddit: there's no focus site to drift from, and it's under 20m */
  const afterBreak = L.findDrifts(trail([[0, "github.com"], [10, null], [40, "reddit.com"]]), cats, T0 + 52 * MIN);
  assert.equal(afterBreak.drifts.length, 0);
});

test("long scrolling with no focus site before it counts as doomscrolling", () => {
  const { ongoing } = L.findDrifts(trail([[0, "reddit.com"], [15, "youtube.com"]]), cats, T0 + 25 * MIN);
  assert.equal(ongoing.from, null);
  assert.equal(ongoing.secs, 25 * 60);
});

test("focus streak counts the current run of focus time", () => {
  const { streak } = L.findDrifts(trail([[0, "github.com"], [20, "stackoverflow.com"]]), cats, T0 + 30 * MIN);
  assert.equal(streak, 30 * 60);
});

test("Lens picks a mood for the situation", () => {
  const base = { onSite: true, tracking: true, total: 3600, drift: null, streak: 0 };
  assert.equal(L.mascotMood({ ...base, tracking: false }).mood, "sleep");
  assert.equal(L.mascotMood({ ...base, streak: 30 * 60 }).mood, "proud");
  assert.equal(L.mascotMood({ ...base, total: 30 }).mood, "wave");
  const drift = { from: "github.com", leftAt: T0, secs: 6 * 60, sites: ["reddit.com"] };
  assert.equal(L.mascotMood({ ...base, drift }).mood, "curious");
  const long = L.mascotMood({ ...base, drift: { ...drift, secs: 20 * 60 } });
  assert.equal(long.mood, "worried");
  assert.match(long.text, /github\.com/);
});

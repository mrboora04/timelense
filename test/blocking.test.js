/* Site timers and Focus mode: Chrome block rules, tabs moved to the paused page, breaks, midnight. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeWorld, bootWorker, settle, stats } = require("./fake-chrome");

const SEC = 1000, MIN = 60 * SEC;
const PAUSED = "chrome-extension://test/blocked.html?u=";
const rule = (w, id) => w.rules.find(r => r.id === id);
const TIMER = 1, FOCUS = 2;

test("a site's timer runs out on time: Chrome blocks it and the open tab goes to the paused page", async () => {
  const w = makeWorld();
  w.tabs = [{ id: 1, url: "https://www.youtube.com/watch?v=1", active: true, audible: false }];
  w.local.limits = { "youtube.com": 5 * 60 };
  const wk = bootWorker(w);
  await settle();
  assert.equal(w.alarms.limit.when, w.now + 5 * MIN);   // wakes exactly when the time is up
  for (let i = 0; i < 4; i++) { w.now += MIN; wk.tick(); await settle(); }
  assert.equal(w.rules.length, 0);
  w.now += MIN; wk.ev.alarm.fire({ name: "limit" }); await settle();
  assert.deepEqual(rule(w, TIMER).condition.requestDomains, ["youtube.com"]);
  assert.deepEqual(rule(w, TIMER).condition.resourceTypes, ["main_frame"]);
  assert.equal(rule(w, TIMER).action.type, "block");
  assert.equal(w.tabs[0].url, PAUSED + encodeURIComponent("https://www.youtube.com/watch?v=1"));
  const why = await wk.whyPaused("m.youtube.com");     // the timer covers subdomains
  assert.equal(why.reason.kind, "timer");
  assert.equal(why.reason.site, "youtube.com");
  /* the paused page isn't a website, so time stops */
  w.now += 10 * MIN; wk.tick(); await settle();
  assert.equal(stats(w, "youtube.com").s, 5 * 60);
});

test("a timer resets at midnight", async () => {
  const w = makeWorld();
  w.tabs = [{ id: 1, url: "https://reddit.com/", active: true, audible: false }];
  w.local.limits = { "reddit.com": 60 };
  const wk = bootWorker(w);
  await settle();
  w.now += MIN; wk.tick(); await settle();
  assert.ok(rule(w, TIMER));
  w.now = new Date(2026, 9, 17, 0, 0, 30).getTime();
  wk.tick(); await settle();
  assert.equal(w.rules.length, 0);
  assert.equal((await wk.whyPaused("reddit.com")).reason, null);
});

test("removing the timer unblocks the site right away", async () => {
  const w = makeWorld();
  w.local.limits = { "github.com": 60 };
  w.local.v1 = { "2026-10-16": { domains: { "github.com": { s: 120, v: 1 } }, hours: new Array(24).fill(0) } };
  const wk = bootWorker(w);
  await settle();
  assert.ok(rule(w, TIMER));
  await wk.store({ limits: {} }); await settle();
  assert.equal(w.rules.length, 0);
  assert.equal((await wk.whyPaused("github.com")).reason, null);
});

test("Focus mode pauses the distracting categories and spares more specific work sites", async () => {
  const w = makeWorld();
  w.tabs = [{ id: 1, url: "https://github.com/a", active: true, audible: false },
            { id: 2, url: "https://www.reddit.com/r/all", active: false, audible: false }];
  w.local.focus = { on: true };
  const wk = bootWorker(w);
  await settle();
  const c = rule(w, FOCUS).condition;
  for (const d of ["reddit.com", "youtube.com", "amazon.com", "bbc.com"]) assert.ok(c.requestDomains.includes(d), d);
  assert.ok(!c.requestDomains.includes("github.com"));
  assert.ok(c.excludedRequestDomains.includes("aws.amazon.com"));   // Work, under Shopping's amazon.com
  assert.equal(w.tabs[0].url, "https://github.com/a");
  assert.ok(w.tabs[1].url.startsWith(PAUSED));
  assert.deepEqual({ ...(await wk.whyPaused("reddit.com")).reason }, { kind: "focus", cat: "Social" });
});

test("Focus mode follows the categories you pick", async () => {
  const w = makeWorld();
  w.local.focus = { on: true, cats: ["Shopping"] };
  const wk = bootWorker(w);
  await settle();
  assert.ok(rule(w, FOCUS).condition.requestDomains.includes("amazon.com"));
  assert.ok(!rule(w, FOCUS).condition.requestDomains.includes("reddit.com"));
  await wk.store({ focus: { on: false, cats: ["Shopping"] } }); await settle();
  assert.equal(w.rules.length, 0);
});

test("a break lifts Focus mode, and it comes back when the break ends", async () => {
  const w = makeWorld();
  w.local.focus = { on: true };
  const wk = bootWorker(w);
  await settle();
  const until = w.now + 5 * MIN;
  await wk.store({ focus: { on: true, breakUntil: until } }); await settle();
  assert.equal(w.rules.length, 0);
  assert.equal(w.alarms.focusBreak.when, until);
  w.now = until; wk.ev.alarm.fire({ name: "focusBreak" }); await settle();
  assert.equal(w.local.focus.breakUntil, null);
  assert.ok(rule(w, FOCUS));
});

test("a site Focus mode only knows by a guess is paused when a tab opens it", async () => {
  const w = makeWorld();
  w.tabs.push({ id: 2, url: "about:blank", active: false, audible: false });
  w.local.focus = { on: true };
  const wk = bootWorker(w);
  await settle();
  assert.ok(!rule(w, FOCUS).condition.requestDomains.includes("coolgaming.net"));
  w.tabs[1].url = "https://coolgaming.net/play";      // guessed Entertainment from its name
  wk.ev.tabsUpd.fire(2, { url: w.tabs[1].url }, w.tabs[1]); await settle();
  assert.ok(w.tabs[1].url.startsWith(PAUSED));
});

test("block rules are only rewritten when they change", async () => {
  const w = makeWorld();
  w.local.focus = { on: true };
  const wk = bootWorker(w);
  await settle();
  const first = w.rules;
  w.now += MIN; wk.tick(); await settle();
  assert.equal(w.rules, first);                        // same array: no updateSessionRules call
});

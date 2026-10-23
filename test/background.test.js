const test = require("node:test");
const assert = require("node:assert/strict");
const { makeWorld, bootWorker, settle, stats } = require("./fake-chrome");

const SEC = 1000, MIN = 60 * SEC;

test("counts time and one visit on the focused tab", async () => {
  const w = makeWorld();
  const wk = bootWorker(w);
  await settle();
  w.now += 30 * SEC; wk.tick(); await settle();
  assert.deepEqual(stats(w, "github.com"), { s: 30, v: 1 });
});

test("no time while another app is in front, even after the worker restarts", async () => {
  const w = makeWorld();
  const wk = bootWorker(w);
  await settle();
  w.now += 20 * SEC;
  w.focused = false; wk.ev.focus.fire(-1); await settle();
  w.now += 5 * MIN;
  const wk2 = bootWorker(w); await settle();     // suspended worker wakes up
  w.now += MIN; wk2.tick(); await settle();
  assert.equal(stats(w, "github.com").s, 20);
});

test("coming back to the same tab or navigating within a site is not a new visit", async () => {
  const w = makeWorld();
  const wk = bootWorker(w);
  await settle();
  w.focused = false; wk.ev.focus.fire(-1); await settle();
  w.focused = true; wk.ev.focus.fire(1); await settle();
  w.tabs[0].url = "https://github.com/b";
  wk.ev.tabsUpd.fire(1, { url: w.tabs[0].url }, w.tabs[0]); await settle();
  assert.equal(stats(w, "github.com").v, 1);
  w.tabs[0].url = "https://www.youtube.com/watch?v=1";
  wk.ev.tabsUpd.fire(1, { url: w.tabs[0].url }, w.tabs[0]); await settle();
  assert.equal(stats(w, "youtube.com").v, 1);
});

test("overlapping events after a cold start count time once", async () => {
  const w = makeWorld();
  bootWorker(w);
  await settle();
  w.now += 40 * SEC;
  w.tabs = [{ id: 2, url: "https://youtube.com/", active: true, audible: false }];
  const wk2 = bootWorker(w);
  wk2.ev.focus.fire(1); wk2.ev.tabsAct.fire({ tabId: 2 });
  await settle();
  assert.equal(stats(w, "github.com").s, 40);
  assert.equal(stats(w, "youtube.com").v, 1);
});

test("an audible tab keeps counting while idle; silence stops it and trims the idle minute", async () => {
  const w = makeWorld();
  const wk = bootWorker(w);
  await settle();
  w.idle = "idle"; w.tabs[0].audible = true;
  w.now += MIN; wk.tick(); await settle();
  assert.equal(stats(w, "github.com").s, 60);
  w.tabs[0].audible = false;
  w.now += MIN; wk.tick(); await settle();
  w.now += 10 * MIN; wk.tick(); await settle();
  assert.equal(stats(w, "github.com").s, 60);
});

test("a long gap (PC asleep) is capped, not credited in full", async () => {
  const w = makeWorld();
  const wk = bootWorker(w);
  await settle();
  w.now += 3 * 60 * MIN; wk.tick(); await settle();
  assert.ok(stats(w, "github.com").s <= 120);
});

test("incognito windows are never recorded", async () => {
  const w = makeWorld();
  w.incognito = true;
  const wk = bootWorker(w);
  await settle();
  w.now += MIN; wk.tick(); await settle();
  assert.deepEqual(stats(w, "github.com"), { s: 0, v: 0 });
});

test("focusing undocked DevTools keeps counting the page, but not when idle", async () => {
  const w = makeWorld();
  const wk = bootWorker(w);
  await settle();
  w.devtools = true; wk.ev.focus.fire(9); await settle();
  w.now += MIN; wk.tick(); await settle();
  assert.equal(stats(w, "github.com").s, 60);
  w.idle = "idle";
  w.now += MIN; wk.tick(); await settle();
  w.now += 5 * MIN; wk.tick(); await settle();
  assert.equal(stats(w, "github.com").s, 60);
});

test("switching sites saves both changes in one storage write", async () => {
  const w = makeWorld();
  const wk = bootWorker(w);
  await settle();
  w.now += 30 * SEC;
  const before = w.v1Writes;
  w.tabs[0].url = "https://youtube.com/";
  wk.ev.tabsUpd.fire(1, { url: w.tabs[0].url }, w.tabs[0]); await settle();
  assert.equal(w.v1Writes - before, 1);
  assert.equal(stats(w, "github.com").s, 30);
  assert.equal(stats(w, "youtube.com").v, 1);
});

test("the trail records starts, switches, pauses and resumes in order", async () => {
  const w = makeWorld();
  const wk = bootWorker(w);
  await settle();
  w.now += MIN;
  w.tabs[0].url = "https://reddit.com/";
  wk.ev.tabsUpd.fire(1, { url: w.tabs[0].url }, w.tabs[0]); await settle();
  w.now += MIN;
  w.focused = false; wk.ev.focus.fire(-1); await settle();
  w.now += MIN;
  w.focused = true; wk.ev.focus.fire(1); await settle();
  const entries = Object.values(w.local.trail).flat().map(e => e.d);
  assert.deepEqual(entries, ["github.com", "reddit.com", null, "reddit.com"]);
});

test("after Chrome restarts, a trail left open is closed where counting stopped", async () => {
  const w = makeWorld();
  const wk = bootWorker(w);
  await settle();
  w.now += MIN; wk.tick(); await settle();        // counted up to here
  const stoppedAt = w.now;
  w.now += 60 * MIN;
  for (const k of Object.keys(w.session)) delete w.session[k];   // Chrome restart clears session storage
  bootWorker(w); await settle();
  const entries = Object.values(w.local.trail).flat();
  assert.deepEqual(entries.map(e => e.d), ["github.com", null, "github.com"]);
  assert.equal(entries[1].t, stoppedAt);
});

test("opening the toolbar popup doesn't pause tracking", async () => {
  const w = makeWorld();
  const wk = bootWorker(w);
  await settle();
  /* Windows: the popup takes keyboard focus, so Chrome reports no focused window */
  w.focused = false; wk.ev.focus.fire(-1);
  const close = wk.openPopup(); await settle();
  w.now += MIN; wk.tick(); await settle();
  assert.equal(stats(w, "github.com").s, 60);
  assert.equal((await wk.live()).tracking, true);
  close(); await settle();               // popup closed and Chrome still not in front: pause
  assert.equal((await wk.live()).tracking, false);
});

test("a pause records why, for the UI", async () => {
  const w = makeWorld();
  const wk = bootWorker(w);
  await settle();
  w.focused = false; wk.ev.focus.fire(-1); await settle();
  assert.equal((await wk.live()).why, "Chrome isn't the window in front");
  w.focused = true; w.idle = "idle"; wk.ev.idle.fire("idle"); await settle();
  assert.equal((await wk.live()).why, "no activity for a minute");
  w.idle = "active"; w.tabs[0].url = "chrome://newtab/"; wk.ev.tabsUpd.fire(1, { url: w.tabs[0].url }, w.tabs[0]); await settle();
  assert.equal((await wk.live()).why, "this tab isn't a website");
});

test("the worker reports its build, so the pages can spot an outdated worker", async () => {
  const { loadLib } = require("./fake-chrome");
  const L = loadLib();
  const w = makeWorld();
  w.focused = false;                       // nothing tracked yet: still answers with its build
  const wk = bootWorker(w);
  await settle();
  const live = await wk.live();
  assert.equal(live.build, L.TL_BUILD);
  assert.equal(L.workerStale(live), false);
  assert.equal(L.workerStale(null), true);                    // no answer at all
  assert.equal(L.workerStale({ tracking: true }), true);      // a worker from before builds existed
});

test("music playing in Chrome counts while another app is in front, as background time", async () => {
  const w = makeWorld();
  w.tabs = [{ id: 1, url: "https://github.com/a", active: true, audible: false },
            { id: 2, url: "https://www.youtube.com/watch?v=1", active: false, audible: true }];
  const wk = bootWorker(w);
  await settle();
  w.focused = false; wk.ev.focus.fire(-1); await settle();
  w.now += MIN; wk.tick(); await settle();
  const live = await wk.live();
  assert.equal(live.domain, "youtube.com");
  assert.equal(live.tracking, true);
  assert.equal(live.bg, true);
  assert.equal(stats(w, "youtube.com").s, 60);
  const marks = Object.values(w.local.trail).flat();
  assert.equal(marks[marks.length - 1].b, 1);          // drift detection can tell it apart
  w.tabs[1].mutedInfo = { muted: true };                // muted: not listening any more
  w.now += MIN; wk.tick(); await settle();
  assert.equal((await wk.live()).tracking, false);
});

test("the tick alarm is created once across worker restarts", async () => {
  const w = makeWorld();
  bootWorker(w); await settle();
  bootWorker(w); await settle();
  assert.equal(w.alarmCreates, 1);
});

test("live readout keeps the visit timer running across ticks", async () => {
  const w = makeWorld();
  const wk = bootWorker(w);
  await settle();
  w.now += 70 * SEC; wk.tick(); await settle();
  w.now += 5 * SEC;
  const live = await wk.live();
  assert.equal(live.domain, "github.com");
  assert.equal(live.tracking, true);
  assert.equal(live.elapsed, 5000);
  assert.equal(live.visitMs, 75000);
});

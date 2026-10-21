/* Minimal fake of the chrome.* APIs TimeLens uses, so the worker can run under `node --test`.
   `world` is the shared state (clock, focus, idle, tabs, storage) a test can change between steps. */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const clone = x => (x === undefined ? x : JSON.parse(JSON.stringify(x)));

function event() {
  const ls = [];
  return { addListener: f => ls.push(f), fire: (...a) => ls.map(f => f(...a)) };
}
function area(data, world) {
  return {
    async get(keys) {
      if (keys == null) return clone(data);
      const out = {};
      for (const k of [].concat(keys)) if (k in data) out[k] = clone(data[k]);
      return out;
    },
    async set(obj) {
      if (world && "v1" in obj) world.v1Writes++;
      Object.assign(data, clone(obj));
    },
    async remove(k) { delete data[k]; },
    async clear() { for (const k in data) delete data[k]; },
  };
}

function makeWorld() {
  return {
    now: new Date(2026, 9, 16, 10, 0, 0).getTime(),
    focused: true,
    idle: "active",
    tabs: [{ id: 1, url: "https://github.com/a", active: true, audible: false }],
    local: {}, session: {}, alarms: {}, alarmCreates: 0, v1Writes: 0,
  };
}

function makeChrome(world, ev) {
  return {
    storage: { local: area(world.local, world), session: area(world.session) },
    idle: { setDetectionInterval() {}, queryState: async () => world.idle, onStateChanged: ev.idle },
    tabs: {
      query: async () => clone(world.tabs.filter(t => t.active)),
      get: async id => clone(world.tabs.find(t => t.id === id)),
      onActivated: ev.tabsAct, onUpdated: ev.tabsUpd, onRemoved: ev.tabsRem,
    },
    windows: {
      WINDOW_ID_NONE: -1,
      getLastFocused: async (opts = {}) => {
        const types = opts.windowTypes || ["normal", "popup"];
        if (world.devtools && types.includes("devtools")) return { id: 9, type: "devtools", focused: true, tabs: [] };
        return { id: 1, type: "normal", focused: world.focused && !world.devtools,
                 incognito: !!world.incognito, tabs: clone(world.tabs) };
      },
      onFocusChanged: ev.focus,
    },
    alarms: {
      get: async n => world.alarms[n] || null,
      create: (n, o) => { world.alarms[n] = o; world.alarmCreates++; },
      onAlarm: ev.alarm,
    },
    runtime: { onStartup: ev.startup, onMessage: ev.msg, getURL: p => "chrome-extension://test" + p },
  };
}

function context(world, chrome) {
  class FakeDate extends Date {
    constructor(...a) { super(...(a.length ? a : [world.now])); }
    static now() { return world.now; }
  }
  const ctx = vm.createContext({ chrome, Date: FakeDate, console, URL });
  ctx.importScripts = (...files) => files.forEach(f => run(ctx, f));
  return ctx;
}
function run(ctx, file) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), ctx, { filename: file });
}

/* Starts a fresh worker over the same world, like Chrome waking a suspended service worker. */
function bootWorker(world) {
  const ev = Object.fromEntries(
    ["tabsAct", "tabsUpd", "tabsRem", "focus", "idle", "startup", "alarm", "msg"].map(k => [k, event()]));
  const ctx = context(world, makeChrome(world, ev));
  run(ctx, "background.js");
  return {
    ev,
    tick: () => ev.alarm.fire({ name: "tick" }),
    live: () => new Promise(r => ev.msg.fire({ type: "getLive" }, {}, r)),
  };
}

/* Loads lib.js on its own and returns its globals. */
function loadLib() {
  const world = makeWorld();
  const ctx = context(world, { runtime: { getURL: p => "chrome-extension://test" + p } });
  run(ctx, "lib.js");
  return vm.runInContext(
    `({ catFor, catsFrom, resolveCat, renameCategory, fmt, clock, esc, addLive, blankDay, domainOf, dayKey,
        BUILTIN_CATS, guessCat, findDrifts, trailEntries, mascotMood })`, ctx);
}

/* lets every pending promise chain in the worker finish */
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };

function stats(world, domain) {
  const v = world.local.v1 || {};
  let s = 0, visits = 0;
  for (const day of Object.values(v)) {
    const e = day.domains[domain];
    if (e) { s += e.s; visits += e.v; }
  }
  return { s, v: visits };
}

module.exports = { makeWorld, bootWorker, loadLib, settle, stats };

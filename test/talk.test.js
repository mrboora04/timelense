/* Lens's own words (talk.js): the JS runtime must reproduce the trained model, and every line
   it lets through must be short, use only live values the situation has, and fall back to
   mascotMood's fixed text when switched off or when the model is missing. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..", process.env.TL_ROOT || ".");
const BIN = fs.readFileSync(path.join(ROOT, "model/lens.bin"));
const CHECK = require("../model/check.json");

/* lib.js + talk.js with fake storage; fetch only knows the extension's own model file */
function load({ local = {}, model = true } = {}) {
  const session = {}, fetched = [];
  const area = data => ({
    get: async k => (k in data ? { [k]: JSON.parse(JSON.stringify(data[k])) } : {}),
    set: async o => { Object.assign(data, JSON.parse(JSON.stringify(o))); },
  });
  const chrome = { storage: { local: area(local), session: area(session) }, runtime: { getURL: p => "chrome-extension://test/" + p } };
  const fetch = async url => {
    fetched.push(url);
    if (!model || url !== "chrome-extension://test/model/lens.bin") throw new Error("no network");
    return { arrayBuffer: async () => BIN.buffer.slice(BIN.byteOffset, BIN.byteOffset + BIN.length) };
  };
  const ctx = vm.createContext({ chrome, fetch, TextDecoder, console, Date });
  for (const f of ["lib.js", "talk.js"]) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx, { filename: f });
  ctx.M = vm.runInContext("lensModel", ctx)(BIN.buffer.slice(BIN.byteOffset, BIN.byteOffset + BIN.length));
  return { ctx, session, fetched, run: code => vm.runInContext(code, ctx) };
}
/* seeded random numbers, so sampled lines are the same on every run */
const seeded = seed => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

const MIN = 60;
/* one context per situation mascotMood can be in */
const SITUATIONS = {
  idle: { onSite: false },
  paused: { onSite: true, tracking: false, why: "screen locked", total: 3000 },
  bg: { onSite: true, tracking: true, bg: true, total: 3000 },
  doom: { onSite: true, tracking: true, total: 9000, drift: { from: null, leftAt: 0, secs: 20 * MIN, sites: ["x.com", "reddit.com"] } },
  start: { onSite: true, tracking: true, total: 600, drift: { from: null, leftAt: 0, secs: 6 * MIN, sites: ["youtube.com"] } },
  drift_long: { onSite: true, tracking: true, total: 9000, drift: { from: "github.com", leftAt: 0, secs: 18 * MIN, sites: ["x.com"] } },
  drift: { onSite: true, tracking: true, total: 9000, drift: { from: "github.com", leftAt: 0, secs: 6 * MIN, sites: ["x.com"] } },
  streak: { onSite: true, tracking: true, total: 9000, streak: 40 * MIN },
  hello: { onSite: true, tracking: true, total: 30 },
  ok: { onSite: true, tracking: true, total: 9000 },
};

test("the model knows every situation mascotMood can be in, with the same live values", () => {
  const { ctx, run } = load();
  for (const [sit, c] of Object.entries(SITUATIONS)) {
    const m = run("mascotMood")(c);
    assert.equal(m.say, sit);
    assert.deepEqual(Object.keys(m.slots).sort(), [...ctx.M.slots[sit]].sort(), sit);
  }
});

test("the JS runtime reproduces the trained model's output", () => {
  const { ctx, run } = load();
  const gen = run("lensGenerate"), step = run("lensStep");
  for (const c of CHECK) {
    assert.equal(gen(ctx.M, c.prompt, Math.random, true), c.text, c.prompt);
    const cache = [];
    let logits;
    c.prompt.split(" ").forEach((t, i) => { logits = step(ctx.M, cache, ctx.M.stoi[t], i); });
    c.logits.forEach((v, i) => assert.ok(Math.abs(logits[i] - v) < 1e-3, `${c.prompt} logit ${i}`));
  }
});

test("sampled lines are short, kind and use only the situation's live values", () => {
  const { ctx, run } = load();
  const gen = run("lensGenerate"), valid = run("lensValid"), prompt = run("lensPrompt");
  const rand = seeded(7);
  let ok = 0, n = 0;
  for (const [sit, c] of Object.entries(SITUATIONS)) {
    const m = run("mascotMood")(c);
    for (const hour of [8, 14, 19, 23]) {
      for (let i = 0; i < 5; i++) {
        const t = gen(ctx.M, prompt(m, hour), rand);
        n++;
        if (valid(t, ctx.M.slots[sit])) ok++;
        assert.doesNotMatch(t, /\b(should|must|waste|wasting|lazy|stop)\b/i, t);
      }
    }
  }
  assert.ok(ok / n >= 0.9, `${ok}/${n} valid`);
});

test("the checks reject lines Lens must never show", () => {
  const { run } = load();
  const valid = run("lensValid");
  assert.ok(valid("{total} today. Looking steady.", ["total"]));
  assert.ok(!valid("{site} for {dur}.", ["dur"]), "a value this situation doesn't have");
  assert.ok(!valid("{dur} and {dur}.", ["dur"]), "the same value twice");
  assert.ok(!valid("Line one.\nLine two.", []), "two lines");
  assert.ok(!valid("x".repeat(95) + ".", []), "too long");
  assert.ok(!valid("all good", []), "unfinished");
});

test("one line per situation, with live values filled on every render", async () => {
  const { session, run } = load();
  const says = run("lensSays"), mood = run("mascotMood");
  const a = await says(mood({ ...SITUATIONS.ok, total: 9000 }));
  assert.equal(a.mood, "happy");
  assert.match(a.text, /2h 30m/);
  assert.doesNotMatch(a.text, /[{}]/);
  const line = session.lensSaid.line;
  const b = await says(mood({ ...SITUATIONS.ok, total: 9060 }));   // a minute later: same line, new number
  assert.equal(session.lensSaid.line, line);
  assert.match(b.text, /2h 31m/);
  await says(mood(SITUATIONS.streak));                              // the situation changed: a new line
  assert.equal(session.lensSaid.say, "streak");
});

test("off switch, missing model and failures all fall back to the fixed lines", async () => {
  const fixed = "All good. 2h 30m browsed today.";
  const off = load({ local: { lensTalk: false } });
  assert.equal((await off.run("lensSays")(off.run("mascotMood")(SITUATIONS.ok))).text, fixed);
  assert.deepEqual(off.fetched, [], "switched off, the model isn't even loaded");
  const missing = load({ model: false });
  assert.equal((await missing.run("lensSays")(missing.run("mascotMood")(SITUATIONS.ok))).text, fixed);
  const broken = load();
  broken.ctx.chrome.storage.session = undefined;
  assert.equal((await broken.run("lensSays")(broken.run("mascotMood")(SITUATIONS.ok))).text, fixed);
});

test("the only thing fetched is the model file inside the extension", async () => {
  const { fetched, run } = load();
  for (const c of Object.values(SITUATIONS)) await run("lensSays")(run("mascotMood")(c));
  assert.deepEqual([...new Set(fetched)], ["chrome-extension://test/model/lens.bin"]);
});

test("a model line can be rated Good, Bad or Skip once, and only the template is kept", async () => {
  const { session, run, ctx } = load({ local: {} });
  const says = run("lensSays"), mood = run("mascotMood"), vote = run("lensVote");
  const m = await says(mood({ ...SITUATIONS.drift, drift: { from: "github.com", leftAt: 0, secs: 6 * MIN, sites: ["x.com"] } }));
  assert.equal(m.rate.say, "drift");
  assert.match(m.text, /github\.com/);
  assert.match(m.rate.line, /\{from\}/, "the template is rated, not the filled-in text");
  await vote(m.rate, "-1");
  await vote(m.rate, "1");                                   // a second vote on the same line is ignored
  const votes = JSON.parse(JSON.stringify((await ctx.chrome.storage.local.get("lensVotes")).lensVotes));
  assert.equal(votes.length, 1);
  assert.equal(votes[0].v, -1);
  assert.equal(votes[0].say, "drift");
  assert.ok(!JSON.stringify(votes).includes("github.com"));
  assert.equal((await says(mood(SITUATIONS.drift))).rate, null, "nothing to rate until Lens writes a new line");
  await says(mood(SITUATIONS.streak));                      // new situation, new line, rateable again
  assert.ok(session.lensSaid.voted !== true);
});

test("fixed lines and the off switch have nothing to rate", async () => {
  const off = load({ local: { lensTalk: false } });
  assert.equal((await off.run("lensSays")(off.run("mascotMood")(SITUATIONS.ok))).rate, undefined);
  const missing = load({ model: false });
  assert.equal((await missing.run("lensSays")(missing.run("mascotMood")(SITUATIONS.ok))).rate, undefined);
});

test("the tally counts good, bad and skipped votes", () => {
  const { run } = load();
  assert.equal(run("lensTally")(), "No ratings yet.");
  assert.equal(run("lensTally")([{ v: 1 }, { v: 1 }, { v: -1 }, { v: 0 }]), "2 good · 1 bad · 1 skipped");
});

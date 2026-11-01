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
  ok: { onSite: true, tracking: true, total: 9000, top: "github.com", vs: "more", drifts: 1 },
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
  assert.doesNotMatch(a.text, /[{}]/);
  const line = session.lensSaid.line, hasTotal = line.includes("{total}");   // some lines (questions) have no number
  if (hasTotal) assert.match(a.text, /2h 30m/);
  const b = await says(mood({ ...SITUATIONS.ok, total: 9060 }));   // a minute later: same line, new number
  assert.equal(session.lensSaid.line, line);
  if (hasTotal) assert.match(b.text, /2h 31m/);
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
  const next = await says(mood(SITUATIONS.drift));            // straight after a vote: a new line to rate
  assert.ok(next.rate && next.rate.line !== m.rate.line);
  assert.notEqual(session.lensSaid.voted, true);
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

test("ratings steer Lens: a line you rated Bad is never written again", async () => {
  const votes = [{ say: "ok", line: "x", v: 1 }, { say: "ok", line: "x", v: 1 }, { say: "ok", line: "y", v: -1 }, { say: "ok", line: "y", v: 0 }];
  const { ctx, run } = load();
  assert.deepEqual(JSON.parse(JSON.stringify(run("lensScores")(votes))), { "ok|x": 2, "ok|y": -1 });
  const P = "<ok> <evening> <usual>", write = run("lensWrite"), gen = run("lensGenerate");
  const first = gen(ctx.M, P, seeded(3));
  const scores = { ["ok|" + first]: -1 };
  for (let s = 1; s <= 40; s++) {
    const t = write(ctx.M, "ok", P, scores, seeded(s));
    assert.notEqual(t, first);
    assert.ok(t === null || t.length > 0);
  }
});

test("in the bubble too: a Bad line is replaced by another one", async () => {
  const live = load({ local: { lensRate: false } });
  const say = live.run("lensSays"), mood = live.run("mascotMood");
  const a = await say(mood(SITUATIONS.ok));
  const bad = live.session.lensSaid.line;
  const { ctx, session, run } = load({ local: { lensVotes: [{ say: "ok", line: bad, v: -1 }] } });
  for (let i = 0; i < 25; i++) {
    delete session.lensSaid;
    await run("lensSays")(run("mascotMood")(SITUATIONS.ok));
    assert.notEqual(session.lensSaid.line, bad);
  }
  assert.ok(a.text);
});

test("rate, rate, rate: every vote is followed at once by a different line, unrated ones first", async () => {
  const { session, run, ctx } = load({ local: { lensRate: false } });
  const says = run("lensSays"), mood = run("mascotMood"), vote = run("lensVote");
  const seen = new Set();
  let m = await says(mood(SITUATIONS.ok));
  for (let i = 0; i < 12; i++) {
    assert.ok(m.rate, `line ${i} can be rated`);
    seen.add(m.rate.line);
    const rated = m.rate.line;
    await vote(m.rate, ["1", "0", "-1"][i % 3]);
    m = await says(mood(SITUATIONS.ok));
    assert.notEqual(m.rate.line, rated, "never the line you just rated");
  }
  assert.ok(seen.size >= 9, `${seen.size} different lines in 12 ratings`);
  assert.equal(JSON.parse(JSON.stringify((await ctx.chrome.storage.local.get("lensVotes")).lensVotes)).length, 12);
});

test("Lens reads your history: today against yesterday, drifts today, the top site", () => {
  const { run } = load();
  const vs = run("vsToken"), mood = run("mascotMood"), prompt = run("lensPrompt");
  assert.equal(vs(null, 9000), "none");
  assert.equal(vs(300, 9000), "same");        // within 15%
  assert.equal(vs(3000, 9000), "more");
  assert.equal(vs(-3000, 9000), "less");
  const m = mood({ ...SITUATIONS.ok, vs: "less", drifts: 4 });
  assert.equal(m.vs, "less");
  assert.equal(m.dr, "many");
  assert.equal(prompt(m, 20), "<ok> <evening> <usual> <less> <many>");
  assert.equal(mood({ ...SITUATIONS.ok, drifts: 0 }).dr, "none");
  assert.equal(mood({ ...SITUATIONS.ok, drifts: 2 }).dr, "some");
  assert.equal(mood({ ...SITUATIONS.hello, vs: "more", drifts: 5 }).vs, "none", "the first minutes of the day have no history yet");
  assert.deepEqual(Object.keys(mood({ ...SITUATIONS.ok, top: "" }).slots), ["total"], "no top site, no {top} slot");
  assert.equal(run("topSite")({ domains: { "a.com": { s: 5 }, "b.com": { s: 50 } } }), "b.com");
  assert.equal(run("topSite")({ domains: {} }), "");
});

test("only drifts that started today count", () => {
  const { run } = load();
  const now = Date.now(), day = 24 * 3600 * 1000;
  assert.equal(run("driftsToday")([{ leftAt: now - day * 1.5 }, { leftAt: now - 1000 }, { leftAt: now }]), 2);
});

test("a line can't claim a history it doesn't have", () => {
  const { run } = load();
  const fits = run("lensFits");
  assert.ok(fits("{total} today, more than yesterday so far.", "<ok> <evening> <usual> <more> <none>"));
  assert.ok(!fits("{total} today, more than yesterday so far.", "<ok> <evening> <usual> <less> <none>"));
  assert.ok(!fits("{total} today, more than yesterday so far.", "<ok> <evening> <usual> <none> <none>"), "no yesterday to compare with");
  assert.ok(!fits("No detours so far, {total} in.", "<ok> <evening> <usual> <same> <many>"));
  assert.ok(fits("A detour or two so far, and {total} in. All fine.", "<ok> <evening> <usual> <same> <some>"));
  assert.ok(fits("{total} today.", "<ok> <evening> <usual> <none> <none>"));
});

test("the JS guard list is the one the model was trained with (model/data.py)", () => {
  const { run } = load();
  const py = fs.readFileSync(path.join(__dirname, "..", "model/data.py"), "utf8");
  const block = py.match(/GUARDS = \[([\s\S]*?)\]\r?\n/)[1];
  const fromPy = [...block.matchAll(/\("([^"]+)", (\d), "([a-z]+)"\)/g)].map(m => [m[1], Number(m[2]), m[3]]);
  assert.ok(fromPy.length >= 6);
  assert.deepEqual(JSON.parse(JSON.stringify(run("LENS_GUARDS"))), fromPy);
});

test("the model's lines for each history fit it, over many samples", () => {
  const { ctx, run } = load();
  const gen = run("lensGenerate"), fits = run("lensFits"), valid = run("lensValid");
  const rand = seeded(11);
  let n = 0, ok = 0;
  for (const vs of ["more", "less", "same", "none"]) {
    for (const dr of ["none", "some", "many"]) {
      for (const say of ["ok", "streak"]) {
        for (let i = 0; i < 6; i++) {
          const p = `<${say}> <evening> <usual> <${vs}> <${dr}>`, t = gen(ctx.M, p, rand);
          n++;
          if (valid(t, ctx.M.slots[say]) && fits(t, p)) ok++;
        }
      }
    }
  }
  assert.ok(ok / n >= 0.9, `${ok}/${n} fit`);
});

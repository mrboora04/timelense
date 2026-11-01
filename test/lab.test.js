/* Train Lens (lab.js): rating many lines in a row. Runs the real model and talk.js with fake
   storage and a stub for the few page elements the lab paints. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..", process.env.TL_ROOT || ".");
const BIN = fs.readFileSync(path.join(ROOT, "model/lens.bin"));
const bufOf = () => BIN.buffer.slice(BIN.byteOffset, BIN.byteOffset + BIN.length);

function load({ local = {}, model = true } = {}) {
  const els = {};
  const area = data => ({
    get: async k => (k in data ? { [k]: JSON.parse(JSON.stringify(data[k])) } : {}),
    set: async o => { Object.assign(data, JSON.parse(JSON.stringify(o))); },
  });
  const chrome = { storage: { local: area(local), session: area({}) }, runtime: { getURL: p => "chrome-extension://test/" + p } };
  const fetch = async () => { if (!model) throw new Error("no model"); return { arrayBuffer: async () => bufOf() }; };
  const el = id => els[id] || (els[id] = { textContent: "", hidden: false, value: "mix" });
  const document = { getElementById: () => null, querySelectorAll: () => [] };   // no page: the wiring is skipped
  const ctx = vm.createContext({ chrome, fetch, TextDecoder, console, Date, document, $: el });
  for (const f of ["lib.js", "talk.js", "lab.js"]) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx, { filename: f });
  return { els, local, run: code => vm.runInContext(code, ctx) };
}
const seeded = seed => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const votesOf = async run => run("chrome.storage.local.get('lensVotes')").then(r => JSON.parse(JSON.stringify(r.lensVotes || [])));

test("every situation the model can be in has a line to rate, a plain-words context, and no unfilled slot", async () => {
  const { run } = load();
  const next = run("labNext"), M = await run("lensLoad")();
  assert.deepEqual(Object.keys(M.slots).sort(), Object.keys(run("LAB_WHEN")).sort(), "LAB_WHEN covers each situation");
  for (const say of Object.keys(M.slots)) {
    const s = await next(say, seeded(3));
    assert.equal(s.say, say);
    assert.ok(run("lensValid")(s.line, M.slots[say]), `${say}: ${s.line}`);
    assert.ok(!/[{}]/.test(run("lensFill")(s.line, run("LAB_EXAMPLE"))), `${say}: slots all filled`);
    assert.ok(["morning", "afternoon", "evening", "night"].includes(s.tod));
    assert.ok(say !== "hello" || s.amt === "light");
  }
});

test("'all situations' goes to the least-rated one first", async () => {
  const sits = Object.keys(load().run("LAB_WHEN"));
  const votes = sits.filter(s => s !== "bg").flatMap(say => [{ t: 1, say, line: "x.", tod: "evening", amt: "usual", v: 1 }]);
  const { run } = load({ local: { lensVotes: votes } });
  assert.equal((await run("labNext")("mix", seeded(5))).say, "bg");
});

test("lines you haven't rated come before ones you have", async () => {
  const left = "I'm ready whenever you open a site.";
  const rated = ["Open a website and I'll start counting.", "Nothing to count on this page. Open a site and I'm on it.",
    "This tab isn't a website, so I'm just resting.", "Quiet tab. I'll start counting when a website shows up.",
    "Pick a site and I'll keep time for you.", "No website here yet. I'll be watching for one.",
    "All set. Open a site and I'll start the clock."];
  const { run } = load({ local: { lensVotes: rated.map(line => ({ t: 1, say: "idle", line, tod: "night", amt: "light", v: 0 })) } });
  const s = await run("labNext")("idle", seeded(11));
  assert.equal(s.again, false);
  assert.ok(!rated.includes(s.line), s.line);
});

test("once every line has been rated, it says so and keeps going", async () => {
  const { run } = load();
  const M = await run("lensLoad")(), gen = run("lensGenerate"), valid = run("lensValid"), rand = seeded(1);
  const all = new Set();
  for (let i = 0; i < 600; i++) { const t = gen(M, "<bg> <afternoon> <usual> <none> <none>", rand); if (valid(t, M.slots.bg)) all.add(t); }
  const lens = load({ local: { lensVotes: [...all].map(line => ({ t: 1, say: "bg", line, tod: "night", amt: "light", v: 1 })) } });
  const s = await lens.run("labNext")("bg", seeded(2));
  assert.equal(s.again, true);
  assert.ok(all.has(s.line));
});

test("rating saves a lab vote with the template only, shows the next line, and Undo takes it back", async () => {
  const { run, els } = load();
  await run("labShow")();
  const first = run("lab").sample;
  assert.ok(first && !/[{}]/.test(els.labLine.textContent), "an example-filled line is on screen");
  await run("labVoteNow")("-1");
  let votes = await votesOf(run);
  assert.equal(votes.length, 1);
  assert.deepEqual([votes[0].say, votes[0].line, votes[0].v, votes[0].lab], [first.say, first.line, -1, 1]);
  assert.ok(!JSON.stringify(votes).includes("youtube.com"), "example names are never saved");
  assert.notEqual(run("lab").sample.line, first.line, "the next line is a different one");
  assert.equal(els.labCount.textContent.startsWith("1 rated"), true);
  await run("labUndoNow")();
  assert.equal((await votesOf(run)).length, 0);
  assert.equal(run("lab").sample.line, first.line, "the same line comes back after Undo");
});

test("ratings keep the most recent 3000", async () => {
  const { run } = load({ local: { lensVotes: Array.from({ length: 2999 }, (_, i) => ({ t: i, say: "ok", line: "a.", tod: "night", amt: "light", v: 0 })) } });
  const log = run("lensLog");
  await log("ok", "b.", "night", "light", 1, true);
  await log("ok", "c.", "night", "light", 1, true);
  const votes = await votesOf(run);
  assert.equal(votes.length, 3000);
  assert.equal(votes.at(-1).line, "c.");
  assert.equal(votes[0].t, 1, "the oldest one dropped off");
});

test("without the model there is nothing to rate, and the buttons say so", async () => {
  const { run, els } = load({ model: false });
  assert.equal(await run("labNext")("mix"), null);
  await run("labShow")();
  assert.match(els.labLine.textContent, /couldn't load/);
  await run("labVoteNow")("1");
  assert.equal((await votesOf(run)).length, 0);
});

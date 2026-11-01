/* Garbled-line check (talk.js lensKnown + model/pairs.py): a line whose neighbouring words never
   meet in the training lines is dropped, and the lines the model was trained on all pass. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..", process.env.TL_ROOT || ".");
const BIN = fs.readFileSync(path.join(ROOT, "model/lens.bin"));
const CHECK = require("../model/check.json");

function load() {
  const ctx = vm.createContext({ TextDecoder, console, Date, chrome: {} });
  for (const f of ["lib.js", "talk.js"]) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx, { filename: f });
  const M = vm.runInContext("lensModel", ctx)(BIN.buffer.slice(BIN.byteOffset, BIN.byteOffset + BIN.length));
  return { M, run: code => vm.runInContext(code, ctx) };
}
const seeded = seed => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

test("the model ships with its word pairs, split the same way as in model/pairs.py", () => {
  const { M, run } = load();
  assert.ok(M.pairs && M.pairs.size > 300, "lens.bin has the pair list");
  assert.ok(M.pairs.has("^ {total}") || M.pairs.has("^ {dur}"), "line starts are marked");
  const py = fs.readFileSync(path.join(__dirname, "..", "model/pairs.py"), "utf8");
  assert.equal(py.match(/WORD = re\.compile\(r"(.+?)"\)/)[1], run("LENS_WORD").source);
});

test("lines the model was trained on pass; glued-together lines don't", () => {
  const { M, run } = load();
  const known = run("lensKnown");
  for (const c of CHECK) assert.ok(known(c.text, M.pairs), c.text);   // greedy outputs are training lines
  assert.ok(!known("{dur} of focus streak of the clock.", M.pairs));
  assert.ok(!known("Was of focus. A stretch soon could feel great.", M.pairs));
  assert.ok(!known("One a?", M.pairs));
  assert.ok(known("Anything.", null), "a model without the list lets every line through");
});

test("Lens never shows a garbled line, and still finds a line for every situation", () => {
  const { M, run } = load();
  const write = run("lensWrite"), known = run("lensKnown");
  for (const say of Object.keys(M.slots)) {
    let found = 0;
    for (let s = 1; s <= 15; s++) {
      const t = write(M, say, `<${say}> <evening> <${say === "hello" ? "light" : "usual"}> <none> <none>`, {}, seeded(s));
      if (t === null) continue;
      found++;
      assert.ok(known(t, M.pairs), `${say}: ${t}`);
    }
    assert.ok(found >= 12, `${say}: ${found}/15 found a line`);
  }
});

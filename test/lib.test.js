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

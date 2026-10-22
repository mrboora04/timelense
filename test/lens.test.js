/* Lens QA, layer 1 of animation/character-animation-qa: schema checks on the rig and pose
   library, using the quality checklists from character-rigging and pose-library-design. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..", process.env.TL_ROOT || ".");
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(ROOT, "lens.js"), "utf8"), ctx);
const { LENS_RIG: rig, LENS_POSES: poses, LENS_MOUTHS: mouths, lensPartPose, lensTransform, lensSVG } =
  vm.runInContext("({ LENS_RIG, LENS_POSES, LENS_MOUTHS, lensPartPose, lensTransform, lensSVG })", ctx);
const parts = Object.fromEntries(rig.parts.map(p => [p.id, p]));

test("every part id is unique and every parent exists", () => {
  assert.equal(Object.keys(parts).length, rig.parts.length);
  for (const p of rig.parts) if (p.parent) assert.ok(parts[p.parent], `${p.id} -> missing parent ${p.parent}`);
});

test("every moving part has a pivot in the 64x64 artwork space", () => {
  const moved = new Set(Object.values(poses).flatMap(p => Object.keys(p.parts || {})));
  moved.add("body"); moved.add("eye_l"); moved.add("eye_r");   // body acts out transitions, eyes blink
  for (const id of moved) {
    assert.ok(parts[id], `pose moves unknown part ${id}`);
    const [x, y] = parts[id].pivot || [];
    assert.ok(x >= 0 && x <= 64 && y >= 0 && y <= 64, `${id} needs a pivot inside the artwork`);
  }
});

test("eyes and pupils are separate parts, so gaze can change", () => {
  assert.equal(parts.pupil_l.parent, "eye_l");
  assert.equal(parts.pupil_r.parent, "eye_r");
});

test("poses only reference existing parts, mouths and hidden extras", () => {
  for (const [name, pose] of Object.entries(poses)) {
    assert.ok(mouths[pose.mouth], `${name}: unknown mouth ${pose.mouth}`);
    for (const id of pose.show || []) assert.ok(parts[id] && parts[id].hidden, `${name}: show ${id} must be a hidden part`);
    for (const id of Object.keys(pose.parts || {})) assert.ok(parts[id], `${name}: unknown part ${id}`);
  }
});

test("every mood Lens can show has a pose", () => {
  for (const mood of ["happy", "wave", "proud", "curious", "worried", "sleep"]) assert.ok(poses[mood], mood);
});

test("pose values stay within the rig's limits", () => {
  for (const pose of Object.keys(poses)) {
    for (const [id, lim] of Object.entries(rig.limits)) {
      const v = lensPartPose(pose, id);
      for (const [k, [lo, hi]] of Object.entries(lim)) if (k in v) assert.ok(v[k] >= lo && v[k] <= hi, `${pose}.${id}.${k}`);
    }
  }
});

test("the SVG nests parts under their parents and orders them by layer", () => {
  const svg = lensSVG();
  for (const p of rig.parts) assert.ok(svg.includes(`data-part="${p.id}"`), p.id);
  assert.ok(svg.indexOf('data-part="rim"') < svg.indexOf('data-part="eye_l"'), "rim is drawn under the eyes");
  assert.equal(lensTransform({}), "translate(0px, 0px) rotate(0deg) scale(1, 1)");
});

/* Lens, the TimeLens mascot, built the way the character skills describe:
   - rig (animation/character-rigging): every part is data, with an explicit layer, a parent
     and a pivot in the 64x64 artwork space; limits keep moves physically sensible
   - pose library (animation/pose-library-design): a pose names only the parts it changes;
     everything else falls back to the rig defaults; mouths are a separate shape library
   - acting (svg-character-animation): transforms only, around each part's own pivot; a mood
     change plays anticipation -> action -> settle and then holds still (no constant motion)
   Plain script, no DOM needed for the data and pure functions (tested in test/lens.test.js). */

const LENS_RIG = {
  id: "lens",
  viewBox: "0 0 64 64",
  parts: [
    { id: "body",    layer: 10, pivot: [28, 40] },
    { id: "handle",  layer: 11, parent: "body", svg: `<line class="lens-handle" x1="45" y1="45" x2="57" y2="57"/>` },
    { id: "rim",     layer: 12, parent: "body", svg: `<circle class="lens-rim" cx="28" cy="28" r="22"/>` },
    { id: "glass",   layer: 13, parent: "body", svg: `<circle class="lens-glass" cx="28" cy="28" r="16.5"/>` },
    { id: "glint",   layer: 14, parent: "body", svg: `<circle class="lens-glint" cx="20.5" cy="19.5" r="3"/>` },
    { id: "eye_l",   layer: 20, parent: "body", pivot: [22, 26], svg: `<circle class="lens-eye" cx="22" cy="26" r="3.4"/>` },
    { id: "pupil_l", layer: 21, parent: "eye_l", pivot: [22, 26], svg: `<circle class="lens-pupil" cx="22" cy="26.3" r="1.7"/>` },
    { id: "eye_r",   layer: 20, parent: "body", pivot: [34, 26], svg: `<circle class="lens-eye" cx="34" cy="26" r="3.4"/>` },
    { id: "pupil_r", layer: 21, parent: "eye_r", pivot: [34, 26], svg: `<circle class="lens-pupil" cx="34" cy="26.3" r="1.7"/>` },
    /* worried brows rise toward the middle; sloping down toward it would read as angry */
    { id: "brow_l",  layer: 22, parent: "body", pivot: [22, 21], hidden: true, svg: `<path class="lens-line" d="M19 22 L25 20"/>` },
    { id: "brow_r",  layer: 22, parent: "body", pivot: [34, 21], hidden: true, svg: `<path class="lens-line" d="M37 22 L31 20"/>` },
    { id: "mouth",   layer: 23, parent: "body", pivot: [28, 35], svg: `<path class="lens-line lens-mouth" d=""/>` },
    { id: "fx_spark", layer: 30, pivot: [52, 13], hidden: true,
      svg: `<path class="lens-spark" d="M52 6 L54 11 L59 13 L54 15 L52 20 L50 15 L45 13 L50 11 Z"/>` },
    { id: "fx_drop",  layer: 30, pivot: [47, 16], hidden: true, svg: `<path class="lens-drop" d="M47 11 Q50 16 47 19 Q44 16 47 11 Z"/>` },
    { id: "fx_zzz",   layer: 30, pivot: [50, 11], hidden: true,
      svg: `<text class="lens-z" x="45" y="15">z</text><text class="lens-z" x="51" y="9">z</text>` },
  ],
  /* constraints: the most a pose may move each part */
  limits: {
    body:    { rotation: [-10, 10], x: [-2, 2], y: [-3, 3] },
    pupil_l: { x: [-1.2, 1.2], y: [-1.2, 1.2] },
    pupil_r: { x: [-1.2, 1.2], y: [-1.2, 1.2] },
    eye_l:   { scaleY: [0.1, 1.3], scale: [0.8, 1.3] },
    eye_r:   { scaleY: [0.1, 1.3], scale: [0.8, 1.3] },
  },
};

const LENS_MOUTHS = {
  smile:     "M22 34 Q28 39 34 34",
  big_smile: "M21 33 Q28 41 35 33",
  small_o:   "M30 33.5 a2 2 0 1 1 -0.01 0",
  wavy:      "M22 36 Q25 33 28 36 Q31 39 34 36",
  flat:      "M25.5 35 L30.5 35",
};

/* Each pose lists only what differs from the rig defaults. show = hidden parts to reveal. */
const LENS_POSES = {
  happy:   { mouth: "smile" },
  wave:    { mouth: "big_smile", show: ["fx_spark"], parts: { body: { rotation: -6 } } },
  proud:   { mouth: "big_smile", parts: { eye_l: { scaleY: 0.5 }, eye_r: { scaleY: 0.5 }, body: { y: -1 } } },
  curious: { mouth: "small_o", parts: { body: { rotation: -8 }, eye_r: { scale: 1.2 },
                                         pupil_l: { x: 1, y: -1 }, pupil_r: { x: 1, y: -1 } } },
  worried: { mouth: "wavy", show: ["brow_l", "brow_r", "fx_drop"], parts: { pupil_l: { y: 1 }, pupil_r: { y: 1 } } },
  sleep:   { mouth: "flat", show: ["fx_zzz"], parts: { eye_l: { scaleY: 0.12 }, eye_r: { scaleY: 0.12 }, body: { y: 1 } } },
};

const clampTo = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
/* pose part values, clamped to the rig's limits */
function lensPartPose(pose, partId) {
  const raw = ((LENS_POSES[pose] || LENS_POSES.happy).parts || {})[partId] || {};
  const lim = LENS_RIG.limits[partId] || {};
  const out = {};
  for (const k in raw) out[k] = lim[k] ? clampTo(raw[k], lim[k]) : raw[k];
  return out;
}
/* CSS transform for a part in a pose (translate, rotate, scale around the part's pivot) */
function lensTransform(p) {
  const sx = (p.scale ?? 1) * (p.scaleX ?? 1), sy = (p.scale ?? 1) * (p.scaleY ?? 1);
  return `translate(${p.x || 0}px, ${p.y || 0}px) rotate(${p.rotation || 0}deg) scale(${sx}, ${sy})`;
}

/* Builds the SVG from the rig: parts nested under their parents, ordered by layer. */
function lensSVG() {
  const kids = id => LENS_RIG.parts.filter(p => (p.parent || null) === id).sort((a, b) => a.layer - b.layer);
  const node = p => {
    const origin = p.pivot ? ` style="transform-origin:${p.pivot[0]}px ${p.pivot[1]}px"` : "";
    return `<g data-part="${p.id}"${origin}${p.hidden ? ` class="lens-off"` : ""}>${p.svg || ""}${kids(p.id).map(node).join("")}</g>`;
  };
  return `<svg class="lens" viewBox="${LENS_RIG.viewBox}" aria-hidden="true">
    <defs><linearGradient id="lens-rim-grad" x1="0" y1="0" x2="1" y2="1">
      <stop class="lens-rim-start" offset="0"/><stop class="lens-rim-end" offset="1"/></linearGradient></defs>
    ${kids(null).map(node).join("")}</svg>`;
}

/* ---------- DOM acting (popup / side panel only) ---------- */
const lensReduceMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/* Snaps every part to a pose (no motion). */
function lensApplyPose(svg, pose) {
  const def = LENS_POSES[pose] || LENS_POSES.happy;
  for (const part of LENS_RIG.parts) {
    const g = svg.querySelector(`[data-part="${part.id}"]`);
    if (!g) continue;
    if (part.pivot) g.style.transform = lensTransform(lensPartPose(pose, part.id));
    if (part.hidden) g.classList.toggle("lens-off", !(def.show || []).includes(part.id));
  }
  svg.querySelector(".lens-mouth").setAttribute("d", LENS_MOUTHS[def.mouth] || LENS_MOUTHS.smile);
}

/* anticipation (small squash) -> action (overshoot into the new pose) -> settle -> hold */
function lensActOut(svg, pose) {
  const body = svg.querySelector('[data-part="body"]');
  const target = lensTransform(lensPartPose(pose, "body"));
  const from = body.style.transform || lensTransform({});
  if (lensReduceMotion() || !body.animate) return lensApplyPose(svg, pose);
  body.animate([
    { transform: from },
    { transform: `${from} translate(0px, 1px) scale(1.04, 0.92)`, offset: 0.3 },   // anticipation
    { transform: `${target} translate(0px, -2.5px)`, offset: 0.7 },                 // action
    { transform: target },                                                         // settle
  ], { duration: 520, easing: "cubic-bezier(.2,.8,.2,1)" });
  setTimeout(() => lensApplyPose(svg, pose), 220);   // face changes at the top of the action
}

/* An occasional blink is the only idle motion; poses otherwise hold still. */
function lensBlink(svg) {
  const pose = svg.dataset.pose;
  if (pose === "sleep" || pose === "proud" || lensReduceMotion()) return;
  for (const id of ["eye_l", "eye_r"]) {
    const g = svg.querySelector(`[data-part="${id}"]`);
    const open = g.style.transform;
    g.animate?.([{ transform: open }, { transform: `${open} scale(1, 0.1)` }, { transform: open }],
                { duration: 180, easing: "ease-in-out" });
  }
}

/* Renders Lens + speech bubble into box. The SVG is built once; mood changes act out a
   transition. Screen readers hear the message only when the mood changes, not on every
   refresh (the bubble text ticks every minute). */
function renderMascot(box, { mood, text }) {
  let svg = box.querySelector("svg.lens");
  if (!svg) {
    box.innerHTML = `${lensSVG()}<p class="bubble"></p><span class="sr-only" aria-live="polite"></span>`;
    svg = box.querySelector("svg.lens");
    lensApplyPose(svg, mood);
    svg.dataset.pose = mood;
    box.querySelector(".sr-only").textContent = text;
    const blink = () => { lensBlink(svg); setTimeout(blink, 4000 + Math.random() * 3000); };
    setTimeout(blink, 2500);
  } else if (svg.dataset.pose !== mood) {
    lensActOut(svg, mood);
    svg.dataset.pose = mood;
    box.querySelector(".sr-only").textContent = text;
  }
  const b = box.querySelector(".bubble");
  if (b.textContent !== text) b.textContent = text;
}

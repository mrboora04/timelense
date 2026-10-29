/* Lens's own words: a tiny GPT trained only on Lens one-liners (model/train.py), run here in
   plain JS from the int8 weights in model/lens.bin. Nothing leaves the PC: the weights ship
   inside the extension and nothing here calls the network.
   It writes one line each time Lens's situation changes; slots such as {site} and {dur} are
   filled with live values on every render, so the numbers stay current. Switched off, no
   model, or a line that fails the checks: mascotMood's fixed text is used instead. */
const LENS_MAX_CHARS = 90;

/* model/lens.bin: "LENS", u32 header size, JSON header, then each tensor in header order.
   A matrix is float32 row scales + int8 rows (padded to 4 bytes); a vector is float32. */
function lensModel(buf) {
  if (String.fromCharCode(...new Uint8Array(buf, 0, 4)) !== "LENS") throw new Error("not a Lens model");
  const n = new DataView(buf).getUint32(4, true);
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, n)));
  const w = {};
  let off = 8 + n;
  for (const [name, [rows, cols], quant] of head.tensors) {
    if (quant) {
      const scale = new Float32Array(buf, off, rows);
      off += rows * 4;
      w[name] = { rows, cols, scale, q: new Int8Array(buf, off, rows * cols) };
      off += Math.ceil(rows * cols / 4) * 4;
    } else {
      w[name] = new Float32Array(buf, off, rows);
      off += rows * 4;
    }
  }
  return { ...head, w, stoi: Object.fromEntries(head.vocab.map((t, i) => [t, i])) };
}

function lensMatVec(m, x, bias) {
  const y = new Float64Array(m.rows);
  for (let r = 0; r < m.rows; r++) {
    let s = 0;
    for (let c = 0, o = r * m.cols; c < m.cols; c++) s += m.q[o + c] * x[c];
    y[r] = s * m.scale[r] + (bias ? bias[r] : 0);
  }
  return y;
}
function lensNorm(x, g, b) {
  const mean = x.reduce((a, v) => a + v, 0) / x.length;
  const sd = Math.sqrt(x.reduce((a, v) => a + (v - mean) ** 2, 0) / x.length + 1e-5);
  return x.map((v, i) => (v - mean) / sd * g[i] + b[i]);
}
const lensGelu = v => 0.5 * v * (1 + Math.tanh(0.7978845608 * (v + 0.044715 * v ** 3)));

/* Runs one token through the model, keeping each layer's keys and values in cache.
   Returns the logits for the next token. */
function lensStep(M, cache, tok, pos) {
  const { d, heads, layers } = M.cfg, hd = d / heads, W = M.w;
  const emb = (m, r) => Float64Array.from(m.q.subarray(r * m.cols, (r + 1) * m.cols), v => v * m.scale[r]);
  const te = emb(W["wte.weight"], tok), pe = emb(W["wpe.weight"], pos);
  let x = te.map((v, i) => v + pe[i]);
  for (let l = 0; l < layers; l++) {
    const p = `blocks.${l}.`, c = cache[l] || (cache[l] = { k: [], v: [] });
    const qkv = lensMatVec(W[p + "attn.weight"], lensNorm(x, W[p + "ln1.weight"], W[p + "ln1.bias"]), W[p + "attn.bias"]);
    c.k.push(qkv.subarray(d, 2 * d));
    c.v.push(qkv.subarray(2 * d));
    const att = new Float64Array(d);
    for (let h = 0; h < heads; h++) {
      const o = h * hd;
      const sc = c.k.map(k => { let s = 0; for (let i = 0; i < hd; i++) s += qkv[o + i] * k[o + i]; return s / Math.sqrt(hd); });
      const top = Math.max(...sc), e = sc.map(s => Math.exp(s - top)), sum = e.reduce((a, v) => a + v, 0);
      c.v.forEach((v, j) => { for (let i = 0; i < hd; i++) att[o + i] += e[j] / sum * v[o + i]; });
    }
    const a = lensMatVec(W[p + "proj.weight"], att, W[p + "proj.bias"]);
    x = x.map((v, i) => v + a[i]);
    const f = lensMatVec(W[p + "fc.weight"], lensNorm(x, W[p + "ln2.weight"], W[p + "ln2.bias"]), W[p + "fc.bias"]).map(lensGelu);
    const m = lensMatVec(W[p + "fc2.weight"], f, W[p + "fc2.bias"]);
    x = x.map((v, i) => v + m[i]);
  }
  return lensMatVec(W["wte.weight"], lensNorm(x, W["lnf.weight"], W["lnf.bias"]));   // output shares the embedding
}

/* top-k sampling at temperature 0.8, or the most likely token when greedy */
function lensPick(logits, rand, greedy) {
  const order = [...logits.keys()].sort((a, b) => logits[b] - logits[a]).slice(0, greedy ? 1 : 20);
  const e = order.map(i => Math.exp((logits[i] - logits[order[0]]) / 0.8));
  let r = rand() * e.reduce((a, v) => a + v, 0);
  for (let i = 0; i < order.length; i++) if ((r -= e[i]) <= 0) return order[i];
  return order[0];
}
/* prompt "<ok> <evening> <usual>" -> a line with slots, such as "{total} today. Looking steady." */
function lensGenerate(M, prompt, rand = Math.random, greedy = false) {
  const ids = prompt.split(" ").map(t => M.stoi[t]), cache = [], end = M.stoi["<end>"];
  let logits, out = "";
  ids.forEach((t, i) => { logits = lensStep(M, cache, t, i); });
  while (ids.length < M.cfg.ctx) {
    const next = lensPick(logits, rand, greedy);
    if (next === end) break;
    out += M.vocab[next];
    ids.push(next);
    if (ids.length < M.cfg.ctx) logits = lensStep(M, cache, next, ids.length - 1);
  }
  return out;
}

/* one short line that uses only the slots its situation can fill, each at most once */
function lensValid(text, allowed) {
  const slots = [...text.matchAll(/\{([a-z]+)\}/g)].map(s => s[1]);
  return text.length > 0 && text.length <= LENS_MAX_CHARS && !/\n/.test(text) && /[.!?]$/.test(text)
    && /^[A-Z{]/.test(text) && slots.every(s => allowed.includes(s)) && new Set(slots).size === slots.length;
}
const lensFill = (text, slots) => text.replace(/\{([a-z]+)\}/g, (_, k) => slots[k] ?? "");
function lensPrompt(m, hour = new Date().getHours()) {
  const tod = hour < 5 ? "night" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 22 ? "evening" : "night";
  return `<${m.say}> <${tod}> <${m.amt}>`;
}

let lensLoading = null;   // the model, loaded once per page
function lensLoad() {
  return lensLoading || (lensLoading = fetch(chrome.runtime.getURL("model/lens.bin"))
    .then(r => r.arrayBuffer()).then(lensModel).catch(() => null));
}
/* mascotMood's { mood, text, say, slots, amt } -> { mood, text } with the model's line.
   The line is kept in session storage (memory only), so the popup and side panel show the same
   one and a new line is written only when the situation changes. */
async function lensSays(m) {
  try {
    const { lensTalk } = await chrome.storage.local.get("lensTalk");
    if (lensTalk === false || !m.say) return m;
    const { lensSaid } = await chrome.storage.session.get("lensSaid");
    let line = lensSaid && lensSaid.say === m.say ? lensSaid.line : undefined;
    if (line === undefined) {
      const M = await lensLoad();
      line = null;
      for (let i = 0; M && M.slots[m.say] && i < 4 && !line; i++) {
        const t = lensGenerate(M, lensPrompt(m));
        if (lensValid(t, M.slots[m.say])) line = t;
      }
      await chrome.storage.session.set({ lensSaid: { say: m.say, line } });
    }
    if (!line) return m;
    const rate = lensSaid && lensSaid.say === m.say && lensSaid.voted ? null : { say: m.say, line, amt: m.amt };
    return { mood: m.mood, text: lensFill(line, m.slots), rate };
  } catch { return m; }
}

/* ---------- rating the model's lines: Good, Bad or Skip (popup and side panel) ----------
   Each vote keeps only the line's template (slots like {dur}, never site names), the situation
   and the time of day, in lensVotes (last 1000), so it can be exported and used to improve
   model/data.py. One vote per line; the row goes away until Lens writes a new one. */
const LENS_VOTES = [["1", "Good", "good"], ["-1", "Bad", "bad"], ["0", "Skip", "skip"]];
async function lensVote(rate, v) {
  const { lensSaid } = await chrome.storage.session.get("lensSaid");
  if (!lensSaid || lensSaid.say !== rate.say || lensSaid.voted) return;
  await chrome.storage.session.set({ lensSaid: { ...lensSaid, voted: true } });
  const { lensVotes = [] } = await chrome.storage.local.get("lensVotes");
  const tod = lensPrompt({ say: rate.say, amt: rate.amt }).split(" ")[1].slice(1, -1);
  lensVotes.push({ t: Date.now(), say: rate.say, line: rate.line, tod, amt: rate.amt, v: Number(v) });
  await chrome.storage.local.set({ lensVotes: lensVotes.slice(-1000) });
}
/* shows the row under the bubble when the message has a line to rate, removes it otherwise */
function renderRate(box, m) {
  let row = box.querySelector(".rate");
  if (!m.rate) { if (row) row.remove(); return; }
  if (!row) {
    row = document.createElement("div");
    row.className = "rate";
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", "Rate Lens's line");
    row.innerHTML = LENS_VOTES.map(([v, label, cls]) => `<button class="${cls}" data-v="${v}">${label}</button>`).join("");
    row.onclick = e => { const b = e.target.closest("[data-v]"); if (b) lensVote(row.rate, b.dataset.v); };
    box.appendChild(row);
  }
  row.rate = m.rate;
}
/* "5 good · 2 bad · 1 skipped" for the side panel */
function lensTally(votes = []) {
  const n = v => votes.filter(x => x.v === v).length;
  return votes.length ? `${n(1)} good · ${n(-1)} bad · ${n(0)} skipped` : "No ratings yet.";
}

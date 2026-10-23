"""Trains Lens's tiny one-liner model and exports it for the extension.

    python model/train.py              train, evaluate, write model/lens.bin + model/check.json
    python model/train.py --onnx       also export model/out/lens.onnx and check it with onnxruntime

Pipeline: synthetic data (data.py, split 90/5/5) -> word-level tokens -> a small GPT
(pre-LayerNorm, learned positions, tied output) -> AdamW with warmup + cosine LR and gradient
clipping -> perplexity and generation checks -> int8 weights for the plain-JS runtime in talk.js.
"""
import argparse, json, math, os, re, struct, sys
import torch
import torch.nn as nn
import torch.nn.functional as F

sys.path.insert(0, os.path.dirname(__file__))
import data

HERE = os.path.dirname(os.path.abspath(__file__))
# Same pattern as LENS_TOKEN_RE in talk.js. Each token keeps its leading space, so joining tokens
# gives the text back exactly.
TOKEN_RE = re.compile(r" ?\{[a-z]+\}| ?[A-Za-z']+| ?[0-9]+| ?[^\sA-Za-z0-9]")
MAX_CHARS = 90


def tokens(text):
    return TOKEN_RE.findall(text)


def valid(sit, text):
    """Same checks as lensValid in talk.js: one short line, only the slots this situation has."""
    slots = re.findall(r"\{([a-z]+)\}", text)
    return (0 < len(text) <= MAX_CHARS and "\n" not in text and text[-1] in ".!?"
            and (text[0].isupper() or text[0] == "{")
            and all(s in data.SLOTS[sit] for s in slots) and len(slots) == len(set(slots)))


class Block(nn.Module):
    def __init__(s, d, h):
        super().__init__()
        s.h = h
        s.ln1, s.ln2 = nn.LayerNorm(d), nn.LayerNorm(d)
        s.attn, s.proj = nn.Linear(d, 3 * d), nn.Linear(d, d)
        s.fc, s.fc2 = nn.Linear(d, 4 * d), nn.Linear(4 * d, d)

    def forward(s, x):
        B, T, D = x.shape
        q, k, v = s.attn(s.ln1(x)).split(D, dim=2)
        q, k, v = (t.view(B, T, s.h, D // s.h).transpose(1, 2) for t in (q, k, v))
        a = F.scaled_dot_product_attention(q, k, v, is_causal=True)
        x = x + s.proj(a.transpose(1, 2).reshape(B, T, D))
        return x + s.fc2(F.gelu(s.fc(s.ln2(x)), approximate="tanh"))


class GPT(nn.Module):
    def __init__(s, vocab, d, layers, heads, ctx):
        super().__init__()
        s.cfg = dict(vocab=vocab, d=d, layers=layers, heads=heads, ctx=ctx)
        s.wte, s.wpe = nn.Embedding(vocab, d), nn.Embedding(ctx, d)
        s.blocks = nn.ModuleList(Block(d, heads) for _ in range(layers))
        s.lnf = nn.LayerNorm(d)
        for m in s.modules():
            if isinstance(m, (nn.Linear, nn.Embedding)):
                nn.init.normal_(m.weight, std=0.02)
            if isinstance(m, nn.Linear):
                nn.init.zeros_(m.bias)

    def forward(s, idx):
        x = s.wte(idx) + s.wpe(torch.arange(idx.shape[1]))
        for b in s.blocks:
            x = b(x)
        return s.lnf(x) @ s.wte.weight.T     # output layer shares the token embedding


def encode(pairs, stoi, ctx):
    """token ids padded to ctx, and a loss mask covering the line and <end> only"""
    X, M = [], []
    for p, line in pairs:
        ids = [stoi[t] for t in p.split()] + [stoi[t] for t in tokens(line)] + [stoi["<end>"]]
        assert len(ids) <= ctx, (p, line)
        n = len(p.split())
        mask = [0] * (n - 1) + [1] * (len(ids) - n) + [0] * (ctx - len(ids) + 1)
        X.append(ids + [0] * (ctx - len(ids)))
        M.append(mask[:ctx - 1])
    return torch.tensor(X), torch.tensor(M, dtype=torch.float)


def loss_on(model, X, M):
    logits = model(X[:, :-1])
    l = F.cross_entropy(logits.reshape(-1, logits.shape[-1]), X[:, 1:].reshape(-1), reduction="none")
    return (l * M.reshape(-1)).sum() / M.sum()


@torch.no_grad()
def generate(model, ids, end, temp=0.8, top_k=20, greedy=False, gen=None):
    ids = list(ids)
    while len(ids) < model.cfg["ctx"]:
        logits = model(torch.tensor([ids]))[0, -1]
        if greedy:
            nxt = int(logits.argmax())
        else:
            v, i = torch.topk(logits / temp, top_k)
            nxt = int(i[torch.multinomial(F.softmax(v, -1), 1, generator=gen)])
        if nxt == end:
            break
        ids.append(nxt)
    return ids


def quantize(model):
    """Per-row symmetric int8 for every matrix, float32 for the rest. Puts the rounded weights
    back into the model, so the checks below test exactly what the extension runs."""
    out = []
    for name, t in model.state_dict().items():   # these share storage with the model
        if t.dim() == 2:
            scale = (t.abs().amax(1) / 127).clamp(min=1e-8)
            q = torch.round(t / scale[:, None]).clamp(-127, 127).to(torch.int8)
            t.copy_(q.float() * scale[:, None])
            out.append((name, list(t.shape), scale, q))
        else:
            out.append((name, list(t.shape), None, t))
    return out


def write_bin(path, model, itos, tensors):
    """LENS, u32 header size, JSON header, then each tensor (padded to 4 bytes):
       matrix = float32 row scales + int8 rows; vector = float32"""
    header = json.dumps({"cfg": model.cfg, "vocab": itos, "slots": data.SLOTS,
                         "tensors": [[n, shape, s is not None] for n, shape, s, _ in tensors]}).encode()
    header += b" " * (-len(header) % 4)
    with open(path, "wb") as f:
        f.write(b"LENS" + struct.pack("<I", len(header)) + header)
        for _, _, scale, t in tensors:
            if scale is not None:
                f.write(scale.numpy().astype("<f4").tobytes())
                raw = t.numpy().tobytes()
                f.write(raw + b"\0" * (-len(raw) % 4))
            else:
                f.write(t.numpy().astype("<f4").tobytes())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--d", type=int, default=32)
    ap.add_argument("--layers", type=int, default=2)
    ap.add_argument("--heads", type=int, default=2)
    ap.add_argument("--ctx", type=int, default=32)
    ap.add_argument("--steps", type=int, default=3000)
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--lr", type=float, default=3e-3)
    ap.add_argument("--onnx", action="store_true")
    args = ap.parse_args()
    torch.manual_seed(1)

    # 1. data, split 90/5/5
    train, val, test = data.split(data.examples())
    # 2. tokens: prompt tokens, then every word token seen in the lines
    prompts = [f"<{x}>" for x in [*data.SLOTS, *data.TODS, *data.AMTS]]
    words = sorted({t for _, l in train + val + test for t in tokens(l)})
    itos = ["<pad>", "<end>", *prompts, *words]
    stoi = {t: i for i, t in enumerate(itos)}
    Xtr, Mtr = encode(train, stoi, args.ctx)
    Xva, Mva = encode(val, stoi, args.ctx)
    Xte, Mte = encode(test, stoi, args.ctx)

    # 3. model
    model = GPT(len(itos), args.d, args.layers, args.heads, args.ctx)
    print(f"vocab {len(itos)}, params {sum(p.numel() for p in model.parameters()):,}, "
          f"examples {len(train)}/{len(val)}/{len(test)}")

    # 4. training: AdamW, linear warmup then cosine decay, gradient clipping
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)
    warm = args.steps // 20
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min(1, (s + 1) / warm) *
                                              0.5 * (1 + math.cos(math.pi * min(1, s / args.steps))))
    for step in range(args.steps):
        i = torch.randint(len(Xtr), (args.batch,))
        loss = loss_on(model, Xtr[i], Mtr[i])
        opt.zero_grad()
        loss.backward()
        nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()
        sched.step()
        if step % 500 == 0 or step == args.steps - 1:
            with torch.no_grad():
                print(f"step {step}: train {loss.item():.3f}, val {loss_on(model, Xva, Mva).item():.3f}")

    # 5. evaluation on the int8 weights the extension will run
    model.eval()
    tensors = quantize(model)
    with torch.no_grad():
        print(f"perplexity (int8): val {math.exp(loss_on(model, Xva, Mva)):.2f}, "
              f"test {math.exp(loss_on(model, Xte, Mte)):.2f}")
    gen = torch.Generator().manual_seed(2)
    total = ok = novel = 0
    seen = set()
    for sit in data.SLOTS:
        for tod in data.TODS:
            for amt in data.AMTS:
                p = data.prompt(sit, tod, amt)
                for _ in range(5):
                    ids = generate(model, [stoi[t] for t in p.split()], stoi["<end>"], gen=gen)
                    text = "".join(itos[i] for i in ids[3:])
                    total += 1
                    ok += valid(sit, text)
                    novel += text not in data.all_lines(sit) and not any(
                        text.endswith(" " + l) for l in data.all_lines(sit))
                    seen.add(text)
        print(f"  {sit:10} {text}")
    print(f"generation: {ok}/{total} valid, {len(seen)} different, {novel} not in the training lines")

    # 6. export for talk.js, plus greedy outputs the JS tests must reproduce
    write_bin(os.path.join(HERE, "lens.bin"), model, itos, tensors)
    check = []
    for sit in data.SLOTS:
        p = data.prompt(sit, "afternoon", "usual")
        ids = [stoi[t] for t in p.split()]
        with torch.no_grad():
            first = model(torch.tensor([ids]))[0, -1][:8].tolist()
        out = generate(model, ids, stoi["<end>"], greedy=True)
        check.append({"prompt": p, "text": "".join(itos[i] for i in out[3:]), "logits": first})
    with open(os.path.join(HERE, "check.json"), "w") as f:
        json.dump(check, f, indent=1)
    print(f"wrote model/lens.bin ({os.path.getsize(os.path.join(HERE, 'lens.bin')) / 1024:.1f} KB)")

    if args.onnx:
        import numpy as np, onnxruntime as ort
        os.makedirs(os.path.join(HERE, "out"), exist_ok=True)
        path = os.path.join(HERE, "out", "lens.onnx")
        x = torch.tensor([[stoi["<ok>"], stoi["<evening>"], stoi["<usual>"]]])
        torch.onnx.export(model, (x,), path, input_names=["ids"], output_names=["logits"],
                          dynamic_axes={"ids": {1: "t"}, "logits": {1: "t"}}, dynamo=False)
        got = ort.InferenceSession(path).run(None, {"ids": x.numpy()})[0]
        diff = float(np.abs(got - model(x).detach().numpy()).max())
        print(f"wrote model/out/lens.onnx; onnxruntime matches torch within {diff:.1e}")


if __name__ == "__main__":
    main()

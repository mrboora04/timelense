"""Every pair of words that follow each other in Lens's training lines, for the garbled-line check.

A tiny model sometimes glues the start of one line to the end of another ("{dur} of focus streak
of the clock."). Such a line usually has a pair of words that never meets in the training lines,
so talk.js drops a line with any pair not on this list. The list goes into lens.bin's header:

    python model/pairs.py      add or refresh the list in the current model/lens.bin (weights unchanged)

train.py writes the list too, so retraining keeps it current. Needs no PyTorch.
"""
import json, os, re, struct

import data

HERE = os.path.dirname(os.path.abspath(__file__))
WORD = re.compile(r"\{[a-z]+\}|[a-z0-9']+")   # same as LENS_WORD in talk.js


def words(text):
    return WORD.findall(text.lower())


def pairs():
    """sorted "a b" pairs, with ^ for the start of a line and $ for its end"""
    out = set()
    for sit in data.LINES:
        lines = set(data.all_lines(sit))
        if sit in ("ok", "streak"):   # openers go in front of these (data.examples)
            lines |= {o + " " + l for ops in data.TOD_OPENERS.values() for o in ops for l in data.LINES[sit]}
        for line in lines:
            w = ["^", *words(line), "$"]
            out |= {a + " " + b for a, b in zip(w, w[1:])}
    return sorted(out)


def patch(path):
    """rewrite lens.bin's JSON header with the current pair list, keeping the weights byte for byte"""
    buf = open(path, "rb").read()
    assert buf[:4] == b"LENS", "not a Lens model"
    n = struct.unpack("<I", buf[4:8])[0]
    head = json.loads(buf[8:8 + n])
    head["pairs"] = pairs()
    new = json.dumps(head).encode()
    new += b" " * (-len(new) % 4)
    with open(path, "wb") as f:
        f.write(b"LENS" + struct.pack("<I", len(new)) + new + buf[8 + n:])
    return len(head["pairs"])


if __name__ == "__main__":
    print(f"model/lens.bin: {patch(os.path.join(HERE, 'lens.bin'))} word pairs")

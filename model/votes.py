"""Reads the ratings from a TimeLens export (side panel > Export data) and shows how Lens's lines did.

    python model/votes.py timelens-export-2026-10-29.json

Per situation: share of Good votes, then the lines rated Bad, so they can be reworded or removed in
data.py before retraining. Skips are counted but don't change the score.
"""
import json, sys
from collections import defaultdict

votes = json.load(open(sys.argv[1], encoding="utf8")).get("lensVotes", [])
by_say, by_line = defaultdict(lambda: [0, 0, 0]), defaultdict(lambda: [0, 0, 0])
for x in votes:
    i = {1: 0, -1: 1, 0: 2}[x["v"]]
    by_say[x["say"]][i] += 1
    by_line[(x["say"], x["line"])][i] += 1
print(f"{len(votes)} votes")
for say, (g, b, s) in sorted(by_say.items()):
    print(f"  {say:10} good {g}, bad {b}, skipped {s}" + (f"  ({g / (g + b):.0%} good)" if g + b else ""))
bad = [(k, v) for k, v in by_line.items() if v[1] > v[0]]
if bad:
    print("rated worse than good:")
    for (say, line), (g, b, s) in sorted(bad, key=lambda kv: kv[1][0] - kv[1][1]):
        print(f"  [{say}] {line}  (good {g}, bad {b})")

#!/bin/bash
# Title-card numbers for video overlays, read from the scored benchmark.
# Usage: ./demo/ledger-card.sh [benchmark/results.json]
set -u
F="${1:-benchmark/results.json}"
[ -f "$F" ] || { echo "no results at $F — run: node benchmark/run.js --quick" >&2; exit 1; }
python3 - "$F" <<'PYEOF'
import json, sys
d = json.load(open(sys.argv[1]))
by = d.get("byStrategy") or {}
if not by:
    sys.exit(f"{sys.argv[1]} has no byStrategy block — regenerate it with benchmark/run.js")
print(f"{'brain':6} {'solved':>8} {'median':>9} {'steps':>7} {'llm':>5} {'fast':>6} {'cost':>10}")
for name, a in by.items():
    print(
        f"{name:6} {a['solved']:>4}/{a['runs']:<3} "
        f"{a['medianWallMs'] / 1000:>8.1f}s {a['steps']:>7} {a['llmCalls']:>5} "
        f"{a['jevCalls']:>6} {'$' + format(a['costUsd'], '.4f'):>10}"
    )
PYEOF

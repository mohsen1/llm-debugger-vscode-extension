#!/bin/bash
# Headed e2e: visible VSCode + real debugger + agent loop, optionally recorded.
#   ./e2e/run.sh --agent=script|claude|codex --mode=jev|llm|both [--record] [--steps=12]
# Requires: extension built, dev host will be launched headed, API key in api.env.
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="$REPO/examples/order-processor"
AGENT="script"; MODE="both"; RECORD="no"; STEPS="12"
for a in "$@"; do case "$a" in
  --agent=*) AGENT="${a#*=}";; --mode=*) MODE="${a#*=}";; --record) RECORD="yes";;
  --steps=*) STEPS="${a#*=}";; *) echo "unknown arg $a"; exit 1;;
esac
done
case "$AGENT" in script|claude|codex) ;; *) echo "bad --agent=$AGENT (script|claude|codex)"; exit 1;; esac
case "$MODE" in jev|llm|both) ;; *) echo "bad --mode=$MODE (jev|llm|both)"; exit 1;; esac
case "$STEPS" in ''|*[!0-9]*|0) echo "bad --steps=$STEPS (positive integer)"; exit 1;; esac

cd "$REPO"
node esbuild.extension.js || exit 1
[ "$AGENT" = script ] || ./e2e/setup.sh

# Reuse a live dev host when its bridge answers (a fresh file alone proves
# nothing — the host may be alive with an older bridge). Read-only probe.
BRIDGE="$TARGET/.llm-debugger/bridge.json"
bridge_live() {
  [ -f "$BRIDGE" ] || return 1
  local port token
  port=$(python3 -c "import json; print(json.load(open('$BRIDGE'))['port'])" 2>/dev/null) || return 1
  token=$(python3 -c "import json; print(json.load(open('$BRIDGE'))['token'])" 2>/dev/null) || return 1
  curl -s --max-time 4 -X POST "http://127.0.0.1:$port/tool" \
    -H "Authorization: Bearer $token" -H "Content-Type: application/json" \
    -d '{"name":"llm-debugger_state","input":{}}' 2>/dev/null | grep -q '"status"'
}
if bridge_live; then
  echo "reusing live dev host (bridge answers)."
else
  code --extensionDevelopmentPath="$REPO" --new-window "$TARGET" >/dev/null 2>&1 &
  echo "waiting for agent bridge (.llm-debugger/bridge.json)..."
  for i in $(seq 1 60); do
    bridge_live && break
    sleep 2
  done
  bridge_live || { echo "bridge never answered — is the dev host open with the extension activated?"; exit 1; }
  echo "bridge up."
fi

run_one() { # $1=agent $2=mode
  local agent="$1" mode="$2" take="e2e-${agent}-${mode}" prompt
  prompt=$(sed "s/__MODE__/${mode}/" "$REPO/e2e/prompt.md")
  local recpid=""
  if [ "$RECORD" = "yes" ]; then
    "$REPO/e2e/focus.sh" "order-processor" || true
    "$REPO/demo/record.sh" "$take" & recpid=$!; sleep 2
  fi
  local rc=0
  case "$agent" in
    script) (cd "$TARGET" && node "$REPO/e2e/agent-loop.mjs" --mode="$mode" --steps="$STEPS" --out="$REPO/e2e/transcript-${mode}.json") || rc=$?;;
    claude) (cd "$TARGET" && claude -p --permission-mode acceptEdits --allowedTools 'mcp__llm-debugger__*' "$prompt" | tee "$REPO/e2e/transcript-claude-${mode}.txt") || rc=$?;;
    codex) (cd "$TARGET" && codex exec "$prompt" | tee "$REPO/e2e/transcript-codex-${mode}.txt") || rc=$?;;
  esac
  if [ -n "$recpid" ]; then
    kill -INT "$recpid" 2>/dev/null; wait "$recpid" 2>/dev/null
    if ffprobe -v error -show_entries format=duration -of csv=p=0 "demo/${take}.mov" >/dev/null 2>&1; then
      echo "video OK -> demo/${take}.mov"
    else
      echo "WARNING: recording demo/${take}.mov failed validation"; rc=1
    fi
  fi
  return $rc
}

MODES=""; [ "$MODE" = "both" ] && MODES="jev llm" || MODES="$MODE"
for m in $MODES; do
  echo "===== agent=$AGENT mode=$m ====="
  run_one "$AGENT" "$m" || echo "FAILED: $AGENT/$m (see transcript)"
done
if [ "$RECORD" = "yes" ] && [ "$MODE" = "both" ] && [ -f "demo/e2e-${AGENT}-jev.mov" ] && [ -f "demo/e2e-${AGENT}-llm.mov" ]; then
  ./demo/assemble.sh "demo/e2e-${AGENT}-jev.mov" "demo/e2e-${AGENT}-llm.mov" "demo/side-by-side-${AGENT}.mp4" || true
fi
echo "done. transcripts in e2e/, videos (if --record) in demo/"

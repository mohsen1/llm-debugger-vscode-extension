#!/bin/bash
# Pre-flight for demo/recording day. Read-only except rebuilding stale output.
# Exits 0 only if everything checkable passes (live dev host NOT required).
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"
pass=0; fail=0
ok() { echo "ok   $1"; pass=$((pass+1)); }
no() { echo "FAIL $1"; fail=$((fail+1)); }

# 1. Build outputs newer than sources?
if [ "out/index.js" -nt "src/index.ts" ] && [ "src/webview/out/index.html" -nt "src/webview/index.tsx" ]; then ok "build fresh"
else echo "-- rebuilding (stale output)"; node esbuild.extension.js >/dev/null 2>&1 && ok "rebuilt extension" || no "extension build"; fi

# 2. Manifest gate
npm run check:manifest >/dev/null 2>&1 && ok "manifest" || no "manifest"

# 3. Ground truth + unit tests (the gates that make the benchmark meaningful)
node benchmark/verify-ground-truth.js >/dev/null 2>&1 && ok "ground truth verified" || no "ground truth"
npx vitest run >/dev/null 2>&1 && ok "unit tests" || no "unit tests"

# 4. Gateway key live?
if python3 -c "
import re, urllib.request
m = re.search(r'^\s*AI_GATEWAY_API_KEY\s*=\s*(.+?)\s*\$', open('api.env').read(), re.M)
key = m.group(1).strip().strip('\"\\'') if m else ''
assert key, 'no key'
req = urllib.request.Request('https://ai-gateway.vercel.sh/v1/models', headers={'Authorization': f'Bearer {key}'})
assert len(__import__('json').loads(urllib.request.urlopen(req, timeout=10).read().decode())['data']) > 100
" 2>/dev/null; then ok "gateway key live"; else no "gateway key"; fi

# 5. ffmpeg + screen device?
if command -v ffmpeg >/dev/null 2>&1 && ffmpeg -f avfoundation -list_devices true -i "" 2>&1 | grep -q "Capture screen"; then ok "ffmpeg + screen device"; else no "ffmpeg/screen"; fi

# 6. Dev host bridge (informational only — relaunch if stale)?
BRIDGE="examples/order-processor/.llm-debugger/bridge.json"
if ./e2e/probe.py state --bridge="$BRIDGE" >/dev/null 2>&1; then ok "dev-host bridge live"; else echo "info dev-host bridge not answering (F5 to launch)"; fi

echo "---"
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]

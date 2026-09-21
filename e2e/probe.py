#!/usr/bin/env python3
"""Thin CLI over the extension's localhost bridge. For humans probing a live
dev host without writing JSON-RPC by hand.
Usage: ./e2e/probe.py <tool> [key=value ...] [--bridge PATH] [--timeout S]
Examples:
  ./e2e/probe.py state
  ./e2e/probe.py start program=run.js
  ./e2e/probe.py breakpoint file=pricing.js line=22 action=remove
  ./e2e/probe.py step kind=next
"""
import json, sys, time, urllib.request

BRIDGE = "examples/order-processor/.llm-debugger/bridge.json"

def load_bridge(path):
    try:
        return json.load(open(path))
    except FileNotFoundError:
        sys.exit(f"no bridge file at {path} — is the dev host open with the extension running?")

def main(argv):
    bridge = BRIDGE
    timeout = 30
    args = []
    it = iter(argv)
    for a in it:
        if a in ("--bridge", "--timeout"):
            try: v = next(it)
            except StopIteration: sys.exit(f"{a} needs a value (use --opt=value or --opt value)")
            if a == "--bridge": bridge = v
            else:
                try: timeout = int(v)
                except ValueError: sys.exit("--timeout needs an integer")
            continue
        if a.startswith("--bridge="): bridge = a.split("=", 1)[1]; continue
        if a.startswith("--timeout="): timeout = int(a.split("=", 1)[1]); continue
        args.append(a)
    if not args or args[0] in ("-h", "--help"):
        print(__doc__.strip())
        return 0
    name = args[0]
    if not name.startswith("llm-debugger_"):
        name = "llm-debugger_" + name
    inputs = {}
    for kv in args[1:]:
        k, _, v = kv.partition("=")
        try: v = int(v)
        except ValueError: pass
        inputs[k] = v
    info = load_bridge(bridge)
    body = json.dumps({"name": name, "input": inputs}).encode()
    # Loopback from sandboxed shells is occasionally refused on first try;
    # retry connection-level failures, but fail fast on real responses.
    last = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(
                f"http://127.0.0.1:{info['port']}/tool", data=body,
                headers={"Authorization": f"Bearer {info['token']}", "Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                print(json.loads(r.read().decode())["text"][:4000])
            return 0
        except urllib.error.URLError as e:
            last = e
            time.sleep(1)
    sys.exit(f"bridge call failed after retries: {last} (is the dev host still open?)")
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

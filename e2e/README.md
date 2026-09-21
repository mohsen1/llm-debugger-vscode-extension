# Headed e2e

> **Unmaintained.** These recording scripts predate the current agent loop and
> are kept for the demo videos only. The maintained in-host entry points are
> `node benchmark/host/run.js --suite=target` (debugger primitives) and
> `node benchmark/run.js` (the scored benchmark).

Drives the VISIBLE debugger in a headed Extension Development Host, with or
without Jev, and optionally records the screen for the demo videos.

```bash
./e2e/setup.sh                                   # register MCP server with Claude + Codex (once)
./e2e/run.sh --agent=script --mode=both          # deterministic loop, no agent dependency
./e2e/run.sh --agent=script --mode=jev --record  # + screen recording -> demo/e2e-script-jev.mov
./e2e/run.sh --agent=claude --mode=jev --record  # real Claude Code in the loop
./e2e/run.sh --agent=codex --mode=llm --record   # real Codex in the loop
```

- Copilot has no headless CLI: use it in the IDE with `docs/AGENT_SKILL.md`.
  (The `llm-debugger.demoJev` / `demoLlm` palette commands are gone — they drove
  the old scripted demo. Use `@debugger` in chat instead.)
- Agent cwd is `examples/order-processor`, so bridge discovery just works.
- Transcripts land in `e2e/`; videos in `demo/`.

- In-IDE equivalent: `@debugger /use-debugger` (brain from Settings →
  LLM Debugger → `strategy`, keys from `jevApiKey` / `llmApiKey` or `api.env`)
  runs the same hunt inside the extension, no setup at all.

## Helpers

- `./e2e/probe.py state|start|breakpoint|step|...` — hand-drive the live
  bridge: `./e2e/probe.py breakpoint file=pricing.js line=22 action=remove`.
- `./demo/ledger-card.sh demo/last-run-jev.json` — title-card numbers for overlays.
- `./demo/assemble.sh LEFT.mov RIGHT.mov [OUT.mp4]` — side-by-side video.
- Recording auto-focuses the dev-host window first (`e2e/focus.sh`); takes are
  ffprobe-validated and `both` mode auto-assembles.

- If a real-agent run stalls waiting for tool approval, rerun with wider
  permissions (`--permission-mode bypassPermissions` for Claude) — the demo
  only reads example code and drives the local debugger.

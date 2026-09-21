# Side-by-side video: Jev vs LLM bug hunt

Same program, same breakpoints, different brains. Everything happens in the
real editor: red dots, yellow step line, variables, debug toolbar.

## Step 0 — pre-flight (2 minutes before recording)

```bash
./scripts/preflight.sh   # build fresh? manifest? gateway key? ffmpeg? bridge?
```

Then set the brain: Settings → LLM Debugger → `strategy` (`jev` / `llm`),
keys in `jevApiKey` / `llmApiKey` (or `AI_GATEWAY_API_KEY` env / `api.env`).

## Pick a take

`node benchmark/demo.js` lists every bug with the debugger actions and wall
time it took on the last benchmark run, most actions first. Then:

```bash
node benchmark/demo.js --task=freeship-single-only
```

That writes `demo/workspace/` — the example with every bug fixed but one, so
exactly one check fails and the hunt cannot wander into a different bug
mid-recording. It prints the folder to open and the prompt to paste.

For the most on-screen movement use `freeship-single-only` (34 actions across
four files, every action type). For the cleanest ledger line use `coupon-order`
(26 straight steps, only 2 generation calls).

## Easiest takes: the built-in participant

1. Dev host on `examples/order-processor`, debug console + variables open.
2. Take 1 — chat: `@debugger` with strategy `jev`. It runs the program,
   takes the first failing check and hunts that; the verdict and the ledger
   land in the chat reply.
3. Take 2 — flip strategy to `llm`, run it again on the same check.
4. Overlay numbers come from the scored benchmark, not from a single take:
   `node benchmark/run.js --quick` then `./demo/ledger-card.sh`.

## Deterministic takes

- `node benchmark/run.js --quick` drives the real debugger through 3 tasks on
  both brains in one dev host, and writes `benchmark/results.md`. Headed by
  default, so it is recordable as-is.
- `e2e/run.sh --record` still exists for agent-in-the-loop takes but is
  unmaintained — see the note at the top of `e2e/README.md`.

## Record & assemble

```bash
./demo/record.sh jev   # fullscreen video -> demo/jev.mov (avfoundation)
./demo/record.sh llm   # ditto -> demo/llm.mov
./demo/assemble.sh demo/e2e-script-jev.mov demo/e2e-script-llm.mov  # -> side-by-side
./demo/ledger-card.sh                          # overlay numbers
```

No ffmpeg? Cmd+Shift+5 → Record Entire Screen, then assemble as above.

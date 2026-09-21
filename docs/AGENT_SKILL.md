# Debugger skill — for Copilot / Claude / Codex (sidebar agents)

You can drive the REAL VSCode debugger — breakpoints, the yellow step line,
live variables, the debug toolbar, all visible to the user — through eight
tools. Use them whenever you are asked to find, reproduce or explain a bug by
debugging it.

## The loop

1. Read the failing check and decide where the suspect value is computed.
2. `llm-debugger_breakpoint` — set 1–3 breakpoints **before** launching.
   A program launched with nothing bound runs straight to exit.
3. `llm-debugger_start` with `{ program }`. The session opens visibly and runs
   to your first breakpoint.
4. `llm-debugger_state` — read the stack, the locals and the source around the
   paused line.
5. `llm-debugger_evaluate` — the cheapest move in the whole loop. One
   expression answers a question that would otherwise cost ten steps:
   `holdKey(ids[0])`, `xs.slice().sort()`, `typeof prices[0]`.
6. `llm-debugger_step` (`next` / `in` / `out` / `continue`) to move.
7. Repeat 4–6 until a runtime value — not a reading of the code — proves the
   cause.
8. Explain it citing the values you saw, propose the minimal fix, then
   `llm-debugger_stop`.

## Two brains

- **Routine routing** ("step in? keep going? am I done?") →
  `llm-debugger_triage_jev`. Sub-second, output tokens free. Execute its
  `recommendedAction` with the step / breakpoint / evaluate tools.
- **Generation** (a breakpoint location, an expression, the final fix) → your
  own reasoning, or `llm-debugger_diagnose_llm`. Do not spend generation calls
  on routine stepping.

## Rules

- Drive the debugger. Do not guess the bug from static reading — every claim
  about behaviour must cite a value you observed while paused.
- Held-out answers: `benchmark/`, `docs/`, `demo/` and `e2e/` record root
  causes from earlier runs, and `benchmark/ground-truth.json` is the answer key
  outright. Do not open them while hunting. The example code itself contains no
  pointers.
- `llm-debugger_stop` removes only the breakpoints these tools created; the
  user's own breakpoints are left alone. Always stop when you are done.

## Out-of-process agents (Claude Code / Codex CLI)

The same tools are exposed over MCP. From the repo root, with the extension
running in VSCode (it writes `.llm-debugger/bridge.json` on activation):

```bash
claude mcp add llm-debugger -- node "$PWD/mcp-server/server.mjs"
codex  mcp add llm-debugger -- node "$PWD/mcp-server/server.mjs"
```

In-process chat (Copilot) needs no setup — reference the tools with `#`
(`#debugStart`, `#debugEvaluate`, …).

## Example prompt

> Find the bug behind `FAIL: inventory release restores availability => got 198,
> expected 200` in `examples/order-processor` by actually debugging it: set
> breakpoints where the reservation is released, step in, and evaluate the
> values until you can point at the line that computes the wrong one. Then tell
> me the root cause with those values as evidence.

## Easiest path: the built-in participant

The extension ships its own chat participant — no MCP setup, no workspace
files. In any sidebar chat:

- `@debugger` — runs the open or attached file, takes its first failing check
  and hunts that.
- `@debugger the async order total comes out NaN` — hunt a symptom you name.
- `@debugger run.js` — name the program.

Pick the brain in Settings → LLM Debugger → `strategy` (`jev` routes each step
through the fast decision model; `llm` reasons every step, the slow baseline).
Keys go in `jevApiKey` / `llmApiKey`, or stay in `AI_GATEWAY_API_KEY` /
`api.env`. Which brain ran is verifiable afterwards: the ledger reports
`jevCalls`, so an `llm`-strategy run shows zero.

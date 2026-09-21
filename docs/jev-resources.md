# TypeSafe Jev — Resources & Integration Notes

> Last verified: 2026-09-20 (Europe/Berlin). Gateway catalog queried live with `AI_GATEWAY_API_KEY` from `api.env`.

## What Jev is

- **System One decision engine, not a generative LLM.** You send `state` (what happened) + typed `questions` (what you want to decide). Jev returns typed probabilistic answers. No autoregressive token sampling, no sampling temperature, no chat history.
- **Three question types:**
  - `boolean` (Noul) — e.g. "is root cause obvious?" → `{ probability: 0..1 }`
  - `choice` — e.g. "what should debugger do next?" → `{ choice, probabilities, confidence }`
  - `score` — ordinal 0..10 or custom min/max → `{ score, confidence }`
- **Performance:** 70–500 ms per decision, parallel questions in one request.
- **Pricing (gateway catalog, live):** `typesafe-ai/jev` — input `$0.000000042` / token ($0.042 / MTok), output `$0`. ~60x cheaper input than `gpt-4o`-class models, output free.
- **Context:** 32k tokens input, `max_tokens: 0` (evaluation model), `type: "evaluation"`, `supported_specifications: ["v4"]`, `zdr: all`, `no_training: all`.

## Canonical sources

1. System One Models: Jev, the TypeSafe AI Model for Decisions, Classifications & Routing — https://saascity.io/blog/system-one-models-jev-typesafe-ai-2026
   - Jev vs LLMs table, Noul/Choice/Score explainer, Hybrid "Traffic Cop + Specialist" pattern, Vercel AI Gateway `evaluate` example (`experimental_evaluate`, model `typesafe-ai/jev`).
2. TypeSafe AI: Now Available on Vercel AI Gateway (2026-09-02) — https://vercel.com/changelog/typesafe-ai-jev-now-available-on-ai-gateway
   - Jev for classification, routing, rubric-based assessment, automated verification. Latency 70–500 ms. Pricing $0.042/MTok input, output free. Best paired with frontier models.
3. Vercel AI Gateway — Evaluation models docs — https://vercel.com/docs/ai-gateway/modalities/evaluation
   - `POST https://ai-gateway.vercel.sh/v1/evaluate` with `{ model, state, questions }`. AI SDK 7.0.105+ `experimental_evaluate`. Question shapes verified live (see below).
4. Tru-Jev harness (example eval harness) — https://github.com/trufyrelabs/tru-jev-harness
   - Shows `state` + natural-language questions pattern; useful as a template for debugger triage harnesses.

## Calling Jev

Two routes, two dialects. Both verified live 2026-09-21; the differences are
handled in `src/ai/jev.ts` so callers write questions once.

|                | direct (default)              | gateway                         |
|----------------|-------------------------------|---------------------------------|
| endpoint       | `POST api.typesafe.ai/v1/systemone` | `POST ai-gateway.vercel.sh/v1/evaluate` |
| model          | `jev-latest`                  | `typesafe-ai/jev`               |
| key            | `TYPESAFE_API_KEY`            | `AI_GATEWAY_API_KEY`            |
| yes/no type    | `"noul"`                      | `"boolean"`                     |
| question text  | `instructions`                | `question`                      |
| yes/no answer  | `{ "noul": 0.62 }`            | `{ "probability": 0.62 }`       |
| score answer   | `{ score, legend, probabilities, confidence }` | `{ score, confidence }` |
| usage          | `{ input_tokens, output_tokens }` | `{ inputTokens, outputTokens }` |

Direct request, exactly as sent:

```json
{
  "model": "jev-latest",
  "state": "Debugger paused at inventory.js:32. holdKey(rid) returned \"1789987089449\" instead of \"pen\".",
  "questions": {
    "nextAction": {
      "type": "choice",
      "instructions": "Which single debugger action best advances the hunt?",
      "criteria": { "next": "Step over", "stepIn": "Step into the call", "finish": "Enough evidence, write the fix" }
    },
    "readyForFix": {
      "type": "noul",
      "instructions": "Do the observed values identify the line producing the wrong value?"
    },
    "severity": {
      "type": "score",
      "instructions": "How severe is this correctness bug?",
      "criteria": ["trivial", "minor", "noticeable", "serious", "completely wrong"]
    }
  }
}
```

Answer to that request, observed in 0.76s:

```json
{"model":"jev-1.13.0","answers":{
  "nextAction":{"type":"choice","choice":"stepIn","confidence":0.68,
                "probabilities":{"stepIn":0.73,"evaluate":0.22,"next":0.02,"...":0}},
  "readyForFix":{"type":"noul","noul":0.62},
  "severity":{"type":"score","score":3.08,"confidence":0.8,
              "legend":{"0":"trivial","1":"minor","2":"noticeable","3":"serious","4":"completely wrong"}}},
 "usage":{"input_tokens":525,"output_tokens":107}}
```

A `score` comes back as a level index on the criteria ladder, not a 0–1 value —
`3.08` of a 5-rung ladder. `jev.ts` normalises it so callers need not know how
many rungs a question had.

Gateway gotchas, if you use that route instead: `questions` must be an object
not an array; `choice` needs `criteria` keyed by choice; `score` needs
`criteria` as an array plus `min`/`max`; and `typesafe-ai/jev` on
`/v1/chat/completions` answers 400 — it is an evaluation model.

## The generation model

Default `gpt-5.4-nano` at reasoning effort `none`, via
`POST api.openai.com/v1/responses`. Measured on a real decision call (7 tools,
`tool_choice: "required"`, a realistic paused-frame observation), median of 3:

| model | median | tool calls | $/MTok in | $/MTok out |
|---|---|---|---|---|
| `gpt-5.4-nano` | **1.12s** | 3/3 | 0.20 | 1.25 |
| `gpt-5.4-mini` | 1.27s | 3/3 | 0.75 | 4.50 |
| `gpt-4o-mini` | 2.06s | 3/3 | 0.15 | 0.60 |
| `gpt-5.6-sol` (effort low) | 3.18s | 3/3 | 4.00 | 20.00 |
| `gpt-5-mini` | 4.87s | 3/3 | 0.25 | 2.00 |
| `gpt-5-nano` | 6.05s | **0/3** | 0.05 | 0.40 |

`gpt-5-nano` returns no `function_call` item at all under `tool_choice:
"required"`, so it cannot drive this agent whatever it costs. Same failure mode
as `deepseek/deepseek-v4-flash` on the gateway route.

The Responses API is not optional for the reasoning models. On
`/v1/chat/completions` the API answers:

> Function tools with reasoning_effort are not supported for gpt-5.6-sol in
> /v1/chat/completions. To use function tools, use /v1/responses or set
> reasoning_effort to 'none'.

Every structured answer here is a function call, so the choice is
`/v1/responses` or no reasoning at all. Replies come back as an `output` array —
reasoning items first, then the `function_call` — and a request that hits its
output cap returns `status: "incomplete"` carrying only the reasoning item,
which is a miss rather than an answer.

The API resolves an alias to a dated id (`gpt-5.4-nano` bills as
`gpt-5.4-nano-2026-03-17`), so `pricing.ts` strips a trailing date and uses the
family rate rather than listing every snapshot.

## How the two are split here

- **Jev** answers the routing question every step — `nextAction` over the seven
  debugger actions, plus `readyForFix` and `atFault` — in one request, in
  parallel, output free.
- **The LLM** is woken only for what a classifier cannot produce: the opening
  hypothesis and breakpoints, a breakpoint location or an expression when Jev
  asks for one, and the closing root cause and patch. Those escalations are
  counted in the ledger like any other LLM call.
- **Deterministic code** owns the step budget, the wall-clock budget,
  breakpoint validation, stall detection, "never continue with nothing bound",
  and the rule that a verdict must rest on at least two observed runtime values.

There is deliberately **no offline heuristic fallback** for Jev. A local guess
would be indistinguishable from a real Jev answer in the benchmark numbers, so
an unreachable Jev fails loudly instead.

## Files in this repo

- `src/ai/jev.ts` — typed `/v1/evaluate` client (boolean / choice / score).
- `src/ai/gateway.ts` — OpenAI-compatible client for the generation model.
- `src/ai/retry.ts` — shared transient-failure retry with jitter.
- `src/ai/pricing.ts` — per-token prices, so the ledger's dollars are real.
- `src/agent/loop.ts` — the hunt: observe → decide → act, plus all the policy.
- `src/agent/strategies/{jev,llm}.ts` — the two brains behind one interface.
- `src/debug/DebugTarget.ts` — the debugger surface the loop is written against.
- `src/debug/VscodeDebugTarget.ts` — the real implementation. See its header for
  the js-debug parent/child session trap.
- `src/ai/hybridPolicy.ts` — Jev routing for the legacy sidebar loop only.
- `examples/order-processor/` — the 13-bug example. No answers in comments.
- `benchmark/ground-truth.json` — the answer key, kept outside the example so a
  debugging agent working in that folder cannot read it.
- `benchmark/` — task isolation, the in-host runner, and scoring by applying the
  patch and re-running the program.

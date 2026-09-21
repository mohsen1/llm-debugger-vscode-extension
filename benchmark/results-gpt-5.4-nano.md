# Debugging performance: Jev routing vs LLM routing

Generated 2026-09-21T19:25:59.460Z · 26 runs

Same loop, same action vocabulary, same observations, same closing report.
The only difference is who answers *what should the debugger do next* at each
step: `jev` routes with a typed evaluation call and wakes the generation model
only for a breakpoint location or an expression; `llm` asks the generation model
every step. Each task is the example with every bug fixed but one; the agent is
told only the failing assertion.

**Solved** means the proposed patch applied, made that assertion pass, and broke
nothing that was passing. It is checked by running the program, not by a judge.

## Summary

| brain | solved | located (±3 lines) | right file | median run | steps | LLM calls | fast checks | cost |
|---|---|---|---|---|---|---|---|---|
| `jev` | **13/13** | 9/13 | 13/13 | 12.8s | 147 | 67 | 157 | $0.0549 |
| `llm` | **11/13** | 8/13 | 12/13 | 92.5s | 513 | 540 | 0 | $0.2430 |

Models that answered: `gpt-5.4-nano-2026-03-17`, `jev-1.13.0`.

Runs the host had to abandon (no ledger, counted as unsolved): `llm` 1.

## Per task

| task | depth | jev | llm |
|---|---|---|---|
| `sort-no-comparator` | shallow | ✅ pricing.js:22 · 2 steps | ✅ pricing.js:22 · 8 steps |
| `percent-floor` | medium | ✅ money.js:9 · 5 steps | ✅ money.js:9 · 60 steps |
| `tax-on-subtotal` | medium | ✅ pricing.js:25 · 6 steps | ✅ pricing.js:33 · 60 steps |
| `shipping-threshold-strict` | shallow | ✅ pricing.js:35 · 3 steps | ✅ pricing.js:27 · 48 steps |
| `unawaited-prices` | deep | ✅ orders.js:7 · 20 steps | ✅ orders.js:5 · 60 steps |
| `merge-overwrites-qty` | medium | ✅ cart.js:18 · 12 steps | ✅ cart.js:20 · 60 steps |
| `holdkey-wrong-segment` | deep | ✅ inventory.js:26 · 18 steps | ✅ inventory.js:19 · 42 steps |
| `coupon-order` | medium | ✅ coupons.js:1 · 26 steps | ✅ coupons.js:1 · 17 steps |
| `freeship-single-only` | shallow | ✅ coupons.js:29 · 34 steps | ✅ coupons.js:33 · 49 steps |
| `zip-prefix-two-digits` | deep | ✅ tax.js:6 · 6 steps | ✅ tax.js:4 · 60 steps |
| `weight-block-floor` | shallow | ✅ shipping.js:19 · 6 steps | ✅ shipping.js:18 · 34 steps |
| `idempotency-key-per-attempt` | medium | ✅ payments.js:6 · 5 steps | ❌ payments.js:5 · 15 steps |
| `ledger-gross-revenue` | deep | ✅ ledger.js:4 · 4 steps | ❌ no report · 0 steps |

## Where runs fell short

- `idempotency-key-per-attempt` / `llm` — pointed at payments.js:5, expected payments.js:8 (ended: agent finished)
- `ledger-gross-revenue` / `llm` — patch did not apply (no edits proposed) (ended: abandoned: Error: run exceeded 420s)

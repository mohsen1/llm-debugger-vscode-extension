# Order Processor — Debug Example

A small multi-file checkout: product catalog, money helpers, discount
rules, pricing engine, sync + async order paths, and a check script.

- `catalog.js` — product data + synchronous price lookups
- `money.js` — cents/dollars conversion + percentage helpers
- `discounts.js` — discount code rules
- `services.js` — remote service facades (simulated latency)
- `pricing.js` — subtotal / discount / tax / shipping engine
- `orders.js` — sync and async checkout paths
- `run.js` — behavioral checks (currently failing)

Intended behavior: subtotal in integer cents; SAVE10 = 10% off,
SAVE20 = 20% off subtotals of $50.00+ (nearest cent); 8% tax on the
discounted amount; free shipping when the discounted amount reaches
$50.00, else $4.99; async checkout agrees with the sync path.

## Run

```bash
node examples/order-processor/run.js
```

- `cart.js` — line validation + duplicate merging
- `inventory.js` — async availability + reservations
- `coupons.js` — percent/fixed/free-shipping stacking
- `tax.js` — zip jurisdiction rates
- `shipping.js` — weight tiers + thresholds
- `payments.js` — authorize with idempotent retries
- `ledger.js` — balanced sale entries + reconciliation
- `receipts.js` — customer receipt rendering
- `pipeline.js` — the 12-stage checkout orchestrator

Intended behavior (pipeline): duplicate cart lines merge by summing
quantities; released reservations restore availability exactly; percent
coupons shape the remainder before fixed amounts come off, and free
shipping combines with any discount mix; zip rates resolve on the 3-digit
prefix; shipping charges a full block for any started 500g over the
allowance; every payment retry rides the same idempotency key so the
gateway logs one key; ledger revenue is the discounted merchandise amount
and entries reconcile to the charged total.

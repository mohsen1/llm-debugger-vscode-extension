import { processOrderSync, processOrderAsync } from "./orders.js";
import { rankTotals } from "./pricing.js";
import { discountFor } from "./discounts.js";
import { totalsFor } from "./pricing.js";

let failures = 0;
function check(name, actual, expected) {
  if (Object.is(actual, expected)) {
    console.log(`PASS: ${name} => ${actual}`);
  } else {
    failures++;
    console.error(`FAIL: ${name} => got ${actual}, expected ${expected}`);
  }
}

// Shortlist display ordering.
const sorted = rankTotals([2000, 10000, 900, 5000]);
check("rankTotals numeric order", JSON.stringify(sorted), JSON.stringify([900, 2000, 5000, 10000]));

// Percentage discount rounding: 3 x $12.99 = $38.97, SAVE10 = 10%.
check("SAVE10 discount rounding", discountFor(3897, "SAVE10"), 390);

// Representative cart: 2 books + 12 pens with SAVE10.
const order = processOrderSync(
  [{ id: "book", qty: 2 }, { id: "pen", qty: 12 }],
  "SAVE10",
);
console.log("sync order breakdown:", order);
  check("sync order total is integer cents", Number.isInteger(order.total), true);

// Large cart with SAVE20.
const big = processOrderSync([{ id: "lamp", qty: 2 }], "SAVE20");
console.log("big order breakdown:", big);
check("big order shipping free", big.shipping, 0);
check("big order tax on after-discount (704)", big.tax, 704);
check("big order discount rounded (2200)", big.discount, 2200);

// Shipping threshold edge: discounted amount of exactly $50.00.
check("shipping free at exactly 5000", totalsFor(5556, 556).shippingCents, 0);
check("tax on after-discount not subtotal", totalsFor(5000, 500).taxCents, 360);

// Async checkout should agree with the sync path.
const asyncOrder = await processOrderAsync([{ id: "book", qty: 1 }], "SAVE10");
console.log("async order breakdown:", asyncOrder);
check("async order total is finite number", Number.isFinite(asyncOrder.total), true);
check("async order total matches sync", asyncOrder.total, processOrderSync([{ id: "book", qty: 1 }], "SAVE10").total);


// Deep pipeline: the full 12-stage checkout over the new modules.
import { normalizeLines } from "./cart.js";
import { checkAvailability, takeReservation, releaseReservation, __resetReservations } from "./inventory.js";
import { applyCoupons } from "./coupons.js";
import { rateForZip } from "./tax.js";
import { shippingFor } from "./shipping.js";
import { authorizeWithRetry } from "./payments.js";
import { recordSale, reconcile } from "./ledger.js";
import { checkoutPipeline } from "./pipeline.js";
import { armFailNextCharge, resetChargeLog, chargeLog } from "./services.js";

check("cart merges duplicate lines", JSON.stringify(normalizeLines([{ id: "book", qty: 1 }, { id: "book", qty: 2 }])), JSON.stringify([{ id: "book", qty: 3 }]));

__resetReservations();
const resIds = await takeReservation([{ id: "pen", qty: 2 }]);
await releaseReservation(resIds);
const avail = await checkAvailability([{ id: "pen", qty: 1 }]);
check("inventory release restores availability", avail[0].available, 200);

check("coupon percent applies before fixed", applyCoupons(10000, ["P10", "F500"]).discountCents, 1500);
check("free shipping combines with discounts", applyCoupons(10000, ["P10", "SHIPFREE"]).freeShip, true);

check("zip rate resolves 3-digit prefix", await rateForZip("90210"), 0.09);

check("shipping rounds partial block up", shippingFor({ afterDiscountCents: 1000, weightGrams: 501, freeShipCoupon: false }), 698);

resetChargeLog();
armFailNextCharge();
await authorizeWithRetry(1000);
check("payment retry keeps one idempotency key", new Set(chargeLog.map((c) => c.key)).size, 1);

const posted = recordSale([], { subtotal: 5000, discount: 500, tax: 360, shipping: 499, total: 5359 });
check("ledger posts discounted revenue", posted.find((e) => e.account === "revenue").amount, 4500);
check("ledger reconciles to charged total", reconcile(posted, 5359), true);

const pipe = await checkoutPipeline([{ id: "book", qty: 1 }, { id: "book", qty: 1 }], { coupons: ["P10"], zip: "10001" });
check("pipeline books merged quantity", pipe.reservedQty, 2);
check("pipeline ledger balances", pipe.ledgerBalanced, true);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed — bugs reproduced.`);
  process.exit(1);
} else {
  console.log("\nAll checks passed.");
}

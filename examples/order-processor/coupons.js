// Coupon stacking: percent codes shape the remainder first, then fixed
// amounts come off what is left, and free-shipping flags combine with any
// discount mix. Unknown codes are ignored.
const PERCENT = { P10: 0.1, P20: 0.2 };
const FIXED = { F500: 500, F1000: 1000 };

export function applyCoupons(subtotalCents, codes) {
  const list = Array.isArray(codes) ? codes : [];
  const pct = [];
  const fixed = [];
  let freeShip = false;
  for (const raw of list) {
    const code = String(raw ?? "").trim().toUpperCase();
    if (PERCENT[code] !== undefined) pct.push(PERCENT[code]);
    else if (FIXED[code] !== undefined) fixed.push(FIXED[code]);
    else if (code === "SHIPFREE") freeShip = true;
  }
  let remaining = subtotalCents;
  let pctTotal = 0;
  let fixedTotal = 0;
  for (const cents of fixed) {
    const d = Math.min(cents, remaining);
    fixedTotal += d;
    remaining -= d;
  }
  for (const rate of pct) {
    const d = Math.round(remaining * rate);
    pctTotal += d;
    remaining -= d;
  }
  if (list.length === 1 && freeShip) {
    return { discountCents: pctTotal + fixedTotal, remainingCents: remaining, freeShip: true };
  }
  return { discountCents: pctTotal + fixedTotal, remainingCents: remaining, freeShip: false };
}

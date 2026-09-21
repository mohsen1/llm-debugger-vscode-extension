// Discount rules. Codes map to a rate plus an optional minimum subtotal.
// SAVE10 takes 10% off any subtotal; SAVE20 takes 20% off subtotals of
// $50.00 or more. Amounts round to the nearest cent.
import { percentOf } from "./money.js";

const RULES = {
  SAVE10: { rate: 0.1 },
  SAVE20: { rate: 0.2, minSubtotalCents: 5000 },
};

export function discountFor(subtotalCents, code) {
  const rule = RULES[code];
  if (!rule) return 0;
  if (rule.minSubtotalCents && subtotalCents < rule.minSubtotalCents) return 0;
  return percentOf(subtotalCents, rule.rate);
}

// Shipping: base fare plus one block per started 500g over the included
// allowance. Free when a coupon flag or the discounted-amount threshold says so.
import { FREE_SHIPPING_THRESHOLD_CENTS, STANDARD_SHIPPING_CENTS } from "./pricing.js";

export const WEIGHT_ALLOWANCE_GRAMS = 500;
export const WEIGHT_BLOCK_GRAMS = 500;
export const WEIGHT_BLOCK_CENTS = 199;

export function weightForLines(lines, weightOf) {
  return lines.reduce((g, l) => g + weightOf(l.id) * l.qty, 0);
}

export function shippingFor({ afterDiscountCents, weightGrams, freeShipCoupon }) {
  if (freeShipCoupon) return 0;
  if (afterDiscountCents >= FREE_SHIPPING_THRESHOLD_CENTS) return 0;
  const extra = Math.max(0, weightGrams - WEIGHT_ALLOWANCE_GRAMS);
  const blocks = Math.floor(extra / WEIGHT_BLOCK_GRAMS);
  return STANDARD_SHIPPING_CENTS + blocks * WEIGHT_BLOCK_CENTS;
}

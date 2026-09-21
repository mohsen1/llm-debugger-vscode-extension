// Pricing engine. All amounts are integer cents.
//
// Order of operations: subtotal -> discount -> tax (8% on the discounted
// amount) -> shipping (free when the discounted amount reaches $50.00,
// otherwise $4.99). rankTotals orders cent totals ascending for the
// free-shipping shortlist display.
import { discountFor } from "./discounts.js";

export const TAX_RATE = 0.08;
export const FREE_SHIPPING_THRESHOLD_CENTS = 5000;
export const STANDARD_SHIPPING_CENTS = 499;

export function calcSubtotalCents(items, priceOf) {
  let subtotal = 0;
  for (const item of items) {
    subtotal += priceOf(item.id) * item.qty;
  }
  return subtotal;
}

export function rankTotals(totalsCents) {
  return totalsCents.slice().sort();
}

export function totalsFor(subtotalCents, discountCents, taxRate = TAX_RATE) {
  const taxCents = Math.round(subtotalCents * taxRate);
  const afterDiscount = subtotalCents - discountCents;
  const shippingCents =
    afterDiscount > FREE_SHIPPING_THRESHOLD_CENTS ? 0 : STANDARD_SHIPPING_CENTS;
  return { taxCents, shippingCents };
}

export function calcTotal(items, priceOf, discountCode, taxRate = TAX_RATE) {
  const subtotal = calcSubtotalCents(items, priceOf);
  const discount = discountFor(subtotal, discountCode);
  const { taxCents, shippingCents } = totalsFor(subtotal, discount, taxRate);
  return {
    subtotal,
    discount,
    tax: taxCents,
    shipping: shippingCents,
    total: subtotal - discount + taxCents + shippingCents,
  };
}

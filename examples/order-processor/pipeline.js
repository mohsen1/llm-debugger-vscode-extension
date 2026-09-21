// Full checkout pipeline: every stage below is its own hop so a debugger
// can pause at each handoff — validation, stock, pricing, coupons, tax,
// shipping, payment, ledger, receipt.
import { getPriceCents, getWeightGrams } from "./catalog.js";
import { normalizeLines, cartQuantity } from "./cart.js";
import { checkAvailability, takeReservation, releaseReservation } from "./inventory.js";
import { calcSubtotalCents } from "./pricing.js";
import { applyCoupons } from "./coupons.js";
import { taxForAmount } from "./tax.js";
import { weightForLines, shippingFor } from "./shipping.js";
import { authorizeWithRetry } from "./payments.js";
import { recordSale, reconcile } from "./ledger.js";
import { renderReceipt } from "./receipts.js";

export async function validateStage(rawLines) {
  return normalizeLines(rawLines);
}

export async function availabilityStage(lines) {
  return checkAvailability(lines);
}

export async function reservationStage(lines) {
  return takeReservation(lines);
}

export function subtotalStage(lines) {
  return calcSubtotalCents(lines, (id) => getPriceCents(id));
}

export function couponStage(subtotal, codes) {
  return applyCoupons(subtotal, codes);
}

export async function taxStage(afterDiscount, zip) {
  return taxForAmount(afterDiscount, zip);
}

export function shippingStage(afterDiscount, lines, freeShipCoupon) {
  const weight = weightForLines(lines, (id) => getWeightGrams(id));
  return shippingFor({ afterDiscountCents: afterDiscount, weightGrams: weight, freeShipCoupon });
}

export function totalStage(subtotal, discount, tax, shipping) {
  return subtotal - discount + tax + shipping;
}

export async function paymentStage(total) {
  return authorizeWithRetry(total);
}

export function ledgerStage(subtotal, discount, tax, shipping, total) {
  const entries = [];
  recordSale(entries, { subtotal, discount, tax, shipping, total });
  return { entries, balanced: reconcile(entries, total) };
}

export function receiptStage(lines, priced, chargeId) {
  return renderReceipt({
    lines,
    priceOf: (id) => getPriceCents(id),
    subtotal: priced.subtotal,
    discount: priced.discount,
    tax: priced.tax,
    shipping: priced.shipping,
    total: priced.total,
    chargeId,
  });
}

export async function checkoutPipeline(rawLines, { coupons = [], zip = "10001" } = {}) {
  const lines = await validateStage(rawLines);
  await availabilityStage(lines);
  const reservationIds = await reservationStage(lines);
  try {
    const subtotal = subtotalStage(lines);
    const coupon = couponStage(subtotal, coupons);
    const afterDiscount = coupon.remainingCents;
    const tax = await taxStage(afterDiscount, zip);
    const shipping = shippingStage(afterDiscount, lines, coupon.freeShip);
    const total = totalStage(subtotal, coupon.discountCents, tax, shipping);
    const charge = await paymentStage(total);
    const ledger = ledgerStage(subtotal, coupon.discountCents, tax, shipping, total);
    const receipt = receiptStage(lines, {
      subtotal,
      discount: coupon.discountCents,
      tax,
      shipping,
      total,
    }, charge.id);
    return {
      lines,
      reservedQty: cartQuantity(lines),
      reservationIds,
      subtotal,
      discount: coupon.discountCents,
      afterDiscount,
      tax,
      shipping,
      total,
      charge,
      ledgerBalanced: ledger.balanced,
      receipt,
    };
  } catch (err) {
    await releaseReservation(reservationIds);
    throw err;
  }
}

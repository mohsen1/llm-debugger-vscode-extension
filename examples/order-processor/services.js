// Remote service facades (simulated latency). Checkout reads prices, stock,
// tax rates and the payment gateway through these; callers are responsible
// for awaiting them.
import { getPriceCents } from "./catalog.js";

const STOCK = {
  book: 50,
  pen: 200,
  lamp: 10,
  mug: 100,
  keyboard: 25,
  notebook: 120,
  headphones: 15,
};

const ZIP_RATES = {
  902: 0.09,
  100: 0.08875,
  941: 0.085,
};

export function fetchPriceCentsAsync(productId) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(getPriceCents(productId)), 5);
  });
}

export function fetchTaxRateAsync() {
  return new Promise((resolve) => {
    setTimeout(() => resolve(0.08), 5);
  });
}

export function fetchStockAsync(productId) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(STOCK[productId] ?? 0), 5);
  });
}

export function fetchTaxRateForZipAsync(zip) {
  return new Promise((resolve) => {
    setTimeout(() => {
      const prefix = Number(String(zip).slice(0, 3));
      resolve(ZIP_RATES[prefix] ?? 0.08);
    }, 5);
  });
}

export const chargeLog = [];
let failNextCharge = false;

export function armFailNextCharge() {
  failNextCharge = true;
}

export function resetChargeLog() {
  chargeLog.length = 0;
  failNextCharge = false;
}

export function chargeAsync(amountCents, idempotencyKey) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      chargeLog.push({ key: idempotencyKey, amount: amountCents });
      if (failNextCharge) {
        failNextCharge = false;
        reject(new Error("gateway timeout"));
        return;
      }
      resolve({ id: `py_${chargeLog.length}`, amount: amountCents, key: idempotencyKey });
    }, 5);
  });
}

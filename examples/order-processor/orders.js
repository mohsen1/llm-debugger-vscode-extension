import { getPriceCents } from "./catalog.js";
import { fetchPriceCentsAsync, fetchTaxRateAsync } from "./services.js";
import { calcTotal } from "./pricing.js";

// Async checkout: resolves the live tax rate and per-item prices, then
// prices the cart with the shared calcTotal engine.
export async function processOrderAsync(items, discountCode) {
  const taxRate = await fetchTaxRateAsync();
  const prices = items.map((item) => fetchPriceCentsAsync(item.id));
  const priceOf = (id) => {
    const idx = items.findIndex((i) => i.id === id);
    return prices[idx];
  };
  return calcTotal(items, priceOf, discountCode, taxRate);
}

export function processOrderSync(items, discountCode) {
  return calcTotal(items, (id) => getPriceCents(id), discountCode);
}

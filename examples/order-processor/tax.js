// Tax: resolves the jurisdiction rate for a zip and applies it to the
// discounted merchandise amount.
import { fetchTaxRateForZipAsync } from "./services.js";

export async function rateForZip(zip) {
  return fetchTaxRateForZipAsync(String(zip ?? "").slice(0, 2));
}

export async function taxForAmount(afterDiscountCents, zip) {
  const rate = await rateForZip(zip);
  return Math.round(afterDiscountCents * rate);
}

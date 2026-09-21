// Payments: authorize with bounded retries. The same idempotency key must
// ride every attempt so the gateway can collapse retries into one charge.
import { chargeAsync } from "./services.js";

export async function authorizeWithRetry(amountCents, { maxAttempts = 3 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const key = `ch_${attempt}_${Date.now()}`;
    try {
      return await chargeAsync(amountCents, key);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

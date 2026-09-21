import log from "../logger";

const subLog = log.createSubLogger("Retry");

/**
 * Gateways rate-limit and occasionally answer 503. In a benchmark that makes
 * hundreds of sequential calls those are certainties, not edge cases, and an
 * unretried blip shows up as a strategy losing a task it never got to attempt.
 */
export function isTransient(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  label?: string;
}

/**
 * A rate limit is measured in requests per MINUTE, so backing off for a second
 * and giving up is no wait at all. Observed live: a free-tier route capped at
 * 5 rpm failed three retries inside two seconds and lost the task.
 */
const RATE_LIMIT_BASE_DELAY_MS = 4000;

/**
 * Runs `fn`, retrying while it throws a `TransientError`. Anything else — a
 * 400, a bad key, a model that is not on this plan — fails immediately, since
 * retrying it only wastes the budget.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 4;
  const base = opts.baseDelayMs ?? 700;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!(err instanceof TransientError) || attempt === attempts - 1) throw err;
      // Exponential with jitter: sequential callers otherwise resynchronise
      // and hit the same limit together on every retry.
      const rateLimited = /\b429\b|rate limit/i.test(err.message);
      const scale = rateLimited ? RATE_LIMIT_BASE_DELAY_MS : base;
      const delay = scale * 2 ** attempt + Math.random() * (rateLimited ? 1500 : 250);
      subLog.debug(
        `${opts.label ?? "call"} failed (${err.message.slice(0, 120)}), retrying in ${Math.round(delay)}ms`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * fetch with a hard deadline. Node's fetch has NO default timeout: a connection
 * the gateway accepts but never answers hangs the caller forever. Observed live
 * — one stalled request froze a benchmark run past every step and wall-clock
 * budget the loop had, because none of them can fire while awaiting a promise
 * that never settles. A timeout is transient, so it retries.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new TransientError(`request timed out after ${timeoutMs}ms`);
    }
    // DNS failures, resets, dropped sockets: all worth one more try.
    throw new TransientError(`request failed: ${String(err).slice(0, 200)}`);
  } finally {
    clearTimeout(timer);
  }
}

export class TransientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransientError";
  }
}

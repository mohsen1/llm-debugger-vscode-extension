/**
 * Per-token prices in USD. Verified 2026-09-21.
 *
 * Direct vendor routes and gateway routes are priced separately because they
 * are billed separately — the same model can appear under both names.
 */
export const TOKEN_PRICES: Record<string, { in: number; out: number }> = {
  // --- OpenAI, direct ------------------------------------------------------
  // Promotional rate, in force at least through 2026-11-21 ($5 / $30 after).
  "gpt-5.6-sol": { in: 0.000004, out: 0.00002 },
  "gpt-5.6-luna": { in: 0.000004, out: 0.00002 },
  "gpt-5.6-terra": { in: 0.000004, out: 0.00002 },
  "gpt-5.4-nano": { in: 0.0000002, out: 0.00000125 },
  "gpt-5.4-mini": { in: 0.00000075, out: 0.0000045 },
  "gpt-5-nano": { in: 0.00000005, out: 0.0000004 },
  "gpt-5-mini": { in: 0.00000025, out: 0.000002 },
  "gpt-4o-mini": { in: 0.00000015, out: 0.0000006 },

  // --- TypeSafe, direct ----------------------------------------------------
  // TypeSafe does not publish a rate on its API docs; this is the figure from
  // the Vercel gateway catalog for the same model, and output is free there.
  // It is an estimate for the direct route, not a quoted price.
  "jev-latest": { in: 0.000000042, out: 0 },
  "jev-1.13.0": { in: 0.000000042, out: 0 },

  // --- Vercel AI Gateway ---------------------------------------------------
  "typesafe-ai/jev": { in: 0.000000042, out: 0 },
  "deepseek/deepseek-v3.1": { in: 0.00000025, out: 0.00000095 },
  "deepseek/deepseek-v4-flash": { in: 0.00000013, out: 0.00000026 },
  "deepseek/deepseek-v4-pro": { in: 0.00000066, out: 0.00000198 },
  "openai/gpt-4o-mini": { in: 0.00000015, out: 0.0000006 },
  "alibaba/qwen3-next-80b-a3b-instruct": { in: 0.00000015, out: 0.0000012 },
};

/**
 * An unlisted model bills at the most expensive rate in the table rather than
 * at zero: a cost column that silently under-reports is worse than one that is
 * visibly pessimistic.
 */
const FALLBACK = { in: 0.000005, out: 0.00003 };

/**
 * `gpt-5.4-nano` bills as `gpt-5.4-nano-2026-03-17` once the API resolves the
 * alias, and Jev answers as `jev-1.13.0` when asked for `jev-latest`. Listing
 * every dated snapshot would go stale on the vendor's schedule, so a trailing
 * date is stripped and the family rate used.
 */
function normalizeModel(model: string): string {
  return model.replace(/-\d{4}-\d{2}-\d{2}$/, "");
}

export function costOf(model: string, inputTokens: number, outputTokens: number): number {
  const price = TOKEN_PRICES[model] ?? TOKEN_PRICES[normalizeModel(model)] ?? FALLBACK;
  return inputTokens * price.in + outputTokens * price.out;
}

export function isPriceKnown(model: string): boolean {
  return model in TOKEN_PRICES || normalizeModel(model) in TOKEN_PRICES;
}

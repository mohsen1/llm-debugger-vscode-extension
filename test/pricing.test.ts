import { describe, expect, it } from "vitest";
import { costOf, isPriceKnown, TOKEN_PRICES } from "../src/ai/pricing";

describe("costOf", () => {
  it("prices a listed model from its own rate", () => {
    const rate = TOKEN_PRICES["gpt-5.4-nano"];
    expect(costOf("gpt-5.4-nano", 1_000_000, 0)).toBeCloseTo(rate.in * 1_000_000, 10);
  });

  it("prices a dated snapshot at its family rate", () => {
    // The API resolves `gpt-5.4-nano` to a dated id; both must bill the same.
    expect(costOf("gpt-5.4-nano-2026-03-17", 500_000, 10_000)).toBeCloseTo(
      costOf("gpt-5.4-nano", 500_000, 10_000),
      12,
    );
    expect(isPriceKnown("gpt-5.4-nano-2026-03-17")).toBe(true);
  });

  it("bills an unknown model pessimistically rather than as free", () => {
    const unknown = costOf("some/unreleased-model", 1_000_000, 1_000_000);
    expect(unknown).toBeGreaterThan(costOf("gpt-5.4-nano", 1_000_000, 1_000_000));
    expect(isPriceKnown("some/unreleased-model")).toBe(false);
  });

  it("charges nothing for Jev output, which is free", () => {
    expect(costOf("jev-latest", 0, 1_000_000)).toBe(0);
    expect(costOf("jev-1.13.0", 1_000_000, 0)).toBeGreaterThan(0);
  });
});

import { describe, expect, it } from "vitest";
import {
  entryCandidates,
  failureLines,
  pickProgram,
  symptomMatch,
  symptomTerms,
  type Probe,
} from "../src/chat/programPick";

const CHECKS = [
  "PASS: cart merges duplicate lines => true",
  "FAIL: inventory release restores availability => got 198, expected 200",
  "PASS: zip rate resolves 3-digit prefix => 0.09",
].join("\n");

function probe(over: Partial<Probe> & Pick<Probe, "path" | "source">): Probe {
  const output = over.output ?? "";
  return { output, failures: failureLines(output), ...over };
}

describe("failureLines", () => {
  it("picks out reported failures and ignores passes", () => {
    expect(failureLines(CHECKS)).toEqual([
      "FAIL: inventory release restores availability => got 198, expected 200",
    ]);
  });
  it("recognises common failure shapes", () => {
    const out = "not ok 3 - totals\nAssertionError: expected 1 to be 2\n✗ shipping\nError: boom";
    expect(failureLines(out)).toHaveLength(4);
  });
});

describe("symptomMatch", () => {
  it("matches a paraphrased symptom to its failure line", () => {
    const symptom = "inventory release restores availability returns 198 instead of 200";
    expect(symptomMatch(CHECKS, symptom)).toBeGreaterThan(0.5);
  });
  it("does not match an unrelated failure", () => {
    expect(symptomMatch(CHECKS, "the async order total comes out NaN")).toBeLessThan(0.5);
  });
  it("scores nothing when the program reported no failure", () => {
    expect(symptomMatch("PASS: everything => ok", "inventory release availability")).toBe(0);
  });
  it("drops filler words so only distinctive terms count", () => {
    expect(symptomTerms("the value returned is wrong for inventory")).toEqual(["inventory"]);
  });
});

describe("pickProgram", () => {
  const openModule = probe({ path: "/ws/orders.js", source: "editor", output: "" });
  const entry = probe({ path: "/ws/run.js", source: "entry", output: CHECKS });

  it("prefers the program that reproduces the symptom over the open file", () => {
    const picked = pickProgram(
      [openModule, entry],
      "inventory release restores availability returns 198 instead of 200",
    );
    expect(picked?.chosen.path).toBe("/ws/run.js");
    expect(picked?.note).toContain("orders.js");
  });

  it("says nothing when the open file is already the right one", () => {
    const openEntry = probe({ path: "/ws/run.js", source: "editor", output: CHECKS });
    const picked = pickProgram([openEntry], "inventory release restores availability");
    expect(picked?.chosen.path).toBe("/ws/run.js");
    expect(picked?.note).toBeUndefined();
  });

  it("falls back to whatever reports a failure when nothing matches the symptom", () => {
    const picked = pickProgram([openModule, entry], "a symptom nobody reports at all");
    expect(picked?.chosen.path).toBe("/ws/run.js");
    expect(picked?.note).toContain("Nothing here reports exactly that failure");
  });

  it("flags the case where every candidate is a silent module", () => {
    const other = probe({ path: "/ws/cart.js", source: "entry", output: "" });
    const picked = pickProgram([openModule, other], "inventory release");
    expect(picked?.note).toBe("none-produced-output");
  });

  it("keeps a prompt-named file when it reproduces the symptom too", () => {
    const named = probe({ path: "/ws/checks.js", source: "prompt", output: CHECKS });
    const picked = pickProgram([named, entry], "inventory release restores availability");
    expect(picked?.chosen.path).toBe("/ws/checks.js");
  });

  it("returns nothing when there is nothing to choose from", () => {
    expect(pickProgram([], "anything")).toBeUndefined();
  });
});

describe("entryCandidates", () => {
  it("offers conventional entry points that exist, package main first", () => {
    const present = new Set(["run.js", "index.js"]);
    expect(entryCandidates("/ws", (n) => present.has(n))).toEqual(["run.js", "index.js"]);
  });
  it("puts package.json main ahead of the conventions", () => {
    const present = new Set(["run.js", "server.js"]);
    expect(entryCandidates("/ws", (n) => present.has(n), "server.js")).toEqual([
      "server.js",
      "run.js",
    ]);
  });
  it("offers nothing when none exist", () => {
    expect(entryCandidates("/ws", () => false)).toEqual([]);
  });
});

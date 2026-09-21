import { describe, expect, it } from "vitest";
import { programFromPrompt } from "../src/chat/promptParsing";

describe("programFromPrompt", () => {
  it("returns undefined for free text (default program)", () => {
    expect(programFromPrompt("")).toBeUndefined();
    expect(programFromPrompt("find the bug in checkout")).toBeUndefined();
  });
  it("picks a JS/TS file from the prompt", () => {
    expect(programFromPrompt("orders.js")).toBe("orders.js");
    expect(programFromPrompt('"pricing.js" please')).toBe("pricing.js");
    expect(programFromPrompt("examples/order-processor/run.js")).toBe(
      "examples/order-processor/run.js",
    );
    expect(programFromPrompt("debug validate.ts now")).toBe("validate.ts");
    expect(programFromPrompt("hunt the bug in src/cli.mjs!")).toBe("src/cli.mjs");
  });
  it("takes the first file when several are named", () => {
    expect(programFromPrompt("compare orders.js with pricing.js")).toBe("orders.js");
  });
  it("strips surrounding punctuation without eating the extension", () => {
    expect(programFromPrompt("(run.js)")).toBe("run.js");
    expect(programFromPrompt("is it `cart.js`?")).toBe("cart.js");
    expect(programFromPrompt("look at run.js.")).toBe("run.js");
  });
  it("ignores prose that merely ends in a dot", () => {
    expect(programFromPrompt("the totals are wrong.")).toBeUndefined();
    expect(programFromPrompt("check the package.json notes")).toBeUndefined();
  });
  it("matches the extensions the participant can act on", () => {
    // .ts is matched on purpose: the participant answers with a clear
    // "node cannot run TypeScript" message rather than a launch failure.
    for (const name of ["a.js", "a.mjs", "a.cjs", "a.ts", "a.tsx", "a.mts"]) {
      expect(programFromPrompt(`debug ${name}`)).toBe(name);
    }
  });
});

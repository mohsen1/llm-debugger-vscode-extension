import { describe, expect, it } from "vitest";
import { shouldIncludeFile } from "../src/context/fileFilter";

const ROOT = "/repo";
describe("shouldIncludeFile", () => {
  it("keeps source files", () => {
    expect(shouldIncludeFile("/repo/examples/order-processor/pricing.js", ROOT)).toBe(true);
    expect(shouldIncludeFile("/repo/.vscode/launch.json", ROOT)).toBe(true);
    expect(shouldIncludeFile("/repo/package.json", ROOT)).toBe(true);
  });
  it("drops build output, deps and vcs", () => {
    expect(shouldIncludeFile("/repo/node_modules/openai/index.js", ROOT)).toBe(false);
    expect(shouldIncludeFile("/repo/.git/objects/ab", ROOT)).toBe(false);
    expect(shouldIncludeFile("/repo/out/index.js", ROOT)).toBe(false);
    expect(shouldIncludeFile("/repo/src/webview/.parcel-cache/x", ROOT)).toBe(false);
  });
  it("never ships secrets", () => {
    expect(shouldIncludeFile("/repo/api.env", ROOT)).toBe(false);
    expect(shouldIncludeFile("/repo/.env", ROOT)).toBe(false);
    expect(shouldIncludeFile("/repo/.env.local", ROOT)).toBe(false);
    expect(shouldIncludeFile("/repo/cert.key", ROOT)).toBe(false);
  });
  it("drops binaries and bundles", () => {
    expect(shouldIncludeFile("/repo/res/icon.png", ROOT)).toBe(false);
    expect(shouldIncludeFile("/repo/out/index.js.map", ROOT)).toBe(false);
  });
});

import * as path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Unit tests run outside an editor, so the `vscode` module does not exist.
    // The code under test never calls it; it is only pulled in by the logger.
    alias: { vscode: path.resolve(__dirname, "test/vscode-stub.ts") },
  },
  test: {
    // Unit tests only. Anything under e2e/ or benchmark/host/ runs *inside* an
    // Extension Development Host and imports `vscode`, which does not exist in
    // a plain node process — those are driven by `benchmark/host/run.js`.
    include: ["test/**/*.test.ts"],
    exclude: ["node_modules/**", "out/**", "e2e/**", "benchmark/host/**", "examples/**"],
  },
});

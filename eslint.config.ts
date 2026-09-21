import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

/** Node built-ins used by the CLI scripts and the in-host suites. */
const nodeGlobals = {
  process: "readonly",
  Buffer: "readonly",
  console: "readonly",
  __dirname: "readonly",
  require: "readonly",
  module: "writable",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  URL: "readonly",
  fetch: "readonly",
  AbortController: "readonly",
} as const;

export default tseslint.config(
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    ignores: [
      "src/generated",
      "dist",
      "out/**",
      "**/node_modules/**",
      // A full VSCode download lives here; linting it exhausts the heap.
      ".vscode-test/**",
      "src/webview/out/**",
      "src/webview/.parcel-cache/**",
      // Held out from the agent and deliberately buggy — linting it is noise.
      "examples/**",
      // Generated copies of the example, same reason.
      "demo/workspace/**",
    ],
  },
  {
    rules: {
      // `_name` is the conventional marker for an argument kept for signature
      // compatibility, which interfaces and fakes need constantly.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // Mocha's TDD interface, injected into the in-host suites by the runner.
    files: ["benchmark/host/suite/**/*.js", "e2e/host/suite/**/*.js"],
    languageOptions: {
      globals: {
        suite: "readonly",
        test: "readonly",
        suiteSetup: "readonly",
        suiteTeardown: "readonly",
        setup: "readonly",
        teardown: "readonly",
      },
    },
  },
  {
    // Node scripts, in-host suites and the MCP server run outside the bundle.
    files: [
      "benchmark/**/*.js",
      "e2e/**/*.js",
      "e2e/**/*.mjs",
      "mcp-server/**/*.mjs",
      "scripts/**/*.js",
      "*.js",
    ],
    languageOptions: { globals: { ...nodeGlobals } },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
);

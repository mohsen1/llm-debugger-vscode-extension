// In-host e2e: launches a real Extension Development Host on the example
// folder and runs Mocha suites INSIDE it (full `vscode` API, no UI clicks).
//   node e2e/host/run.js [--headless]   # headed by default (watch it debug)
// Results: e2e/last-host-run.json
const path = require("node:path");
const fs = require("node:fs");
const { runTests, downloadAndUnzipVSCode } = require("@vscode/test-electron");

async function main() {
  const repo = path.resolve(__dirname, "..", "..");
  const target = path.join(repo, "examples", "order-processor");
  const outFile = path.join(repo, "e2e", "last-host-run.json");
  const headless = process.argv.includes("--headless");
  const execPath = await downloadAndUnzipVSCode();
  console.log(`[host] vscode: ${execPath}`);
  console.log(`[host] target: ${target} ${headless ? "(headless)" : "(headed — watch it debug)"}`);
  const env = { ...process.env, LLM_E2E_OUT: outFile };
  if (process.env.LLM_E2E_SUITE) env.LLM_E2E_SUITE = process.env.LLM_E2E_SUITE;
  if (headless) {
    env.ELECTRON_RUN_AS_NODE = undefined;
  }
  await runTests({
    vscodeExecutablePath: execPath,
    extensionDevelopmentPath: process.env.LLM_E2E_DEVPATH || repo,
    extensionTestsPath: path.join(__dirname, "suite", "index.js"),
    launchArgs: [
      target,
      "--new-window",
      "--disable-workspace-trust",
      // Isolated profile: the CLI refuses `--extensionTestsPath` runs while
      // another Code instance (the user's window) holds the singleton lock.
      `--user-data-dir=${path.join(repo, ".vscode-test", "user-data-e2e")}`,
      ...(headless ? ["--headless", "--disable-gpu", "--disable-dev-shm-usage"] : []),
    ],
    extensionTestsEnv: env,
  });
  console.log(`[host] done: ${outFile}`);
  console.log(fs.readFileSync(outFile, "utf-8").slice(0, 3000));
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(`[host] FAILED: ${err && err.stack ? err.stack : err}`);
    process.exit(1);
  },
);

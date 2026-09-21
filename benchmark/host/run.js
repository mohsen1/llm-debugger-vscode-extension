// Boots one Extension Development Host and runs a Mocha suite inside it, with
// the real `vscode` API and the real debugger. Everything that needs a live
// debug session happens in here; scoring happens outside, afterwards.
//
//   node benchmark/host/run.js --suite=ownership [--headless]
//
// Env passed through to the suite:
//   LLMDBG_OUT       where the suite writes its results JSON
//   LLMDBG_WORKSPACE folder the host opens (defaults to the example)
const path = require("node:path");
const fs = require("node:fs");
const { runTests, downloadAndUnzipVSCode } = require("@vscode/test-electron");

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

async function main() {
  const repo = path.resolve(__dirname, "..", "..");
  const suite = arg("suite", "ownership");
  const workspace = path.resolve(arg("workspace", path.join(repo, "examples", "order-processor")));
  const outFile = path.resolve(arg("out", path.join(repo, "benchmark", `host-${suite}.json`)));
  const headless = process.argv.includes("--headless");

  if (!fs.existsSync(workspace)) throw new Error(`workspace not found: ${workspace}`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });

  const execPath = await downloadAndUnzipVSCode();
  console.log(`[host] suite=${suite} workspace=${workspace} ${headless ? "headless" : "headed"}`);

  await runTests({
    vscodeExecutablePath: execPath,
    extensionDevelopmentPath: repo,
    extensionTestsPath: path.join(__dirname, "suite", "index.js"),
    launchArgs: [
      workspace,
      "--new-window",
      "--disable-workspace-trust",
      "--disable-extensions",
      // Isolated profile: the CLI refuses --extensionTestsPath while another
      // Code instance holds the singleton lock on the default profile.
      `--user-data-dir=${path.join(repo, ".vscode-test", "user-data-bench")}`,
      ...(headless ? ["--headless", "--disable-gpu", "--disable-dev-shm-usage"] : []),
    ],
    extensionTestsEnv: {
      ...process.env,
      LLMDBG_SUITE: suite,
      LLMDBG_OUT: outFile,
      LLMDBG_WORKSPACE: workspace,
    },
  });

  console.log(`[host] wrote ${outFile}`);
  if (fs.existsSync(outFile)) console.log(fs.readFileSync(outFile, "utf-8").slice(0, 4000));
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(`[host] FAILED: ${err && err.stack ? err.stack : err}`);
    process.exit(1);
  },
);

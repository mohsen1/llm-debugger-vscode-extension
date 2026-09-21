const path = require("node:path");
const Mocha = require("mocha");

const SUITES = {
  ownership: "session-ownership.test.js",
  target: "target.test.js",
  bench: "benchmark.test.js",
};

function run() {
  const name = process.env.LLMDBG_SUITE || "ownership";
  const file = SUITES[name];
  if (!file) throw new Error(`unknown suite: ${name} (have: ${Object.keys(SUITES).join(", ")})`);
  const mocha = new Mocha({ ui: "tdd", color: true, timeout: 20 * 60 * 1000 });
  mocha.addFile(path.resolve(__dirname, file));
  return new Promise((resolve, reject) => {
    mocha.run((failures) => (failures > 0 ? reject(new Error(`${failures} failed`)) : resolve()));
  });
}

module.exports = { run };

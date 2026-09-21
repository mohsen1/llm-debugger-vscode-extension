// Mocha runner for in-host suites (standard @vscode/test-electron shape).
const path = require("node:path");
const Mocha = require("mocha");

function run() {
  const mocha = new Mocha({ ui: "tdd", color: true, timeout: 400000 });
  if (process.env.LLM_E2E_SUITE === "primitives") {
    mocha.addFile(path.resolve(__dirname, "driver-primitives.test.js"));
  } else {
    mocha.addFile(path.resolve(__dirname, "launch-matrix.test.js"));
  }
  return new Promise((resolve, reject) => {
    try {
      mocha.run((failures) => {
        if (failures > 0) reject(new Error(`${failures} tests failed.`));
        else resolve();
      });
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = { run };

// The benchmark's expensive half: run every task under every strategy against
// the real debugger, inside one dev host. Scoring happens outside, afterwards,
// so a scoring change never costs another Electron boot or another API call.
//
// Inputs (env):
//   LLMDBG_MANIFEST  JSON file: [{ dir, program, symptom }]
//   LLMDBG_PLAN      JSON file: { strategies, repeats, maxSteps }
//   LLMDBG_OUT       where to write the raw run records
const assert = require("node:assert");
const fs = require("node:fs");
const vscode = require("vscode");

const OUT = process.env.LLMDBG_OUT;
const manifest = JSON.parse(fs.readFileSync(process.env.LLMDBG_MANIFEST, "utf-8"));
const plan = JSON.parse(fs.readFileSync(process.env.LLMDBG_PLAN, "utf-8"));

/**
 * Belt and braces on top of the loop's own wall-clock budget. The loop can only
 * check its deadline between steps, so anything that blocks inside one step
 * would otherwise run until Mocha kills the whole host and 25 good runs die
 * with the one bad one. A timed-out run is recorded and the suite moves on.
 */
const RUN_TIMEOUT_MS = (plan.maxWallMs || 5 * 60 * 1000) + 4 * 60 * 1000;

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`run exceeded ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

suite("benchmark", function () {
  test(`${manifest.length} task(s) x ${plan.strategies.join("+")} x ${plan.repeats}`, async function () {
    // Enough for every run to hit its own cap, plus room to write results.
    this.timeout(manifest.length * plan.strategies.length * plan.repeats * RUN_TIMEOUT_MS + 120000);
    const ext = vscode.extensions.getExtension("mohsen1.llm-debugger");
    assert.ok(ext, "extension not found in the dev host");
    const api = await ext.activate();
    assert.ok(api && api.runHunt, "activate() did not return runHunt");

    const runs = [];
    const started = Date.now();
    let index = 0;
    const total = manifest.length * plan.strategies.length * plan.repeats;

    for (let repeat = 0; repeat < plan.repeats; repeat++) {
      for (const task of manifest) {
        for (const strategy of plan.strategies) {
          index++;
          const label = `[${index}/${total}] ${task.dir} ${strategy}`;
          console.log(`${label} — ${task.symptom.slice(0, 90)}`);
          const t0 = Date.now();
          // Captured live, so a run the host has to abandon still shows how far
          // it got — the returned result never arrives for those.
          const live = [];
          let record;
          try {
            const result = await withTimeout(
              api.runHunt(
                { program: task.program, symptom: task.symptom },
                strategy,
                {
                  maxSteps: plan.maxSteps,
                  maxWallMs: plan.maxWallMs,
                  say: (line) => live.push(line),
                  progress: (line) => live.push(`… ${line}`),
                },
              ),
              RUN_TIMEOUT_MS,
            );
            record = {
              dir: task.dir,
              strategy,
              repeat,
              report: result.report,
              ledger: result.ledger,
              wallMs: result.wallMs,
              endedReason: result.endedReason,
              warnings: result.warnings,
              trail: result.trail,
              evidence: result.evidence,
            };
          } catch (err) {
            // The abandoned hunt may still hold the debug session; the next
            // launch would collide with it.
            try {
              await api.target.stop();
            } catch {
              /* nothing more to do about it here */
            }
            record = {
              dir: task.dir,
              strategy,
              repeat,
              report: null,
              ledger: null,
              wallMs: Date.now() - t0,
              endedReason: `abandoned: ${String(err).slice(0, 300)}`,
              warnings: [`last seen: ${live[live.length - 1] || "(nothing recorded)"}`],
              trail: live.slice(-40),
              evidence: [],
            };
          }
          console.log(
            `${label} → ${record.endedReason} in ${(record.wallMs / 1000).toFixed(1)}s` +
              (record.ledger
                ? `, ${record.ledger.steps} steps, ${record.ledger.llmCalls} llm, ${record.ledger.jevCalls} jev`
                : ""),
          );
          runs.push(record);
          // Written after every run: a host that dies at task 19 still leaves
          // 18 usable results behind.
          if (OUT) fs.writeFileSync(OUT, JSON.stringify({ runs, complete: false }, null, 1));
        }
      }
    }

    if (OUT) {
      fs.writeFileSync(
        OUT,
        JSON.stringify({ runs, complete: true, totalMs: Date.now() - started }, null, 1),
      );
    }
    assert.ok(runs.length > 0, "no runs recorded");
  });
});

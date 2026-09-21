// Materialize one bug hunt as a workspace you can open and demo.
//
//   node benchmark/demo.js                        list the tasks
//   node benchmark/demo.js --task=freeship-single-only
//   node benchmark/demo.js --task=coupon-order --dir=demo/workspace
//
// The folder it writes is the example with every bug fixed except the one
// named, so exactly one check fails. That is what makes a demo repeatable: in
// the raw example all 13 bugs are live at once and the hunt can wander into a
// different one mid-recording.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadGroundTruth, materializeTask, runChecks } from "./lib/example.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, "..");

function flag(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

/** Observed with the default model, jev routing. Keeps the listing honest. */
const OBSERVED = {
  "freeship-single-only": { steps: 34, seconds: 30.6, note: "every action type, four files" },
  "coupon-order": { steps: 26, seconds: 16.8, note: "26 straight steps, only 2 model calls" },
  "unawaited-prices": { steps: 20, seconds: 38.3, note: "async NaN, heavy on evaluate" },
  "holdkey-wrong-segment": { steps: 18, seconds: 36.4, note: "wrong key segment, found by evaluate" },
  "merge-overwrites-qty": { steps: 12, seconds: 12.8, note: "assignment that should have been +=" },
  "tax-on-subtotal": { steps: 6, seconds: 20.1, note: "taxed before the discount" },
  "zip-prefix-two-digits": { steps: 6, seconds: 14.3, note: "slice(0,2) against a 3-digit table" },
  "weight-block-floor": { steps: 6, seconds: 11.9, note: "floor where it should ceil" },
  "percent-floor": { steps: 5, seconds: 6.7, note: "truncated cents" },
  "idempotency-key-per-attempt": { steps: 5, seconds: 8.7, note: "key rebuilt inside the retry loop" },
  "ledger-gross-revenue": { steps: 4, seconds: 6.4, note: "deep bug, fast hunt" },
  "shipping-threshold-strict": { steps: 3, seconds: 9.4, note: "> where it should be >=" },
  "sort-no-comparator": { steps: 2, seconds: 6.2, note: "the classic; shortest run" },
};

const truth = loadGroundTruth();
const wanted = flag("task", "");

if (!wanted) {
  console.log("Demo tasks, most debugger actions first:\n");
  const rows = truth.bugs
    .map((b) => ({ id: b.id, depth: b.depth, ...(OBSERVED[b.id] ?? { steps: 0, seconds: 0, note: "" }) }))
    .sort((a, b) => b.steps - a.steps);
  for (const r of rows) {
    console.log(
      `  ${String(r.steps).padStart(2)} steps  ${String(r.seconds).padStart(5)}s  ` +
        `${r.id.padEnd(28)} ${r.depth.padEnd(7)} ${r.note}`,
    );
  }
  console.log("\nRun one:  node benchmark/demo.js --task=freeship-single-only");
  process.exit(0);
}

const bug = truth.bugs.find((b) => b.id === wanted);
if (!bug) {
  console.error(`Unknown task "${wanted}". Run without --task to see the list.`);
  process.exit(1);
}

const dir = path.resolve(repoRoot, flag("dir", path.join("demo", "workspace")));
materializeTask(dir, bug.id, truth);
const checks = runChecks(dir);
const failing = [...checks.fail];
if (failing.length === 0) {
  console.error(`${bug.id} did not reproduce in ${dir} — ground truth may be stale.`);
  process.exit(1);
}
const symptom = checks.raw
  .split("\n")
  .map((l) => l.trim())
  .find((l) => l.startsWith("FAIL:") && l.includes(failing[0]));

const observed = OBSERVED[bug.id];
console.log(`\nWorkspace ready:  ${dir}`);
console.log(`Only failing check: ${failing.join(", ")}  (${checks.pass.size} others pass)\n`);
console.log("1. Open that folder in the Extension Development Host (F5, then File > Open Folder).");
console.log("2. Paste this into the chat sidebar:\n");
console.log(`   @debugger ${symptom?.replace(/^FAIL:\s*/, "") ?? failing[0]}\n`);
if (observed) {
  console.log(
    `Expect roughly ${observed.steps} debugger actions in ~${observed.seconds}s — ${observed.note}.`,
  );
}
console.log(`The fix it should land on: ${bug.file}:${bug.line}\n`);

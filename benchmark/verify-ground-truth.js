// Proves benchmark/ground-truth.json is correct and complete, with no models
// and no debugger involved:
//
//   1. All fixes applied  -> every check passes.
//   2. Each bug isolated  -> exactly that bug's checks fail, and nothing else.
//
// (2) is the important one: it proves each entry's `checks` list is the true
// blast radius, which is what the benchmark scores against.
//
//   node benchmark/verify-ground-truth.js
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadGroundTruth, materializeTask, runChecks } from "./lib/example.js";

const truth = loadGroundTruth();
const work = fs.mkdtempSync(path.join(os.tmpdir(), "llmdbg-truth-"));
let failures = 0;

function report(ok, label, detail = "") {
  if (!ok) failures++;
  const mark = ok ? "ok  " : "FAIL";
  console.log(`${mark} ${label}${detail ? ` — ${detail}` : ""}`);
}

try {
  const allFixed = runChecks(materializeTask(path.join(work, "all-fixed"), null, truth));
  report(
    !allFixed.crashed && allFixed.fail.size === 0,
    `all ${truth.bugs.length} fixes applied → clean run`,
    allFixed.fail.size ? `still failing: ${[...allFixed.fail].join(", ")}` : `${allFixed.pass.size} checks pass`,
  );

  for (const bug of truth.bugs) {
    const dir = materializeTask(path.join(work, bug.id), bug.id, truth);
    const res = runChecks(dir);
    const expected = new Set(bug.checks);
    const unexpected = [...res.fail].filter((c) => !expected.has(c));
    const missing = bug.checks.filter((c) => !res.fail.has(c));
    const detail = [
      unexpected.length ? `also failed: ${unexpected.join(", ")}` : "",
      missing.length ? `did not fail: ${missing.join(", ")}` : "",
    ].filter(Boolean).join("; ");
    report(
      !res.crashed && unexpected.length === 0 && missing.length === 0,
      `${bug.id} isolated → exactly ${bug.checks.length} check(s) fail`,
      detail,
    );

    // The location in ground truth must point at the line the fix touches.
    const src = fs.readFileSync(path.join(dir, bug.fix.file), "utf-8").split("\n");
    const firstSearchLine = bug.fix.search.split("\n")[0];
    const at = src.findIndex((l) => l === firstSearchLine);
    report(
      at !== -1 && Math.abs(at + 1 - bug.line) <= 1,
      `${bug.id} line ${bug.line} matches the fix site`,
      at === -1 ? "fix text not found in isolated copy" : `fix text is at line ${at + 1}`,
    );
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nground truth verified" : `\n${failures} problem(s)`);
process.exit(failures === 0 ? 0 : 1);

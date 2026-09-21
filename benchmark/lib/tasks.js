// Builds the benchmark's task workspaces.
//
// One directory per task, each a full copy of the example with every bug fixed
// except the one being hunted — so exactly one assertion fails and a run can be
// scored on whether it fixed that assertion.
//
// Directories are named task-01..task-NN rather than by bug id on purpose: the
// agent sees file paths in every observation, and a folder called
// "sort-no-comparator" would hand it the answer.
import fs from "node:fs";
import path from "node:path";
import { loadGroundTruth, materializeTask, runChecks } from "./example.js";

/** Representative spread for --quick: one shallow, one medium, one deep. */
export const QUICK_TASK_IDS = ["sort-no-comparator", "coupon-order", "holdkey-wrong-segment"];

export function buildTaskWorkspaces(rootDir, { only } = {}) {
  const truth = loadGroundTruth();
  const bugs = only && only.length > 0 ? truth.bugs.filter((b) => only.includes(b.id)) : truth.bugs;
  if (bugs.length === 0) throw new Error(`no tasks matched: ${(only || []).join(", ")}`);

  fs.rmSync(rootDir, { recursive: true, force: true });
  fs.mkdirSync(rootDir, { recursive: true });

  const tasks = [];
  bugs.forEach((bug, i) => {
    const dir = `task-${String(i + 1).padStart(2, "0")}`;
    const abs = path.join(rootDir, dir);
    materializeTask(abs, bug.id, truth);
    const checks = runChecks(abs);
    const failing = bug.checks.filter((c) => checks.fail.has(c));
    if (failing.length === 0) {
      throw new Error(`${bug.id}: isolated copy has no failing check — ground truth is stale`);
    }
    // The symptom is the assertion line the program itself printed. It is the
    // only thing about the bug the agent is told.
    const symptom = symptomLine(checks.raw, failing[0]) ?? `${failing[0]} failed`;
    tasks.push({
      dir,
      bugId: bug.id,
      program: path.join(dir, truth.entry),
      symptom,
      depth: bug.depth,
      expectedFile: bug.file,
      expectedLine: bug.line,
      checks: bug.checks,
      unexpectedFailures: [...checks.fail].filter((c) => !bug.checks.includes(c)),
    });
  });

  // The agent reads files under rootDir; the manifest deliberately does not
  // live there, so nothing in the workspace maps a directory back to a bug.
  return { rootDir, tasks, truth };
}

function symptomLine(output, checkName) {
  return output
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("FAIL:") && l.includes(checkName));
}

/** What the in-host suite needs: no bug ids, no expected locations. */
export function huntManifest(tasks) {
  return tasks.map((t) => ({ dir: t.dir, program: t.program, symptom: t.symptom }));
}

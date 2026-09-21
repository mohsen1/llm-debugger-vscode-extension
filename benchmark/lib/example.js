// Materializing and grading copies of examples/order-processor.
//
// A "task" is one distinct root cause. To hunt it in isolation we copy the
// example and apply the canonical fix for every OTHER bug, so exactly one
// assertion fails. That is what makes a run scoreable: the agent's proposed
// edits either make that assertion pass without breaking a passing one, or
// they do not.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "..", "..");

export function loadGroundTruth() {
  const file = path.join(repoRoot, "benchmark", "ground-truth.json");
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

/**
 * Exact-match single-occurrence replacement.
 * Ambiguity is a bug in the fix, not something to paper over: an edit whose
 * search text appears zero or many times is rejected rather than guessed at.
 */
export function applyEdit(dir, edit) {
  const target = path.join(dir, edit.file);
  if (!fs.existsSync(target)) {
    return { ok: false, reason: `no such file: ${edit.file}` };
  }
  const before = fs.readFileSync(target, "utf-8");
  const search = normalizeEol(edit.search);
  const hits = countOccurrences(normalizeEol(before), search);
  if (hits !== 1) {
    return { ok: false, reason: `search text matched ${hits} times in ${edit.file}` };
  }
  fs.writeFileSync(target, normalizeEol(before).replace(search, normalizeEol(edit.replace)));
  return { ok: true };
}

function normalizeEol(s) {
  return String(s).replace(/\r\n/g, "\n");
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let n = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    n++;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return n;
}

/** Copy the example's own sources (no node_modules, no dotfiles) into destDir. */
export function copyExample(destDir) {
  const src = path.join(repoRoot, "examples", "order-processor");
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (name.startsWith(".") || name === "node_modules" || name === "README.md") continue;
    const from = path.join(src, name);
    if (!fs.statSync(from).isFile()) continue;
    fs.copyFileSync(from, path.join(destDir, name));
  }
  return destDir;
}

/**
 * A copy of the example with every bug fixed except `keepBrokenId`.
 * Pass null to fix all of them (used to verify the ground truth is complete).
 */
export function materializeTask(destDir, keepBrokenId, truth = loadGroundTruth()) {
  copyExample(destDir);
  const problems = [];
  for (const bug of truth.bugs) {
    if (bug.id === keepBrokenId) continue;
    const res = applyEdit(destDir, bug.fix);
    if (!res.ok) problems.push(`${bug.id}: ${res.reason}`);
  }
  if (problems.length > 0) {
    throw new Error(`ground truth does not apply cleanly:\n  ${problems.join("\n  ")}`);
  }
  return destDir;
}

/**
 * Run the example's checks and read the per-assertion verdicts out of stdout.
 * run.js prints `PASS: <name> => ...` / `FAIL: <name> => ...` per check.
 */
export function runChecks(dir, { timeoutMs = 30000 } = {}) {
  let out = "";
  try {
    out = execFileSync(process.execPath, ["run.js"], {
      cwd: dir,
      encoding: "utf-8",
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    // A non-zero exit is expected whenever checks fail — the output is what matters.
    out = `${err.stdout || ""}${err.stderr || ""}`;
    if (!out) return { pass: new Set(), fail: new Set(), crashed: true, raw: String(err).slice(0, 2000) };
  }
  const pass = new Set();
  const fail = new Set();
  for (const line of out.split("\n")) {
    const m = line.match(/^(PASS|FAIL):\s+(.+?)\s+=>/);
    if (!m) continue;
    (m[1] === "PASS" ? pass : fail).add(m[2]);
  }
  return { pass, fail, crashed: pass.size + fail.size === 0, raw: out };
}

/**
 * Score one agent report against ground truth.
 *
 * `solved` is the signal that matters and it is objective: apply the agent's
 * edits to a fresh isolated copy, re-run the checks, and require that the
 * target assertions now pass and that nothing that was passing broke.
 */
export function scoreReport({ bug, report, workDir, truth = loadGroundTruth() }) {
  const baseline = runChecks(materializeTask(workDir, bug.id, truth));
  const expectedFail = bug.checks.filter((c) => baseline.fail.has(c));
  const result = {
    taskId: bug.id,
    located: false,
    locatedFile: false,
    solved: false,
    appliedEdits: 0,
    editError: "",
    brokeChecks: [],
    stillFailing: [],
  };

  if (report && report.file) {
    const reportedFile = path.basename(String(report.file));
    result.locatedFile = reportedFile === bug.file;
    const reportedLine = Number(report.line);
    result.located =
      result.locatedFile && Number.isFinite(reportedLine) && Math.abs(reportedLine - bug.line) <= 3;
  }

  const edits = Array.isArray(report?.edits) ? report.edits : [];
  if (edits.length === 0) {
    result.editError = "no edits proposed";
    return result;
  }

  materializeTask(workDir, bug.id, truth);
  for (const edit of edits) {
    const res = applyEdit(workDir, edit);
    if (!res.ok) {
      result.editError = res.reason;
      return result;
    }
    result.appliedEdits++;
  }

  const after = runChecks(workDir);
  if (after.crashed) {
    result.editError = "patched program did not run";
    return result;
  }
  result.stillFailing = expectedFail.filter((c) => !after.pass.has(c));
  // A check that is missing from the patched run entirely — because the program
  // now throws before reaching it — is broken just as surely as one that fails.
  result.brokeChecks = [...baseline.pass].filter((c) => !after.pass.has(c));
  result.solved = result.stillFailing.length === 0 && result.brokeChecks.length === 0;
  return result;
}

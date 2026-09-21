import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error — plain ESM JS, shared with the benchmark runner.
import { loadGroundTruth, materializeTask, runChecks, scoreReport } from "../benchmark/lib/example.js";

interface Bug {
  id: string;
  file: string;
  line: number;
  checks: string[];
  fix: { file: string; search: string; replace: string };
}

const truth = loadGroundTruth() as { bugs: Bug[] };
const bug = truth.bugs.find((b) => b.id === "sort-no-comparator")!;
let workDir: string;

beforeAll(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "llmdbg-scoring-"));
});
afterAll(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

const score = (report: unknown) => scoreReport({ bug, report, workDir, truth });

describe("task isolation", () => {
  it("leaves exactly one failing check", () => {
    const dir = materializeTask(path.join(workDir, "isolated"), bug.id, truth);
    const checks = runChecks(dir);
    expect([...checks.fail]).toEqual(bug.checks);
    expect(checks.pass.size).toBeGreaterThan(15);
  });
});

describe("scoring a report", () => {
  it("counts the canonical fix as solved and located", () => {
    const result = score({ file: "pricing.js", line: bug.line, edits: [bug.fix] });
    expect(result.solved).toBe(true);
    expect(result.located).toBe(true);
  });

  it("accepts a different but equally correct fix", () => {
    const result = score({
      file: "pricing.js",
      line: bug.line,
      edits: [
        {
          file: "pricing.js",
          search: "  return totalsCents.slice().sort();",
          replace: "  return [...totalsCents].sort((a, b) => Number(a) - Number(b));",
        },
      ],
    });
    expect(result.solved).toBe(true);
  });

  it("refuses a patch that silences the check by breaking the program", () => {
    const result = score({
      file: "pricing.js",
      line: bug.line,
      edits: [
        {
          file: "pricing.js",
          search: "export function rankTotals(totalsCents) {",
          replace: "export function rankTotals(totalsCents) {\n  throw new Error('boom');",
        },
      ],
    });
    expect(result.solved).toBe(false);
  });

  it("refuses a patch that fixes this check but breaks a passing one", () => {
    const result = score({
      file: "pricing.js",
      line: bug.line,
      edits: [
        // Sorts correctly, but also corrupts the tax calculation two checks rely on.
        {
          file: "pricing.js",
          search: "  return totalsCents.slice().sort();",
          replace: "  return totalsCents.slice().sort((a, b) => a - b);",
        },
        {
          file: "pricing.js",
          search: "export const TAX_RATE = 0.08;",
          replace: "export const TAX_RATE = 0.99;",
        },
      ],
    });
    expect(result.solved).toBe(false);
    expect(result.brokeChecks.length).toBeGreaterThan(0);
  });

  it("rejects an edit whose search text is not in the file", () => {
    const result = score({
      file: "pricing.js",
      line: bug.line,
      edits: [{ file: "pricing.js", search: "this text does not exist", replace: "x" }],
    });
    expect(result.solved).toBe(false);
    expect(result.editError).toContain("matched 0 times");
  });

  it("marks the right file but the wrong line as located-file only", () => {
    const result = score({ file: "pricing.js", line: bug.line + 20, edits: [bug.fix] });
    expect(result.locatedFile).toBe(true);
    expect(result.located).toBe(false);
    // The patch still works, so a sloppy line number does not cost the solve.
    expect(result.solved).toBe(true);
  });

  it("scores a report with no edits as unsolved", () => {
    const result = score({ file: "pricing.js", line: bug.line, edits: [] });
    expect(result.solved).toBe(false);
    expect(result.editError).toBe("no edits proposed");
  });
});

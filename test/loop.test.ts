import { describe, expect, it } from "vitest";
import { firstExecutableLine, hunt } from "../src/agent/loop";
import type { Decision, HuntReport, Observation, Strategy } from "../src/agent/types";
import { FakeDebugTarget, FakeWorkspaceFiles } from "./fakeTarget";

const PROGRAM = "/ws/run.js";
const SOURCE = `import { total } from "./pricing.js";\n\nconst t = total([1, 2]);\nconsole.log(t);\n`;

function files() {
  return new FakeWorkspaceFiles({
    [PROGRAM]: SOURCE,
    "/ws/pricing.js": "export function total(xs) {\n  return xs.sort()[0];\n}\n",
  });
}

/** A strategy that plays a fixed script, then finishes. */
function scripted(script: Decision[]): (m: unknown) => Strategy {
  let i = 0;
  return () => ({
    name: "llm" as const,
    async decide(): Promise<Decision> {
      return script[i++] ?? { action: "finish", source: "llm", why: "script exhausted" };
    },
  });
}

const noPlan = async () => ({ hypothesis: "sort is suspicious", breakpoints: [] as never[] });
const noReport = async (): Promise<HuntReport | null> => null;

function run(args: {
  target: FakeDebugTarget;
  script: Decision[];
  maxSteps?: number;
  plan?: typeof noPlan;
  reporter?: typeof noReport;
}) {
  return hunt({
    target: args.target,
    task: { program: PROGRAM, symptom: "total() returns the wrong number" },
    strategy: scripted(args.script),
    files: files(),
    planner: (args.plan ?? noPlan) as never,
    reporter: (args.reporter ?? noReport) as never,
    options: { maxSteps: args.maxSteps ?? 10 },
  });
}

describe("hunt loop policy", () => {
  it("breaks on the entry file when the plan gives no usable location", async () => {
    const target = new FakeDebugTarget([{ file: "/ws/run.js", line: 3 }]);
    const result = await run({ target, script: [{ action: "finish", source: "llm" }] });
    // `import` on line 1 never binds, so the entry breakpoint must skip past it.
    expect(target.calls[0]).toBe("setBreakpoint /ws/run.js:3");
    expect(result.warnings.join(" ")).toContain("no usable opening breakpoint");
  });

  it("refuses to continue when nothing is bound to stop at", async () => {
    const target = new FakeDebugTarget([
      { file: "/ws/run.js", line: 3 },
      { file: "/ws/pricing.js", line: 2 },
    ]);
    // Nothing bound means `continue` would run the program to exit blind.
    target.reportNoBreakpoints = true;
    const result = await run({ target, script: [{ action: "continue", source: "llm" }], maxSteps: 2 });
    const stepped = target.calls.filter((c) => c.startsWith("step "));
    expect(stepped[0]).toBe("step next");
    expect(result.trail.join("\n")).toContain("continue with no breakpoints");
  });

  it("forces a step when the strategy repeats itself at the same line", async () => {
    // The fake advances on every step, so pin it at one location by only ever
    // offering evaluate — which does not move execution.
    const target = new FakeDebugTarget([{ file: "/ws/pricing.js", line: 2 }]);
    const evaluateForever: Decision[] = Array.from({ length: 6 }, () => ({
      action: "evaluate" as const,
      expression: "xs",
      source: "llm" as const,
    }));
    const result = await run({ target, script: evaluateForever, maxSteps: 6 });
    expect(target.calls).toContain("step next");
    expect(result.trail.join("\n")).toMatch(/stalled on evaluate@pricing\.js:2/);
  });

  it("rejects a breakpoint at a line that does not exist", async () => {
    const target = new FakeDebugTarget([{ file: "/ws/pricing.js", line: 2 }]);
    const result = await run({
      target,
      script: [{ action: "setBreakpoint", file: "pricing.js", line: 900, source: "llm" }],
    });
    expect(result.trail.join("\n")).toContain("is not a real location");
    expect(target.calls.some((c) => c.includes(":900"))).toBe(false);
  });

  it("keeps evaluate results as evidence", async () => {
    const target = new FakeDebugTarget([{ file: "/ws/pricing.js", line: 2, locals: { xs: "[1,2]" } }]);
    target.values = { "xs.sort()" : "[1,2]" };
    const result = await run({
      target,
      script: [{ action: "evaluate", expression: "xs.sort()", source: "llm" }],
    });
    expect(result.evidence.join("\n")).toContain("xs.sort() = [1,2]");
  });

  it("still writes a verdict when the program exits early", async () => {
    const target = new FakeDebugTarget([{ file: "/ws/run.js", line: 3 }]);
    const report: HuntReport = {
      rootCause: "sort without a comparator",
      file: "pricing.js",
      line: 2,
      edits: [{ file: "pricing.js", search: "xs.sort()", replace: "xs.sort((a,b)=>a-b)" }],
      evidence: [],
    };
    const result = await run({
      target,
      script: [{ action: "next", source: "llm" }, { action: "next", source: "llm" }],
      reporter: (async () => report) as never,
    });
    expect(result.endedReason).toBe("program exited");
    expect(result.report?.file).toBe("pricing.js");
  });

  /** A strategy that throws `failures` times, then plays the script. */
  function flaky(failures: number, script: Decision[]) {
    let thrown = 0;
    let i = 0;
    return () => ({
      name: "llm" as const,
      async decide(_o: Observation): Promise<Decision> {
        if (thrown < failures) {
          thrown++;
          throw new Error("gateway down");
        }
        return script[i++] ?? { action: "finish", source: "llm" };
      },
    });
  }

  it("treats a single provider blip as one lost step, not a lost hunt", async () => {
    const locals = { xs: "[1,2]" };
    const target = new FakeDebugTarget([
      { file: "/ws/pricing.js", line: 2, locals },
      { file: "/ws/pricing.js", line: 2, locals },
      { file: "/ws/pricing.js", line: 2, locals },
    ]);
    const result = await hunt({
      target,
      task: { program: PROGRAM, symptom: "x" },
      strategy: flaky(1, [{ action: "finish", source: "llm" }]),
      files: files(),
      planner: noPlan as never,
      reporter: noReport as never,
      options: { maxSteps: 5 },
    });
    expect(result.endedReason).toBe("agent finished");
    expect(result.warnings.join(" ")).toContain("gateway down");
  });

  it("gives up, and still stops the session, when the provider stays down", async () => {
    const target = new FakeDebugTarget(
      Array.from({ length: 8 }, () => ({ file: "/ws/pricing.js", line: 2 })),
    );
    const result = await hunt({
      target,
      task: { program: PROGRAM, symptom: "x" },
      strategy: flaky(99, []),
      files: files(),
      planner: noPlan as never,
      reporter: noReport as never,
      options: { maxSteps: 8 },
    });
    expect(target.calls).toContain("stop");
    expect(result.endedReason).toContain("gateway down");
    expect(result.ledger.steps).toBeLessThan(4);
  });

  it("counts a step per debugger action, not per model call", async () => {
    const locals = { xs: "[1,2]" };
    const target = new FakeDebugTarget([
      { file: "/ws/run.js", line: 3, locals },
      { file: "/ws/pricing.js", line: 2, locals },
      { file: "/ws/pricing.js", line: 2, locals },
    ]);
    const result = await run({
      target,
      script: [
        { action: "next", source: "llm" },
        { action: "next", source: "llm" },
        { action: "finish", source: "llm" },
      ],
    });
    expect(result.ledger.steps).toBe(2);
  });

  it("will not accept a verdict before any runtime value has been read", async () => {
    // Frames with no locals: finishing here would mean guessing from the
    // failing assertion rather than debugging.
    const target = new FakeDebugTarget([
      { file: "/ws/pricing.js", line: 2 },
      { file: "/ws/pricing.js", line: 2 },
      { file: "/ws/pricing.js", line: 2, locals: { xs: "[1,2]" } },
      { file: "/ws/pricing.js", line: 2, locals: { xs: "[1,2]" } },
    ]);
    const result = await run({
      target,
      script: Array.from({ length: 5 }, () => ({ action: "finish" as const, source: "llm" as const })),
      maxSteps: 6,
    });
    expect(result.trail.join("\n")).toContain("no runtime values observed yet");
    expect(target.calls).toContain("step in");
    expect(result.endedReason).toBe("agent finished");
  });
});

describe("firstExecutableLine", () => {
  it("skips imports, exports, comments and blank lines", () => {
    expect(firstExecutableLine(SOURCE)).toBe(3);
    expect(firstExecutableLine("// note\n\nexport const a = 1;\nrun();\n")).toBe(4);
    expect(firstExecutableLine("")).toBe(1);
  });
});

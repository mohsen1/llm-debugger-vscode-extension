import type { DebugTarget, PausedState } from "../debug/DebugTarget";
import { Meter } from "./meter";
import { buildObservation } from "./observation";
import { makeOpeningPlan, type OpeningPlan } from "./plan";
import { writeReport } from "./report";
import type { Decision, HuntResult, HuntTask, Strategy } from "./types";
import type { WorkspaceFiles } from "./workspace";

export interface HuntOptions {
  /** Hard cap on debugger actions. The deep tasks need room; nothing needs 500. */
  maxSteps?: number;
  /**
   * Wall-clock budget for the hunt, excluding the closing write-up. Steps alone
   * do not bound a run: a step that waits on a pause that never comes, or a
   * retried rate limit, can each take tens of seconds. Running out of time is a
   * reportable outcome, not a hang.
   */
  maxWallMs?: number;
  /** Short line for the visible transcript, one per step. */
  say?: (line: string) => void;
  /** Long-running phase marker, so a chat UI never goes silent. */
  progress?: (line: string) => void;
  isCancelled?: () => boolean;
}

const DEFAULT_MAX_STEPS = 120;
const DEFAULT_MAX_WALL_MS = 6 * 60 * 1000;
/** Same action at the same line this many times running means the hunt is stuck. */
const STALL_LIMIT = 3;
const MAX_EVIDENCE = 60;
/** A verdict has to rest on values read from the running program, not on the
 * failing assertion alone — otherwise the loop is a code reviewer with a
 * debugger attached. */
const MIN_VALUES_BEFORE_FINISH = 2;
/** Consecutive provider failures tolerated before a hunt is abandoned. */
const MAX_DECISION_FAILURES = 3;
/** The closing write-up's own budget, spent after the loop's. */
const REPORT_BUDGET_MS = 90000;
/** Tearing down a wedged adapter should not hold the next task hostage. */
const STOP_BUDGET_MS = 20000;

/** Rejects if `work` has not settled in time, so no await is open-ended. */
function withDeadline<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} exceeded ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/**
 * One bug hunt, start to finish.
 *
 * Nothing about the target program is hardcoded: the only thing the agent is
 * told is the failing assertion. Where to break, what to step into, what to
 * read and when to stop all come from the strategy. The loop owns policy that
 * neither model should be trusted with — the step budget, breakpoint
 * validation, stall detection and the cost ledger.
 */
export async function hunt(args: {
  target: DebugTarget;
  task: HuntTask;
  strategy: (meter: Meter) => Strategy;
  files: WorkspaceFiles;
  options?: HuntOptions;
  /** Overridable so the loop's policy can be tested without the network. */
  planner?: typeof makeOpeningPlan;
  reporter?: typeof writeReport;
}): Promise<HuntResult> {
  const { target, task, files } = args;
  const planner = args.planner ?? makeOpeningPlan;
  const reporter = args.reporter ?? writeReport;
  const options = args.options ?? {};
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const deadline = Date.now() + (options.maxWallMs ?? DEFAULT_MAX_WALL_MS);
  const meter = new Meter();
  const strategy = args.strategy(meter);

  const t0 = Date.now();
  const trail: string[] = [];
  const evidence: string[] = [];
  const warnings: string[] = [];
  const visited = new Map<string, string>();
  let endedReason = "finished";
  let hypothesis = "";
  /** Paused frames with real locals, plus successful evaluates. */
  let valuesSeen = 0;

  const say = (line: string) => {
    trail.push(line);
    try {
      options.say?.(line);
    } catch {
      /* a UI that throws must not end a hunt */
    }
  };
  const progress = (line: string) => {
    try {
      options.progress?.(line);
    } catch {
      /* as above */
    }
  };

  const programAbs = files.resolve(task.program, task.program);
  if (!programAbs) {
    return done(`program not found: ${task.program}`);
  }

  try {
    // ---- opening plan: the one look at code before the program runs --------
    progress("reading the failing check…");
    const plan: OpeningPlan = await planner({
      symptom: task.symptom,
      entryFile: files.shortPath(programAbs),
      entrySource: files.readFile(programAbs) ?? "",
      moduleNames: files.listModules(programAbs),
      meter,
    });
    hypothesis = plan.hypothesis;
    if (hypothesis) say(`Hypothesis: ${hypothesis}`);

    let placed = 0;
    for (const bp of plan.breakpoints) {
      const target_ = validateLocation(bp.file, bp.line, programAbs, files);
      if (!target_) {
        warnings.push(`opening breakpoint ${bp.file}:${bp.line} does not exist`);
        continue;
      }
      await target.setBreakpoint(target_.abs, target_.line);
      placed++;
      say(`Breakpoint at ${files.shortPath(target_.abs)}:${target_.line} — ${bp.why}`);
    }
    if (placed === 0) {
      // Without a breakpoint the program runs straight to exit and there is
      // nothing to observe; break on the entry file so the hunt can start.
      await target.setBreakpoint(programAbs, firstExecutableLine(files.readFile(programAbs) ?? ""));
      warnings.push("no usable opening breakpoint; broke on the entry file instead");
      say(`Breakpoint at ${files.shortPath(programAbs)} (entry) — no usable plan location`);
    }

    // ---- run --------------------------------------------------------------
    progress("launching the debugger…");
    await target.launch(programAbs);
    if (target.status() !== "paused") {
      endedReason = "program never paused";
      say(`Program ran to exit without hitting a breakpoint (${target.status()}).`);
    }

    let recentKey = "";
    let recentCount = 0;
    let decisionFailures = 0;

    for (let step = 0; step < maxSteps; step++) {
      if (options.isCancelled?.()) {
        endedReason = "cancelled";
        say("Stopped by user.");
        break;
      }
      if (Date.now() > deadline) {
        endedReason = "time budget exhausted";
        say(`Out of time after ${step} steps — writing up what was found.`);
        break;
      }
      if (target.status() === "ended") {
        endedReason = endedReason === "finished" ? "program exited" : endedReason;
        break;
      }
      const paused = await target.paused();
      if (!paused) {
        if (target.status() === "ended") {
          endedReason = "program exited";
          break;
        }
        const resumed = await target.waitForStop(8000);
        if (!resumed) {
          endedReason = target.status() === "ended" ? "program exited" : "never paused again";
          break;
        }
        continue;
      }

      rememberVisit(paused, files, visited);
      const here = describe(paused, files);
      const locals = topLocals(paused);
      if (paused.scopes.some((scope) => scope.vars.length > 0)) valuesSeen++;
      recordEvidence(evidence, `${here} · ${locals}`);

      progress(`step ${step} — deciding at ${here}`);
      const observation = buildObservation({
        step,
        stepsLeft: maxSteps - step,
        symptom: task.symptom,
        hypothesis,
        paused,
        ...target.output(),
        breakpoints: target.ownedBreakpoints().map((b) => `${files.shortPath(b.file)}:${b.line}`),
        history: trail,
        evidence,
        shortPath: (p) => files.shortPath(p),
      });

      let decision: Decision;
      try {
        decision = await strategy.decide(observation);
        decisionFailures = 0;
      } catch (err) {
        // A rate limit or a 503 costs one step, not the task. Only a run of
        // them means the provider is genuinely gone.
        decisionFailures++;
        warnings.push(`decision ${step}: ${String(err).slice(0, 200)}`);
        if (decisionFailures >= MAX_DECISION_FAILURES) {
          endedReason = `decision failed ${decisionFailures}x: ${String(err).slice(0, 200)}`;
          say(`Giving up after ${decisionFailures} failed decisions: ${String(err).slice(0, 160)}`);
          break;
        }
        decision = {
          action: "next",
          source: "policy",
          why: `decision failed (${decisionFailures}/${MAX_DECISION_FAILURES}), stepping on`,
        };
      }

      // ---- policy the models do not get a vote on -------------------------
      // Overrides settle first, then stall detection runs on what will actually
      // be executed — otherwise the detector trips on a decision that policy
      // was going to replace anyway, and forces a step for no reason.
      if (decision.action === "continue" && target.ownedBreakpoints().length === 0) {
        decision = { action: "next", source: "policy", why: "continue with no breakpoints would run to exit" };
      }
      if (decision.action === "finish" && valuesSeen < MIN_VALUES_BEFORE_FINISH) {
        // Finishing before any runtime value has been read is not debugging,
        // it is guessing from the failing assertion. Both arms are held to
        // this, so it costs neither of them an advantage. Stepping in is the
        // move most likely to reach a frame with locals; adapters fall back to
        // a step over when there is nothing to step into.
        decision = {
          action: "stepIn",
          source: "policy",
          why: `no runtime values observed yet (${valuesSeen}/${MIN_VALUES_BEFORE_FINISH})`,
        };
      }

      const key = `${decision.action}@${here}`;
      recentCount = key === recentKey ? recentCount + 1 : 0;
      recentKey = key;
      if (recentCount >= STALL_LIMIT && decision.action !== "finish") {
        decision = { action: "next", source: "policy", why: `stalled on ${key}` };
        recentCount = 0;
      }

      if (decision.action === "finish") {
        endedReason = "agent finished";
        say(`step${step}: enough evidence — ${decision.why ?? ""}`.trim());
        break;
      }

      meter.countStep();
      let outcome: string;
      try {
        outcome = await execute(decision, {
          target,
          files,
          programAbs,
          evidence,
          warnings,
          onValueSeen: () => {
            valuesSeen++;
          },
        });
      } catch (err) {
        // A rejected step — the session raced to exit, a breakpoint refused to
        // bind — costs this step, not the hunt. The loop re-reads state at the
        // top and carries on or ends on its own terms.
        outcome = `action failed: ${String(err).slice(0, 160)}`;
        warnings.push(`step ${step}: ${String(err).slice(0, 200)}`);
      }
      say(`step${step}: ${label(decision)} → ${outcome}`);
    }

    if (meter.ledger.steps >= maxSteps) endedReason = "step budget exhausted";
  } catch (err) {
    endedReason = `run failed: ${String(err).slice(0, 300)}`;
    warnings.push(String(err).slice(0, 400));
  } finally {
    try {
      await withDeadline(target.stop(), STOP_BUDGET_MS, "stopping the session");
    } catch (err) {
      warnings.push(`teardown: ${String(err).slice(0, 200)}`);
    }
  }

  // ---- verdict ------------------------------------------------------------
  // Always written, even after an early exit: a hunt that saw three frames
  // still has to say what it concluded, and a wrong answer is a real result.
  progress("writing up the root cause…");
  let report = null;
  if (!options.isCancelled?.()) {
    try {
      // The write-up runs after the loop's wall-clock budget is already spent,
      // so it needs a budget of its own — otherwise a retried, slow generation
      // call can double a run's duration with nothing to show for it.
      report = await withDeadline(
        reporter({
          symptom: task.symptom,
          hypothesis,
          trail,
          evidence,
          visitedSources: [...visited.entries()].map(([name, source]) => ({ name, source })),
          meter,
        }),
        REPORT_BUDGET_MS,
        "writing the verdict",
      );
    } catch (err) {
      warnings.push(`report failed: ${String(err).slice(0, 300)}`);
    }
  }

  return done(endedReason, report);

  function done(reason: string, reportOut: HuntResult["report"] = null): HuntResult {
    return {
      strategy: strategy.name,
      task,
      report: reportOut,
      ledger: meter.ledger,
      trail,
      evidence,
      wallMs: Date.now() - t0,
      endedReason: reason,
      warnings,
    };
  }
}

async function execute(
  decision: Decision,
  ctx: {
    target: DebugTarget;
    files: WorkspaceFiles;
    programAbs: string;
    evidence: string[];
    warnings: string[];
    onValueSeen: () => void;
  },
): Promise<string> {
  const { target, files, programAbs } = ctx;
  switch (decision.action) {
    case "next":
    case "stepIn":
    case "stepOut":
    case "continue": {
      const kind = decision.action === "stepIn" ? "in" : decision.action === "stepOut" ? "out" : decision.action === "next" ? "next" : "continue";
      const status = await target.step(kind);
      if (status !== "paused") return `session ${status}`;
      const paused = await target.paused();
      return paused ? describe(paused, files) : status;
    }
    case "setBreakpoint": {
      const where = validateLocation(decision.file ?? "", decision.line ?? 0, programAbs, files);
      if (!where) return `rejected: ${decision.file}:${decision.line} is not a real location`;
      const set = await target.setBreakpoint(where.abs, where.line);
      // Setting a dot without running to it burns a step for nothing, so the
      // two go together — and a program that exits on the way is a real answer.
      const status = await target.step("continue");
      const label = `${files.shortPath(where.abs)}:${set.line}`;
      if (status !== "paused") return `breakpoint ${label}, then session ${status}`;
      const paused = await target.paused();
      return paused ? `breakpoint ${label} → ${describe(paused, files)}` : `breakpoint ${label}`;
    }
    case "evaluate": {
      const res = await target.evaluate(decision.expression ?? "");
      const line = `${decision.expression} = ${res.value}`;
      if (res.ok) {
        recordEvidence(ctx.evidence, line);
        ctx.onValueSeen();
      }
      return res.ok ? line.slice(0, 300) : `evaluate failed: ${res.value.slice(0, 160)}`;
    }
    default:
      return "no-op";
  }
}

function validateLocation(
  file: string,
  line: number,
  programAbs: string,
  files: WorkspaceFiles,
): { abs: string; line: number } | null {
  if (!file || !Number.isFinite(line) || line < 1) return null;
  const abs = files.resolve(file, programAbs);
  if (!abs) return null;
  const total = files.lineCount(abs);
  if (total === 0 || line > total) return null;
  return { abs, line };
}

function describe(paused: PausedState, files: WorkspaceFiles): string {
  const top = paused.frames[0];
  if (!top) return `paused (${paused.reason})`;
  return `${files.shortPath(top.source)}:${top.line}`;
}

function topLocals(paused: PausedState): string {
  const vars = paused.scopes.flatMap((s) => s.vars);
  if (vars.length === 0) return "no locals";
  return vars
    .slice(0, 4)
    .map((v) => `${v.name}=${v.value.slice(0, 40)}`)
    .join(" ");
}

function recordEvidence(evidence: string[], line: string): void {
  if (evidence[evidence.length - 1] === line) return;
  evidence.push(line);
  if (evidence.length > MAX_EVIDENCE) evidence.shift();
}

/** Keep the source of every file the hunt paused in, for the closing patch. */
function rememberVisit(
  paused: PausedState,
  files: WorkspaceFiles,
  visited: Map<string, string>,
): void {
  const top = paused.frames[0];
  if (!top?.source) return;
  const name = files.shortPath(top.source);
  if (visited.has(name)) return;
  const source = files.readFile(top.source);
  if (source) visited.set(name, source);
}

function label(decision: Decision): string {
  const base =
    decision.action === "setBreakpoint"
      ? `setBreakpoint ${decision.file}:${decision.line}`
      : decision.action === "evaluate"
        ? `evaluate ${decision.expression}`
        : decision.action;
  // When the loop overrules a model, the transcript has to say why — otherwise
  // an overridden step reads as if the model chose it.
  const reason = decision.source === "policy" && decision.why ? ` (${decision.why})` : "";
  return `${base} [${decision.source}]${reason}`;
}

/** First line that actually executes — an ESM `import` line never binds. */
export function firstExecutableLine(source: string): number {
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].trim();
    if (!s || s.startsWith("//") || s.startsWith("/*") || s.startsWith("*")) continue;
    if (s.startsWith("import ") || s.startsWith("import{") || s.startsWith("export ")) continue;
    if (s === "{" || s === "}") continue;
    return i + 1;
  }
  return 1;
}

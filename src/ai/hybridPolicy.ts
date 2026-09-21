import type { StructuredCode } from "../types";
import { serializeStructuredCode } from "./prompts";
import { booleanProbability, choiceAnswer, evaluateWithJev, type JevQuestion } from "./jev";

/**
 * Jev routing for the legacy sidebar loop in `debug/DebugLoopController.ts`.
 *
 * The in-extension hunt (`agent/`) has its own strategy that works from a
 * paused-frame observation; this adapter exists because the sidebar loop feeds
 * a different shape — whole-workspace source plus a paused-state blob — and is
 * only reachable when the user explicitly arms it.
 */

export type JevAction = "setBreakpoint" | "next" | "stepIn" | "stepOut" | "continue" | "finishWithFix";

const ACTIONS: JevAction[] = ["setBreakpoint", "next", "stepIn", "stepOut", "continue", "finishWithFix"];

export interface HybridStep {
  jev: {
    nextAction: JevAction;
    nextActionConfidence: number;
    readyForFix: boolean;
    readyForFixProb: number;
    latencyMs: number;
    inputTokens: number;
  };
  /** True when the generation model is needed — fix synthesis or a breakpoint location. */
  shouldEscalateToLlm: boolean;
  /** One line for the sidebar transcript. */
  reason: string;
}

function questions(): Record<string, JevQuestion> {
  return {
    nextAction: {
      type: "choice",
      question: "What single debugger action should run next?",
      choices: ACTIONS,
      criteria: {
        setBreakpoint: "Set a new breakpoint to investigate a suspicious file/line",
        next: "Step over the current line to observe the next state",
        stepIn: "Step into the current call to see inside",
        stepOut: "Step out of this function back to the caller",
        continue: "Continue to the next breakpoint (only if breakpoints exist)",
        finishWithFix: "Enough evidence gathered; stop stepping and write the fix",
      },
    },
    readyForFix: {
      type: "boolean",
      question: "Is there enough evidence to write a correct fix without stepping further?",
      criteria: {
        true: "Root cause identified with file and line, and the fix is clear",
        false: "More runtime data is needed first",
      },
    },
  };
}

export async function decideHybridStep(args: {
  structuredCode: StructuredCode[];
  pausedState: unknown;
  stderr?: string;
  stdout?: string;
  phase: "paused" | "exception" | "initial";
  hasActiveBreakpoints: boolean;
}): Promise<HybridStep> {
  const stateParts = [
    `Phase: ${args.phase}`,
    `HasActiveBreakpoints: ${args.hasActiveBreakpoints}`,
    "# Code:",
    serializeStructuredCode(args.structuredCode).slice(0, 6000),
    "",
    "# PausedState:",
    summarize(args.pausedState),
  ];
  if (args.stderr) stateParts.push("", "# stderr:", String(args.stderr).slice(0, 2000));
  if (args.stdout) stateParts.push("", "# stdout:", String(args.stdout).slice(0, 2000));

  const res = await evaluateWithJev(stateParts.join("\n"), questions());
  const readyForFixProb = booleanProbability(res.answers, "readyForFix") ?? 0;
  const chosen = choiceAnswer(res.answers, "nextAction");
  const confidence = chosen?.confidence ?? 0;
  const raw = chosen?.choice ?? "next";
  let action: JevAction = (ACTIONS as string[]).includes(raw) ? (raw as JevAction) : "next";

  // Policy stays in code: continuing with no breakpoints runs to exit blind.
  if (action === "continue" && !args.hasActiveBreakpoints) {
    action = readyForFixProb >= 0.6 ? "finishWithFix" : "setBreakpoint";
  }
  const shouldEscalateToLlm =
    args.phase === "exception" || action === "finishWithFix" || action === "setBreakpoint";

  return {
    jev: {
      nextAction: action,
      nextActionConfidence: confidence,
      readyForFix: readyForFixProb >= 0.6,
      readyForFixProb,
      latencyMs: res.latencyMs,
      inputTokens: res.inputTokens,
    },
    shouldEscalateToLlm,
    reason:
      `fast check: ${action} (conf ${confidence.toFixed(2)}, ready p=${readyForFixProb.toFixed(2)}, ` +
      `${res.latencyMs}ms, ${res.inputTokens} tok)` +
      (shouldEscalateToLlm ? " → asking the model" : " → stepping without a model call"),
  };
}

function summarize(pausedState: unknown): string {
  try {
    const s = JSON.stringify(pausedState);
    return s.length > 4000 ? `${s.slice(0, 4000)}...(truncated)` : s;
  } catch {
    return String(pausedState).slice(0, 4000);
  }
}

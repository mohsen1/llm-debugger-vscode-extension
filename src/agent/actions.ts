import type { ChatCompletionTool } from "../types";
import type { ActionKind, Decision } from "./types";

/**
 * The action vocabulary. Both strategies choose from exactly this set, so the
 * benchmark compares decision-makers rather than capabilities.
 */
export const ACTIONS: Record<ActionKind, string> = {
  next: "Step over the current line and look at the state after it runs.",
  stepIn: "Step into the call on the current line to see what happens inside.",
  stepOut: "Step out of this function back to its caller.",
  continue: "Run until the next breakpoint (or until the program exits).",
  setBreakpoint: "Set a breakpoint at a specific file and line, then run to it.",
  evaluate: "Evaluate an expression in the paused frame to read a runtime value.",
  finish: "Stop stepping — there is enough runtime evidence to write the fix.",
};

const WHY = {
  type: "string",
  description: "One short sentence: what this tells you about the failing check.",
} as const;

export const ACTION_TOOLS: ChatCompletionTool[] = [
  simple("next"),
  simple("stepIn"),
  simple("stepOut"),
  simple("continue"),
  {
    type: "function",
    function: {
      name: "setBreakpoint",
      description: ACTIONS.setBreakpoint,
      parameters: {
        type: "object",
        properties: {
          file: { type: "string", description: "File name or path, e.g. pricing.js" },
          line: { type: "number", description: "1-based line number" },
          why: WHY,
        },
        required: ["file", "line", "why"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "evaluate",
      description: ACTIONS.evaluate,
      parameters: {
        type: "object",
        properties: {
          expression: {
            type: "string",
            description: "A JavaScript expression valid in the paused frame, e.g. totalsCents.map(Number)",
          },
          why: WHY,
        },
        required: ["expression", "why"],
      },
    },
  },
  simple("finish"),
];

function simple(name: ActionKind): ChatCompletionTool {
  return {
    type: "function",
    function: {
      name,
      description: ACTIONS[name],
      parameters: {
        type: "object",
        properties: { why: WHY },
        required: ["why"],
      },
    },
  };
}

export function isActionKind(name: string): name is ActionKind {
  return Object.prototype.hasOwnProperty.call(ACTIONS, name);
}

export function decisionFromToolCall(
  call: { name: string; args: Record<string, unknown> },
  source: Decision["source"],
): Decision | null {
  if (!isActionKind(call.name)) return null;
  const why = typeof call.args.why === "string" ? call.args.why : undefined;
  const decision: Decision = { action: call.name, source, ...(why ? { why } : {}) };
  if (call.name === "setBreakpoint") {
    const line = Number(call.args.line);
    if (typeof call.args.file !== "string" || !Number.isFinite(line)) return null;
    decision.file = call.args.file;
    decision.line = Math.max(1, Math.trunc(line));
  }
  if (call.name === "evaluate") {
    if (typeof call.args.expression !== "string" || !call.args.expression.trim()) return null;
    decision.expression = call.args.expression.trim();
  }
  return decision;
}

import type { ChatCompletionTool } from "../../types";
import { booleanProbability, choiceAnswer, evaluateWithJev, type JevQuestion } from "../../ai/jev";
import { ACTIONS } from "../actions";
import { callWithTools } from "../llmClient";
import type { Meter } from "../meter";
import { renderObservation } from "../observation";
import type { ActionKind, Decision, Observation, Strategy } from "../types";
import { DEBUGGER_SYSTEM_PROMPT } from "./llm";

const CHOICES: ActionKind[] = [
  "next",
  "stepIn",
  "stepOut",
  "continue",
  "setBreakpoint",
  "evaluate",
  "finish",
];

/** Above this, Jev's own read of the evidence ends the hunt without asking the LLM. */
const READY_FOR_FIX_THRESHOLD = 0.7;
/** How sure Jev must be about picking `finish` when readiness alone is not enough. */
const FINISH_CONFIDENCE_THRESHOLD = 0.75;

function questions(): Record<string, JevQuestion> {
  return {
    nextAction: {
      type: "choice",
      question: "Which single debugger action best advances the hunt for the failing check's cause?",
      choices: CHOICES,
      criteria: { ...ACTIONS },
    },
    readyForFix: {
      type: "boolean",
      question:
        "Do the runtime values already observed identify the exact line that produces the wrong value?",
      criteria: {
        true: "The wrong value and the line that computes it have both been seen at runtime",
        false: "The wrong value has not been traced to the line that computes it yet",
      },
    },
    atFault: {
      type: "boolean",
      question: "Is the line the debugger is paused on the line that computes the wrong value?",
      criteria: {
        true: "This line's own computation is wrong",
        false: "This line is fine; the wrong value came from somewhere else",
      },
    },
  };
}

/**
 * The hybrid arm: Jev is the traffic cop, the LLM is the specialist.
 *
 * Every step's routing decision is a single typed Jev evaluation — cheap,
 * parallel, output tokens free. The generation model is only woken up when the
 * chosen action needs something a classifier cannot produce: a breakpoint
 * location or an expression to evaluate. Those escalations are counted in the
 * ledger like any other LLM call, so the comparison stays honest.
 */
export class JevStrategy implements Strategy {
  readonly name = "jev" as const;

  constructor(private readonly meter: Meter) {}

  async decide(observation: Observation): Promise<Decision> {
    const state = renderObservation(observation);
    const res = await evaluateWithJev(state, questions());
    this.meter.recordJev(res.model, res.latencyMs, res.inputTokens, res.outputTokens);

    const readyProb = booleanProbability(res.answers, "readyForFix") ?? 0;
    const atFaultProb = booleanProbability(res.answers, "atFault") ?? 0;
    const action = choiceAnswer(res.answers, "nextAction");
    const raw = action?.choice ?? "next";
    const confidence = action?.confidence ?? 0;
    const chosen: ActionKind = (CHOICES as string[]).includes(raw) ? (raw as ActionKind) : "next";

    // `finish` as a raw choice is honoured only when the readiness question
    // agrees, or when the classifier is at least confident about it. Without
    // this, a 0.59-confidence pick ends the hunt at readiness 0.26.
    const wantsFinish =
      readyProb >= READY_FOR_FIX_THRESHOLD ||
      (chosen === "finish" && confidence >= FINISH_CONFIDENCE_THRESHOLD);
    if (wantsFinish) {
      return {
        action: "finish",
        source: "jev",
        confidence: Math.max(readyProb, confidence),
        why: `evidence looks sufficient (ready p=${readyProb.toFixed(2)}, conf ${confidence.toFixed(2)})`,
      };
    }

    // Parameterless actions execute straight off the classifier — the whole
    // point of the hybrid: no generation call for routine stepping.
    if (chosen !== "setBreakpoint" && chosen !== "evaluate") {
      return {
        action: chosen,
        source: "jev",
        confidence,
        why: `routed by fast check (conf ${confidence.toFixed(2)}, at-fault p=${atFaultProb.toFixed(2)})`,
      };
    }

    return chosen === "setBreakpoint"
      ? this.askForBreakpoint(observation, confidence)
      : this.askForExpression(observation, confidence);
  }

  /** Jev asked for a breakpoint; only a generative model can say where. */
  private async askForBreakpoint(observation: Observation, confidence: number): Promise<Decision> {
    const call = await callWithTools({
      system: DEBUGGER_SYSTEM_PROMPT,
      user: `${renderObservation(observation)}\n\n# Your task\nA new breakpoint is the right move. Name the file and 1-based line to break on.`,
      tools: [BREAKPOINT_TOOL],
      meter: this.meter,
      maxTokens: 200,
    });
    const file = call?.args.file;
    const line = Number(call?.args.line);
    if (typeof file !== "string" || !Number.isFinite(line)) {
      return { action: "next", source: "policy", why: "no usable breakpoint location came back" };
    }
    return {
      action: "setBreakpoint",
      file,
      line: Math.max(1, Math.trunc(line)),
      source: "llm",
      confidence,
      why: typeof call?.args.why === "string" ? call.args.why : "fast check asked for a breakpoint",
    };
  }

  /** Jev asked to read a value; only a generative model can write the expression. */
  private async askForExpression(observation: Observation, confidence: number): Promise<Decision> {
    const call = await callWithTools({
      system: DEBUGGER_SYSTEM_PROMPT,
      user: `${renderObservation(observation)}\n\n# Your task\nReading a runtime value is the right move. Give one JavaScript expression to evaluate in this frame.`,
      tools: [EVALUATE_TOOL],
      meter: this.meter,
      maxTokens: 200,
    });
    const expression = call?.args.expression;
    if (typeof expression !== "string" || !expression.trim()) {
      return { action: "next", source: "policy", why: "no usable expression came back" };
    }
    return {
      action: "evaluate",
      expression: expression.trim(),
      source: "llm",
      confidence,
      why: typeof call?.args.why === "string" ? call.args.why : "fast check asked for a value",
    };
  }
}

const BREAKPOINT_TOOL: ChatCompletionTool = {
  type: "function",
  function: {
    name: "setBreakpoint",
    description: ACTIONS.setBreakpoint,
    parameters: {
      type: "object",
      properties: {
        file: { type: "string", description: "File name or path, e.g. pricing.js" },
        line: { type: "number", description: "1-based line number" },
        why: { type: "string", description: "One short sentence." },
      },
      required: ["file", "line", "why"],
    },
  },
};

const EVALUATE_TOOL: ChatCompletionTool = {
  type: "function",
  function: {
    name: "evaluate",
    description: ACTIONS.evaluate,
    parameters: {
      type: "object",
      properties: {
        expression: { type: "string", description: "A JavaScript expression valid in the paused frame." },
        why: { type: "string", description: "One short sentence." },
      },
      required: ["expression", "why"],
    },
  },
};

import * as path from "node:path";
import { booleanProbability, choiceAnswer, evaluateWithJev } from "../ai/jev";
import { Meter } from "../agent/meter";
import { callForText } from "../agent/llmClient";
import { buildObservation, renderObservation } from "../agent/observation";
import type { DebugTarget, StepKind } from "../debug/DebugTarget";
import logger from "../logger";

const log = logger.createSubLogger("AgentTools");

export interface AgentToolDef {
  name: string;
  displayName: string;
  description: string;
}

/**
 * The debugger, exposed to OTHER agents — Copilot, Claude Code, Codex — through
 * VSCode language-model tools and the localhost MCP bridge. Same target object
 * the in-extension hunt drives, so the editor shows the same thing either way.
 */
export const AGENT_TOOL_DEFS: AgentToolDef[] = [
  {
    name: "llm-debugger_start",
    displayName: "Start debug session",
    description:
      "Launch a Node.js program under the real VSCode debugger. Breakpoints, the yellow step line, " +
      "variables and the debug toolbar all appear on screen. Set breakpoints BEFORE calling this, or " +
      "the program may run to exit without pausing. Input: { program, stopOnEntry? }.",
  },
  {
    name: "llm-debugger_breakpoint",
    displayName: "Set breakpoint",
    description:
      "Set or remove a breakpoint (a red dot in the editor) at a 1-based line. " +
      "Input: { file, line, action: set|remove (default set) }.",
  },
  {
    name: "llm-debugger_step",
    displayName: "Step debugger",
    description:
      "Advance the paused program one action and return the new state. " +
      "Kinds: next (over), in (into), out, continue (to the next breakpoint or exit). " +
      "Input: { kind }.",
  },
  {
    name: "llm-debugger_state",
    displayName: "Read debugger state",
    description:
      "Read the paused stack, locals, source around the paused line, breakpoints and program output " +
      "without moving execution. No input.",
  },
  {
    name: "llm-debugger_evaluate",
    displayName: "Evaluate expression",
    description:
      "Evaluate a JavaScript expression in the paused frame and return the value. The cheapest way to " +
      "test a hypothesis about runtime state. Input: { expression }.",
  },
  {
    name: "llm-debugger_triage_jev",
    displayName: "Fast triage decision",
    description:
      "Ask the fast typed decision model what to do next from the current paused state. Returns a " +
      "recommended action with confidence plus a ready-for-fix probability, in a few hundred " +
      "milliseconds for a fraction of a generation call. Use it for routine routing. No input.",
  },
  {
    name: "llm-debugger_diagnose_llm",
    displayName: "Diagnose with the LLM",
    description:
      "Ask the generation model to analyse the paused state — the expensive path. Use it for fix " +
      "synthesis and explanations, not for routine step routing. Input: { question }.",
  },
  {
    name: "llm-debugger_stop",
    displayName: "Stop debug session",
    description:
      "End the session and remove every breakpoint this tool created. The user's own breakpoints stay. " +
      "No input.",
  },
];

export async function callAgentTool(
  target: DebugTarget,
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  switch (name) {
    case "llm-debugger_start": {
      const program = String(input.program || "");
      if (!program) throw new Error("start needs { program }.");
      const status = await target.launch(program, { stopOnEntry: !!input.stopOnEntry });
      return status === "paused"
        ? await stateText(target, "Session started and paused")
        : `Session started but is ${status} — no breakpoint was hit. Set breakpoints before starting.`;
    }
    case "llm-debugger_breakpoint": {
      const file = String(input.file || "");
      const line = Number(input.line || 0);
      if (!file || !Number.isFinite(line) || line < 1) throw new Error("breakpoint needs { file, line }.");
      const action = String(input.action || "set");
      if (action === "remove") {
        await target.removeBreakpoint(file, line);
        return `Breakpoint removed at ${file}:${line}.`;
      }
      if (action !== "set") throw new Error('breakpoint action must be "set" or "remove".');
      const res = await target.setBreakpoint(file, line);
      return `Breakpoint set at ${file}:${res.line}${res.verified ? " (bound)" : ""}.`;
    }
    case "llm-debugger_step": {
      const kind = String(input.kind || "next") as StepKind;
      if (!["next", "in", "out", "continue"].includes(kind)) {
        throw new Error("step kind must be one of: next, in, out, continue.");
      }
      const status = await target.step(kind);
      return status === "paused"
        ? await stateText(target, `Stepped (${kind})`)
        : `Stepped (${kind}) and the session is now ${status}.`;
    }
    case "llm-debugger_state":
      return stateText(target, "Current state");
    case "llm-debugger_evaluate": {
      const expression = String(input.expression || "");
      if (!expression) throw new Error("evaluate needs { expression }.");
      const res = await target.evaluate(expression);
      return res.ok ? `${expression} = ${res.value}` : `Could not evaluate: ${res.value}`;
    }
    case "llm-debugger_triage_jev": {
      const observation = await observe(target, String(input.symptom || "(not stated)"));
      if (!observation) return `Nothing to triage — the session is ${target.status()}.`;
      const res = await evaluateWithJev(observation, {
        nextAction: {
          type: "choice",
          question: "Which single debugger action best advances the hunt?",
          choices: ["next", "stepIn", "stepOut", "continue", "setBreakpoint", "evaluate", "finish"],
          criteria: {
            next: "Step over the current line",
            stepIn: "Step into the call on this line",
            stepOut: "Step out to the caller",
            continue: "Run to the next breakpoint",
            setBreakpoint: "Break somewhere else and run there",
            evaluate: "Read a runtime value first",
            finish: "Enough evidence — write the fix",
          },
        },
        readyForFix: {
          type: "boolean",
          question: "Do the observed runtime values identify the line producing the wrong value?",
          criteria: {
            true: "The wrong value and the line computing it have both been seen",
            false: "Not traced to its source yet",
          },
        },
      });
      const action = choiceAnswer(res.answers, "nextAction");
      return JSON.stringify(
        {
          recommendedAction: action?.choice ?? "next",
          confidence: action?.confidence ?? 0,
          actionProbabilities: action?.probabilities ?? {},
          readyForFixProbability: booleanProbability(res.answers, "readyForFix") ?? 0,
          latencyMs: res.latencyMs,
          note: "Execute recommendedAction with the step/breakpoint/evaluate tools.",
        },
        null,
        1,
      );
    }
    case "llm-debugger_diagnose_llm": {
      const observation = await observe(target, String(input.symptom || "(not stated)"));
      if (!observation) return `Nothing to diagnose — the session is ${target.status()}.`;
      const question = String(
        input.question || "What do these runtime values prove, and what should happen next?",
      );
      return callForText({
        system:
          "You are a senior engineer reading a live debugger. Answer from the runtime values in front " +
          "of you. Be concrete and brief: no hedging, no word counts.",
        user: `${observation}\n\n# Question\n${question}`,
        meter: new Meter(),
        maxTokens: 600,
      });
    }
    case "llm-debugger_stop": {
      await target.stop();
      return "Session ended and the breakpoints this tool created were removed.";
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/** The same observation text the in-extension hunt reasons over. */
async function observe(target: DebugTarget, symptom: string): Promise<string | null> {
  const paused = await target.paused();
  if (!paused) return null;
  return renderObservation(
    buildObservation({
      step: 0,
      stepsLeft: 0,
      symptom,
      hypothesis: "",
      paused,
      ...target.output(),
      breakpoints: target.ownedBreakpoints().map((b) => `${path.basename(b.file)}:${b.line}`),
      history: [],
      evidence: [],
      shortPath: (p) => path.basename(p),
    }),
  );
}

async function stateText(target: DebugTarget, label: string): Promise<string> {
  const paused = await target.paused();
  if (!paused) return `${label}: session is ${target.status()}.`;
  const top = paused.frames[0];
  const lines = [
    `${label} at ${top ? `${path.basename(top.source)}:${top.line} in ${top.name}` : "unknown"} (${paused.reason}).`,
    "",
    "Stack:",
    ...paused.frames.slice(0, 8).map((f, i) => `  ${i}. ${f.name} (${path.basename(f.source)}:${f.line})`),
    "",
    "Locals:",
    ...paused.scopes.flatMap((s) => s.vars.slice(0, 20).map((v) => `  ${s.name}.${v.name} = ${v.value}`)),
  ];
  if (paused.focus) lines.push("", paused.focus);
  const { stdout, stderr } = target.output();
  if (stdout.trim()) lines.push("", "stdout:", stdout.slice(-1200));
  if (stderr.trim()) lines.push("", "stderr:", stderr.slice(-1200));
  log.debug(`${label} → ${top ? `${top.source}:${top.line}` : "no frame"}`);
  return lines.join("\n").slice(0, 8000);
}

/** Vetoes a tool name that is not ours before it reaches the target. */
export function isAgentTool(name: string): boolean {
  return AGENT_TOOL_DEFS.some((d) => d.name === name);
}

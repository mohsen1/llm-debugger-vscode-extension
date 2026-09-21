import { ACTION_TOOLS, decisionFromToolCall } from "../actions";
import { callWithTools } from "../llmClient";
import type { Meter } from "../meter";
import { renderObservation } from "../observation";
import type { Decision, Observation, Strategy } from "../types";

export const DEBUGGER_SYSTEM_PROMPT =
  "You are driving a live JavaScript debugger to find the cause of one failing check. " +
  "You can see the call stack, local variables, source around the paused line, and program output. " +
  "Pick exactly one debugger action. Work from runtime values, not from guesses about the code: " +
  "when a value looks wrong, step into the call that produced it or evaluate an expression to pin it down. " +
  "Only finish once you can name the line that produces the wrong value and say what the right code is.";

/**
 * The baseline arm: the generation model decides every single step.
 * This is the "existing system" shape — one LLM round trip per debugger action.
 */
export class LlmStrategy implements Strategy {
  readonly name = "llm" as const;

  constructor(private readonly meter: Meter) {}

  async decide(observation: Observation): Promise<Decision> {
    const call = await callWithTools({
      system: DEBUGGER_SYSTEM_PROMPT,
      user: renderObservation(observation),
      tools: ACTION_TOOLS,
      meter: this.meter,
      maxTokens: 400,
    });
    if (!call) {
      return { action: "next", source: "policy", why: "model returned no action" };
    }
    const decision = decisionFromToolCall(call, "llm");
    if (!decision) {
      return { action: "next", source: "policy", why: `unusable action ${call.name}` };
    }
    return decision;
  }
}

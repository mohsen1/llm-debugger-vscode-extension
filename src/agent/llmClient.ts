import type { ChatCompletionTool } from "../types";
import { callLlm, type LlmToolCall } from "../ai/llm";
import logger from "../logger";
import type { Meter } from "./meter";

const log = logger.createSubLogger("AgentLlm");

export type ToolCall = LlmToolCall;

/**
 * One metered, tool-calling round trip.
 *
 * Structured output comes back as a tool call rather than as JSON in prose:
 * the model cannot answer with a paragraph, so there is no format to repair and
 * no parser to fool.
 */
export async function callWithTools(args: {
  system: string;
  user: string;
  tools: ChatCompletionTool[];
  meter: Meter;
  maxTokens?: number;
  patience?: "decision" | "long";
}): Promise<ToolCall | null> {
  const t0 = Date.now();
  const result = await callLlm({
    system: args.system,
    user: args.user,
    tools: args.tools,
    maxTokens: args.maxTokens ?? 800,
    ...(args.patience ? { patience: args.patience } : {}),
  });
  args.meter.recordLlm(result.model, Date.now() - t0, result.inputTokens, result.outputTokens);
  if (!result.toolCall) log.warn(`no tool call in reply from ${result.model}`);
  return result.toolCall;
}

/** Metered prose call, for the places where free text is the point. */
export async function callForText(args: {
  system: string;
  user: string;
  meter: Meter;
  maxTokens?: number;
}): Promise<string> {
  const t0 = Date.now();
  const result = await callLlm({
    system: args.system,
    user: args.user,
    maxTokens: args.maxTokens ?? 800,
    patience: "long",
  });
  args.meter.recordLlm(result.model, Date.now() - t0, result.inputTokens, result.outputTokens);
  return result.text;
}

import type { ChatCompletionSystemMessageParam } from "openai/resources";
import type { PausedState, StructuredCode } from "./types";
import log from "./log";

export const systemMessage: ChatCompletionSystemMessageParam = {
  role: "system",
  content: "You are an AI assistant that decides debugging steps.",
};

export function getInitialBreakpointsMessage(
  structuredCode: StructuredCode[],
): string {
  return [
    "Here is the workspace code in a structured format (filePath -> [lines]):",
    serializeStructuredCode(structuredCode),
    "",
    "Decide on an initial breakpoint by calling setBreakpoint on a line in the code the is most likely to be the root cause of the problem.",
    "You may reference lines precisely now.",
  ].join("\n");
}

export function getPausedMessage(
  structuredCode: StructuredCode[],
  pausedState: PausedState,
): string {
  return [
    "Code:",
    serializeStructuredCode(structuredCode),
    "",
    "Current Debug State:",
    "Breakpoints:",
    serializeBreakpoints(pausedState.breakpoints),
    "",
    "Stack Trace:",
    JSON.stringify(pausedState.pausedStack, null, 2),
    "",
    "Variables:",
    JSON.stringify(pausedState.topFrameVariables, null, 2),
    "",
    "Choose next action by calling setBreakpoint, removeBreakpoint, next, stepIn, stepOut, or continueExec.",
  ].join("\n");
}

function serializeBreakpoints(breakpoints: PausedState["breakpoints"]) {
  return breakpoints.map(({ file, line }) => `${file}:${line}`).join(", ");
}

function serializeStructuredCode(structuredCode: StructuredCode[]) {
  const serialized = structuredCode
    .map(
      ({ filePath, lines }) =>
        `${filePath}\n${lines
          .map(
            ({ lineNumber, text }) =>
              `${String(lineNumber).padStart(3, " ")}| ${text}`,
          )
          .join("\n")}`,
    )
    .join("\n\n");

  return serialized;
}

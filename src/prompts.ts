import type { ChatCompletionSystemMessageParam } from "openai/resources";
import type {  StructuredCode } from "./types";

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
  pausedState: unknown
): string {
  const message = [
    "# Code:",
    serializeStructuredCode(structuredCode),
    "",
  ];

  if (pausedState) {
    message.push(
      "# Current Debug State:",
      JSON.stringify(pausedState)
    );
  }

  message.push(
    "# Instructions:",
    "Debugger is in paused state",
    "Choose next action by calling setBreakpoint, removeBreakpoint, next, stepIn, stepOut, or continueExec.",
    "Always make sure there are breakpoints set before calling continueExec.",
    "Once you understood the problem, instead of calling any tools, respond with a code fix and explain your reasoning.",
  );

  return message.join("\n");
}


export function serializeStructuredCode(structuredCode: StructuredCode[]) {
  const serialized = structuredCode
    .map(
      ({ filePath, lines }) =>
        `${filePath}\n${
          lines
            .map(
              ({ lineNumber, text }) =>
                `${String(lineNumber).padStart(3, " ")}| ${text}`,
            )
            .join("\n")
        }`,
    )
    .join("\n\n");

  return serialized;
}

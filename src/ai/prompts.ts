import type {
  ChatCompletionMessageParam,
  ChatCompletionSystemMessageParam,
  ChatCompletionTool,
} from "openai/resources";
import type { StructuredCode } from "../types";

interface StackFrame {
  name: string;
  source: string;
  line: number;
  column: number;
}

interface Variable {
  name: string;
  value: string;
}

interface Scope {
  scopeName: string;
  variables: Variable[];
}

interface PausedState {
  pausedStack: StackFrame[];
  topFrameVariables: Scope[];
}

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
  const message = ["# Code:", serializeStructuredCode(structuredCode), ""];

  if (pausedState) {
    message.push("# Current Debug State:", JSON.stringify(pausedState));
  }

  message.push(
    "# Instructions:",
    "Debugger is in paused state",
    "Choose next action by calling setBreakpoint, removeBreakpoint, next, stepIn, stepOut, or continue.",
    "Always make sure there are breakpoints set before calling continue.",
    "Once you understood the problem, instead of calling any tools, respond with a code fix and explain your reasoning.",
  );

  return message.join("\n");
}

export function getExceptionMessage(
  structuredCode: StructuredCode[],
  pausedState: PausedState,
): string {
  const message = ["# Code:", serializeStructuredCode(structuredCode), ""];

  if (pausedState) {
    const stack = pausedState.pausedStack.map((frame: StackFrame) => {
      return `at ${frame.name} (${frame.source}:${frame.line}:${frame.column})`;
    }).join("\n");

    const exception = pausedState.topFrameVariables.find((scope: Scope) => scope.scopeName === 'Exception');
    const exceptionValue = exception?.variables.find((v: Variable) => v.name === 'exception')?.value;
    message.push("# Exception:", exceptionValue || "Unknown exception", stack);
  }

  message.push(
    "# Instructions:",
    "Debugger is in paused state due to an uncaught exception.",
    "Analyze the exception and stack trace to understand the root cause.",
    "Provide a code fix and explain your reasoning.",
  );

  return message.join("\n");
}

export function serializeStructuredCode(structuredCode: StructuredCode[]) {
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

export const initialBreakPointsSystemMessage: ChatCompletionMessageParam = {
  role: "system" as const,
  content:
    "You are an AI assistant that sets initial breakpoints before launch of a debugger.",
};

export const debugLoopSystemMessage: ChatCompletionMessageParam = {
  role: "system" as const,
  content:
    "You are an AI assistant that decides debugging steps. suggest next action by calling a function",
};

export const breakpointFunctions: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "setBreakpoint",
      description: "Sets a breakpoint in a specific file and line.",
      parameters: {
        type: "object",
        properties: {
          file: { type: "string" },
          line: { type: "number" },
        },
        required: ["file", "line"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "removeBreakpoint",
      description: "Removes a breakpoint from a specific file and line.",
      parameters: {
        type: "object",
        properties: { file: { type: "string" }, line: { type: "number" } },
        required: ["file", "line"],
      },
    },
  },
];

export const debugFunctions: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "next",
      description: "Step over the current line in the debugger.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "stepIn",
      description: "Step into the current function call in the debugger.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "stepOut",
      description: "Step out of the current function call in the debugger.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "continue",
      description: "Continue execution in the debugger.",
      parameters: { type: "object", properties: {} },
    },
  },
];

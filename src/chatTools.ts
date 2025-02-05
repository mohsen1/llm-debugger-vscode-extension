import fs from "node:fs";
import process from "node:process";
import os from "node:os";
import path from "node:path";
import { OpenAI } from "openai";
import type { ChatCompletion } from "openai/resources/chat/completions";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "./types";

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
      name: "continueExec",
      description: "Continue execution in the debugger.",
      parameters: { type: "object", properties: {} },
    },
  },
];

export class ChatWithHistory {
  #messageHistory: ChatCompletionMessageParam[] = [];
  #functions: ChatCompletionTool[];

  constructor(systemMessage: ChatCompletionMessageParam, functions: ChatCompletionTool[]) {
    this.#messageHistory = [systemMessage];
    this.#functions = functions;
  }

  clearHistory() {
    this.#messageHistory = [initialBreakPointsSystemMessage];
  }

  ask(message: string) {
    // TODO: token count and shift items from the top of the history if necessary
    this.#messageHistory.push({ role: "user", content: message });
    return callLlm(this.#messageHistory, this.#functions);
  }
}


export async function callLlm(
  promptOrMessages: string | ChatCompletionMessageParam[],
  functions?: ChatCompletionTool[],
): Promise<ChatCompletion> {
  const messages: ChatCompletionMessageParam[] = []
  if (Array.isArray(promptOrMessages)) {
    if (promptOrMessages?.[0].role !== 'system'){
      messages.push(initialBreakPointsSystemMessage);
    }
    messages.push(...promptOrMessages);
  } else {
    messages.push(initialBreakPointsSystemMessage);
    messages.push({ role: "user", content: promptOrMessages });
  }
  

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    tools: functions,
    messages, 
    tool_choice: "required",
    max_tokens: 1000,
  });


  const promptCacheFile = path.join(
    os.homedir(),
    ".llm-debugger-prompt-cache.json",
  );
  if (!fs.existsSync(promptCacheFile)) {
    fs.writeFileSync(promptCacheFile, JSON.stringify([], null, 2));
  }

  return completion;
}
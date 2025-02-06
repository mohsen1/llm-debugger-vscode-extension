import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { OpenAI } from "openai";
import type { ChatCompletion } from "openai/resources/chat/completions";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "../types";

import { initialBreakPointsSystemMessage } from "./prompts";

export class AIChat {
  #messageHistory: ChatCompletionMessageParam[] = [];
  #functions: ChatCompletionTool[];

  constructor(
    systemMessage: ChatCompletionMessageParam,
    functions: ChatCompletionTool[],
  ) {
    this.#messageHistory = [systemMessage];
    this.#functions = functions;
  }

  clearHistory() {
    this.#messageHistory = [initialBreakPointsSystemMessage];
  }

  ask(message: string, { withFunctions = true } = {}) {
    // TODO: token count and shift items from the top of the history if necessary
    this.#messageHistory.push({ role: "user", content: message });
    return callLlm(this.#messageHistory, withFunctions ? this.#functions : []);
  }
}

export async function callLlm(
  promptOrMessages: string | ChatCompletionMessageParam[],
  functions?: ChatCompletionTool[],
): Promise<ChatCompletion> {
  const messages: ChatCompletionMessageParam[] = [];
  if (Array.isArray(promptOrMessages)) {
    if (promptOrMessages?.[0].role !== "system") {
      messages.push(initialBreakPointsSystemMessage);
    }
    messages.push(...promptOrMessages);
  } else {
    messages.push(initialBreakPointsSystemMessage);
    messages.push({ role: "user", content: promptOrMessages });
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const withTools = functions && functions.length > 0;
  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    tools: withTools ? functions : undefined,
    messages,
    tool_choice: withTools ? "required" : undefined,
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

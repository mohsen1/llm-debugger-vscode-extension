import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { OpenAI } from "openai";
import type { ChatCompletion } from "openai/resources/chat/completions";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "../types";
import { initialBreakPointsSystemMessage } from "./prompts";
import { callGatewayChat, getGatewayApiKey } from "./gateway";
import vscode from "vscode";

export class AIChat {
  #messageHistory: ChatCompletionMessageParam[] = [];
  #output = vscode.window.createOutputChannel("LLM Debugger (AI Chat)", {log: true});
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

  async ask(message: string, { withFunctions = true } = {}) {
    this.#output.appendLine(''); // Add a new line
    this.#output.appendLine('------------------------ USER ----------------------');
    this.#output.info(`User: ${message}`);

    this.#messageHistory.push({ role: "user", content: message });
    const response = await callLlm(
      this.#messageHistory,
      withFunctions ? this.#functions : []
    );
    const responseMessage = response.choices[0].message;
    this.#output.appendLine(''); // Add a new line
    this.#output.appendLine('------------------------ AI ----------------------');
    if (responseMessage.content) {
      this.#output.info(`AI: ${responseMessage.content}`);
    }
    if (responseMessage.tool_calls) {
      for (const toolCall of responseMessage.tool_calls) {
        this.#output.info(`AI FN: ${toolCall.function.name}(${toolCall.function.arguments === '{}' ? '' : toolCall.function.arguments})`);
      }
    }
    return response;
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

  // Prefer Vercel AI Gateway (DeepSeek cheap-strong) when a gateway key exists.
  // Falls back to direct OpenAI (gpt-4o) for backwards compatibility.
  const gatewayKey = getGatewayApiKey();
  if (gatewayKey) {
    const { completion, modelUsed, fallbackUsed } = await callGatewayChat(
      messages,
      functions,
      { maxTokens: 1000 },
    );
    try {
      const promptCacheFile = path.join(os.homedir(), ".llm-debugger-prompt-cache.json");
      if (!fs.existsSync(promptCacheFile)) {
        fs.writeFileSync(promptCacheFile, JSON.stringify([], null, 2));
      }
      const entry = { at: new Date().toISOString(), model: modelUsed, fallbackUsed, messages, functions: (functions ?? []).map((f) => f.function.name) };
      const prev = JSON.parse(fs.readFileSync(promptCacheFile, "utf-8"));
      prev.push(entry);
      fs.writeFileSync(promptCacheFile, JSON.stringify(prev.slice(-50), null, 2));
    } catch { /* cache best-effort */ }
    return completion;
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

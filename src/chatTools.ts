import fs from 'node:fs'
import process from 'node:process'
import os from 'node:os'
import path from 'node:path'
import { OpenAI } from 'openai'
import type { ChatCompletion } from 'openai/resources/chat/completions'
import type { ChatCompletionMessageParam, ChatCompletionTool } from './types'

export const systemMessage: ChatCompletionMessageParam = {
  role: 'system' as const,
  content: 'You are an AI assistant that decides debugging steps. Suggest at least one breakpoint before launch.',
}

export const debugFunctions: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'setBreakpoint',
      description: 'Sets a breakpoint in a specific file and line.',
      parameters: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'number' },
        },
        required: ['file', 'line'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'removeBreakpoint',
      description: 'Removes a breakpoint from a specific file and line.',
      parameters: {
        type: 'object',
        properties: { file: { type: 'string' }, line: { type: 'number' } },
        required: ['file', 'line'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'stepOver',
      description: 'Step over the current line in the debugger.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'stepIn',
      description: 'Step into the current function call in the debugger.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'stepOut',
      description: 'Step out of the current function call in the debugger.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'continueExec',
      description: 'Continue execution in the debugger.',
      parameters: { type: 'object', properties: {} },
    },
  },
]

export async function callLlm(prompt: string): Promise<ChatCompletion> {
  const promptCacheFile = path.join(os.homedir(), '.llm-debugger-prompt-cache.json')
  if (!fs.existsSync(promptCacheFile)) {
    fs.writeFileSync(promptCacheFile, JSON.stringify([], null, 2))
  }
  const cache = new Map<string, ChatCompletion>(JSON.parse(fs.readFileSync(promptCacheFile, 'utf8')))
  if (cache.has(prompt)) {
    return cache.get(prompt)!
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  const userMessage: ChatCompletionMessageParam = {
    role: 'user',
    content: prompt,
  }

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    tools: debugFunctions,
    messages: [systemMessage, userMessage],
    tool_choice: 'auto',
  })

  cache.set(prompt, completion)
  fs.writeFileSync(promptCacheFile, JSON.stringify(Array.from(cache.entries()), null, 2))

  return completion
}

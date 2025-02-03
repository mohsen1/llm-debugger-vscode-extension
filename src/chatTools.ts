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

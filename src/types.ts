import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources'

export interface StructuredCode {
  filePath: string
  lines: Array<{
    lineNumber: number
    text: string
    hasBreakpoint?: boolean
  }>
}

export interface PausedState {
  breakpoints: Array<{ file: string, line: number }>
  pausedStack: any
  topFrameVariables: any[]
}

export type { ChatCompletionMessageParam, ChatCompletionTool }

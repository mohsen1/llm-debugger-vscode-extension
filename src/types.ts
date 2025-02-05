import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources";
import { Breakpoint } from "vscode";

export interface StructuredCode {
  filePath: string;
  lines: Array<{
    lineNumber: number;
    text: string;
    hasBreakpoint?: boolean;
  }>;
}

export interface PausedState {
  breakpoints: Breakpoint[];
  pausedStack: unknown;
  topFrameVariables: unknown[];
}

export type { ChatCompletionMessageParam, ChatCompletionTool };

import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources";

export interface StructuredCode {
  filePath: string;
  lines: Array<{
    lineNumber: number;
    text: string;
    hasBreakpoint?: boolean;
  }>;
}

export type { ChatCompletionMessageParam, ChatCompletionTool };

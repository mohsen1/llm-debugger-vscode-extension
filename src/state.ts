import * as vscode from "vscode";
import type {  StackFrame, Thread, Variable } from "@vscode/debugadapter";
import log from "./log";

interface SourceBreakpointInfo {
  file: string;
  line: number;
}

interface ScopeVariables {
  scopeName: string;
  variables: Variable[];
}

interface PausedState {
  breakpoints: SourceBreakpointInfo[];
  pausedStack: StackFrame[];
  topFrameVariables: ScopeVariables[];
}

/**
 * Gathers current breakpoints, stack, and top-frame variables from the active debug session.
 *
 * @param session   The current debug session
 * @param threadId  (Optional) The thread ID to inspect. Defaults to the first paused thread found.
 * @returns         An object containing breakpoint info, paused stack, and top-frame variables.
 */
export async function gatherPausedState(
  session: vscode.DebugSession,
  threadId?: number,
): Promise<PausedState> {
  if (!session) {
    throw new Error("No active debug session");
  }

  // Get all threads
  const threadsResponse = await session.customRequest("threads");
  const threads = (threadsResponse.threads || []) as Thread[];
  if (!threads.length) {
    throw new Error("No threads available");
  }

  // If no threadId provided, try to find a paused thread
  if (typeof threadId !== "number") {
    // Get all stopped threads
    const stoppedThreads: Thread[] = [];
    for (const thread of threads) {
      try {
        // Try to get stack trace - this will fail if thread isn't stopped
        await session.customRequest("stackTrace", { threadId: thread.id });
        stoppedThreads.push(thread);
      } catch {
        continue; // Thread is not stopped
      }
    }

    if (stoppedThreads.length === 0) {
      log.debug("No paused threads found");
      return {
        breakpoints: [],
        pausedStack: [],
        topFrameVariables: [],
      };
    }

    threadId = stoppedThreads[0].id;
    log.debug(`Using paused thread ${threadId}`);
  }

  // Gather all breakpoints from VSCode
  const breakpoints: SourceBreakpointInfo[] = vscode.debug.breakpoints
    .map((bp) => {
      if (bp instanceof vscode.SourceBreakpoint) {
        return {
          file: bp.location.uri.fsPath,
          line: bp.location.range.start.line + 1,
        };
      }
      return null;
    })
    .filter((bp): bp is SourceBreakpointInfo => bp !== null);

  const pausedStack: StackFrame[] = [];
  const topFrameVariables: ScopeVariables[] = [];

  // Get stack trace for the specified thread
  const stackTraceResponse = await session.customRequest("stackTrace", { threadId });
  if (stackTraceResponse.stackFrames) {
    pausedStack.push(...stackTraceResponse.stackFrames);
  }

  return { breakpoints, pausedStack, topFrameVariables };
}

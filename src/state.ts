import * as vscode from "vscode";
import type { Scope, StackFrame, Variable } from "@vscode/debugadapter";
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
  const threads = threadsResponse.threads || [];
  if (!threads.length) {
    throw new Error("No threads available");
  }

  // If no threadId provided, try to find a paused thread
  if (typeof threadId !== "number") {
    // Get all stopped threads
    const stoppedThreads = [];
    for (const thread of threads) {
      try {
        // Try to get stack trace - this will fail if thread isn't stopped
        await session.customRequest("stackTrace", { threadId: thread.id });
        stoppedThreads.push(thread);
      } catch (e) {
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

  let pausedStack: StackFrame[] = [];
  const topFrameVariables: ScopeVariables[] = [];

  try {
    // Get stack trace for the specific thread
    const stackTrace = await session.customRequest("stackTrace", { threadId });
    pausedStack = stackTrace.stackFrames || [];

    // If we have at least one frame, gather variables from the top frame
    if (pausedStack.length > 0) {
      const [topFrame] = pausedStack;

      // Get scopes for top frame
      const scopesResp = await session.customRequest("scopes", {
        frameId: topFrame.id,
      });
      const scopes = scopesResp.scopes || [];

      // Fetch all variables in parallel
      const scopeVariablePromises = scopes.map(async (scope: Scope) => {
        try {
          const varsResp = await session.customRequest("variables", {
            variablesReference: scope.variablesReference,
          });
          return {
            scopeName: scope.name,
            variables: varsResp.variables || [],
          };
        } catch (err) {
          log.error(
            `Failed to get variables for scope "${scope.name}": ${String(err)}`,
          );
          return {
            scopeName: scope.name,
            variables: [],
          };
        }
      });

      const resolvedScopeVariables = await Promise.all(scopeVariablePromises);
      topFrameVariables.push(...resolvedScopeVariables);
    }
  } catch (e) {
    log.debug(`Failed to gather stack trace for thread ${threadId}: ${String(e)}`);
    // Return empty state if we can't get stack trace
    return {
      breakpoints,
      pausedStack: [],
      topFrameVariables: [],
    };
  }

  return { breakpoints, pausedStack, topFrameVariables };
}

import { StackFrame, Variable } from "@vscode/debugadapter";
import * as vscode from "vscode";
import log from "../logger";

interface SimpleBreakpoint {
  type: "source" | "function" | "unknown";
  path?: string;
  line?: number;
  functionName?: string;
}

interface SimpleStackFrame {
  name: string;
  line: number;
  column: number;
  source: string;
}

export interface PausedState {
  breakpoints: SimpleBreakpoint[];
  pausedStack: SimpleStackFrame[];
  topFrameVariables: {
    scopeName: string;
    variables: { name: string; value: string }[];
  }[];
}

export class DebugState {
  /**
   * Returns the set of enabled breakpoints in a simplified format:
   *  - For SourceBreakpoints: file path and line number
   *  - For FunctionBreakpoints: function name
   */
  getEnabledBreakpoints(): SimpleBreakpoint[] {
    return vscode.debug.breakpoints
      .filter((bp) => bp.enabled)
      .map((bp) => {
        if (bp instanceof vscode.SourceBreakpoint) {
          return {
            type: "source",
            path: bp.location.uri.fsPath,
            line: bp.location.range.start.line,
          };
        } else if (bp instanceof vscode.FunctionBreakpoint) {
          return {
            type: "function",
            functionName: bp.functionName,
          };
        }
        return { type: "unknown" };
      });
  }

  /**
   * Gets a list of frames (name, line, column, source) for the currently paused thread.
   * To keep it small, we only include the basic location info.
   */
  async getPausedStack(session: vscode.DebugSession): Promise<SimpleStackFrame[]> {
    const threadsResponse = await session.customRequest("threads");
    const allThreads = threadsResponse?.threads || [];

    // Find a 'paused' thread. In many debug adapters, there's only one paused thread anyway.
    // For simplicity, just take the first thread here.
    const pausedThread = allThreads[0];
    if (!pausedThread) return [];

    const stackTraceResponse = await session.customRequest("stackTrace", {
      threadId: pausedThread.id,
      startFrame: 0,
      levels: 20,
    });

    const frames = stackTraceResponse?.stackFrames || [];
    return frames.map((f: StackFrame) => ({
      name: f.name,
      line: f.line,
      column: f.column,
      source: f.source?.path || f.source?.name || "<unknown>",
    }));
  }

  /**
   * Retrieves variables from the top stack frame (locals only), excluding large/global scopes.
   */
  async getTopFrameVariables(session: vscode.DebugSession): Promise<{
    scopeName: string;
    variables: { name: string; value: string }[];
  }[]> {
    // Hard-code threadId=1 for simplicity; adapt as needed if you track paused thread IDs elsewhere.
    const threadId = 1;

    const stackTraceResponse = await session.customRequest("stackTrace", {
      threadId,
      startFrame: 0,
      levels: 1,
    });
    const frames = stackTraceResponse.stackFrames || [];
    if (!frames.length) return [];

    const frameId = frames[0].id;
    const scopesResponse = await session.customRequest("scopes", { frameId });
    const scopes = scopesResponse?.scopes || [];

    const results: {
      scopeName: string;
      variables: { name: string; value: string }[];
    }[] = [];

    for (const scope of scopes) {
      // Skip anything that isn't a local/closure scope to keep data minimal
      if (!["Local", "Closure", "Exception"].includes(scope.name)) continue;

      const varsResponse = await session.customRequest("variables", {
        variablesReference: scope.variablesReference,
      });
      const vars = varsResponse.variables || [];
      // Just pick out name and a short value
      const simplified = vars.map((v: Variable) => ({
        name: v.name,
        value: v.value,
      }));

      results.push({
        scopeName: scope.name,
        variables: simplified,
      });
    }
    return results;
  }

  /**
   * Collects the current paused state: enabled breakpoints, call stack, and top-frame local variables.
   */
  async gatherPausedState(session: vscode.DebugSession): Promise<PausedState> {
    if (!session) {
      log.error("No active debug session");
      return {
        breakpoints: [],
        pausedStack: [],
        topFrameVariables: [],
      };
    }
    const result: PausedState = {
      breakpoints: [],
      pausedStack: [],
      topFrameVariables: [],
    };
    try {
      result.breakpoints = this.getEnabledBreakpoints();
    } catch (error) {
      log.error("Error getting enabled breakpoints", String(error));
    }
    try {
      result.pausedStack = await this.getPausedStack(session);
    } catch (error) {
      log.error("Error getting paused stack", String(error));
    }
    try {
      result.topFrameVariables = await this.getTopFrameVariables(session);
    } catch (error) {
      log.error("Error getting top frame variables", String(error));
    }

    return result;
  }
}

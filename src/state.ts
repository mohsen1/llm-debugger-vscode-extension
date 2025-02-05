import * as vscode from 'vscode'
import type { Scope, StackFrame, Variable } from '@vscode/debugadapter'
import log from './log'

interface SourceBreakpointInfo {
  file: string
  line: number
}

interface ScopeVariables {
  scopeName: string
  variables: Variable[]
}

interface PausedState {
  breakpoints: SourceBreakpointInfo[]
  pausedStack: StackFrame[]
  topFrameVariables: ScopeVariables[]
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
    throw new Error('No active debug session')
  }

  // If no threadId provided, try to find a paused thread
  if (typeof threadId !== 'number') {
    const threadsResponse = await session.customRequest('threads')
    const threads = threadsResponse.threads || []
    if (!threads.length) {
      throw new Error('No threads available')
    }
    threadId = threads[0].id
    log.debug(`No thread ID provided, using thread ${threadId}`)
  }

  // Get stack trace for the specific thread
  const stackTrace = await session.customRequest('stackTrace', { threadId })

  // Gather all breakpoints from VSCode
  const breakpoints: SourceBreakpointInfo[] = vscode.debug.breakpoints
    .map((bp) => {
      if (bp instanceof vscode.SourceBreakpoint) {
        return {
          file: bp.location.uri.fsPath,
          line: bp.location.range.start.line + 1,
        }
      }
      return null
    })
    .filter((bp): bp is SourceBreakpointInfo => bp !== null)

  let pausedStack: StackFrame[] = []
  const topFrameVariables: ScopeVariables[] = []

  try {
    pausedStack = stackTrace.stackFrames || []

    // If we do have at least one frame, gather variables from the top frame
    if (pausedStack.length > 0) {
      const [topFrame] = pausedStack

      // Get scopes for top frame
      const scopesResp = await session.customRequest('scopes', { frameId: topFrame.id })
      const scopes = scopesResp.scopes || []

      // Fetch all variables in parallel
      const scopeVariablePromises = scopes.map(async (scope: Scope) => {
        try {
          const varsResp = await session.customRequest('variables', {
            variablesReference: scope.variablesReference,
          })
          return {
            scopeName: scope.name,
            variables: varsResp.variables || [],
          }
        }
        catch (err) {
          console.error(`Failed to get variables for scope "${scope.name}":`, err)
          return {
            scopeName: scope.name,
            variables: [],
          }
        }
      })

      const resolvedScopeVariables = await Promise.all(scopeVariablePromises)
      topFrameVariables.push(...resolvedScopeVariables)
    }
  }
  catch (e) {
    // If it's explicitly "Thread is not paused" or a similar error, handle gracefully
    if (String(e).includes('Thread is not paused')) {
      log.debug('gatherPausedState: Thread is not paused, so no stack trace is available.')
    }
    else {
      log.error(`Failed to gather paused stack or variables: ${String(e)}`)
    }
  }

  return { breakpoints, pausedStack, topFrameVariables }
}

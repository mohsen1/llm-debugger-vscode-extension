import * as vscode from 'vscode'
import { breakpointFunctions, callLlm, debugFunctions } from './chatTools'
import { gatherWorkspaceCode } from './codeParser'
import {
  handleLlmFunctionCall,
  markBreakpointsInCode,
} from './debugActions'
import { getInitialBreakpointsMessage, getPausedMessage } from './prompts'
import type { StructuredCode } from './types'
import * as log from './log'
import { gatherPausedState } from './state'

// Store the structured code so we can annotate breakpoints on it whenever we pause
const structuredCode: StructuredCode[] = []

async function setupInitialBreakpoints() {
  const structuredCode = await gatherWorkspaceCode()
  log.debug('Calling LLM for initial breakpoints.')
  log.show()

  // Clearn all breakpoints (TODO: this should not be in the final implementation)
  await vscode.debug.removeBreakpoints(
    vscode.debug.breakpoints.filter(breakpoint => breakpoint.enabled),
  )

  const initialResponse = await callLlm(getInitialBreakpointsMessage(structuredCode), breakpointFunctions)
  await handleLlmFunctionCall(initialResponse)
}

function debugLoop() {
  let live = false

  async function loop(session: vscode.DebugSession) {
    if (!session)
      return

    await session.customRequest('continue') // continue to the next breakpoint
    const pausedState = await gatherPausedState(session)
    markBreakpointsInCode(structuredCode, pausedState.breakpoints)

    log.debug('Calling LLM with paused state.')
    // Call the LLM with the updated state
    const pausedResponse = await callLlm(getPausedMessage(structuredCode, pausedState), debugFunctions)

    await handleLlmFunctionCall(pausedResponse)

    log.debug('LLM function call handled.')

    if (live)
      loop(session)
  }

  function stop() {
    live = false
  }

  function start(session: vscode.DebugSession) {
    live = true
    return loop(session)
  }

  return { stop, start }
}

export function activate(context: vscode.ExtensionContext) {
  log.debug('LLM Debugger activated.')

  const command = vscode.commands.registerCommand('llm-debugger.startLLMDebug', async () => {
    const { stop, start } = debugLoop()

    const disposable = vscode.debug.registerDebugAdapterTrackerFactory('pwa-node', {
      createDebugAdapterTracker(session: vscode.DebugSession) {
        return {
          async onWillStartSession() {
            // The parent process itself is not what we launched
            if (session.parentSession) {
              await session.parentSession.customRequest('pause')
              await setupInitialBreakpoints()
              await start(session)
            }
            await session.customRequest('pause')
          },
        }
      },
    })

    log.clear()
    // Now launch the actual debug session
    await vscode.debug.startDebugging(undefined, {
      type: 'pwa-node',
      request: 'launch',
      name: 'LLM Debugger',
      // eslint-disable-next-line no-template-curly-in-string
      program: '${workspaceFolder}/array.test.js',
      env: { NODE_ENV: 'test' },
    })

    // If the session ends, we can do any cleanup
    vscode.debug.onDidTerminateDebugSession((_) => {
      disposable.dispose()
      stop()
    })
  })

  context.subscriptions.push(command)
}

export function deactivate() {
  log.debug('LLM Debugger deactivated.')
}

import * as vscode from 'vscode'
import { callLlm } from './chatTools'
import { gatherWorkspaceCode } from './codeParser'
import {
  gatherPausedState,
  handleLlmFunctionCall,
  markBreakpointsInCode,
} from './debugActions'
import { getInitialBreakpointsMessage, getPausedMessage } from './prompts'
import type { StructuredCode } from './types'
import * as log from './log'

// Store the structured code so we can annotate breakpoints on it whenever we pause
const structuredCode: StructuredCode[] = []
vscode.debug.registerDebugAdapterTrackerFactory('pwa-node', {
  createDebugAdapterTracker(session: vscode.DebugSession) {
    log.debug(`createDebugAdapterTracker for session: ${session.id}`)
    return {
      async onWillStartSession() {
        // pause the session
        const structuredCode = await gatherWorkspaceCode()
        log.clear()
        log.debug('Calling LLM for initial breakpoints.')
        log.show()

        // Clearn all breakpoints (TODO: this should not be in the final implementation)
        await vscode.debug.removeBreakpoints(
          vscode.debug.breakpoints.filter(breakpoint => breakpoint.enabled),
        )

        // Ask LLM for any initial breakpoints before launching
        session.customRequest('pause')
        const initialResponse = await callLlm(getInitialBreakpointsMessage(structuredCode))
        await handleLlmFunctionCall(initialResponse)
        log.debug('Resuming session.')
        session.customRequest('continue')

        await debugLoop(session)
      },
    }
  },
})

async function debugLoop(session: vscode.DebugSession) {
  log.debug('Starting debug loop.')
  while (
    // TODO: while session is active session not just any active session
    vscode.debug.activeDebugSession?.id
  ) {
    // Gather paused state (stack, variables, breakpoints, etc.)
    const pausedState = await gatherPausedState(session)
    markBreakpointsInCode(structuredCode, pausedState.breakpoints)

    log.debug('Calling LLM with paused state.')
    // Call the LLM with the updated state
    const pausedResponse = await callLlm(getPausedMessage(structuredCode, pausedState))

    log.debug('Handling LLM function call.')
    log.debug(`Paused response: ${JSON.stringify(pausedResponse)}`)

    await handleLlmFunctionCall(pausedResponse, { callAllFunctions: true })
  }
  log.debug('Debug loop ended.')
}

export function activate(context: vscode.ExtensionContext) {
  log.debug('LLM Debugger activated.')

  const command = vscode.commands.registerCommand('llm-debugger.startLLMDebug', async () => {
    // Now launch the actual * debug session
    const started = await vscode.debug.startDebugging(undefined, {
      type: 'pwa-node',
      request: 'launch',
      name: 'LLM Debugger',
      // eslint-disable-next-line no-template-curly-in-string
      program: '${workspaceFolder}/array.test.js',
      env: { NODE_ENV: 'test' },
    })

    if (!started) {
      log.error('Failed to start debug session.')
      return
    }

    log.debug('Debug session started.')
    log.show()

    const session = vscode.debug.activeDebugSession
    if (!session)
      log.error('No active debug session found.')

    vscode.debug.onDidReceiveDebugSessionCustomEvent((event) => {
      log.debug(`onDidReceiveMessage: ${JSON.stringify(event)}`)
    })

    // If the session ends, we can do any cleanup
    vscode.debug.onDidTerminateDebugSession((terminated) => {
      if (terminated.id === session?.id) {
        log.debug('Debug session terminated.')
      }
    })
  })

  context.subscriptions.push(command)
}

export function deactivate() {
  log.debug('LLM Debugger deactivated.')
}

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

const outputChannel = vscode.window.createOutputChannel('LLM Debugger')

// Store the structured code so we can annotate breakpoints on it whenever we pause
let structuredCode: StructuredCode[] = []

vscode.debug.registerDebugAdapterTrackerFactory('pwa-node', {
  createDebugAdapterTracker(session: vscode.DebugSession) {
    outputChannel.appendLine(`createDebugAdapterTracker: ${session.id}`)
    return {
      onExit() {
        outputChannel.appendLine('onExit')
      },

      onWillStartSession() {
        outputChannel.appendLine('onWillStartSession')
      },

      onWillStopSession() {
        outputChannel.appendLine('onWillStopSession')
      },

      onDidReceiveMessage(message: any) {
        outputChannel.appendLine(`onDidReceiveMessage: ${message.type} ${message.event}`)
      },

      onError(error) {
        outputChannel.appendLine(`onError: ${error}`)
      },
      onWillReceiveMessage(message) {
        outputChannel.appendLine(`onWillReceiveMessage: ${message.type} ${message.event}`)
      },
      onDidSendMessage: async (message) => {
        outputChannel.appendLine(`onDidSendMessage: ${message.type} ${message.event}`)
        // We only care about DAP events
        if (message.type !== 'event')
          return

        // "stopped" is the standard DAP event fired when execution is paused
        if (message.event === 'stopped') {
          outputChannel.appendLine('Debugger has paused ("stopped" event).')

          // Gather paused state (stack, variables, breakpoints, etc.)
          const pausedState = await gatherPausedState(session)
          markBreakpointsInCode(structuredCode, pausedState.breakpoints)

          // Call the LLM with the updated state
          const pausedResponse = await callLlm(getPausedMessage(structuredCode, pausedState))

          await handleLlmFunctionCall(pausedResponse, { callAllFunctions: true })
        }
      },
    }
  },
})
export function activate(context: vscode.ExtensionContext) {
  outputChannel.appendLine('LLM Debugger activated.')

  const command = vscode.commands.registerCommand('llm-debugger.startLLMDebug', async () => {
    // Gather and store code from the workspace
    structuredCode = await gatherWorkspaceCode()
    outputChannel.appendLine('Calling LLM for initial breakpoints.')
    outputChannel.show()

    // Ask LLM for any initial breakpoints before launching
    const initialResponse = await callLlm(getInitialBreakpointsMessage(structuredCode))

    await handleLlmFunctionCall(initialResponse)

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
      outputChannel.appendLine('Failed to start debug session.')
      return
    }

    outputChannel.appendLine('Debug session started.')
    outputChannel.show()

    const session = vscode.debug.activeDebugSession
    if (!session)
      outputChannel.appendLine('No active debug session found.')

    vscode.debug.onDidReceiveDebugSessionCustomEvent((event) => {
      outputChannel.appendLine(`onDidReceiveMessage: ${JSON.stringify(event)}`)
    })

    // If the session ends, we can do any cleanup
    vscode.debug.onDidTerminateDebugSession((terminated) => {
      if (terminated.id === session?.id) {
        outputChannel.appendLine('Debug session terminated.')
      }
    })
  })

  context.subscriptions.push(command)
}

export function deactivate() {
  outputChannel.appendLine('LLM Debugger deactivated.')
}

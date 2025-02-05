import process from 'node:process'
import * as vscode from 'vscode'
import { breakpointFunctions, callLlm, debugFunctions } from './chatTools'
import { gatherWorkspaceCode } from './codeParser'
import {
  handleLlmFunctionCall,
  markBreakpointsInCode,
} from './debugActions'
import { getInitialBreakpointsMessage, getPausedMessage } from './prompts'
import type { StructuredCode } from './types'
import log from './log'
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

class DebugLoopController {
  #live = false
  #currentThreadId: number | undefined

  async #loop(session: vscode.DebugSession) {
    if (!session || !this.#live)
      return

    const pausedState = await gatherPausedState(session, this.#currentThreadId)
    markBreakpointsInCode(structuredCode, pausedState.breakpoints)

    log.debug('Calling LLM with paused state.')
    const pausedResponse = await callLlm(getPausedMessage(structuredCode, pausedState), debugFunctions)

    await handleLlmFunctionCall(pausedResponse)
    log.debug('LLM function call handled.')

    if (this.#live)
      this.#loop(session)
  }

  stop() {
    this.#live = false
  }

  start(session: vscode.DebugSession, threadId: number) {
    this.#currentThreadId = threadId
    this.#live = true
    return this.#loop(session)
  }
}

process.on('uncaughtException', (error) => {
  log.error('Uncaught exception:', error)
})

export function activate(context: vscode.ExtensionContext) {
  log.debug('LLM Debugger activated.')

  const command = vscode.commands.registerCommand('llm-debugger.startLLMDebug', async () => {
    const debugLoopController = new DebugLoopController()

    const disposable = vscode.debug.registerDebugAdapterTrackerFactory('pwa-node', {
      createDebugAdapterTracker(session: vscode.DebugSession) {
        return {
          async onWillStartSession() {
            log.debug('onWillStartSession', session.id)
            if (session.parentSession) {
              await setupInitialBreakpoints()
              await session.parentSession.customRequest('pause')
            }
            else {
              await session.customRequest('pause')
            }
          },

          onWillStopSession() {
            debugLoopController.stop()
          },

          onError(error: Error) {
            log.error('createDebugAdapterTracker', session.id, String(error))
          },

          onDidSendMessage: async (message: any) => {
            log.debug('onDidSendMessage', session.id, JSON.stringify(message))
            if (message.event === 'stopped') {
              const { threadId, reason } = message.body
              log.debug(`Debug session paused on thread ${threadId}, reason: ${reason}`)
              debugLoopController.start(session, threadId)
            }
          },
        }
      },
    })

    log.clear()
    // Now launch the actual debug session
    await vscode.debug.startDebugging(vscode.workspace.workspaceFolders?.[0], {
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
      debugLoopController.stop()
    })
  })

  context.subscriptions.push(command)
}

export function deactivate() {
  log.debug('LLM Debugger deactivated.')
}

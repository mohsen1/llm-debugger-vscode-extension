import process from 'node:process'
import * as vscode from 'vscode'
import { OpenAI } from 'openai'
import {
  continueExec,
  gatherPausedState,
  markBreakpointsInCode,
  removeBreakpoint,
  setBreakpoint,
  stepIn,
  stepOut,
  stepOver,
} from './debugActions'
import { gatherWorkspaceCode } from './codeParser'
import { debugFunctions } from './chatTools'
import { getInitialBreakpointsMessage, getPausedMessage, systemMessage } from './prompts'
import type { StructuredCode } from './types'

const outputChannel = vscode.window.createOutputChannel('LLM Debugger')
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// Store the structured code so we can annotate breakpoints on it whenever we pause
let structuredCode: StructuredCode[] = []

export function activate(context: vscode.ExtensionContext) {
  outputChannel.appendLine('LLM Debugger activated.')

  // 1) Register a Debug Adapter Tracker for the "node" debug type
  //    so we can intercept the standard DAP "stopped" event.
  //   vscode.debug.registerDebugAdapterTrackerFactory('node', {
  //     createDebugAdapterTracker(session: vscode.DebugSession) {
  //       return {
  //         onDidSendMessage: async (message) => {
  //           // We only care about DAP events
  //           if (message.type !== 'event')
  //             return

  //           // "stopped" is the standard DAP event fired when execution is paused
  //           if (message.event === 'stopped') {
  //             outputChannel.appendLine('Debugger has paused ("stopped" event).')

  //             // Gather paused state (stack, variables, breakpoints, etc.)
  //             const pausedState = await gatherPausedState(session)
  //             markBreakpointsInCode(structuredCode, pausedState.breakpoints)

  //             // Call the LLM with the updated state
  //             const pausedResponse = await openai.chat.completions.create({
  //               model: 'gpt-4o',
  //               tools: debugFunctions,
  //               messages: [systemMessage, getPausedMessage(structuredCode, pausedState)],
  //               tool_choice: 'auto',
  //             })

  //             const choice = pausedResponse.choices[0]
  //             const finishReason = choice.finish_reason

  //             // If the assistant made tool calls, process them
  //             if (choice.message?.tool_calls?.length) {
  //               for (const toolCall of choice.message.tool_calls) {
  //                 const { name, arguments: argsStr } = toolCall.function
  //                 switch (name) {
  //                   case 'setBreakpoint':
  //                     await setBreakpoint(argsStr)
  //                     break
  //                   case 'removeBreakpoint':
  //                     await removeBreakpoint(argsStr)
  //                     break
  //                   case 'stepOver':
  //                     await stepOver()
  //                     break
  //                   case 'stepIn':
  //                     await stepIn()
  //                     break
  //                   case 'stepOut':
  //                     await stepOut()
  //                     break
  //                   case 'continueExec':
  //                     await continueExec()
  //                     break
  //                 }
  //               }
  //             }

  //             if (finishReason === 'stop') {
  //               outputChannel.appendLine('LLM indicated to stop debugging actions.')
  //             }
  //           }
  //         },
  //       }
  //     },
  //   })

  // 2) Command to start the debug session
  const command = vscode.commands.registerCommand('llm-debugger.startLLMDebug', async () => {
    // Gather and store code from the workspace
    structuredCode = await gatherWorkspaceCode()
    outputChannel.appendLine('Calling LLM for initial breakpoints.')
    outputChannel.show()

    // Ask LLM for any initial breakpoints before launching
    const initialResponse = await openai.chat.completions.create({
      model: 'gpt-4o',
      tools: debugFunctions,
      messages: [systemMessage, getInitialBreakpointsMessage(structuredCode)],
      tool_choice: 'auto',
    })

    // Process any breakpoint-related tool calls
    if (initialResponse.choices[0].message?.tool_calls?.length) {
      for (const toolCall of initialResponse.choices[0].message.tool_calls) {
        const { name, arguments: argsStr } = toolCall.function
        switch (name) {
          case 'setBreakpoint':
            await setBreakpoint(argsStr)
            break
          case 'removeBreakpoint':
            await removeBreakpoint(argsStr)
            break
        }
      }
    }

    // Now launch the actual Node debug session
    await vscode.debug.startDebugging(undefined, {
      type: 'node',
      request: 'launch',
      name: 'LLM Debugger',
      // eslint-disable-next-line no-template-curly-in-string
      program: '${workspaceFolder}/array.test.js',
      env: { NODE_ENV: 'test' },
    })

    outputChannel.appendLine('Debug session started.')
    outputChannel.show()

    const session = vscode.debug.activeDebugSession
    if (!session)
      outputChannel.appendLine('No active debug session found.')

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

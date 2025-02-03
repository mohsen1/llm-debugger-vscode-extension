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

const outputChannel = vscode.window.createOutputChannel('LLM Debugger')
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export function activate(context: vscode.ExtensionContext) {
  outputChannel.appendLine('LLM Debugger activated.')

  const command = vscode.commands.registerCommand('llm-debugger.startLLMDebug', async () => {
    const structuredCode = await gatherWorkspaceCode()

    outputChannel.appendLine('Calling LLM for initial breakpoints.')
    outputChannel.show()
    const initialResponse = await openai.chat.completions.create({
      model: 'gpt-4o',
      tools: debugFunctions,
      messages: [systemMessage, getInitialBreakpointsMessage(structuredCode)],
      tool_choice: 'auto',
    })

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

    // Launch debug session
    await vscode.debug.startDebugging(undefined, {
      type: 'node',
      request: 'launch',
      name: 'LLM Debugger',
      // eslint-disable-next-line no-template-curly-in-string
      program: '${workspaceFolder}/array.test.js',
      env: { NODE_ENV: 'test' },
    })

    outputChannel.appendLine('Debug session started.')

    const session = vscode.debug.activeDebugSession
    if (!session) {
      outputChannel.appendLine('No active debug session found.')
      return
    }

    // Listen for debug-adapter-level events
    const disposable = vscode.debug.onDidReceiveDebugSessionCustomEvent(async (evt) => {
      if (evt.session.id !== session.id) {
        outputChannel.appendLine('Debug session changed.')
        return
      }

      if (evt.event === 'stopped') {
        const pausedState = await gatherPausedState(session)
        markBreakpointsInCode(structuredCode, pausedState.breakpoints)

        const pausedResponse = await openai.chat.completions.create({
          model: 'gpt-4o',
          tools: debugFunctions,
          messages: [systemMessage, getPausedMessage(structuredCode, pausedState)],
          tool_choice: 'auto',
        })

        const choice = pausedResponse.choices[0]
        const finishReason = choice.finish_reason
        if (!choice.message?.tool_calls?.length)
          return

        for (const toolCall of choice.message.tool_calls) {
          const { name, arguments: argsStr } = toolCall.function
          switch (name) {
            case 'setBreakpoint':
              await setBreakpoint(argsStr)
              break
            case 'removeBreakpoint':
              await removeBreakpoint(argsStr)
              break
            case 'stepOver':
              await stepOver()
              break
            case 'stepIn':
              await stepIn()
              break
            case 'stepOut':
              await stepOut()
              break
            case 'continueExec':
              await continueExec()
              break
          }
        }

        if (finishReason === 'stop')
          disposable.dispose()
      }
    })

    // Clean up when session ends
    vscode.debug.onDidTerminateDebugSession((terminated) => {
      if (terminated.id === session.id) {
        disposable.dispose()
      }
    })
  })

  context.subscriptions.push(command)
}

export function deactivate() {
  outputChannel.appendLine('LLM Debugger deactivated.')
}

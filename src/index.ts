import * as fs from 'node:fs'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import process from 'node:process'
import * as vscode from 'vscode'
import { OpenAI } from 'openai'
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources'

const outputChannel = vscode.window.createOutputChannel('LLM Debugger')
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const debugFunctions: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'setBreakpoint',
      description: 'Sets a breakpoint in a specific file and line.',
      parameters: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'number' },
        },
        required: ['file', 'line'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'removeBreakpoint',
      description: 'Removes a breakpoint from a specific file and line.',
      parameters: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'number' },
        },
        required: ['file', 'line'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'stepOver',
      description: 'Step over the current line in the debugger.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'stepIn',
      description: 'Step into the current function call in the debugger.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'stepOut',
      description: 'Step out of the current function call in the debugger.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'continueExec',
      description: 'Continue execution in the debugger.',
      parameters: { type: 'object', properties: {} },
    },
  },
]

// Example: read entire workspace (or a subset) and produce structured lines
async function gatherWorkspaceCode(): Promise<Array<{
  filePath: string
  lines: Array<{
    lineNumber: number
    text: string
    // Extendable metadata: tokens, char offsets, etc.
  }>
}>> {
  const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  if (!wsFolder)
    return []

  // For brevity, we'll just rely on `yek` again to get file paths or code.
  // In practice, you could do your own file-walking if you want more control.
  const repoCode = execSync('yek', { cwd: wsFolder }).toString()

  // If `repoCode` is a big concatenated string with ">>>> filename\n", parse it into structured lines:
  const sections = parseRepoCodeOutput(repoCode)

  return sections.map(({ fileName, lines }) => {
    return {
      filePath: path.isAbsolute(fileName) ? fileName : path.join(wsFolder, fileName),
      lines: lines.map((text, idx) => ({
        lineNumber: idx + 1,
        text,
        // Future: tokens, char offsets, etc.
      })),
    }
  })
}

// Simple parser example for the `yek` output with lines like ">>>> fileName\nsome code lines\n\n>>>> nextFile"
function parseRepoCodeOutput(output: string): Array<{ fileName: string, lines: string[] }> {
  const result: Array<{ fileName: string, lines: string[] }> = []
  let currentFile: string | null = null
  let currentLines: string[] = []

  const rawLines = output.split('\n')
  for (const line of rawLines) {
    const match = line.match(/^>>>>[ \t]([^\n]*)$/)
    if (match) {
      // If we were reading a previous file, push it
      if (currentFile) {
        result.push({ fileName: currentFile, lines: currentLines })
      }
      currentFile = match[1]
      currentLines = []
      continue
    }
    if (currentFile)
      currentLines.push(line)
  }
  // If we ended with a file open
  if (currentFile)
    result.push({ fileName: currentFile, lines: currentLines })

  return result
}

export function activate(context: vscode.ExtensionContext) {
  outputChannel.appendLine('LLM Debugger activated.')

  const command = vscode.commands.registerCommand('llm-debugger.startLLMDebug', async () => {
    // 1) Gather structured code data
    const structuredCode = await gatherWorkspaceCode()

    // 2) Ask LLM for initial breakpoints
    const systemMessage: ChatCompletionMessageParam = {
      role: 'system',
      content: 'You are an AI assistant that decides debugging steps. Suggest at least one breakpoint before launch.',
    }
    const userMessage: ChatCompletionMessageParam = {
      role: 'user',
      content: `
Here is the workspace code in a structured format (filePath -> [lines]):

${JSON.stringify(structuredCode, null, 2)}

Please decide on an initial breakpoint by calling setBreakpoint (and optionally more). 
You may reference lines precisely now.`,
    }
    outputChannel.appendLine('Calling LLM for initial breakpoints.')
    const initialResponse = await openai.chat.completions.create({
      model: 'gpt-4o',
      tools: debugFunctions,
      messages: [systemMessage, userMessage],
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

    // 3) Launch the debug session
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
    if (!session) {
      outputChannel.appendLine('No active debug session found.')
      return
    }

    // Listen for debug-adapter-level events
    const disposable = vscode.debug.onDidReceiveDebugSessionCustomEvent(async (evt) => {
      if (evt.session.id !== session.id)
        return

      if (evt.event === 'stopped') {
        // 4) Gather paused state. This is also where you can feed the structured code again or partial references
        const pausedState = await gatherPausedState(session)
        // Optionally, mark breakpoints in code lines if you like:
        markBreakpointsInCode(structuredCode, pausedState.breakpoints)

        const pausedMessage: ChatCompletionMessageParam = {
          role: 'user',
          content: `
We are paused. Below is the paused state plus code references with breakpoints marked:

Paused state:
${JSON.stringify(pausedState, null, 2)}

Structured code with any breakpoints annotated:
${JSON.stringify(structuredCode, null, 2)}

Choose next action by calling setBreakpoint, removeBreakpoint, stepOver, stepIn, stepOut, or continueExec.
`,
        }
        const pausedResponse = await openai.chat.completions.create({
          model: 'gpt-4o',
          tools: debugFunctions,
          messages: [systemMessage, pausedMessage],
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
              await session.customRequest('next')
              break
            case 'stepIn':
              await session.customRequest('stepIn')
              break
            case 'stepOut':
              await session.customRequest('stepOut')
              break
            case 'continueExec':
              await session.customRequest('continue')
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

async function gatherPausedState(session: vscode.DebugSession) {
  const breakpoints = vscode.debug.breakpoints
    .map((bp) => {
      if (bp instanceof vscode.SourceBreakpoint) {
        return {
          file: bp.location.uri.fsPath,
          line: bp.location.range.start.line + 1,
        }
      }
      return null
    })
    .filter((bp): bp is { file: string, line: number } => bp !== null)

  let pausedStack = null
  const topFrameVariables: any[] = []
  try {
    // Hard-coded threadId = 1 for demonstration
    const stackTrace = await session.customRequest('stackTrace', { threadId: 1 })
    pausedStack = stackTrace.stackFrames || []

    if (pausedStack.length) {
      const [topFrame] = pausedStack
      const scopesResp = await session.customRequest('scopes', { frameId: topFrame.id })
      for (const scope of scopesResp.scopes || []) {
        const varsResp = await session.customRequest('variables', {
          variablesReference: scope.variablesReference,
        })
        topFrameVariables.push({
          scopeName: scope.name,
          variables: (await varsResp).variables,
        })
      }
    }
  }
  catch (e) {
    outputChannel.appendLine(`Failed to gather paused stack or variables: ${String(e)}`)
  }

  return { breakpoints, pausedStack, topFrameVariables }
}

function markBreakpointsInCode(
  structuredCode: Array<{
    filePath: string
    lines: Array<{
      lineNumber: number
      text: string
      hasBreakpoint?: boolean
    }>
  }>,
  breakpoints: Array<{ file: string, line: number }>,
) {
  // Reset all
  for (const fileObj of structuredCode) {
    for (const lineObj of fileObj.lines) {
      lineObj.hasBreakpoint = false
    }
  }
  // Mark current breakpoints
  for (const bp of breakpoints) {
    const fileObj = structuredCode.find(sc => sc.filePath === bp.file)
    if (!fileObj)
      continue
    const lineObj = fileObj.lines.find(l => l.lineNumber === bp.line)
    if (lineObj)
      lineObj.hasBreakpoint = true
  }
}

async function setBreakpoint(functionArgsString: string) {
  try {
    const { file, line } = JSON.parse(functionArgsString)
    let fullPath = file
    if (!path.isAbsolute(file) && vscode.workspace.workspaceFolders?.length) {
      const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath
      fullPath = path.join(workspaceRoot, file)
    }

    const uri = vscode.Uri.file(fullPath)
    const position = new vscode.Position(line - 1, 0)
    const location = new vscode.Location(uri, position)
    const breakpoint = new vscode.SourceBreakpoint(location, true)

    vscode.debug.addBreakpoints([breakpoint])
    outputChannel.appendLine(`Breakpoint set at ${file}:${line}`)
    vscode.window.showInformationMessage(`Breakpoint set at ${file}:${line}`)
  }
  catch (err) {
    outputChannel.appendLine(`Failed to set breakpoint: ${String(err)}`)
    vscode.window.showErrorMessage(`Failed to set breakpoint: ${String(err)}`)
  }
}

async function removeBreakpoint(functionArgsString: string) {
  try {
    const { file, line } = JSON.parse(functionArgsString)
    const allBreakpoints = vscode.debug.breakpoints
    const toRemove: vscode.Breakpoint[] = []

    for (const bp of allBreakpoints) {
      if (bp instanceof vscode.SourceBreakpoint) {
        const thisFile = bp.location.uri.fsPath
        const thisLine = bp.location.range.start.line + 1
        // Compare by absolute or endsWith, depending on your preference
        if (thisFile === file || thisFile.endsWith(file)) {
          if (thisLine === line)
            toRemove.push(bp)
        }
      }
    }

    if (toRemove.length) {
      vscode.debug.removeBreakpoints(toRemove)
      outputChannel.appendLine(`Removed ${toRemove.length} breakpoint(s) at ${file}:${line}`)
      vscode.window.showInformationMessage(`Removed breakpoint at ${file}:${line}`)
    }
    else {
      outputChannel.appendLine(`No breakpoint found at ${file}:${line} to remove.`)
      vscode.window.showWarningMessage(`No breakpoint found at ${file}:${line} to remove.`)
    }
  }
  catch (err) {
    outputChannel.appendLine(`Failed to remove breakpoint: ${String(err)}`)
    vscode.window.showErrorMessage(`Failed to remove breakpoint: ${String(err)}`)
  }
}

export function deactivate() {
  outputChannel.appendLine('LLM Debugger deactivated.')
}

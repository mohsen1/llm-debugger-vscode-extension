import * as path from 'node:path'
import * as vscode from 'vscode'

const outputChannel = vscode.window.createOutputChannel('LLM Debugger')

export async function setBreakpoint(functionArgsString: string) {
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

export async function removeBreakpoint(functionArgsString: string) {
  try {
    const { file, line } = JSON.parse(functionArgsString)
    const allBreakpoints = vscode.debug.breakpoints
    const toRemove: vscode.Breakpoint[] = []

    for (const bp of allBreakpoints) {
      if (bp instanceof vscode.SourceBreakpoint) {
        const thisFile = bp.location.uri.fsPath
        const thisLine = bp.location.range.start.line + 1
        if ((thisFile === file || thisFile.endsWith(file)) && thisLine === line)
          toRemove.push(bp)
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

export async function stepOver() {
  const session = vscode.debug.activeDebugSession
  if (!session) {
    outputChannel.appendLine('Cannot stepOver. No active debug session.')
    return
  }
  try {
    await session.customRequest('next')
    outputChannel.appendLine('Stepped over the current line.')
  }
  catch (err) {
    outputChannel.appendLine(`Failed to step over: ${String(err)}`)
  }
}

export async function stepIn() {
  const session = vscode.debug.activeDebugSession
  if (!session) {
    outputChannel.appendLine('Cannot stepIn. No active debug session.')
    return
  }
  try {
    await session.customRequest('stepIn')
    outputChannel.appendLine('Stepped into the current function call.')
  }
  catch (err) {
    outputChannel.appendLine(`Failed to step in: ${String(err)}`)
  }
}

export async function stepOut() {
  const session = vscode.debug.activeDebugSession
  if (!session) {
    outputChannel.appendLine('Cannot stepOut. No active debug session.')
    return
  }
  try {
    await session.customRequest('stepOut')
    outputChannel.appendLine('Stepped out of the current function call.')
  }
  catch (err) {
    outputChannel.appendLine(`Failed to step out: ${String(err)}`)
  }
}

export async function continueExec() {
  const session = vscode.debug.activeDebugSession
  if (!session) {
    outputChannel.appendLine('Cannot continue. No active debug session.')
    return
  }
  try {
    await session.customRequest('continue')
    outputChannel.appendLine('Continued execution.')
  }
  catch (err) {
    outputChannel.appendLine(`Failed to continue: ${String(err)}`)
  }
}

/**
 * Gathers current breakpoints, stack, and top-level variables.
 */
export async function gatherPausedState(session: vscode.DebugSession) {
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

/**
 * Marks lines in the structured code where breakpoints exist.
 */
export function markBreakpointsInCode(
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
  for (const fileObj of structuredCode) {
    for (const lineObj of fileObj.lines) {
      lineObj.hasBreakpoint = false
    }
  }
  for (const bp of breakpoints) {
    const fileObj = structuredCode.find(sc => sc.filePath === bp.file)
    if (!fileObj)
      continue
    const lineObj = fileObj.lines.find(l => l.lineNumber === bp.line)
    if (lineObj)
      lineObj.hasBreakpoint = true
  }
}

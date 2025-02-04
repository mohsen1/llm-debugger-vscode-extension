import * as path from 'node:path'
import type { ChatCompletion } from 'openai/resources'
import * as vscode from 'vscode'
import { debug, error, info, warn } from './log'

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
  }
  catch (err) {
    error(`Failed to set breakpoint: ${String(err)}`)
    vscode.window.showErrorMessage(`Failed to set breakpoint: ${String(err)}`)
  }
}

export async function removeBreakpoint(functionArgsString: string) {
  debug(`Removing breakpoint: ${functionArgsString}`)
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
      info(`Removed ${toRemove.length} breakpoint(s) at ${file}:${line}`)
      vscode.window.showInformationMessage(`Removed breakpoint at ${file}:${line}`)
    }
    else {
      warn(`No breakpoint found at ${file}:${line} to remove.`)
      vscode.window.showWarningMessage(`No breakpoint found at ${file}:${line} to remove.`)
    }
  }
  catch (err) {
    error(`Failed to remove breakpoint: ${String(err)}`)
    vscode.window.showErrorMessage(`Failed to remove breakpoint: ${String(err)}`)
  }
}

export async function stepOver() {
  debug('Stepping over the current line.')
  const session = vscode.debug.activeDebugSession
  if (!session) {
    debug('Cannot stepOver. No active debug session.')
    return
  }
  try {
    await session.customRequest('next')
    info('Stepped over the current line.')
  }
  catch (err) {
    error(`Failed to step over: ${String(err)}`)
  }
}

export async function stepIn() {
  debug('Stepping into the current function call.')
  const session = vscode.debug.activeDebugSession
  if (!session) {
    debug('Cannot stepIn. No active debug session.')
    return
  }
  try {
    await session.customRequest('stepIn')
    info('Stepped into the current function call.')
  }
  catch (err) {
    error(`Failed to step in: ${String(err)}`)
  }
}

export async function stepOut() {
  const session = vscode.debug.activeDebugSession
  if (!session) {
    debug('Cannot stepOut. No active debug session.')
    return
  }
  try {
    await session.customRequest('stepOut')
    info('Stepped out of the current function call.')
  }
  catch (err) {
    error(`Failed to step out: ${String(err)}`)
  }
}

export async function continueExec() {
  const session = vscode.debug.activeDebugSession
  if (!session) {
    debug('Cannot continue. No active debug session.')
    return
  }
  try {
    await session.customRequest('continue')
    info('Continued execution.')
  }
  catch (err) {
    error(`Failed to continue: ${String(err)}`)
  }
}

export async function handleLlmFunctionCall(completion: ChatCompletion) {
  const choice = completion?.choices?.[0]
  if (!choice) {
    debug(`No choice found in completion. ${JSON.stringify(completion)}`)
    return { shouldContinue: true }
  }

  for (const toolCall of choice.message?.tool_calls || []) {
    const { name, arguments: argsStr } = toolCall.function
    info(`${name}(${argsStr || ''})`)

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
      default:
        break
    }
  }
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

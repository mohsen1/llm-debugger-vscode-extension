import * as vscode from 'vscode'

const outputChannel = vscode.window.createOutputChannel('LLM Debugger')

export function show() {
  outputChannel.show()
}

export function clear() {
  outputChannel.clear()
}

export function debug(...msgs: string[]) {
  outputChannel.appendLine(`DEBUG: ${msgs.join(' ')}`)
}

export function info(...msgs: string[]) {
  outputChannel.appendLine(`INFO: ${msgs.join(' ')}`)
}

export function error(...msgs: string[]) {
  outputChannel.appendLine(`ERROR: ${msgs.join(' ')}`)
}

export function warn(...msgs: string[]) {
  outputChannel.appendLine(`WARN: ${msgs.join(' ')}`)
}

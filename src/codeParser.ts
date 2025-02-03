import * as path from 'node:path'
import fs from 'node:fs'
import * as vscode from 'vscode'

/**
 * Runs `yek` to retrieve a concatenated string of repo code, then splits it into structured lines per file.
 */
export async function gatherWorkspaceCode(): Promise<Array<{
  filePath: string
  lines: Array<{
    lineNumber: number
    text: string
  }>
}>> {
  const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  if (!wsFolder)
    return []

  // Hardcoded for now
  return [
    'array.js',
    'array.test.js',
  ].map(file => ({
    filePath: path.join(wsFolder, file),
    lines: fs.readFileSync(path.join(wsFolder, file), 'utf-8').split('\n').map((text, idx) => ({
      lineNumber: idx + 1,
      text,
    })),
  }))
}

import * as path from "node:path";
import fs from "node:fs";
import * as vscode from "vscode";
import { StructuredCode } from "./types";
import log from "./logger";
/**
 * Runs `yek` to retrieve a concatenated string of repo code, then splits it into structured lines per file.
 */
export function gatherWorkspaceCode(): StructuredCode[] {
  log.debug("gatherWorkspaceCode");
  const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!wsFolder) return [];

  log.debug("wsFolder", wsFolder);
  // Hardcoded for now
  return ["array.js", "array.test.js"].map((file) => ({
    filePath: path.join(wsFolder, file),
    lines: fs
      .readFileSync(path.join(wsFolder, file), "utf-8")
      .split("\n")
      .map((text, idx) => ({
        lineNumber: idx + 1,
        text,
      })),
  }));
}


export function getLaunchConfigs(workspace: vscode.WorkspaceFolder): vscode.DebugConfiguration[] {
  const config = vscode.workspace.getConfiguration("launch", workspace);
  const configurations = config.get<vscode.DebugConfiguration[]>("configurations");
  return configurations ?? [];
}
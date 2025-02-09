import * as path from "node:path";
import fs from "node:fs";
import fsExtra from "fs-extra";
import * as vscode from "vscode";
import { StructuredCode } from "../types";
import log from "../logger";

export class SourceCodeCollector {
    private workspaceFolder: vscode.WorkspaceFolder | undefined;
    constructor(workspaceFolder?: vscode.WorkspaceFolder) {
        this.workspaceFolder = workspaceFolder;
    }

    setWorkspaceFolder(workspaceFolder: vscode.WorkspaceFolder) {
        this.workspaceFolder = workspaceFolder;
    }

    /**
     * Runs `yek` to retrieve a concatenated string of repo code, then splits it into structured lines per file.
     */
    gatherWorkspaceCode(): StructuredCode[] {
        if (!this.workspaceFolder) return [];
        const wsFolder = this.workspaceFolder?.uri.fsPath;
        if (!wsFolder) {
            log.error("No workspace folder found");
            return [];
        }

        // get list of files in the workspace
        // TODO: handle gitignore
        return fsExtra.readdirSync(wsFolder, { withFileTypes: true, recursive: true })
            .filter(dirent => dirent.isFile())
            .map((dirent) => {
                const fullPath = path.join(dirent.parentPath, dirent.name);
                return {
                    filePath: fullPath,
                    lines: fs
                        .readFileSync(fullPath, "utf-8")
                        .split("\n")
                        .map((text, idx) => ({
                            lineNumber: idx + 1,
                            text,
                        })),
                }
            })
    }
}

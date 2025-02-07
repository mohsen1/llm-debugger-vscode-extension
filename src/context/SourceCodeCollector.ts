import * as path from "node:path";
import fs from "node:fs";
import * as vscode from "vscode";
import { StructuredCode } from "../types";
import log from "../logger";

export class SourceCodeCollector {
    private workspaceFolder: vscode.WorkspaceFolder | undefined;
    constructor(workspaceFolder?: vscode.WorkspaceFolder) {
        this.workspaceFolder = workspaceFolder;
    }
    /**
     * Runs `yek` to retrieve a concatenated string of repo code, then splits it into structured lines per file.
     */
    gatherWorkspaceCode(): StructuredCode[] {
        log.debug("gatherWorkspaceCode");
        if (!this.workspaceFolder) return [];
        const wsFolder = this.workspaceFolder?.uri.fsPath;
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
}

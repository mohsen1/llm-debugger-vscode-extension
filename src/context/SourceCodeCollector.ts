import * as path from "node:path";
import fs from "node:fs";
import fsExtra from "fs-extra";
import * as vscode from "vscode";
import { StructuredCode } from "../types";
import { MAX_FILE_BYTES, shouldIncludeFile } from "./fileFilter";
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

        // Collect workspace source, skipping deps, build output, binaries
        // and secrets (api.env/.env must never reach a model prompt).
        const out: StructuredCode[] = [];
        for (const dirent of fsExtra.readdirSync(wsFolder, { withFileTypes: true, recursive: true })) {
            if (!dirent.isFile()) continue;
            const fullPath = path.join(dirent.parentPath, dirent.name);
            if (!shouldIncludeFile(fullPath, wsFolder)) continue;
            try {
                if (fs.statSync(fullPath).size > MAX_FILE_BYTES) continue;
                out.push({
                    filePath: fullPath,
                    lines: fs
                        .readFileSync(fullPath, "utf-8")
                        .split("\n")
                        .map((text, idx) => ({
                            lineNumber: idx + 1,
                            text,
                        })),
                });
            } catch {
                continue; // unreadable file: skip, don't kill the loop
            }
        }
        return out;
    }
}

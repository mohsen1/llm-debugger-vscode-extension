import * as fs from "node:fs";
import * as path from "node:path";

/**
 * File access the loop needs, as a port — so the loop itself imports neither
 * `vscode` nor `node:fs` and can be driven by a fake in unit tests.
 */
export interface WorkspaceFiles {
  /** Absolute path for a name the model produced ("pricing.js", "./src/a.js", an absolute path). */
  resolve(file: string, nearProgram: string): string | null;
  readFile(absPath: string): string | null;
  /** Sibling module names of the program, for the opening plan. */
  listModules(programAbs: string): string[];
  /** Display form, relative to the workspace when possible. */
  shortPath(absPath: string): string;
  lineCount(absPath: string): number;
}

export class NodeWorkspaceFiles implements WorkspaceFiles {
  constructor(private readonly root: string) {}

  resolve(file: string, nearProgram: string): string | null {
    const dir = path.dirname(nearProgram);
    const candidates = [
      path.isAbsolute(file) ? file : null,
      path.join(dir, file),
      path.join(this.root, file),
      path.join(dir, path.basename(file)),
    ].filter((c): c is string => !!c);
    for (const candidate of candidates) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    return null;
  }

  readFile(absPath: string): string | null {
    try {
      return fs.readFileSync(absPath, "utf-8");
    } catch {
      return null;
    }
  }

  listModules(programAbs: string): string[] {
    try {
      return fs
        .readdirSync(path.dirname(programAbs))
        .filter((f) => /\.[cm]?js$/.test(f) && f !== path.basename(programAbs))
        .sort();
    } catch {
      return [];
    }
  }

  shortPath(absPath: string): string {
    if (absPath.startsWith(this.root)) {
      return path.relative(this.root, absPath) || path.basename(absPath);
    }
    return path.basename(absPath);
  }

  lineCount(absPath: string): number {
    const source = this.readFile(absPath);
    return source ? source.split("\n").length : 0;
  }
}

/**
 * Pure include/exclude rules for workspace code collection (no vscode import,
 * so this stays unit-testable). The collector used to ship EVERYTHING to the
 * model — node_modules, .git, build output, and worse, api.env with live keys.
 */

const SKIP_DIRS = new Set([
  "node_modules", ".git", "out", "dist", "build", "coverage",
  ".parcel-cache", ".llm-debugger", ".vscode-test", "target",
  ".next", "__pycache__", ".turbo",
]);

const SKIP_FILES = new Set(["package-lock.json", "pnpm-lock.yaml", "yarn.lock"]);

const SKIP_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".woff", ".woff2",
  ".ttf", ".eot", ".mp4", ".mov", ".vsix", ".map", ".log", ".tgz",
  ".pdf", ".zip", ".node",
]);

const SECRET_BASENAMES = [/^\.env(\.|$)/i, /^api\.env$/i, /\.pem$/i, /\.key$/i];

/** Max file size to include (larger files are build output or bundles). */
export const MAX_FILE_BYTES = 200 * 1024;

export function shouldIncludeFile(absPath: string, workspaceRoot: string): boolean {
  const rel = absPath.startsWith(workspaceRoot + "/")
    ? absPath.slice(workspaceRoot.length + 1)
    : absPath;
  const segments = rel.split("/");
  const base = segments[segments.length - 1];

  // Skip anything inside skipped dirs (but allow .vscode/launch.json etc).
  for (const seg of segments.slice(0, -1)) {
    if (seg === ".vscode") continue;
    if (SKIP_DIRS.has(seg) || seg.startsWith(".")) return false;
  }
  // Skip hidden files except inside .vscode/.
  if (base.startsWith(".") && !segments.includes(".vscode")) return false;
  if (SKIP_FILES.has(base)) return false;
  if (SECRET_BASENAMES.some((re) => re.test(base))) return false;
  const dot = base.lastIndexOf(".");
  if (dot >= 0 && SKIP_EXTENSIONS.has(base.slice(dot).toLowerCase())) return false;
  return true;
}

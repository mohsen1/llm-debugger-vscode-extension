import type {
  BreakpointRef,
  DebugTarget,
  EvaluateResult,
  LaunchOptions,
  PausedState,
  StepKind,
  TargetStatus,
} from "../src/agent/../debug/DebugTarget";
import type { WorkspaceFiles } from "../src/agent/workspace";

/**
 * A scripted debugger. Each entry in `stops` is where the program pauses next;
 * once they run out the session ends — which is what a real program does when
 * it falls off the end, and the loop has to cope with it.
 */
export class FakeDebugTarget implements DebugTarget {
  private index = -1;
  private state: TargetStatus = "idle";
  private bps: BreakpointRef[] = [];
  readonly calls: string[] = [];
  /** Expression -> value; anything else evaluates as undefined. */
  values: Record<string, string> = {};
  /** Model an adapter with nothing bound, to exercise the continue guardrail. */
  reportNoBreakpoints = false;

  constructor(private readonly stops: Array<{ file: string; line: number; name?: string; locals?: Record<string, string> }>) {}

  async launch(_program: string, _options?: LaunchOptions): Promise<TargetStatus> {
    this.calls.push("launch");
    this.index = 0;
    this.state = this.stops.length > 0 ? "paused" : "ended";
    return this.state;
  }

  async setBreakpoint(file: string, line: number) {
    this.calls.push(`setBreakpoint ${file}:${line}`);
    this.bps.push({ file, line });
    return { verified: true, line };
  }

  async removeBreakpoint(file: string, line: number) {
    this.bps = this.bps.filter((b) => !(b.file === file && b.line === line));
  }

  async clearOwnedBreakpoints() {
    this.bps = [];
  }

  ownedBreakpoints(): BreakpointRef[] {
    return this.reportNoBreakpoints ? [] : [...this.bps];
  }

  status(): TargetStatus {
    return this.state;
  }

  async paused(): Promise<PausedState | null> {
    if (this.state !== "paused") return null;
    const stop = this.stops[this.index];
    if (!stop) return null;
    return {
      reason: "breakpoint",
      threadId: 1,
      frames: [{ id: 1, name: stop.name ?? "fn", source: stop.file, line: stop.line, column: 1 }],
      scopes: [
        {
          name: "Local",
          vars: Object.entries(stop.locals ?? {}).map(([name, value]) => ({ name, value })),
        },
      ],
      focus: `# ${stop.file}\n> ${stop.line}| (source)`,
    };
  }

  async step(kind: StepKind): Promise<TargetStatus> {
    this.calls.push(`step ${kind}`);
    this.index++;
    this.state = this.index < this.stops.length ? "paused" : "ended";
    return this.state;
  }

  async evaluate(expression: string): Promise<EvaluateResult> {
    this.calls.push(`evaluate ${expression}`);
    if (this.state !== "paused") return { ok: false, value: "not paused" };
    return { ok: true, value: this.values[expression] ?? "undefined" };
  }

  output() {
    return { stdout: "", stderr: "" };
  }

  async waitForStop(): Promise<boolean> {
    return this.state === "paused";
  }

  async stop(): Promise<void> {
    this.calls.push("stop");
    this.state = "ended";
    this.bps = [];
  }
}

/** In-memory workspace: `files` maps absolute-ish path -> source. */
export class FakeWorkspaceFiles implements WorkspaceFiles {
  constructor(private readonly files: Record<string, string>) {}

  resolve(file: string): string | null {
    if (this.files[file] !== undefined) return file;
    const hit = Object.keys(this.files).find((f) => f.endsWith(`/${file}`) || f === file);
    return hit ?? null;
  }

  readFile(absPath: string): string | null {
    return this.files[absPath] ?? null;
  }

  listModules(): string[] {
    return Object.keys(this.files);
  }

  shortPath(absPath: string): string {
    return absPath.split("/").pop() ?? absPath;
  }

  lineCount(absPath: string): number {
    const source = this.files[absPath];
    return source ? source.split("\n").length : 0;
  }
}

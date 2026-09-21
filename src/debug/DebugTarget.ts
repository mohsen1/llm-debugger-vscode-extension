/**
 * The debugger surface the agent loop is allowed to touch.
 *
 * The loop is written against this interface and nothing else, so its decision
 * logic can be exercised against a fake target in milliseconds instead of only
 * through a real Extension Development Host.
 */

export type StepKind = "next" | "in" | "out" | "continue";
export type TargetStatus = "idle" | "running" | "paused" | "ended";

export interface Frame {
  id: number;
  name: string;
  /** Absolute path when the adapter knows one, else the source name. */
  source: string;
  line: number;
  column: number;
}

export interface Scope {
  name: string;
  vars: Array<{ name: string; value: string; type?: string }>;
}

export interface PausedState {
  reason: string;
  threadId: number;
  frames: Frame[];
  /** Local/closure scopes of the top frame. */
  scopes: Scope[];
  /** Numbered source excerpt around the top frame. */
  focus?: string;
}

export interface BreakpointRef {
  file: string;
  line: number;
}

export interface LaunchOptions {
  /** Pause before the first user statement. Off by default: the agent's own
   * breakpoints decide where it stops, and a program that never hits one is a
   * real result the loop has to handle. */
  stopOnEntry?: boolean;
  cwd?: string;
  args?: string[];
}

export interface EvaluateResult {
  ok: boolean;
  /** The rendered value, or the adapter's error message when `ok` is false. */
  value: string;
}

export interface DebugTarget {
  launch(program: string, options?: LaunchOptions): Promise<TargetStatus>;
  /** Resolves once the adapter reports the breakpoint bound (or refused it). */
  setBreakpoint(file: string, line: number): Promise<{ verified: boolean; line: number }>;
  removeBreakpoint(file: string, line: number): Promise<void>;
  /** Only breakpoints this target created — the user's own dots are never touched. */
  clearOwnedBreakpoints(): Promise<void>;
  ownedBreakpoints(): BreakpointRef[];

  status(): TargetStatus;
  /** Null unless currently paused. */
  paused(): Promise<PausedState | null>;
  step(kind: StepKind, timeoutMs?: number): Promise<TargetStatus>;
  /** Evaluate an expression in a paused frame (defaults to the top frame). */
  evaluate(expression: string, frameId?: number): Promise<EvaluateResult>;

  output(): { stdout: string; stderr: string };
  /** True if a pause happened within the timeout; false if it ended or timed out. */
  waitForStop(timeoutMs: number): Promise<boolean>;
  stop(): Promise<void>;
}

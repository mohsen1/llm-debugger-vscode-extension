import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import logger from "../logger";
import type {
  BreakpointRef,
  DebugTarget,
  EvaluateResult,
  Frame,
  LaunchOptions,
  PausedState,
  Scope,
  StepKind,
  TargetStatus,
} from "./DebugTarget";

const log = logger.createSubLogger("DebugTarget");

/** Stamped on the launch config we create. See `owns()` for why that is not enough on its own. */
export const AGENT_MODE_FLAG = "llmDebuggerAgentMode";

/** js-debug reports its own DAP plumbing through `output` events; never surface it. */
const ADAPTER_NOISE = /js-debug|dap\/operation|cdp\/operation|operationjs-debug/i;

const MAX_VARS_PER_SCOPE = 40;
const MAX_VALUE_CHARS = 240;
/**
 * Scope names are adapter-authored prose — js-debug answers "Local: rankTotals",
 * not "Local" — so matching them exactly silently drops every local variable.
 * The DAP `presentationHint` is the contract; the prefixes are the fallback for
 * adapters that do not set it.
 */
const SCOPE_PREFIXES = ["local", "closure", "block", "catch", "exception"];

function isInterestingScope(scope: { name?: string; presentationHint?: string; expensive?: boolean }): boolean {
  // "Module" and "Global" come back marked expensive and hold hundreds of
  // entries; they are never what a paused-frame snapshot wants.
  if (scope.expensive) return false;
  if (scope.presentationHint === "locals" || scope.presentationHint === "arguments") return true;
  const name = (scope.name ?? "").toLowerCase();
  return SCOPE_PREFIXES.some((p) => name.startsWith(p));
}

type StopWaiter = (paused: boolean) => void;

/**
 * Drives one visible Node debug session through the real VSCode debugger.
 *
 * Session ownership is the whole game here. A `node` launch produces a parent
 * js-debug session that owns no threads plus a child session that actually runs
 * the program: `stopped` arrives on the CHILD, `threads` on the parent answers
 * "No debugger available", and the child's `configuration` does not carry the
 * parent's custom fields. Selecting the session by its own config flag — or by
 * "first session wins" — therefore latches onto the one session that never
 * pauses, which looks exactly like a debugger that refuses to stop.
 *
 * So: ownership is decided by walking `parentSession`, and the session that
 * emits `stopped` is the one every subsequent request is sent to. With that in
 * place no polling, entry-breakpoint synthesis or fixed sleeps are needed.
 */
export class VscodeDebugTarget implements DebugTarget {
  /** Bumped on every launch; trackers from an older run are ignored. */
  private generation = 0;
  private ownedSessionIds = new Set<string>();
  private liveSessions = new Map<string, vscode.DebugSession>();
  private rootSession: vscode.DebugSession | null = null;
  private pausedSession: vscode.DebugSession | null = null;
  private threadId: number | undefined;
  private stopReason = "";
  /** Top frame of the current pause; invalid as soon as execution resumes. */
  private topFrameId: number | undefined;
  private state: TargetStatus = "idle";
  private stopWaiters: StopWaiter[] = [];
  private breakpointWaiters: Array<(body: unknown) => void> = [];
  private ownedBps: vscode.SourceBreakpoint[] = [];
  private stdout = "";
  private stderr = "";
  /** Adapter events seen this run, for diagnosing a session that will not pause. */
  private events: string[] = [];

  /** Installs the adapter tracker. Call once from `activate`. */
  register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.debug.registerDebugAdapterTrackerFactory("*", {
        createDebugAdapterTracker: (session) => {
          if (!this.owns(session)) return undefined;
          const generation = this.generation;
          this.ownedSessionIds.add(session.id);
          this.liveSessions.set(session.id, session);
          if (!this.rootSession) this.rootSession = session;
          return {
            onDidSendMessage: (m: DapMessage) => {
              // A session torn down at the end of one hunt can still emit while
              // the next one is launching; without this its `terminated` would
              // end the new run before it started.
              if (generation !== this.generation) return;
              this.onAdapterMessage(session, m);
            },
          };
        },
      }),
      vscode.debug.onDidTerminateDebugSession((session) => {
        if (!this.ownedSessionIds.has(session.id)) return;
        this.liveSessions.delete(session.id);
        if (this.pausedSession?.id === session.id) this.pausedSession = null;
        if (this.liveSessions.size === 0) this.markEnded();
      }),
    );
  }

  /**
   * True when `session` is our launch or any descendant of it. The id set is
   * consulted first so deep trees resolve even if a parent link is missing by
   * the time a grandchild's tracker is created — parents are always claimed
   * before their children start.
   */
  private owns(session: vscode.DebugSession): boolean {
    for (let s: vscode.DebugSession | undefined = session; s; s = s.parentSession) {
      if (this.ownedSessionIds.has(s.id)) return true;
      if (s.configuration?.[AGENT_MODE_FLAG]) return true;
    }
    return false;
  }

  private onAdapterMessage(session: vscode.DebugSession, message: DapMessage): void {
    if (message.type !== "event") return;
    // `loadedSource` fires once per module and would bury everything else.
    if (this.events.length < 200 && message.event !== "output" && message.event !== "loadedSource") {
      const role = session.parentSession ? "child" : "root";
      const detail = message.event === "stopped" ? `:${message.body?.reason ?? "?"}` : "";
      this.events.push(`${role}/${message.event}${detail}`);
    }
    switch (message.event) {
      case "stopped":
        this.pausedSession = session;
        this.threadId = message.body?.threadId ?? this.threadId;
        this.stopReason = message.body?.reason || "pause";
        this.state = "paused";
        this.resolveStopWaiters(true);
        break;
      case "continued":
        if (this.state === "paused" && this.pausedSession?.id === session.id) {
          this.state = "running";
        }
        break;
      case "output":
        this.captureOutput(message.body?.category, message.body?.output);
        break;
      case "breakpoint": {
        const waiters = this.breakpointWaiters;
        this.breakpointWaiters = [];
        for (const w of waiters) w(message.body?.breakpoint);
        break;
      }
      default:
        break;
    }
  }

  private captureOutput(category: string | undefined, text: string | undefined): void {
    if (!text || ADAPTER_NOISE.test(text)) return;
    if (category === "stderr") this.stderr = (this.stderr + text).slice(-8192);
    else if (category === "stdout" || category === "console") this.stdout = (this.stdout + text).slice(-8192);
  }

  private markEnded(): void {
    this.state = "ended";
    this.pausedSession = null;
    this.resolveStopWaiters(false);
  }

  private resolveStopWaiters(paused: boolean): void {
    const waiters = this.stopWaiters;
    this.stopWaiters = [];
    for (const w of waiters) w(paused);
  }

  /** Register interest in the next stop BEFORE issuing the request that causes it. */
  private nextStop(timeoutMs: number): Promise<boolean> {
    if (this.state === "paused") return Promise.resolve(true);
    if (this.state === "ended") return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      const done = (paused: boolean) => {
        clearTimeout(timer);
        resolve(paused);
      };
      const timer = setTimeout(() => {
        this.stopWaiters = this.stopWaiters.filter((w) => w !== done);
        resolve(this.state === "paused");
      }, timeoutMs);
      this.stopWaiters.push(done);
    });
  }

  status(): TargetStatus {
    return this.state;
  }

  output(): { stdout: string; stderr: string } {
    return { stdout: this.stdout, stderr: this.stderr };
  }

  /** Adapter events seen since the last launch, plus the config as launched. */
  trace(): {
    events: string[];
    configuration: Record<string, unknown> | null;
    diagnostics: Record<string, unknown>;
  } {
    const root = this.rootSession;
    return {
      events: [...this.events],
      configuration: root ? (root.configuration as unknown as Record<string, unknown>) : null,
      diagnostics: { ...this.diagnostics, threadId: this.threadId, state: this.state },
    };
  }

  /** Raw shapes of the last state requests, for when a snapshot comes back thin. */
  private diagnostics: Record<string, unknown> = {};

  waitForStop(timeoutMs: number): Promise<boolean> {
    return this.nextStop(timeoutMs);
  }

  async launch(program: string, options: LaunchOptions = {}): Promise<TargetStatus> {
    // Tear down a leftover session WITHOUT touching breakpoints: callers set
    // theirs before launching, and the public stop() clears owned ones.
    if (this.state === "running" || this.state === "paused") await this.endSession();
    const folder = vscode.workspace.workspaceFolders?.[0];
    const absProgram = path.isAbsolute(program)
      ? program
      : path.join(folder?.uri.fsPath || process.cwd(), program);
    if (!fs.existsSync(absProgram)) throw new Error(`Program not found: ${absProgram}`);

    this.resetRun();
    this.state = "running";
    // Registered before startDebugging so a stop that lands during launch is
    // never missed; resolves early on termination, so no sleep is involved.
    const stopped = this.nextStop(options.stopOnEntry ? 30000 : 60000);
    const started = await vscode.debug.startDebugging(folder, {
      type: "node",
      request: "launch",
      name: "LLM Debugger",
      program: absProgram,
      cwd: options.cwd || path.dirname(absProgram),
      args: options.args ?? [],
      console: "internalConsole",
      stopOnEntry: options.stopOnEntry ?? false,
      // Stepping into node's own module loader burns a hunt's step budget.
      skipFiles: ["<node_internals>/**"],
      [AGENT_MODE_FLAG]: true,
    });
    if (!started) {
      this.resolveStopWaiters(false);
      this.state = "idle";
      throw new Error("startDebugging was refused (is another session running?)");
    }
    await stopped;
    return this.state;
  }

  async setBreakpoint(file: string, line: number): Promise<{ verified: boolean; line: number }> {
    const abs = this.resolve(file);
    const bp = new vscode.SourceBreakpoint(
      new vscode.Location(vscode.Uri.file(abs), new vscode.Position(Math.max(0, line - 1), 0)),
      true,
    );
    // Before launch there is no adapter to verify against; js-debug binds
    // pre-registered breakpoints at launch, so this is not a wait worth having.
    if (this.liveSessions.size === 0) {
      vscode.debug.addBreakpoints([bp]);
      this.ownedBps.push(bp);
      return { verified: false, line };
    }
    const verification = new Promise<{ verified: boolean; line: number }>((resolve) => {
      const timer = setTimeout(() => {
        this.breakpointWaiters = this.breakpointWaiters.filter((w) => w !== done);
        resolve({ verified: false, line });
      }, 2000);
      const done = (body: unknown) => {
        clearTimeout(timer);
        const b = body as { verified?: boolean; line?: number } | undefined;
        resolve({ verified: !!b?.verified, line: b?.line ?? line });
      };
      this.breakpointWaiters.push(done);
    });
    vscode.debug.addBreakpoints([bp]);
    this.ownedBps.push(bp);
    return verification;
  }

  async removeBreakpoint(file: string, line: number): Promise<void> {
    const abs = this.resolve(file);
    const doomed = this.ownedBps.filter(
      (b) => b.location.uri.fsPath === abs && b.location.range.start.line + 1 === line,
    );
    if (doomed.length === 0) return;
    vscode.debug.removeBreakpoints(doomed);
    this.ownedBps = this.ownedBps.filter((b) => !doomed.includes(b));
  }

  async clearOwnedBreakpoints(): Promise<void> {
    if (this.ownedBps.length === 0) return;
    try {
      vscode.debug.removeBreakpoints(this.ownedBps);
    } catch (err) {
      log.warn(`could not remove breakpoints: ${String(err).slice(0, 160)}`);
    }
    this.ownedBps = [];
  }

  ownedBreakpoints(): BreakpointRef[] {
    return this.ownedBps.map((b) => ({
      file: b.location.uri.fsPath,
      line: b.location.range.start.line + 1,
    }));
  }

  async paused(): Promise<PausedState | null> {
    const session = this.pausedSession;
    if (!session || this.state !== "paused") return null;
    const threadId = await this.resolveThreadId(session);
    if (threadId === undefined) return null;
    try {
      const st = await session.customRequest("stackTrace", { threadId, startFrame: 0, levels: 20 });
      const frames: Frame[] = (st?.stackFrames ?? []).map((f: DapFrame) => ({
        id: f.id,
        name: f.name,
        source: f.source?.path || f.source?.name || "<unknown>",
        line: f.line,
        column: f.column,
      }));
      this.diagnostics.frameIds = frames.map((f) => f.id);
      this.topFrameId = frames[0]?.id;
      const scopes = frames.length > 0 ? await this.readScopes(session, frames[0].id) : [];
      return {
        reason: this.stopReason,
        threadId,
        frames,
        scopes,
        focus: readFocus(frames[0]),
      };
    } catch (err) {
      log.warn(`paused() failed: ${String(err).slice(0, 200)}`);
      return null;
    }
  }

  private async readScopes(session: vscode.DebugSession, frameId: number): Promise<Scope[]> {
    const out: Scope[] = [];
    const res = await session.customRequest("scopes", { frameId });
    const offered: string[] = (res?.scopes ?? []).map((s: { name: string }) => s.name);
    this.diagnostics.scopesFrameId = frameId;
    this.diagnostics.scopesOffered = offered;
    this.diagnostics.scopesRaw = JSON.stringify(res ?? null).slice(0, 600);
    for (const scope of res?.scopes ?? []) {
      if (!isInterestingScope(scope)) continue;
      try {
        const vars = await session.customRequest("variables", {
          variablesReference: scope.variablesReference,
        });
        out.push({
          name: scope.name,
          vars: (vars?.variables ?? []).slice(0, MAX_VARS_PER_SCOPE).map((v: DapVariable) => ({
            name: v.name,
            value: String(v.value ?? "").slice(0, MAX_VALUE_CHARS),
            ...(v.type ? { type: v.type } : {}),
          })),
        });
      } catch {
        /* a scope that refuses to expand is not worth failing the snapshot over */
      }
    }
    return out;
  }

  async step(kind: StepKind, timeoutMs = 20000): Promise<TargetStatus> {
    const session = this.pausedSession;
    if (!session || this.state !== "paused") {
      throw new Error(`cannot step while ${this.state}`);
    }
    const threadId = await this.resolveThreadId(session);
    if (threadId === undefined) throw new Error("no paused thread to step");
    const request =
      kind === "in" ? "stepIn" : kind === "out" ? "stepOut" : kind === "next" ? "next" : "continue";
    // Order matters: nextStop() short-circuits on the CURRENT status, so the
    // state has to leave "paused" before the waiter is registered or it
    // resolves immediately and the step looks like it never stopped.
    this.state = "running";
    this.topFrameId = undefined;
    const stopped = this.nextStop(timeoutMs);
    try {
      await session.customRequest(request, { threadId });
    } catch (err) {
      // `continue` that runs to exit legitimately rejects as the session goes
      // away; termination resolves the waiter, so let it play out either way.
      log.debug(`${request} rejected: ${String(err).slice(0, 160)}`);
    }
    await stopped;
    return this.state;
  }

  async evaluate(expression: string, frameId?: number): Promise<EvaluateResult> {
    const session = this.pausedSession;
    if (!session || this.state !== "paused") return { ok: false, value: `not paused (${this.state})` };
    // The loop reads state before every decision, so the top frame id is
    // almost always already known — re-deriving it costs three DAP round trips
    // per evaluate, which adds up over a long hunt.
    let targetFrame = frameId ?? this.topFrameId;
    if (targetFrame === undefined) {
      const state = await this.paused();
      targetFrame = state?.frames[0]?.id;
    }
    if (targetFrame === undefined) return { ok: false, value: "no frame to evaluate in" };
    try {
      const res = await session.customRequest("evaluate", {
        expression,
        frameId: targetFrame,
        context: "repl",
      });
      return { ok: true, value: String(res?.result ?? "").slice(0, 2000) };
    } catch (err) {
      return { ok: false, value: String(err).replace(/^Error:\s*/, "").slice(0, 400) };
    }
  }

  async stop(): Promise<void> {
    await this.endSession();
    await this.clearOwnedBreakpoints();
    this.state = "ended";
  }

  /** Terminate the session tree and reset run state, leaving breakpoints alone. */
  private async endSession(): Promise<void> {
    const root = this.rootSession;
    if (root) {
      try {
        await vscode.debug.stopDebugging(root);
      } catch (err) {
        log.debug(`stopDebugging: ${String(err).slice(0, 160)}`);
      }
    }
    // The next launch must not race a half-torn-down adapter; this is the one
    // place a bounded wait is genuinely needed, and it watches real state.
    await this.waitUntilTerminated(8000);
    this.resetRun();
    this.state = "ended";
  }

  private async waitUntilTerminated(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.liveSessions.size > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  private resetRun(): void {
    this.generation++;
    this.resolveStopWaiters(false);
    this.topFrameId = undefined;
    this.ownedSessionIds.clear();
    this.liveSessions.clear();
    this.rootSession = null;
    this.pausedSession = null;
    this.threadId = undefined;
    this.stopReason = "";
    this.stdout = "";
    this.stderr = "";
    this.events = [];
    this.state = "idle";
  }

  /** The stopped event carries the thread; fall back to asking the paused session. */
  private async resolveThreadId(session: vscode.DebugSession): Promise<number | undefined> {
    if (this.threadId !== undefined) return this.threadId;
    try {
      const res = await session.customRequest("threads");
      const threads = res?.threads ?? [];
      if (threads.length > 0) this.threadId = threads[0].id;
    } catch (err) {
      log.warn(`threads request failed: ${String(err).slice(0, 160)}`);
    }
    return this.threadId;
  }

  private resolve(file: string): string {
    if (path.isAbsolute(file)) return file;
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
    return path.join(folder, file);
  }
}

/** ~24 numbered lines around the top frame — enough to reason about, small enough to send. */
function readFocus(frame?: Frame): string | undefined {
  if (!frame?.source || !path.isAbsolute(frame.source)) return undefined;
  try {
    if (!fs.existsSync(frame.source)) return undefined;
    const lines = fs.readFileSync(frame.source, "utf-8").split("\n");
    const from = Math.max(0, frame.line - 12);
    const to = Math.min(lines.length, frame.line + 12);
    const body = lines
      .slice(from, to)
      .map((text, i) => `${from + i + 1 === frame.line ? ">" : " "} ${String(from + i + 1).padStart(3)}| ${text}`);
    return [`# ${path.basename(frame.source)} lines ${from + 1}-${to}`, ...body].join("\n").slice(0, 3000);
  } catch {
    return undefined;
  }
}

interface DapMessage {
  type: string;
  event?: string;
  body?: {
    reason?: string;
    threadId?: number;
    category?: string;
    output?: string;
    breakpoint?: { verified?: boolean; line?: number };
  };
}

interface DapFrame {
  id: number;
  name: string;
  line: number;
  column: number;
  source?: { path?: string; name?: string };
}

interface DapVariable {
  name: string;
  value?: string;
  type?: string;
}

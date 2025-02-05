import * as vscode from "vscode";
import {
  breakpointFunctions,
  callLlm,
  ChatWithHistory,
  debugFunctions,
  debugLoopSystemMessage,
} from "./chatTools";
import { gatherWorkspaceCode } from "./codeParser";
import { handleLlmFunctionCall, markBreakpointsInCode } from "./debugActions";
import { getInitialBreakpointsMessage, getPausedMessage } from "./prompts";
import type { StructuredCode } from "./types";
import log from "./log";
import { gatherPausedState } from "./state";
import { Thread } from "@vscode/debugadapter";

let structuredCode: StructuredCode[] = [];

async function setupInitialBreakpoints() {
  structuredCode = gatherWorkspaceCode();

  // Clear all breakpoints
  await vscode.debug.removeBreakpoints(
    vscode.debug.breakpoints.filter((breakpoint) => breakpoint.enabled)
  );

  const initialResponse = await callLlm(
    getInitialBreakpointsMessage(structuredCode),
    breakpointFunctions
  );
  await handleLlmFunctionCall(initialResponse);
}

async function getPausedState(session: vscode.DebugSession) {
  try {
    const pausedState = await gatherPausedState(session);
    markBreakpointsInCode(structuredCode, pausedState.breakpoints);
    return pausedState;
  } catch (error) {
    log.error("Error gathering paused state", String(error));
    return null;
  }
}

class DebugLoopController {
  #live = false;
  // #currentThreadId: number | undefined; // TODO: add threadId for multi-threaded debugging
  #chatWithHistory = new ChatWithHistory(debugLoopSystemMessage, [...debugFunctions, ...breakpointFunctions]);

  async #loop(session: vscode.DebugSession) {
    if (!session || !this.#live) {
      log.debug("Not looping", JSON.stringify({ session, live: this.#live }));
      return;
    };
    
    const pausedState = await getPausedState(session);
    log.debug("Paused state", JSON.stringify(pausedState));

    log.ai("Thinking...");
    const llmResponse = await this.#chatWithHistory.ask(
      getPausedMessage(structuredCode, pausedState)
    );
    if (llmResponse.choices[0].message.content) {
      log.ai(llmResponse.choices[0].message.content);
    }
    await handleLlmFunctionCall(llmResponse);

    const activeDebugSession = vscode.debug.activeDebugSession;
    if (!activeDebugSession) {
      log.debug("No active debug session found.");
      return;
    }
    if (this.#live) {
      this.#loop(activeDebugSession);
    }
  }

  finish() {
    this.#live = false;
    this.#chatWithHistory.ask("Debug session finished. Provide a code fix and explain your reasoning.", {withFunctions: false});
  }

  stop() {
    this.#live = false;
  }

  async start(session: vscode.DebugSession) {
    // this.#currentThreadId = threadId;
    
    if (!this.#live) {
      this.#live = true;
      return this.#loop(session);
    }
  }
}
const debugLoopController = new DebugLoopController();

vscode.debug.onDidTerminateDebugSession(() => {
  debugLoopController.stop();
});

class DebugAdapterTracker implements vscode.DebugAdapterTracker {
  private session: vscode.DebugSession;

  constructor(session: vscode.DebugSession) {
    this.session = session;
  }

  onWillStartSession(): void {
    // log.debug("Debug session starting");
  }

  onWillStopSession(): void {
    debugLoopController.finish();
  }

  async onDidSendMessage(message: { type: string; command: string; body: unknown }): Promise<void> {
    // Log everything for visibility

    // Capture "threads" response
    if (message.type === "response" && message.command === "threads") {
      const body = message.body as { threads: Thread[] };
      const threads = body.threads || [];
      if (threads.length > 0) {
        await debugLoopController.start(this.session);
      }
    }
  }

  onError(error: Error): void {
    log.error("Debug adapter error:", error.message);
  }

  onExit(code: number | undefined, signal: string | undefined): void {
    log.debug(`Debug adapter exit - code: ${code}, signal: ${signal}`);
  }
}

// We’ll keep track of newly created trackers in a map so we can query them later.
const trackerMap = new Map<string, DebugAdapterTracker>();

async function startLLMDebug() {
  try {
    log.debug("Setting initial breakpoints");
    await setupInitialBreakpoints();

    log.debug("Starting debug session");
    const started = await vscode.debug.startDebugging(undefined, {
      type: "node",
      request: "launch",
      name: "LLM Debugger (Dynamic)",
      stopOnEntry: true,
      program: "${workspaceFolder}/array.test.js",
      env: { NODE_ENV: "test" },
    });

    if (!started) {
      throw new Error("Failed to start the debug session");
    }
  } catch (error) {
    log.error(`LLM Debug failed: ${String(error)}`);
    log.show();
    vscode.window.showErrorMessage(`LLM Debugger error: ${String(error)}`);
  }
}


export function activate(context: vscode.ExtensionContext) {
  log.clear();
  log.debug("LLM Debugger activated.");
  log.show();

  // Register a tracker factory. For an internal debug type, put "node",
  // or for all debug sessions, use '*'.
  const debugTrackerFactory = vscode.debug.registerDebugAdapterTrackerFactory("*", {
    createDebugAdapterTracker(session: vscode.DebugSession) {
      log.debug(`Creating debug tracker for session: ${session.name}`);
      const tracker = new DebugAdapterTracker(session);
      trackerMap.set(session.id, tracker);
      return tracker;
    }
  });

  const command = vscode.commands.registerCommand(
    "llm-debugger.startLLMDebug",
    startLLMDebug
  );

  context.subscriptions.push(command, debugTrackerFactory);
}

export function deactivate() {
  log.debug("LLM Debugger deactivated.");
}
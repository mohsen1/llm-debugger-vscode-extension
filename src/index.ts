import * as vscode from "vscode";
import { breakpointFunctions, callLlm, debugFunctions } from "./chatTools";
import { gatherWorkspaceCode } from "./codeParser";
import { handleLlmFunctionCall, markBreakpointsInCode } from "./debugActions";
import { getInitialBreakpointsMessage, getPausedMessage } from "./prompts";
import type { StructuredCode } from "./types";
import log from "./log";
import { gatherPausedState } from "./state";

// Store the structured code so we can annotate breakpoints on it whenever we pause
const structuredCode: StructuredCode[] = [];

async function setupInitialBreakpoints() {
  const structuredCode = await gatherWorkspaceCode();

  // Clearn all breakpoints (TODO: this should not be in the final implementation)
  await vscode.debug.removeBreakpoints(
    vscode.debug.breakpoints.filter((breakpoint) => breakpoint.enabled),
  );

  const initialResponse = await callLlm(
    getInitialBreakpointsMessage(structuredCode),
    breakpointFunctions,
  );
  await handleLlmFunctionCall(initialResponse);
}

class DebugLoopController {
  #live = false;
  #currentThreadId: number | undefined;

  async #loop(session: vscode.DebugSession) {
    if (!session || !this.#live) {
      return;
    }

    const pausedState = await gatherPausedState(session, this.#currentThreadId);
    markBreakpointsInCode(structuredCode, pausedState.breakpoints);

    log.ai("Sending paused state to LLM.");
    const pausedResponse = await callLlm(
      getPausedMessage(structuredCode, pausedState),
      debugFunctions,
    );

    await handleLlmFunctionCall(pausedResponse);
    log.debug("LLM function call handled.");

    const activeDebugSession = vscode.debug.activeDebugSession;
    if (!activeDebugSession) {
      log.debug("No active debug session found.");
      return;
    }
    if (this.#live) {
      this.#loop(activeDebugSession);
    }
  }

  stop() {
    this.#live = false;
  }

  start(session: vscode.DebugSession, threadId: number) {
    this.#currentThreadId = threadId;
    this.#live = true;
    return this.#loop(session);
  }
}
const debugLoopController = new DebugLoopController();

const disposable = vscode.debug.registerDebugAdapterTrackerFactory("*", {
  createDebugAdapterTracker(session: vscode.DebugSession) {
    return {
      async onWillStartSession() {
        if (session.parentSession) {
          log.debug("onWillStartSession", session.id, " now setting initial breakpoints");
          await setupInitialBreakpoints();
        }
      },

      onWillStopSession() {
        // debugLoopController.stop();
      },

      onError(error: Error) {
        log.error("DebugAdapterTracker error on session", session.id)
        log.error(String(error))
      },

      onDidSendMessage: async (message: {
        event: string;
        body: { threadId: number; reason: string };
      }) => {
        if (message.event === "stopped") {
          const { threadId, reason } = message.body;
          if (threadId !== undefined && reason === "entry") {
            log.debug("Starting debug loop controller");
            debugLoopController.start(session, threadId);
          }
        }
      },
    };
  }
});

// If the session ends, we can do any cleanup
vscode.debug.onDidTerminateDebugSession(() => {
  disposable.dispose();
  debugLoopController.stop();
});

function startDebugging() {
  log.clear();
  log.show();
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    log.error("No workspace folder found");
    return;
  }
  log.debug("Launching the debug session on", workspaceFolder.uri.fsPath);
  const started = vscode.debug.startDebugging(undefined, {
    type: "node",
    request: "launch",
    name: "LLM Debugger (Dynamic)",
    stopOnEntry: true,
    program: "${workspaceFolder}/array.test.js",
    env: { NODE_ENV: "test" },
  });

  if (!started) {
    log.error("Failed to start the debug session");
    log.show();
    return;
  }
}

export function activate(context: vscode.ExtensionContext) {
  log.debug("LLM Debugger activated.");
  const command = vscode.commands.registerCommand(
    "llm-debugger.startLLMDebug",
    startDebugging,
  );
  context.subscriptions.push(command);
}

export function deactivate() {
  log.debug("LLM Debugger deactivated.");
}

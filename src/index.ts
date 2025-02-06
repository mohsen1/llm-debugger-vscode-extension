import * as vscode from "vscode";
import { DebugLoopController } from "./debug/DebugLoopController";
import { DebugAdapterTracker } from "./debug/DebugAdapterTracker";
import { gatherWorkspaceCode } from "./utils";
import log from "./logger";

import type { LogEntry } from "./logger";
import { llmDebuggerSidebarProvider } from "./views/SidebarView";

const debugLoopController = new DebugLoopController();

export async function activate(context: vscode.ExtensionContext) {
  
  try {
    // Restore persisted logs
    const storedLogs = context.workspaceState.get<LogEntry[]>("llmDebuggerLogs", []);
    
  // Register debug command
  const startCommand = vscode.commands.registerCommand(
    "llm-debugger.startLLMDebug",
    async () => {

      log.show();
      debugLoopController.reset();
      await debugLoopController.setInitialBreakpoints();
      const code = gatherWorkspaceCode();
      debugLoopController.setCode(code);
      await debugLoopController.start();
      await vscode.debug.startDebugging(undefined, {
        type: "node",
        request: "launch",
        name: "LLM Debugger (Dynamic)",
        stopOnEntry: true,
        program: "${workspaceFolder}/array.test.js",
        env: { NODE_ENV: "test" },
        internalConsoleOptions: "neverOpen",
        openDebug: "neverOpen"
      });
      log.show()
    },
  );
  const sidebarProvider = new llmDebuggerSidebarProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("llmDebuggerSidebar.view", sidebarProvider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    })
  );

  // Set up logger with restored logs
  log.setSidebarProvider(sidebarProvider);
  log.loadPersistedLogs(storedLogs);

  log.debug("Activated");

  // Register debug tracker so we can handle events like "stopped"
  vscode.debug.registerDebugAdapterTrackerFactory("*", {
    createDebugAdapterTracker(session) {
      return new DebugAdapterTracker(session, debugLoopController);
    },
  });


  // Save logs when debug session ends
  debugLoopController.on("finished", () => {
      context.workspaceState.update("llmDebuggerLogs", log.getPersistedLogs());
    });

    context.subscriptions.push(startCommand);
  } catch (error) {
    log.error("Failed to activate", String(error));
  }
}

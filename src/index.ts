import * as vscode from "vscode";
import { DebugLoopController } from "./DebugLoopController";
import { DebugAdapterTracker } from "./DebugAdapterTracker";
import { gatherWorkspaceCode } from "./codeParser";
import log from "./log";
import { llmDebuggerSidebarProvider } from "./SidebarView";

const debugLoopController = new DebugLoopController();

export async function activate(context: vscode.ExtensionContext) {
  // Register debug tracker so we can handle events like "stopped"
  vscode.debug.registerDebugAdapterTrackerFactory("*", {
    createDebugAdapterTracker(session) {
      return new DebugAdapterTracker(session, debugLoopController);
    },
  });

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
      });
      log.show()
    },
  );

  context.subscriptions.push(startCommand);

  const sidebarProvider = new llmDebuggerSidebarProvider();
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("llmDebuggerSidebar.view", sidebarProvider)
  );
}

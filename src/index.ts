
import * as vscode from "vscode";
import { DebugLoopController } from "./DebugLoopController";
import { DebugAdapterTracker } from "./DebugAdapterTracker";
import { gatherWorkspaceCode } from "./codeParser";
import log from "./log";

const debugLoopController = new DebugLoopController();

export async function activate(context: vscode.ExtensionContext) {

  debugLoopController.reset();
  
  // Pre-fetch structured code
  const code = gatherWorkspaceCode();
  debugLoopController.setCode(code);

  // Register debug tracker so we can handle events like "stopped"
  vscode.debug.registerDebugAdapterTrackerFactory("*", {
    createDebugAdapterTracker(session) {
      return new DebugAdapterTracker(session, debugLoopController);
    },
  });


  // setup initial breakpoints
  await debugLoopController.setInitialBreakpoints();

  const startCommand = vscode.commands.registerCommand(
    "llm-debugger.startLLMDebug",
    async () => {
      // Start the debug session
      await debugLoopController.start();
      await vscode.debug.startDebugging(undefined, {
        type: "node",
        request: "launch",
        name: "LLM Debugger (Dynamic)",
        stopOnEntry: true,
        program: "${workspaceFolder}/array.test.js",
        env: { NODE_ENV: "test" },
      });
      log.show();
    }
  );


  context.subscriptions.push(startCommand);
}
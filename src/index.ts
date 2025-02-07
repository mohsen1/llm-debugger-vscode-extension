import * as vscode from "vscode";
import { DebugLoopController } from "./debug/DebugLoopController";
import { DebugAdapterTracker } from "./debug/DebugAdapterTracker";
import { SourceCodeCollector } from "./context/SourceCodeCollector";
import log from "./logger";
import { LlmDebuggerSidebarProvider } from "./views/SidebarView";

const debugLoopController = new DebugLoopController();

export async function activate(context: vscode.ExtensionContext) {
  try {
    // Register debug adapter tracker for all debug sessions.
    vscode.debug.registerDebugAdapterTrackerFactory("*", {
      createDebugAdapterTracker(session) {
        return new DebugAdapterTracker(session, debugLoopController);
      },
    });


    // Listen for any debug session start. If "Debug with AI" is enabled,
    // then pause execution immediately, set initial breakpoints, and initialize our workflow.
     
    vscode.debug.onDidStartDebugSession(async (session: vscode.DebugSession) => {
      const debugWithAI = context.workspaceState.get<boolean>("llmDebuggerEnabled", false);
      if (debugWithAI) {
        log.clear();
        // log.show();
        debugLoopController.reset();
        // Pause execution so we can set initial breakpoints
        await debugLoopController.pauseExecution(session);
        // Now set initial breakpoints using AI guidance
        await debugLoopController.setInitialBreakpoints();
        // Gather workspace code and initialize debugging loop
        const sourceCodeCollector = new SourceCodeCollector(session.workspaceFolder);
        debugLoopController.setCode(sourceCodeCollector.gatherWorkspaceCode());
        await debugLoopController.start();
      }
    });

    // Set up and register the sidebar (integrated into the Run and Debug panel)
    const sidebarProvider = new LlmDebuggerSidebarProvider(context, debugLoopController);
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider("llmDebuggerPanel", sidebarProvider, {
        webviewOptions: { retainContextWhenHidden: true },
      }),
    );

    log.setSidebarProvider(sidebarProvider);

    log.clear();
    log.debug("activated");

  } catch (error) {
    log.error("Failed to activate", String(error));
  }
}
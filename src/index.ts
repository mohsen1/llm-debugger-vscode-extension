import * as vscode from "vscode";
import { DebugLoopController } from "./debug/DebugLoopController";
import { DebugAdapterTracker } from "./debug/DebugAdapterTracker";
import log from "./logger";
import { LlmDebuggerSidebarProvider } from "./views/SidebarView";
import { DebugConfigurationProvider } from "./debug/DebugConfigurationProvider";
import { SourceCodeCollector } from "./context/SourceCodeCollector";

export async function activate(context: vscode.ExtensionContext) {
  // Assume that the first workspace folder is the one we want to debug.
  const sourceCodeCollector = new SourceCodeCollector(vscode.workspace.workspaceFolders?.[0]);
  const debugLoopController = new DebugLoopController(sourceCodeCollector);

  // Register debug adapter tracker for all debug sessions.
  context.subscriptions.push(
    vscode.debug.registerDebugAdapterTrackerFactory("*", {
      createDebugAdapterTracker(session) {
        // Return a new tracker for EACH session. Do NOT reuse the same tracker.
        return new DebugAdapterTracker(session, new DebugLoopController(sourceCodeCollector));
      },
    })
  );

  // Register the debug configuration provider for the llmDebugger
  // TODO: Support other debuggers
  context.subscriptions.push(
    vscode.debug.registerDebugConfigurationProvider("node", new DebugConfigurationProvider(context, debugLoopController)),
  );

  // Set up and register the sidebar (integrated into the Run and Debug panel)
  const sidebarProvider = new LlmDebuggerSidebarProvider(context, debugLoopController);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("llmDebuggerPanel", sidebarProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  // After setting up initializers log that the extension has been activated.
  log.clear();
  log.debug("activated");
}

export async function deactivate(context: vscode.ExtensionContext) {
  context.subscriptions.forEach((disposable) => disposable.dispose());
}

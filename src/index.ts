import * as vscode from "vscode";
import { DebugLoopController } from "./debug/DebugLoopController";
import { DebugAdapterTracker } from "./debug/DebugAdapterTracker";
import { gatherWorkspaceCode, getLaunchConfigs } from "./utils";
import log from "./logger";

import type { LogEntry } from "./logger";
import { llmDebuggerSidebarProvider } from "./views/SidebarView";

const debugLoopController = new DebugLoopController();



export async function activate(context: vscode.ExtensionContext) {
  try {
    // Restore persisted logs
    const storedLogs = context.workspaceState.get<LogEntry[]>(
      "llmDebuggerLogs",
      [],
    );

    // Register debug command with selected configuration
    const startCommand = vscode.commands.registerCommand(
      "llm-debugger.startLLMDebug",
      async () => {
        log.show();
        debugLoopController.reset();
        await debugLoopController.setInitialBreakpoints();
        const code = gatherWorkspaceCode();
        debugLoopController.setCode(code);
        await debugLoopController.start();

        // Retrieve selected configuration from workspace state
        const selectedConfig = context.workspaceState.get<vscode.DebugConfiguration>(
          "llmDebuggerSelectedConfig"
        );
        if (!selectedConfig) {
          vscode.window.showErrorMessage(
            "No LLM Debugger configuration selected. Please run 'LLM Debugger: Choose Config' command first."
          );
          return;
        }

        // Launch the debugger using the selected configuration
        await vscode.debug.startDebugging(undefined, selectedConfig);
        log.show();
      }
    );



    // Command for choosing a configuration to use for debugging via UI
    const chooseConfigCommand = vscode.commands.registerCommand(
      "llm-debugger.chooseConfig",
      async () => {
        const configs: vscode.DebugConfiguration[] = context.workspaceState.get("llmDebuggerConfigs", []);
        if (!configs || configs.length === 0) {
          vscode.window.showErrorMessage(
            "No LLM Debugger configurations available. Please run 'LLM Debugger: Set Configs' command first."
          );
          return;
        }
        const chosen = await vscode.window.showQuickPick(
          configs.map((cfg) => ({
            label: cfg.name || "Unnamed Config",
            description: cfg.type,
            config: cfg,
          })),
          {
            placeHolder: "Select a configuration for LLM Debugger",
          }
        );
        if (chosen && chosen.config) {
          await context.workspaceState.update("llmDebuggerSelectedConfig", chosen.config);
          vscode.window.showInformationMessage(`LLM Debugger selected config: ${chosen.label}`);
        }
      }
    );

    const sidebarProvider = new llmDebuggerSidebarProvider(
      context.extensionUri,
    );
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        "llmDebuggerSidebar.view",
        sidebarProvider,
        {
          webviewOptions: {
            retainContextWhenHidden: true,
          },
        },
      ),
    );

    // Set up logger with restored logs
    log.setSidebarProvider(sidebarProvider);
    log.loadPersistedLogs(storedLogs);

    log.debug("Activated");

    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (!workspace) {
      log.error("No workspace found");
      return;
    }
    log.info("Workspace", workspace.uri.fsPath);
    const configs = getLaunchConfigs(workspace);
    log.info("All configs", JSON.stringify(configs, null, 2));

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

    // Push registered commands to subscriptions
    context.subscriptions.push(startCommand, chooseConfigCommand);
  } catch (error) {
    log.error("Failed to activate", String(error));
  }
}

import * as vscode from "vscode";
import { DebugLoopController } from "./DebugLoopController";

export class DebugConfigurationProvider implements vscode.DebugConfigurationProvider {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly debugLoopController: DebugLoopController,
  ) {}

  resolveDebugConfiguration(
    folder: vscode.WorkspaceFolder | undefined,
    config: vscode.DebugConfiguration,
  ): vscode.ProviderResult<vscode.DebugConfiguration> {
    // Get the current debug enabled state from workspace state
    const debugEnabled = this.context.workspaceState.get<boolean>(
      "llmDebuggerEnabled",
      false,
    );

    // LLDB specific
    config.stopOnTerminate = false;

    // Store the AI debug state in the config for the debug adapter
    config.llmDebuggerEnabled = debugEnabled;

    if (debugEnabled) {
      // Configure the debugger to stop on uncaught exceptions
      config.breakOnUncaughtExceptions = true;
      config.stopOnEntry = true;
    }

    return config;
  }
}
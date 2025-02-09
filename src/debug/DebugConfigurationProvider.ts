import * as vscode from "vscode";
import { DebugLoopController } from "./DebugLoopController";

export class DebugConfigurationProvider implements vscode.DebugConfigurationProvider {
  constructor(private readonly context: vscode.ExtensionContext,
    private readonly debugLoopController: DebugLoopController
  ) {}

  resolveDebugConfiguration(
    folder: vscode.WorkspaceFolder | undefined,
    config: vscode.DebugConfiguration,
  ): vscode.ProviderResult<vscode.DebugConfiguration> {
    // Get the current debug enabled state from workspace state
    const debugEnabled = this.context.workspaceState.get<boolean>("llmDebuggerEnabled", false);
    
    // Only force stopOnEntry if AI debugging is enabled
    if (debugEnabled) {
      config.stopOnEntry = true;
      config.stopOnExit = true;
      config.stopOnTerminate = true;
      // Configure the debugger to stop on uncaught exceptions
      config.breakOnException = {
        uncaught: true,
        // caught: false
      };
    }
    
    return config;
  }
}
import * as vscode from "vscode";
import { DebugLoopController } from "./DebugLoopController";

export class DebugConfigurationProvider implements vscode.DebugConfigurationProvider {
  constructor(private readonly context: vscode.ExtensionContext,
    private readonly debugLoopController: DebugLoopController

  ) {}

  resolveDebugConfiguration(
    folder: vscode.WorkspaceFolder | undefined,
    config: vscode.DebugConfiguration,
    token?: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.DebugConfiguration> {
    // Get the current debug enabled state from workspace state
    const debugEnabled = this.context.workspaceState.get<boolean>("llmDebuggerEnabled", false);
    
    // Only force stopOnEntry if AI debugging is enabled
    config.stopOnEntry = debugEnabled;
    
    // Store the AI debug state in the config for the debug adapter
    config.llmDebuggerEnabled = debugEnabled;
    
    return config;
  }
}
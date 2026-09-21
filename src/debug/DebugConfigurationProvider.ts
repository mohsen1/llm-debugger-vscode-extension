import * as vscode from "vscode";
import { DebugLoopController } from "./DebugLoopController";
import { AGENT_MODE_FLAG } from "./VscodeDebugTarget";

export class DebugConfigurationProvider implements vscode.DebugConfigurationProvider {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly debugLoopController: DebugLoopController,
  ) {}

  resolveDebugConfiguration(
    folder: vscode.WorkspaceFolder | undefined,
    config: vscode.DebugConfiguration,
  ): vscode.ProviderResult<vscode.DebugConfiguration> {
    // Hands off anything the agent launched. This provider serves the sidebar's
    // autonomous loop, and its armed flag lives in workspace state — so without
    // this guard an old "armed" sidebar silently rewrites every agent launch,
    // forcing stopOnEntry (the hunt then burns its first pause on the entry
    // line) and stamping llmDebuggerEnabled, which puts the legacy loop on the
    // same session the agent is driving. Observed live; worth a hard guard.
    if (config[AGENT_MODE_FLAG]) return config;

    const debugEnabled = this.context.workspaceState.get<boolean>("llmDebuggerEnabled", false);

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

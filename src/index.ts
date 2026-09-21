import * as vscode from "vscode";
import { hunt, type HuntOptions } from "./agent/loop";
import { JevStrategy } from "./agent/strategies/jev";
import { LlmStrategy } from "./agent/strategies/llm";
import type { HuntResult, HuntTask, StrategyName } from "./agent/types";
import { NodeWorkspaceFiles } from "./agent/workspace";
import { AGENT_TOOL_DEFS, callAgentTool } from "./agentTools/registry";
import { registerAgentTools } from "./agentTools/lmTools";
import { startBridge } from "./agentTools/bridge";
import { registerDebuggerParticipant } from "./chat/DebuggerParticipant";
import { SourceCodeCollector } from "./context/SourceCodeCollector";
import { DebugAdapterTracker } from "./debug/DebugAdapterTracker";
import { DebugConfigurationProvider } from "./debug/DebugConfigurationProvider";
import { DebugLoopController } from "./debug/DebugLoopController";
import { VscodeDebugTarget } from "./debug/VscodeDebugTarget";
import type { DebugTarget } from "./debug/DebugTarget";
import log from "./logger";
import { LlmDebuggerSidebarProvider } from "./views/SidebarView";

/**
 * What the extension hands back from `activate`, for the in-host benchmark and
 * for anything else that wants to drive a hunt without going through chat.
 */
export interface LlmDebuggerApi {
  target: DebugTarget;
  runHunt(
    task: HuntTask,
    strategyName: StrategyName,
    options?: HuntOptions,
  ): Promise<HuntResult>;
}

export async function activate(context: vscode.ExtensionContext): Promise<LlmDebuggerApi> {
  const workspaceDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const sourceCodeCollector = new SourceCodeCollector(vscode.workspace.workspaceFolders?.[0]);
  const debugLoopController = new DebugLoopController(sourceCodeCollector);

  // The one debug target. It installs its own adapter tracker and claims the
  // whole js-debug session tree (parent shell plus the child that runs the
  // program and emits `stopped`).
  const target = new VscodeDebugTarget();
  target.register(context);

  // The legacy autonomous loop only runs when the user explicitly arms it from
  // the sidebar; otherwise it would wipe other sessions' breakpoints and stall
  // their launch on model calls.
  context.subscriptions.push(
    vscode.debug.registerDebugAdapterTrackerFactory("*", {
      createDebugAdapterTracker(session) {
        if (!session.configuration?.llmDebuggerEnabled) return undefined;
        if (session.parentSession) return undefined;
        return new DebugAdapterTracker(session, debugLoopController);
      },
    }),
    vscode.debug.registerDebugConfigurationProvider(
      "node",
      new DebugConfigurationProvider(context, debugLoopController),
    ),
  );

  const sidebarProvider = new LlmDebuggerSidebarProvider(context, debugLoopController);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("llmDebuggerPanel", sidebarProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  // Language-model tools: Copilot, Claude and Codex can drive the same visible
  // session through `#debugStart` and friends.
  registerAgentTools(context, target);

  // Localhost bridge for out-of-process agents (see mcp-server/).
  if (workspaceDir) {
    startBridge(target, workspaceDir).then(
      () => log.debug("agent bridge ready"),
      (err) => log.warn(`agent bridge failed: ${String(err).slice(0, 160)}`),
    );
  }

  registerDebuggerParticipant(context, target);

  context.subscriptions.push(
    vscode.commands.registerCommand("llm-debugger.invokeTool", async () => {
      const name = await vscode.window.showQuickPick(
        AGENT_TOOL_DEFS.map((d) => d.name),
        { placeHolder: "Agent tool to invoke" },
      );
      if (!name) return;
      const raw = await vscode.window.showInputBox({ prompt: `JSON input for ${name}`, value: "{}" });
      try {
        const text = await callAgentTool(target, name, JSON.parse(raw || "{}"));
        log.info(text);
        vscode.window.showInformationMessage(`${name}: ${text.slice(0, 400)}`);
      } catch (err) {
        vscode.window.showErrorMessage(String(err).slice(0, 400));
      }
    }),
  );

  log.clear();
  log.debug("activated");

  return {
    target,
    runHunt: (task, strategyName, options) =>
      hunt({
        target,
        task,
        strategy: (meter) =>
          strategyName === "jev" ? new JevStrategy(meter) : new LlmStrategy(meter),
        files: new NodeWorkspaceFiles(workspaceDir || process.cwd()),
        ...(options ? { options } : {}),
      }),
  };
}

export async function deactivate(context: vscode.ExtensionContext) {
  context.subscriptions.forEach((disposable) => disposable.dispose());
}

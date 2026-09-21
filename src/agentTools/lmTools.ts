import * as vscode from "vscode";
import type { DebugTarget } from "../debug/DebugTarget";
import { AGENT_TOOL_DEFS, callAgentTool } from "./registry";

class AgentLMTool implements vscode.LanguageModelTool<object> {
  constructor(
    private toolName: string,
    private displayName: string,
    private target: DebugTarget,
  ) {}
  prepareInvocation(): vscode.ProviderResult<vscode.PreparedToolInvocation> {
    return { invocationMessage: `${this.displayName}…` };
  }
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<object>,
  ): Promise<vscode.LanguageModelToolResult> {
    const input = (options.input || {}) as Record<string, unknown>;
    try {
      const text = await callAgentTool(this.target, this.toolName, input);
      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
    } catch (err) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`Tool error (${this.toolName}): ${String(err)}`),
      ]);
    }
  }
}

export function registerAgentTools(
  context: vscode.ExtensionContext,
  target: DebugTarget,
): void {
  for (const def of AGENT_TOOL_DEFS) {
    context.subscriptions.push(
      vscode.lm.registerTool(def.name, new AgentLMTool(def.name, def.displayName, target)),
    );
  }
}

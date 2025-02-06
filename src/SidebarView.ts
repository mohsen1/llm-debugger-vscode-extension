
import * as vscode from "vscode";
import log from "./log";
export class llmDebuggerSidebarProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
  ) {
    this._view = webviewView;
    log.debug("Resolving webview view");

    // Configure webview settings
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this._extensionUri, "src/webview"),
      ],
    };

    // Set up message handling
    webviewView.webview.onDidReceiveMessage((message) => {
      switch (message.command) {
        case "startDebugging":
          vscode.commands.executeCommand("llm-debugger.startLLMDebug");
          break;
      }
    });
  }

  public logMessage(message: string, type: string) {
    if (this._view) {
      this._view.webview.postMessage({ command: "log", message, type });
    }
  }
}

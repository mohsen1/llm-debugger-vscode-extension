import * as vscode from "vscode";
import * as fs from "fs";
import * as crypto from "crypto";
import * as cheerio from "cheerio";
import { DebugLoopController } from "../debug/DebugLoopController";

export class LlmDebuggerSidebarProvider implements vscode.WebviewViewProvider {
  private debugLoopController: DebugLoopController;
  private _view?: vscode.WebviewView;
  private readonly _extensionContext: vscode.ExtensionContext;
  private readonly _extensionUri: vscode.Uri;

  constructor(context: vscode.ExtensionContext, debugLoopController: DebugLoopController) {
    this.debugLoopController = debugLoopController;
    this._extensionContext = context;
    this._extensionUri = context.extensionUri;

    // Listen for spinner events and forward them to the webview.
    this.debugLoopController.on("spinner", (data: { active: boolean }) => {
      if (this._view) {
        this._view.webview.postMessage({
          command: "spinner",
          active: data.active,
        });
      }
    });
  }

  public resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this._extensionUri, "src", "webview", "out"),
      ],
    };

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    // Send current debug mode state to the webview
    const debugWithAI = this._extensionContext.workspaceState.get<boolean>("llmDebuggerEnabled", false);
    webviewView.webview.postMessage({ command: "setDebugEnabled", enabled: debugWithAI });

    // Listen for messages from the webview
    webviewView.webview.onDidReceiveMessage((message) => {
      switch (message.command) {
        case "toggleDebug":
          this._extensionContext.workspaceState.update("llmDebuggerEnabled", message.enabled);
          break;
      }
    });
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const webviewOutPath = vscode.Uri.joinPath(
      this._extensionUri,
      "src",
      "webview",
      "out"
    );
    const htmlPath = vscode.Uri.joinPath(webviewOutPath, "index.html");
    const html = fs.readFileSync(htmlPath.fsPath, "utf8");
    const nonce = getNonce();
    const $ = cheerio.load(html);

    // Update resource URIs for CSS
    $("link[rel='stylesheet']").each((_, el) => {
      const relativeHref = $(el).attr("href");
      if (relativeHref) {
        const newHref = webview.asWebviewUri(
          vscode.Uri.joinPath(webviewOutPath, relativeHref)
        ).toString();
        $(el).attr("href", newHref);
      }
    });

    // Update resource URIs for JS and add nonce
    $("script").each((_, el) => {
      const relativeSrc = $(el).attr("src");
      if (relativeSrc) {
        const newSrc = webview.asWebviewUri(
          vscode.Uri.joinPath(webviewOutPath, relativeSrc)
        ).toString();
        $(el).attr("src", newSrc);
        $(el).attr("nonce", nonce);
      }
    });

    // Add CSP meta tag
    $("head").prepend(`<meta 
      http-equiv="Content-Security-Policy"
      content="default-src 'none';
      style-src ${webview.cspSource};
      script-src 'nonce-${nonce}';">`);

    return $.html();
  }

  public logMessage(message: string, type: string, timestamp: number) {
    if (this._view) {
      this._view.webview.postMessage({
        command: "log",
        message,
        type,
        timestamp,
      });
    }
  }
}

function getNonce() {
  return crypto.randomBytes(16).toString("base64");
}
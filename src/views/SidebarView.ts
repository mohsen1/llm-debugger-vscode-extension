import * as crypto from "crypto";
import * as vscode from "vscode";
import * as fs from "fs";
import * as cheerio from "cheerio";
import log from "../logger";

export class llmDebuggerSidebarProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private readonly _extensionContext: vscode.ExtensionContext;
  private readonly _extensionUri: vscode.Uri;

  constructor(extensionContext: vscode.ExtensionContext) {
    this._extensionContext = extensionContext;
    this._extensionUri = extensionContext.extensionUri;
  }

  public resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;

    // Configure webview settings
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        // Allow access to the 'src/webview/out' directory.
        vscode.Uri.joinPath(this._extensionUri, "src", "webview", "out"),
      ],
    };

    // Set the HTML content for the webview using our helper
    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    // Send the initial configurations via postMessage instead of using setState
    const configs = this._extensionContext.workspaceState.get("llmDebuggerConfigs", []);
    webviewView.webview.postMessage({ command: "initConfigs", configs });

    // Set up message handling from the webview
    webviewView.webview.onDidReceiveMessage((message) => {
      switch (message.command) {
        case "startDebugging":
          vscode.commands.executeCommand("llm-debugger.startLLMDebug");
          break;
        case "chooseConfig":
          vscode.commands.executeCommand("llm-debugger.chooseConfig", JSON.stringify(message));
          break;
      }
    });
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const webviewOutPath = vscode.Uri.joinPath(
      this._extensionUri,
      "src",
      "webview",
      "out",
    );
    const htmlPath = vscode.Uri.joinPath(webviewOutPath, "index.html");
    const html = fs.readFileSync(htmlPath.fsPath, "utf8");
    const nonce = getNonce();
    const $ = cheerio.load(html);

    // Resolve HTML imports of CSS files using cheerio
    $("link[rel='stylesheet']").each((i, el) => {
      const relativeHref = $(el).attr("href");
      if (relativeHref) {
        const newHref = webview
          .asWebviewUri(vscode.Uri.joinPath(webviewOutPath, relativeHref))
          .toString();
        $(el).attr("href", newHref);
      }
    });

    // Resolve HTML imports of JS files using cheerio
    $("script").each((i, el) => {
      const relativeSrc = $(el).attr("src");
      if (relativeSrc) {
        const newSrc = webview
          .asWebviewUri(vscode.Uri.joinPath(webviewOutPath, relativeSrc))
          .toString();
        $(el).attr("src", newSrc);
        $(el).attr("nonce", nonce);
      }
    });

    // Add the CSP meta tag
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
  // Cryptographically secure nonce
  return crypto.randomBytes(16).toString("base64");
}

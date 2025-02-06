import * as crypto from "crypto";
import * as vscode from "vscode";
import * as fs from "fs";
import * as cheerio from "cheerio";
import log from "./log";

export class llmDebuggerSidebarProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;
    log.debug("Resolving webview view");

    // Configure webview settings
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        // Allow access to the 'out/webview' directory.
        vscode.Uri.joinPath(this._extensionUri, "out", "webview")
      ],
    };

    // Set the html content for the webview using our helper
    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    // Set up message handling
    webviewView.webview.onDidReceiveMessage((message) => {
      switch (message.command) {
        case "startDebugging":
          vscode.commands.executeCommand("llm-debugger.startLLMDebug");
          break;
      }
    });
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    // Locate the index.html file in your webview folder
    const webviewOutPath = vscode.Uri.joinPath(this._extensionUri, "out", "webview");
    const htmlPath = vscode.Uri.joinPath(webviewOutPath, "index.html");
    const html = fs.readFileSync(htmlPath.fsPath, "utf8");
    const nonce = getNonce();
    const $ = cheerio.load(html);

    // Resolve HTML imports of CSS files using cheerio
     $("link[rel='stylesheet']").each((i, el) => {
      const relativeHref = $(el).attr("href");
      if (relativeHref) {
        const newHref = webview.asWebviewUri(vscode.Uri.joinPath(webviewOutPath, relativeHref)).toString();
        $(el).attr("href", newHref);
      }
    });

    // Resolve HTML imports of JS files using cheerio
    $("script").each((i, el) => {
      const relativeSrc = $(el).attr("src");
      if (relativeSrc) {
        const newSrc = webview.asWebviewUri(vscode.Uri.joinPath(webviewOutPath, relativeSrc)).toString();
        $(el).attr("src", newSrc);
        $(el).attr("nonce", nonce);
      }
    });

    // Add the CSP meta tag
    $('head').prepend(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">`);


    return $.html();
  }

  public logMessage(message: string, type: string) {
    if (this._view) {
      this._view.webview.postMessage({ command: "log", message, type });
    }
  }
}

function getNonce() {
  return crypto.randomBytes(16).toString('base64'); // Cryptographically secure nonce
}
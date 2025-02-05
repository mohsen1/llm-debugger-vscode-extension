import * as vscode from "vscode";

export class llmDebuggerSidebarProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
    ) {
        this._view = webviewView;

        // Configure webview settings
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: []
        };

        // Set up message handling
        webviewView.webview.onDidReceiveMessage(message => {
            switch (message.command) {
                case 'startDebugging':
                    vscode.commands.executeCommand('llm-debugger.startLLMDebug');
                    break;
            }
        });

        // Set webview content
        webviewView.webview.html = this.getWebviewContent();
    }

    public logMessage(message: string, type: string) {
        if (this._view) {
            this._view.webview.postMessage({ command: 'log', message, type });
        }
    }

    private getWebviewContent() {
        return `
        <!DOCTYPE html>
        <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>LLM Debugger</title>
                <style>
                    body {
                        padding: 10px;
                        font-family: var(--vscode-font-family);
                    }
                    #start-button {
                        width: 100%;
                        padding: 8px;
                        margin-bottom: 16px;
                        background: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        cursor: pointer;
                    }
                    #start-button:hover {
                        background: var(--vscode-button-hoverBackground);
                    }
                    #log-area {
                        height: calc(100vh - 120px);
                        overflow-y: auto;
                        border: 1px solid var(--vscode-input-border);
                        padding: 8px;
                    }
                    .log-message {
                        margin: 4px 0;
                        padding: 4px;
                        border-radius: 3px;
                    }
                    .log-ai { color: var(--vscode-debugTokenExpression-name); }
                    .log-fn { color: var(--vscode-debugTokenExpression-value); }
                    .log-debug { color: var(--vscode-debugIcon-breakpointCurrentStackframeForeground); }
                    .log-info { color: var(--vscode-debugConsole-infoForeground); }
                    .log-error { color: var(--vscode-debugConsole-errorForeground); }
                    .log-warn { color: var(--vscode-debugConsole-warningForeground); }
                </style>
            </head>
            <body>
                <button id="start-button">Start LLM Debug Session</button>
                <div id="log-area"></div>

                <script>
                    const vscode = acquireVsCodeApi();
                    const logArea = document.getElementById('log-area');

                    document.getElementById('start-button').addEventListener('click', () => {
                        vscode.postMessage({ command: 'startDebugging' });
                    });

                    window.addEventListener('message', event => {
                        const message = event.data;
                        if (message.command === 'log') {
                            const logEntry = document.createElement('div');
                            logEntry.classList.add('log-message', 'log-' + message.type);
                            logEntry.textContent = message.message;
                            logArea.appendChild(logEntry);
                            logArea.scrollTop = logArea.scrollHeight;
                        }
                    });
                </script>
            </body>
        </html>`;
    }
}

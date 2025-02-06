import * as React from "react";
import MarkdownIt from "markdown-it";
import * as vscode from "vscode";

declare function acquireVsCodeApi<Commands = { command: string }, State = unknown>(): {
  postMessage(message: Commands): void;
  setState(state: State): void;
  getState(): State;
};

export function App() {
  const [logs, setLogs] = React.useState<
    {
      message: string;
      type: string;
      timestamp: number;
    }[]
  >([]);

  React.useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.command === "log") {
        setLogs((prev) => [
          ...prev,
          {
            message: event.data.message,
            type: event.data.type,
            timestamp: event.data.timestamp,
          },
        ]);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const handleStartDebug = () => {
    const vscode = acquireVsCodeApi();
    vscode.postMessage({ command: "startDebugging" });
  };

 
  const handleConfigChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const vscode = acquireVsCodeApi<{ command: "chooseConfig", config: string }>();
    const config = e.target.value;
    vscode.postMessage({ command: "chooseConfig", config });
  };

  const getAllConfigs = () => {
    const vscode = acquireVsCodeApi<unknown, { configs: vscode.DebugConfiguration[] }>();
    const configs = vscode.getState()?.configs;
    return configs;
  };


  const renderMarkdown = (message: string) => {
    const markdown = new MarkdownIt();
    return (
      <div
        className="markdown-content"
        dangerouslySetInnerHTML={{ __html: markdown.render(message) }}
      />
    );
  };


  return (
    <div>
      <div className="configs-list">
        <select onChange={handleConfigChange}>
          {getAllConfigs().map((config) => (
            <option key={config.name} value={config.name}>{config.name}</option>
          ))}
        </select>
      </div>
      <div className="control-panel">
        <button id="start-button" onClick={handleStartDebug}>
          Start Debug
        </button>
      </div>
      {logs.length > 0 ? (
        <div id="log-area">
          {logs.map((line, i) => (
            <div key={i} className="log-message">
              {renderMarkdown(line.message)}
            </div>
          ))}
        </div>
      ) : (
        <Help />
      )}
    </div>
  );
}

function Help() {
  return (
    <div className="help-text">
      <p>
        Click on the <code>Start Debug</code> button to start debugging using
        the LLM Debugger.
      </p>
    </div>
  );
}

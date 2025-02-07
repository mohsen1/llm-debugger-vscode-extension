import * as React from "react";
import MarkdownIt from "markdown-it";

// Assume the VS Code API has been injected via the preload script
declare const vscodeApi: {
  postMessage(message: { command: string; enabled: boolean }): void;
};

export function App() {
  const [logs, setLogs] = React.useState<
    { message: string; type: string; timestamp: number }[]
  >([]);
  const [debugEnabled, setDebugEnabled] = React.useState<boolean>(false);

  const [spinnerActive, setSpinnerActive] = React.useState<boolean>(false);
  React.useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      switch (data?.command) {
        case "log":
          setLogs((prev) => [...prev, {
            message: data.message,
            type: data.type,
            timestamp: data.timestamp,
          }]);
          break;
        case "setDebugEnabled":
          setDebugEnabled(data.enabled);
          break;
        case "spinner":
          setSpinnerActive(data.active);
          break;
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const onCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const enabled = e.target.checked;
    setDebugEnabled(enabled);
    vscodeApi.postMessage({ command: "toggleDebug", enabled });
  };

  const renderMarkdown = (message: string) => {
    const md = new MarkdownIt();
    return (
      <div
        className="markdown-content"
        dangerouslySetInnerHTML={{ __html: md.render(message) }}
      />
    );
  };

  const lastLog = logs.at(-1);

  return (
    <div className="sidebar-container">
      <div className="control-panel">
        <input
          type="checkbox"
          id="debug-with-ai"
          checked={debugEnabled}
          onChange={onCheckboxChange}
        />
        <label htmlFor="debug-with-ai">Debug with AI</label>
      </div>

      <div id="log-area">
        <div
          className={`log-message log-${lastLog?.type} ${
            lastLog?.type === "ai" ? "active" : ""
          }`}
        >
          {renderMarkdown(lastLog?.message || "")}
        </div>
        {spinnerActive && <div className="spinner" />}
      </div>

      {!lastLog && <Help />}
    </div>
  );
}

function Help() {
  return (
    <div className="help-text">
      <p>
        Enable "Debug with AI" above. When you start a debug session via VS
        Code's Run and Debug panel, the LLM Debugger workflow will run.
      </p>
    </div>
  );
}

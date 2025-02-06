import * as React from "react";
import MarkdownIt from "markdown-it";
import * as vscode from "vscode";



export function App() {
  const [logs, setLogs] = React.useState<
    {
      message: string;
      type: string;
      timestamp: number;
    }[]
  >([]);
  const [configs, setConfigs] = React.useState<vscode.DebugConfiguration[]>([]);
  const [selectedConfig, setSelectedConfig] = React.useState<vscode.DebugConfiguration | null>(null);

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
      } else if (event.data?.command === "initConfigs") {
        setConfigs(event.data.configs);
        setSelectedConfig(event.data.configs[0]);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  // Automatically select the first config when available
  React.useEffect(() => {
    if (configs.length > 0 && selectedConfig === null) {
      const firstConfig = configs[0];
      setSelectedConfig(firstConfig);
  
      window.vscodeApi.postMessage({
        command: "chooseConfig",
        config: JSON.stringify(firstConfig),
      });
    }
  }, [configs, selectedConfig]);

  // const handleStartDebug = () => {
  //   window.vscodeApi.postMessage({ command: 'chooseConfig', config: selectedConfig })
  //   window.vscodeApi.postMessage({ command: "startDebugging" });
  // };

  // const handleConfigChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
  //   const configName = e.target.value;
  //   const config = configs.find((config) => config.name === configName);
  //   if (config) {
  //     setSelectedConfig(config);
  //     window.vscodeApi.postMessage({ command: "chooseConfig", config: JSON.stringify(config) });
  //   }
  // };

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
    <div className="sidebar-container">
      <div className="control-panel">
        <input type="checkbox" id="debug-with-ai" />
        <label htmlFor="debug-with-ai">Debug with AI</label>
      </div>

      {logs.length > 0
        ? (
          <div id="log-area">
            {logs
            .map((line, i) => (
              <div key={i} className={`log-message log-${line.type} ${line.type === "ai" && i === logs.length - 1 ? "active" : ""}`}>
                {renderMarkdown(line.message)}
              </div>
            ))}
          </div>
        )
        : <Help />}
    </div>
  );
}

function Help() {
  return (
    <div className="help-text">
      <p>
        Click on the <code>Start Debug</code>{" "}
        button to start debugging using the LLM Debugger.
      </p>
    </div>
  );
}

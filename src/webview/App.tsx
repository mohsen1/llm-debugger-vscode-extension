import * as React from "react";

declare function acquireVsCodeApi<T = unknown, S = unknown>(): {
  postMessage(message: T): void;
  setState(state: S): void;
  getState(): S;
};

export function App() {
  const [logs, setLogs] = React.useState<string[]>([]);

  React.useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.command === "log") {
        setLogs(prev => [...prev, event.data.message]);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const handleStartDebug = () => {
    const vscode = acquireVsCodeApi();
    vscode.postMessage({ command: "startDebugging" });
  };

  return (
    <div>
      <button onClick={handleStartDebug}>Start Debug</button>
      <div id="log-area">
        {logs.map((line, i) => (
          <div key={i} className="log-line">
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}
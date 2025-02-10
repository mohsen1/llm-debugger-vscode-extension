import * as React from "react";
import { Markdown } from "./Markdown";

// Assume the VS Code API has been injected via the preload script
declare const vscodeApi: {
  postMessage(message: { command: string; enabled: boolean }): void;
};


interface AiFunctionCall {
  functionName: string;
  args: string;
  reason: string;
}

export function App() {
  const [debugEnabled, setDebugEnabled] = React.useState<boolean>(false);
  const [isInSession, setIsInSession] = React.useState<boolean>(false);
  const [spinner, setSpinner] = React.useState<{
    active: boolean;
    message: string
  }>({
    active: false,
    message: ""
  });
  const [debugResuls, setDebugResults] = React.useState<string | null>(null);
  const [currentAiFunctionCall, setCurrentAiFunctionCall] = React.useState<AiFunctionCall | null>(null);

  // Listen to messages from the extension
  React.useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      switch (data?.command) {
        case "aiFunctionCall":
          setCurrentAiFunctionCall(data);
          break;
        case "setDebugEnabled":
          setDebugEnabled(data.enabled);
          break;
        case "spinner":
          setSpinner(data);
          break;
        case "isInSession":
          setIsInSession(data.isInSession);
          break
        case "debugResults":
          setDebugResults(data.results);
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


  return (
    <div className="sidebar-container">
      <div className="control-panel">
        <input
          type="checkbox"
          id="debug-with-ai"
          disabled={isInSession}
          checked={debugEnabled}
          onChange={onCheckboxChange}
        />
        <label htmlFor="debug-with-ai">Debug with AI</label>
      </div>
      {currentAiFunctionCall && !spinner && !debugResuls && <AiFunctionCallView {...currentAiFunctionCall} />}
      {spinner.active && <Thinking message={spinner.message} />}
      {!isInSession && !debugResuls && <Help />}
      {debugResuls && <Results message={debugResuls} onClear={() => { setDebugResults(null) }} />}
    </div>
  );
}

function AiFunctionCallView({ functionName, args, reason }: AiFunctionCall) {
  return (
    <div className="ai-function-call">
      <div className="function-name">{functionName}()</div>
      <div className="reason">{reason}</div>
    </div>
  );
}

function Thinking({message}: {message: string}) {
  return (
    <div className="thinking">
      <div className="spinner"></div>
      <div className="text">{message}</div>
    </div>
  )
}

function Results({ message, onClear }: { message: string; onClear: () => void }) {
  return (
    <div className="results">
      <header>
        <h4>Results</h4>
        <a href="#" onClick={() => onClear()}>Clear</a>
      </header>
      <Markdown message={message} />
    </div>
  )
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

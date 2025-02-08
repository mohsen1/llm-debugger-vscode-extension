import * as React from "react";

// Assume the VS Code API has been injected via the preload script
declare const vscodeApi: {
  postMessage(message: { command: string; enabled: boolean }): void;
};

export function App() {
  const [debugEnabled, setDebugEnabled] = React.useState<boolean>(false);
  const [isInSession, setIsInSession] = React.useState<boolean>(false);
  const [spinnerActive, setSpinnerActive] = React.useState<boolean>(false);
  React.useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      switch (data?.command) {
        case "setDebugEnabled":
          setDebugEnabled(data.enabled);
          break;
        case "spinner":
          setSpinnerActive(data.active);
          break;
        case "isInSession":
          setIsInSession(data.isInSession);
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
      {spinnerActive && <div className="spinner"></div>}
      {!isInSession && <Help />}
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

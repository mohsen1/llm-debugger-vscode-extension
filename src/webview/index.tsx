import * as React from "react";
import * as ReactDOM from "react-dom/client";
import { App } from "./App";
import "./style.css";

declare function acquireVsCodeApi<
  Commands = { command: string },
  State = unknown,
>(): {
  postMessage(message: Commands): void;
  setState(state: State): void;
  getState(): State;
};

declare global {
  interface Window {
    vscodeApi: ReturnType<typeof acquireVsCodeApi>;
  }
}

const container = document.getElementById("root")!;
const errorContainer = document.getElementById("error-root")!;
const root = ReactDOM.createRoot(container);
const errorRoot = ReactDOM.createRoot(errorContainer);

try {
  window.vscodeApi = acquireVsCodeApi();
  root.render(<App />);
} catch (error) {
  errorRoot.render(<GlobalError error={error} />);
}

window.addEventListener("error", (event) => {
  errorRoot.render(<GlobalError error={event.error} />);
});


function GlobalError(props: { error: unknown }) {
  return (
    <div className="global-error">
      <h3><code>LLM Debugger</code> encountered an error</h3>
      <pre className="global-error-content">{String(props.error)}</pre>
    </div>
  );
}

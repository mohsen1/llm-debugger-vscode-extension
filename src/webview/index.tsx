import * as React from "react";
import * as ReactDOM from "react-dom/client";
import { App } from "./App";
import "./style.css"; // This triggers the cssPlugin to inline the content

if (typeof document !== "undefined") {
  const container = document.getElementById("root")!;
  const root = ReactDOM.createRoot(container);
  root.render(<App />);
}

import * as vscode from "vscode";
import { LlmDebuggerSidebarProvider } from "../views/SidebarView";

export interface LogEntry {
  message: string;
  type: string;
  timestamp: number;
}

class Logger {
  private isEnabled = true;
  private logChannel: vscode.LogOutputChannel;
  private thinkingTimeout: NodeJS.Timeout | null = null;
  private logEntries: LogEntry[] = [];
  private prefix: string = ""

  constructor(logChannel: vscode.LogOutputChannel | null = null, prefix: string = "") {
    this.logChannel = logChannel || vscode.window.createOutputChannel("LLM Debugger", {
      log: true,
    });
    this.prefix = prefix;
  }

  enable() {
    this.isEnabled = true;
  }

  disable() {
    this.isEnabled = false;
  }


  createSubLogger(name: string) {    
    return new Logger(this.logChannel, `${name}: `);
  }



  loadPersistedLogs(entries: LogEntry[]) {
    this.logEntries = entries;
  }

  getPersistedLogs(): LogEntry[] {
    return this.logEntries;
  }

  private clearThinkingTimeout() {
    if (this.thinkingTimeout) {
      clearInterval(this.thinkingTimeout);
      this.thinkingTimeout = null;
      this.logChannel.append("");
    }
  }

  show() {
    this.logChannel.show();
  }

  clear() {
    this.clearThinkingTimeout();
    this.logChannel.replace("");
    // Don't clear logEntries to maintain persistence
  }

  private logToSidebar(message: string, type: string) {
    const entry = {
      message,
      type,
      timestamp: Date.now(),
    };
    this.logEntries.push(entry);
  }

  private writeToOutput(
    msg: string,
    level: keyof Pick<
      vscode.LogOutputChannel,
      "debug" | "error" | "info" | "warn" | "trace"
    > = "info",
  ) {
    if (!this.isEnabled) {
      return;
    }
    this.logChannel[level](`${this.prefix}${msg}`);
  }


  debug(...msgs: string[]) {
    this.clearThinkingTimeout();
    const message = msgs.join(" ");
    this.writeToOutput(message, "debug");
    // not writing to sidebar because it's too verbose
  }

  info(...msgs: string[]) {
    this.clearThinkingTimeout();
    const message = msgs.join(" ");
    this.writeToOutput(message, "info");
    this.logToSidebar(message, "info");
  }

  error(...msgs: string[]) {
    this.clearThinkingTimeout();
    const message = msgs.join(" ");
    this.writeToOutput(message, "error");
    this.logToSidebar(message, "error");
  }

  warn(...msgs: string[]) {
    this.clearThinkingTimeout();
    const message = msgs.join(" ");
    this.writeToOutput(message, "warn");
    this.logToSidebar(message, "warn");
  }
}

export default new Logger();

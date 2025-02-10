import * as vscode from "vscode";

export interface LogEntry {
  message: string;
  type: string;
  timestamp: number;
}

class Logger {
  private isEnabled = true;
  private logChannel: vscode.LogOutputChannel;
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



  show() {
    this.logChannel.show();
  }

  clear() {
    this.logChannel.clear();
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
    const message = msgs.join(" ");
    this.writeToOutput(message, "debug");
    // not writing to sidebar because it's too verbose
  }

  trace(...msg: string[]) {
    this.writeToOutput(msg.join(''), 'trace')
  }

  info(...msgs: string[]) {
    const message = msgs.join(" ");
    this.writeToOutput(message, "info");
  }

  error(...msgs: string[]) {
    const message = msgs.join(" ");
    this.writeToOutput(message, "error");
  }

  warn(...msgs: string[]) {
    const message = msgs.join(" ");
    this.writeToOutput(message, "warn");
  }
}

export default new Logger();

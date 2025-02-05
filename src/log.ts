import * as vscode from "vscode";
import chalk from "chalk";

class Logger {
  private outputChannel: vscode.OutputChannel;
  private thinkingTimeout: NodeJS.Timeout | null = null;

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel("LLM Debugger");
  }

  private clearThinkingTimeout() {
    if (this.thinkingTimeout) {
      clearInterval(this.thinkingTimeout);
      this.thinkingTimeout = null;
      this.outputChannel.appendLine("");
    }
  }

  show() {
    this.outputChannel.show();
  }

  clear() {
    this.clearThinkingTimeout();
    this.outputChannel.clear();
  }

  ai(...msgs: string[]) {
    this.outputChannel.appendLine(chalk.blue(`AI: `) + msgs.join(" "));
    this.thinkingTimeout = setInterval(() => {
      this.outputChannel.append('🁢');
    }, 250);
  }

  fn(...msgs: string[]) {
    this.clearThinkingTimeout();
    this.outputChannel.appendLine(chalk.green(`FN: `) + msgs.join(" "));
  }

  debug(...msgs: string[]) {
    this.clearThinkingTimeout();
    this.outputChannel.appendLine(chalk.gray(`DEBUG: `) + msgs.join(" "));
  }

  info(...msgs: string[]) { 
    this.clearThinkingTimeout();
    this.outputChannel.appendLine(chalk.cyan(`INFO: `) + msgs.join(" "));
  }

  error(...msgs: string[]) {
    this.clearThinkingTimeout();
    this.outputChannel.appendLine(chalk.red(`ERROR: `) + msgs.join(" "));
  }

  warn(...msgs: string[]) {
    this.clearThinkingTimeout();
    this.outputChannel.appendLine(chalk.yellow(`WARN: `) + msgs.join(" "));
  }
}

export default new Logger();

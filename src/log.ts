import * as vscode from "vscode";
import chalk from "chalk";

class Logger {
  private outputChannel: vscode.OutputChannel;

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel("LLM Debugger");
  }

  show() {
    this.outputChannel.show();
  }

  clear() {
    this.outputChannel.clear();
  }

  ai(...msgs: string[]) {
    this.outputChannel.appendLine(chalk.blue(`AI: `) + msgs.join(" "));
  }

  fn(...msgs: string[]) {
    this.outputChannel.appendLine(chalk.green(`FN: `) + msgs.join(" "));
  }

  debug(...msgs: string[]) {
    this.outputChannel.appendLine(chalk.gray(`DEBUG: `) + msgs.join(" "));
  }

  info(...msgs: string[]) {
    this.outputChannel.appendLine(chalk.cyan(`INFO: `) + msgs.join(" "));
  }

  error(...msgs: string[]) {
    this.outputChannel.appendLine(chalk.red(`ERROR: `) + msgs.join(" "));
  }

  warn(...msgs: string[]) {
    this.outputChannel.appendLine(chalk.yellow(`WARN: `) + msgs.join(" "));
  }
}

export default new Logger();

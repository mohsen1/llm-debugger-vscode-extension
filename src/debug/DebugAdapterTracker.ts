import * as vscode from "vscode";
import { DebugLoopController } from "./DebugLoopController";
import log from "../logger";
export class DebugAdapterTracker implements vscode.DebugAdapterTracker {
  private session: vscode.DebugSession;
  private controller: DebugLoopController;

  constructor(session: vscode.DebugSession, controller: DebugLoopController) {
    this.session = session;
    this.controller = controller;
  }

  onWillStopSession(): void {
    this.controller.finish();
  }

  async onWillStartSession(): Promise<void> {
    log.debug("onWillStartSession");
    if (vscode.debug.activeDebugSession) {
      await vscode.debug.activeDebugSession.customRequest("pause");
    }
    await this.controller.waitForThreadStopped();
  }

  async onDidSendMessage(message: { type: string; event: string }) {
    if (message.type === "event" && message.event === "stopped") {
      this.controller.handleThreadStopped(this.session);
    }
    if (message.type === "event" && message.event === "terminated") {
      this.controller.finish();
    }
  }

  onError() {
    this.controller.finish();
  }

  onExit() {
    this.controller.finish();
  }
}

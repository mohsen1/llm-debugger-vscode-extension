import * as vscode from "vscode";
import { DebugLoopController } from "./DebugLoopController";
import logger from "../logger";

const log = logger.createSubLogger("DebugAdapterTracker");
// log.disable();

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

  onWillReceiveMessage(message: any): void {
    log.debug(`onWillReceiveMessage: ${message.type} - ${JSON.stringify(message.command)}`);
  }

  async onWillStartSession(): Promise<void> {
    let hasStartedController = false;
    vscode.debug.onDidStartDebugSession((session) => {
      if (!hasStartedController && session.id === this.session.id) {
        hasStartedController = true;
        log.debug(`Starting AI debug session: ${session.id}`);
        this.controller.setSession(session);
        this.controller.start();
      }
    });
    log.debug("onWillStartSession");
    await this.controller.clear()
    await this.session.customRequest("launch");
    await this.session.customRequest("pause");
    await this.controller.setInitialBreakpoints();
    await this.session.customRequest("continue");
    log.debug("Waiting for thread to stop...");
    await this.controller.waitForThreadStopped();
    log.debug('Breakpoint set and thread stopped');

  }

  async onDidSendMessage(message: { type: string; event: string }) {
    if (message.type === "event" && message.event === "stopped") {
      log.debug(`onDidSendMessage Received message: ${message.type} - ${message.event}`);
      this.controller.emit("threadStopped");
    }
    if (message.type === "event" && message.event === "terminated") {
      log.debug(`onDidSendMessage Received message: ${message.type} - ${message.event}`);
      this.controller.finish();
    }
  }

  onError(error?: Error) {
    log.error(`Error occurred: ${error?.message}`);
    this.controller.finish();
  }

  onExit() {
    this.controller.finish();
  }
}

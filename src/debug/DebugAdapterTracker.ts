import * as vscode from "vscode";
import { DebugLoopController } from "./DebugLoopController";
import logger from "../logger";

const log = logger.createSubLogger("DebugAdapterTracker");
// log.disable();

interface DebugMessage {
  type: string;
  command?: string;
  event?: string;
  body?: {
    reason?: string;
  };
}

export class DebugAdapterTracker implements vscode.DebugAdapterTracker {
  private session: vscode.DebugSession;
  private controller: DebugLoopController;

  constructor(session: vscode.DebugSession, controller: DebugLoopController) {
    this.session = session;
    this.controller = controller;
  }

  async onWillReceiveMessage(message: DebugMessage) {
    log.debug(`onWillReceiveMessage: ${message.type} - ${JSON.stringify(message.command)}`);
    if (message.command === "disconnect") {
      await this.controller.finish();
    }
  }

  async onWillStartSession(): Promise<void> {
    log.debug("onWillStartSession");
    await this.controller.clear();
    this.controller.setSession(this.session);
    await this.controller.start();
  }

  async onDidSendMessage(message: DebugMessage) {
    log.debug("onDidSendMessage", JSON.stringify(message));
    if (message.type === "event" && message.event === "stopped") {
      if (message.body?.reason === "exception") {
        log.debug('stopped due to exception');
        await this.controller.handleException(this.session);
      } else {
        await this.controller.loop();
      }
    }
  }

  onError(error?: Error) {
    log.error(`Error occurred: ${error?.message}`);
    this.controller.finish();
  }

}

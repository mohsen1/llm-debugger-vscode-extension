import * as vscode from "vscode";
import { DebugLoopController } from "./DebugLoopController";
import logger from "../logger";

const log = logger.createSubLogger("DebugAdapterTracker");
// log.disable();

interface ThreadInfo {
  id: number;
  name: string;
}

interface DebugMessage {
  type: string;
  command?: string;
  event?: string;
  body?: {
    reason?: string;
    threadId?: number;
    allThreadsStopped?: boolean;
    threads?: ThreadInfo[];
  };
}

export class DebugAdapterTracker implements vscode.DebugAdapterTracker {
  private session: vscode.DebugSession;
  private controller: DebugLoopController;
  private threadId: number | undefined;

  constructor(session: vscode.DebugSession, controller: DebugLoopController) {
    this.session = session;
    this.controller = controller;
  }

  async onWillReceiveMessage(message: DebugMessage) {
    log.debug(`onWillReceiveMessage: ${message.type} - ${JSON.stringify(message)}`);
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
    if (message.event !== 'loadedSource') {
      log.debug("onDidSendMessage", JSON.stringify(message));
    }

    // Track thread creation
    if (message.type === "response" && message.command === "threads") {
      const threads = message.body?.threads || [];
      if (threads.length > 0 && !this.threadId) {
        this.threadId = threads[0].id;
        this.controller.setThreadId(this.threadId);
      }
    }

    // Handle stopped events
    if (message.type === "event" && message.event === "stopped") {
      const threadId = message.body?.threadId || this.threadId;
      const allThreadsStopped = message.body?.allThreadsStopped || false;

      if (threadId) {
        this.threadId = threadId;
        this.controller.setThreadId(threadId);
      }

      if (message.body?.reason === "exception") {
        log.debug('stopped due to exception');
        await this.controller.handleException(this.session);
      } else {
        // Emit threadStopped before calling loop
        this.controller.emit("threadStopped", { threadId, allThreadsStopped });
        await this.controller.loop();
      }
    }

    // Handle thread exit
    if (message.type === "event" && message.event === "thread" && message.body?.reason === "exited") {
      this.threadId = undefined;
      this.controller.setThreadId(undefined);
    }
  }

  onError(error?: Error) {
    log.error(`Error occurred: ${error?.message}`);
    this.controller.finish();
  }
}

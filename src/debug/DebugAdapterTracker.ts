
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
    text?: string; // Added to capture output event text
    output?: string; // Capture output content
    category?: string;
  };
}

export class DebugAdapterTracker implements vscode.DebugAdapterTracker {
  private session: vscode.DebugSession;
  private controller: DebugLoopController;
  private threadId: number | undefined;
  private stderr: string = ""; // Accumulate error output
  private stdout: string = ""; // Accumulate standard output


  constructor(session: vscode.DebugSession, controller: DebugLoopController) {
    this.session = session;
    this.controller = controller;
  }

  // async onWillReceiveMessage(message: DebugMessage) {
  //   log.debug(`onWillReceiveMessage: ${message.type} - ${JSON.stringify(message)}`);
  // }

  async onWillStartSession(): Promise<void> {
    log.debug("onWillStartSession");
    await this.controller.clear();
    this.controller.setSession(this.session);

    // check if session has thread 
    const threadsResponse = await this.session.customRequest('threads');
    const threads = threadsResponse?.threads || [];

    if (threads.length > 0 && !this.threadId) {
      this.threadId = threads[0].id;
      this.controller.setThreadId(this.threadId);
    } else {
      log.debug('onWillStartSession: No thread found in session');
      return;
    }

    await this.controller.start();
    log.debug('started controller for session', this.session.id)
  }



  async onDidSendMessage(message: DebugMessage) {
    if (message.event !== 'loadedSource') {
      log.debug("onDidSendMessage", JSON.stringify(message));
    }

    // Track thread creation
    if (message.type === "response" && message.command === "threads") {
      const threads = message.body?.threads || [];

      // We are ignoreing other threads that are created since we don't support multi-threaded 
      // debugging just yet
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
        await this.controller.handleException(this.session, this.stderr, this.stdout);
      }
      else {
        // Emit threadStopped before calling loop
        this.controller.emit("threadStopped", { threadId, allThreadsStopped });
        await this.controller.loop(); // not sure if we need to loop manually from here, controller should handle looping state
      }
    }

    // Handle thread exit
    if (message.type === "event" && message.event === "thread" && message.body?.reason === "exited") {
      this.threadId = undefined;
      this.controller.setThreadId(undefined);
    }

    // Accumulate error output
    if (message.type === "event" && message.event === "output") {
      if (message.body?.category === "stderr") {
        this.stderr += message.body.output || "";
      }
      if (message.body?.category === 'stdout') {
        this.stdout += message.body.output || ''
      }
    }

    if (message.type === "response" && message.command === "disconnect") {
      log.debug("onDidSendMessage: disconnect");
      this.controller.finish([
        '# stdout',
        this.stdout,
        '# stderr',
        this.stderr
      ].join('\n\n'));
    }

  }


  onError(error: Error) {
    log.error(`Error occurred: ${error.message}`);
    this.stderr += error.message;
  }

}
import { EventEmitter } from "node:events";
import * as path from "node:path";
import type { ChatCompletion } from "openai/resources";
import * as vscode from "vscode";
import {
  breakpointFunctions,
  debugFunctions,
  getInitialBreakpointsMessage,
  getPausedMessage,
  systemMessage,
} from "../ai/prompts";
import { AIChat, callLlm } from "../ai/Chat";
import log from "../logger";
import { StructuredCode } from "../types";
import { DebugState } from "./DebugState";

/**
 * This controller waits for "stopped" events to retrieve paused state.
 * Instead of forcing "pause", we only call gatherPausedState after the debugger
 * actually stops. This avoids the 'Thread is not paused' error.
 */
export class DebugLoopController extends EventEmitter {
  private live = false;
  private finishing = false;
  private session: vscode.DebugSession | null = null;
  private chatWithHistory = new AIChat(systemMessage, [
    ...breakpointFunctions,
    ...debugFunctions,
  ]);

  private structuredCode: StructuredCode[] = [];

  constructor() {
    super();
    // Wire up the spinner events from AIChat to this controller.
    this.chatWithHistory.onSpinner = (active: boolean) => {
      this.emit("spinner", { active });
    };
  }

  setCode(code: StructuredCode[]) {
    this.structuredCode = code;
  }

  /**
   * Called whenever a "stopped" event occurs. We gather paused state,
   * send it to the LLM, and handle the function calls it returns.
   */
  async handleThreadStopped(session: vscode.DebugSession) {
    log.debug("handleThreadStopped");
    if (!this.live) return;
    if (this.finishing) return;
    if (!this.session) {
      this.session = session;
      await this.loop();
    }
    this.emit("threadStopped", session);
  }

  waitForThreadStopped() {
    return new Promise<void>((resolve) => {
      this.on("threadStopped", resolve);
    });
  }

  async setInitialBreakpoints() {
    log.ai("Setting initial breakpoints");
    this.emit("spinner", { active: true });
    const response = await callLlm(
      getInitialBreakpointsMessage(this.structuredCode),
      breakpointFunctions,
    );
    await this.handleLlmFunctionCall(response);
    this.emit("spinner", { active: false });
  }

  reset() {
    this.session = null;
    this.chatWithHistory.clearHistory();
    this.finishing = false;
    this.live = false;
  }

  async loop() {
    if (!this.session) return;
    if (!this.live) return;

    const debugState = new DebugState();
    const pausedState = await debugState.gatherPausedState(this.session);

    if (this.finishing) return;
    if (!this.live) return;

    log.ai("Thinking..");
    this.emit("spinner", { active: true });
    const llmResponse = await this.chatWithHistory.ask(
      getPausedMessage(this.structuredCode, pausedState),
    );
    this.emit("spinner", { active: false });
    if (this.finishing) return;
    if (!this.live) return;

    const [choice] = llmResponse.choices;
    const content = choice?.message?.content;
    if (content) {
      log.info(content);
    }

    await this.handleLlmFunctionCall(llmResponse);

    if (this.finishing) return;
    if (!this.live) return;

    await this.loop();
  }

  async start() {
    this.live = true;
  }

  async finish() {
    if (this.finishing) return;
    this.finishing = true;

    log.ai("Debug session finished. Providing code fix and explanation");

    // Provide final fix explanation if wanted...
    const response = await this.chatWithHistory.ask(
      "Debug session finished. Provide a code fix and explain your reasoning.",
      { withFunctions: false },
    );
    const [choice] = response.choices;
    const content = choice?.message?.content;
    if (content) {
      log.info(content);
    } else {
      log.info("No content from LLM");
    }

    this.stop();
  }

  stop() {
    this.live = false;
  }

  async pauseExecution() {
    const session = vscode.debug.activeDebugSession;
    if (!session) {
      log.debug("Cannot pause. No active debug session.");
      return;
    }
    try {
      const threads = await session.customRequest("threads");
      const threadId = threads.threads[0]?.id;
      if (threadId === undefined) {
        log.debug("No active thread found to pause.");
        return;
      }
      await Promise.all([
        session.customRequest("pause", { threadId }),
        this.waitForThreadStopped(),
      ]);
    } catch (err) {
      log.error(`Failed to pause execution: ${String(err)}`);
    }
  }

  async setBreakpoint(functionArgsString: string) {
    try {
      const { file, line } = JSON.parse(functionArgsString);
      let fullPath = file;
      if (!path.isAbsolute(file) && vscode.workspace.workspaceFolders?.length) {
        const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
        fullPath = path.join(workspaceRoot, file);
      }

      const uri = vscode.Uri.file(fullPath);
      const position = new vscode.Position(line - 1, 0);
      const location = new vscode.Location(uri, position);
      const breakpoint = new vscode.SourceBreakpoint(location, true);

      vscode.debug.addBreakpoints([breakpoint]);
      log.debug(`Set breakpoint at ${fullPath}:${line}`);
    } catch (err) {
      log.error(`Failed to set breakpoint: ${String(err)}`);
      vscode.window.showErrorMessage(
        `Failed to set breakpoint: ${String(err)}`,
      );
    }
  }

  async removeBreakpoint(functionArgsString: string) {
    log.debug(`Removing breakpoint: ${functionArgsString}`);
    try {
      const { file, line } = JSON.parse(functionArgsString);
      const allBreakpoints = vscode.debug.breakpoints;
      const toRemove: vscode.Breakpoint[] = [];

      for (const bp of allBreakpoints) {
        if (bp instanceof vscode.SourceBreakpoint) {
          const thisFile = bp.location.uri.fsPath;
          const thisLine = bp.location.range.start.line + 1;
          if (
            (thisFile === file || thisFile.endsWith(file)) &&
            thisLine === line
          ) {
            toRemove.push(bp);
          }
        }
      }

      if (toRemove.length) {
        vscode.debug.removeBreakpoints(toRemove);
        log.debug(
          `Removed ${toRemove.length} breakpoint(s) at ${file}:${line}`,
        );
      }
    } catch (err) {
      log.error(`Failed to remove breakpoint: ${String(err)}`);
      vscode.window.showErrorMessage(
        `Failed to remove breakpoint: ${String(err)}`,
      );
    }
  }

  async next() {
    const session = vscode.debug.activeDebugSession;
    if (!session) {
      log.debug("Cannot run command 'next'. No active debug session.");
      return;
    }
    try {
      const threads = await session.customRequest("threads");
      const threadId = threads.threads[0]?.id;
      if (threadId === undefined) {
        log.debug("Cannot run command 'next'. No active thread found.");
        return;
      }
      await Promise.all([
        session.customRequest("next", { threadId }),
        this.waitForThreadStopped(),
      ]);
    } catch (err) {
      log.error(`Failed to run command 'next': ${String(err)}`);
    }
  }

  async stepIn() {
    const session = vscode.debug.activeDebugSession;
    if (!session) {
      log.debug("Cannot stepIn. No active debug session.");
      return;
    }
    try {
      const threads = await session.customRequest("threads");
      const threadId = threads.threads[0]?.id;
      if (threadId === undefined) {
        log.debug("Cannot stepIn. No active thread found.");
        return;
      }
      await Promise.all([
        session.customRequest("stepIn", { threadId }),
        this.waitForThreadStopped(),
      ]);
    } catch (err) {
      log.error(`Failed to step in: ${String(err)}`);
    }
  }

  async stepOut() {
    const session = vscode.debug.activeDebugSession;
    if (!session) {
      log.debug("Cannot run command 'stepOut'. No active debug session.");
      return;
    }
    try {
      const threads = await session.customRequest("threads");
      const threadId = threads.threads[0]?.id;
      if (threadId === undefined) {
        log.debug("Cannot run command 'stepOut'. No active thread found.");
        return;
      }
      await Promise.all([
        session.customRequest("stepOut", { threadId }),
        this.waitForThreadStopped(),
      ]);
      log.info("Stepped out of the current function call.");
    } catch (err) {
      log.error(`Failed to run command 'stepOut': ${String(err)}`);
    }
  }

  async continueExecution() {
    const session = vscode.debug.activeDebugSession;
    if (!session) {
      log.debug("Cannot run command 'continue'. No active debug session.");
      return;
    }
    try {
      const threads = await session.customRequest("threads");
      const threadId = threads.threads[0]?.id;
      if (threadId === undefined) {
        log.debug("Cannot run command 'continue'. No active thread found.");
        return;
      }
      await Promise.all([
        session.customRequest("continue", { threadId }),
        this.waitForThreadStopped(),
      ]);
    } catch (err) {
      log.error(`Failed to run command 'continue': ${String(err)}`);
    }
  }

  async handleLlmFunctionCall(completion: ChatCompletion) {
    const choice = completion?.choices?.[0];
    if (!choice) {
      log.debug(`No choice found in completion. ${JSON.stringify(completion)}`);
      return { shouldContinue: true };
    }

    const hasActiveBreakpoints = vscode.debug.breakpoints.some(
      (bp) => bp.enabled,
    );

    for (const toolCall of choice.message?.tool_calls || []) {
      const { name, arguments: argsStr } = toolCall.function;
      log.fn(`${name}(${argsStr && argsStr !== '{}' ? argsStr : ""})`);

      switch (name) {
        case "setBreakpoint":
          await this.setBreakpoint(argsStr);
          break;
        case "removeBreakpoint":
          await this.removeBreakpoint(argsStr);
          break;
        case "next":
          await this.next();
          break;
        case "stepIn":
          await this.stepIn();
          break;
        case "stepOut":
          await this.stepOut();
          break;
        case "continue": {
          if (hasActiveBreakpoints) {
            await this.continueExecution();
          } else {
            log.debug("Cannot continue. No active breakpoints.");
          }
          break;
        }
        default:
          break;
      }
    }
  }
}
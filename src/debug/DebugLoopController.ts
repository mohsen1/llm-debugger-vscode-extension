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
import logger from "../logger";
import { DebugState } from "./DebugState";
import { SourceCodeCollector } from "../context/SourceCodeCollector";

const log = logger.createSubLogger("DebugLoopController");

/**
 * This controller waits for "stopped" events to retrieve paused state.
 * Instead of forcing "pause", we only call gatherPausedState after the debugger
 * actually stops. This avoids the 'Thread is not paused' error.
 */
export class DebugLoopController extends EventEmitter {
  private live = false;
  private session: vscode.DebugSession | null = null;

  constructor(private sourceCodeCollector: SourceCodeCollector) {
    super();
  }

  private chat = new AIChat(systemMessage, [
    ...breakpointFunctions,
    ...debugFunctions,
  ]);

  setWorkspaceFolder(workspaceFolder: vscode.WorkspaceFolder) {
    this.sourceCodeCollector.setWorkspaceFolder(workspaceFolder);
  }

  setSession(session: vscode.DebugSession) {
    this.session = session;
  }

  async shouldLoop() {
    // check if session has threads live
    const threadsRequestResponse = await this.session?.customRequest("threads");
    if (!threadsRequestResponse?.threads?.length) {
      log.error("No threads found in session");
      return false;
    }
    const llmDebuggerEnabled = vscode.workspace.getConfiguration("llm").get("debuggerEnabled", true);
    log.debug(`Should loop? ${JSON.stringify({ live: this.live, session: this.session !== null, llmDebuggerEnabled })}`);
    return this.live && this.session !== null && llmDebuggerEnabled;
  }

  /**
   * Called whenever a "stopped" event occurs. We gather paused state,
   * send it to the LLM, and handle the function calls it returns.
   */
  async handleThreadStopped(session: vscode.DebugSession) {
    if (session !== this.session) return;
    log.debug("Handling thread stop...");
    await this.loop();
  }

  waitForThreadStopped() {
    log.debug("Waiting for thread to stop...");
    return new Promise<void>((resolve) => {
      this.on("threadStopped", resolve);
    });
  }

  async setInitialBreakpoints(removeExisting = true) {
    log.debug("Setting initial breakpoints");
    if (removeExisting) {
      vscode.debug.removeBreakpoints(vscode.debug.breakpoints.filter((bp) => bp.enabled));
    }
    this.emit("spinner", { active: true });
    const structuredCode = this.sourceCodeCollector.gatherWorkspaceCode();
    const response = await callLlm(
      getInitialBreakpointsMessage(structuredCode),
      breakpointFunctions,
    );
    await this.handleLlmFunctionCall(response);
    this.emit("spinner", { active: false });
  }

  reset() {
    this.session = null;
    this.chat.clearHistory();
    this.live = false;
  }

  async loop() {
    let shouldLoop = await this.shouldLoop();
    if (!shouldLoop) return;

    log.debug("Gathering paused state");
    const debugState = new DebugState();
    const pausedState = await debugState.gatherPausedState(this.session!);

    // checking again since while we were gathering paused state, the live flag could have been set to false
    shouldLoop = await this.shouldLoop();
    if (!shouldLoop) return;

    log.debug("Thinking..");
    this.emit("spinner", { active: true });

    // --- DEBUGGING STEP 2: Log the message sent to the LLM ---
    const messageToSend = getPausedMessage(this.sourceCodeCollector.gatherWorkspaceCode(), pausedState);
    log.debug("Message to LLM:", messageToSend);

    const llmResponse = await this.chat.ask(messageToSend);
    this.emit("spinner", { active: false });
    // if (this.finishing) return;
    if (!this.live) return;

    const [choice] = llmResponse.choices;
    const content = choice?.message?.content;
    if (content) {
      log.info(content);
    }

    // --- DEBUGGING STEP 3: Ensure awaits are correct ---
    await this.handleLlmFunctionCall(llmResponse); // Make sure this is awaited

    if (!this.live) return;

    await this.loop(); 
  }

  async start() {
    log.debug("Starting debug loop controller");
    this.live = true;
    this.emit("isInSession", { isInSession: true });
    await this.loop();
  }


  async finish() {
    

    log.debug("Debug session finished. Providing code fix and explanation");

    // Provide final fix explanation if wanted...
    this.emit('spinner', { active: true });
    const response = await this.chat.ask(
      "Debug session finished. Provide a code fix and explain your reasoning.",
      { withFunctions: false },
    );
    this.emit('spinner', { active: false });
    const [choice] = response.choices;
    const content = choice?.message?.content;
    if (content) {
      log.info(content);
      this.emit("debugResults", { results: content });
    } else {
      log.info("No content from LLM");
    }
    this.emit('isInSession', { isInSession: false });
    this.stop();
  }

  stop() {
    this.live = false;
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

    log.debug(`Handling LLM function call: ${JSON.stringify({ choice, hasActiveBreakpoints })}`);

    for (const toolCall of choice.message?.tool_calls || []) {
      const { name, arguments: argsStr } = toolCall.function;
      log.debug(`${name}(${argsStr && argsStr !== '{}' ? argsStr : ""})`);

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
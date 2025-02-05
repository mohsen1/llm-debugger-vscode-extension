import * as vscode from "vscode";


async function getPusedStack(session: vscode.DebugSession) {
  // 1) Get all threads
  const threadsResponse = await session.customRequest("threads");
  if (!threadsResponse?.threads) return;

  // 2) Typically only one thread is actually "paused" on a stopped event,
  //    but you may have multiple. You’d identify the stopped thread, e.g.:
  //    (In some debug adapters, you get e.body.threadId as the paused thread.)
  const pausedThreadId = threadsResponse.threads[0].id;

  // 3) Request stack trace for the paused thread
  const stackTraceResponse = await session.customRequest("stackTrace", {
    threadId: pausedThreadId,
    startFrame: 0,
    levels: 20, // or however many frames you want
  });

  // 4) Do whatever you need with the stack frames
  const frames = stackTraceResponse?.stackFrames || [];
  return frames;
}

async function getTopFrameVariables(
  activeSession: vscode.DebugSession,
) {
  try {
    // 1) Get the active thread (this can be tricky if you have multiple threads)
    //    You'll need the actual threadId; for demonstration let's assume it's 1.
    //    If you need to find all threads, you can do:
    //    const threads = await activeSession.customRequest('threads', {});
    //    then pick a threadId from there.

    const threadId = 1;

    // 2) Request the stack trace for the top frame
    const stackTraceResponse = await activeSession.customRequest("stackTrace", {
      threadId,
      startFrame: 0,
      levels: 1,
    });

    if (
      !stackTraceResponse.stackFrames ||
      stackTraceResponse.stackFrames.length === 0
    ) {
      vscode.window.showInformationMessage("No stack frames found.");
      return;
    }

    // Take the first (top) frame
    const topFrame = stackTraceResponse.stackFrames[0];
    const frameId = topFrame.id;

    // 3) Request scopes for this frame
    const scopesResponse = await activeSession.customRequest("scopes", {
      frameId,
    });
    if (!scopesResponse.scopes) {
      vscode.window.showInformationMessage("No scopes found for top frame.");
      return;
    }

    const variables: unknown[] = [];

    // 4) For each scope, request the variables
    for (const scope of scopesResponse.scopes) {
      const variableRef = scope.variablesReference;
      if (variableRef && variableRef > 0) {
        const varsResponse = await activeSession.customRequest("variables", {
          variablesReference: variableRef,
        });
        const vars = varsResponse.variables;
        variables.push({
          scopeName: scope.name,
          variables: vars,
        });
      }
    }

    return variables;
  } catch (err) {
    console.error("Error retrieving variables:", err);
  }
}

/**
 * Gathers current breakpoints, stack, and top-frame variables from the active debug session.
 *
 * @param session   The current debug session
 * @param threadId  (Optional) The thread ID to inspect. Defaults to the first paused thread found.
 * @returns         An object containing breakpoint info, paused stack, and top-frame variables.
 */
export async function gatherPausedState(
  session: vscode.DebugSession,
) {
  if (!session) {
    throw new Error("No active debug session");
  }
  return {
    breakpoints: vscode.debug.breakpoints.filter((breakpoint) =>
      breakpoint.enabled
    ),
    pausedStack: await getPusedStack(session),
    topFrameVariables: await getTopFrameVariables(session),
  };
}

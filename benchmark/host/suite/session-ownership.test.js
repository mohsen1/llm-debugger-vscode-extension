// Proves the root cause of "the debugger never pauses".
//
// One launch, two tracker filters watching it side by side:
//   A  session.configuration.llmDebuggerAgentMode  — what the old code used
//   B  walk up session.parentSession               — the fix
//
// js-debug answers a `node` launch with a parent session that owns no threads
// plus a child that runs the program. `stopped` is emitted by the child, and
// the child's configuration does not carry the parent's custom fields — so A
// latches onto the one session that never pauses. B sees the stop.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");

const OUT = process.env.LLMDBG_OUT;
const FLAG = "llmDebuggerAgentMode";

function wsFile(rel) {
  return path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, rel);
}

function carriesFlag(session) {
  return !!(session.configuration && session.configuration[FLAG]);
}

function makeOwnershipWalk() {
  const claimed = new Set();
  return (session) => {
    for (let s = session; s; s = s.parentSession) {
      if (claimed.has(s.id)) {
        claimed.add(session.id);
        return true;
      }
      if (carriesFlag(s)) {
        claimed.add(session.id);
        return true;
      }
    }
    return false;
  };
}

async function threadsOf(session) {
  try {
    const r = await session.customRequest("threads");
    return (r && r.threads ? r.threads : []).map((t) => t.id);
  } catch (err) {
    return `error: ${String(err).replace(/^Error:\s*/, "").slice(0, 80)}`;
  }
}

suite("session ownership", function () {
  test("parentSession walk sees `stopped`; the config-flag filter does not", async function () {
    const owns = makeOwnershipWalk();
    const seen = {
      byFlag: { sessions: [], stops: [] },
      byWalk: { sessions: [], stops: [] },
    };
    let firstStopSession = null;
    let resolveStop;
    const stopped = new Promise((r) => {
      resolveStop = r;
    });

    const tracker = vscode.debug.registerDebugAdapterTrackerFactory("*", {
      createDebugAdapterTracker(session) {
        const flagged = carriesFlag(session);
        const walked = owns(session);
        if (!flagged && !walked) return undefined;
        const label = `${session.type}${session.parentSession ? ":child" : ":root"}`;
        if (flagged) seen.byFlag.sessions.push(label);
        if (walked) seen.byWalk.sessions.push(label);
        return {
          onDidSendMessage(message) {
            if (message.type !== "event" || message.event !== "stopped") return;
            const reason = (message.body && message.body.reason) || "?";
            if (flagged) seen.byFlag.stops.push(reason);
            if (walked) {
              seen.byWalk.stops.push(reason);
              if (!firstStopSession) {
                firstStopSession = session;
                resolveStop();
              }
            }
          },
        };
      },
    });

    const owned = [
      new vscode.SourceBreakpoint(
        new vscode.Location(vscode.Uri.file(wsFile("pricing.js")), new vscode.Position(21, 0)),
        true,
      ),
    ];

    const result = { when: new Date().toISOString() };
    try {
      while (vscode.debug.activeDebugSession) {
        await vscode.debug.stopDebugging(vscode.debug.activeDebugSession);
        await new Promise((r) => setTimeout(r, 300));
      }
      vscode.debug.addBreakpoints(owned);

      const started = await vscode.debug.startDebugging(vscode.workspace.workspaceFolders[0], {
        type: "node",
        request: "launch",
        name: "ownership probe",
        program: wsFile("run.js"),
        cwd: path.dirname(wsFile("run.js")),
        console: "internalConsole",
        stopOnEntry: false,
        skipFiles: ["<node_internals>/**"],
        [FLAG]: true,
      });
      result.started = started;

      await Promise.race([stopped, new Promise((r) => setTimeout(r, 30000))]);

      result.byFlag = seen.byFlag;
      result.byWalk = seen.byWalk;
      result.stopSessionIsChild = !!(firstStopSession && firstStopSession.parentSession);
      result.stopSessionCarriesFlag = firstStopSession ? carriesFlag(firstStopSession) : null;
      result.firstStopReason = seen.byWalk.stops[0] || null;
      result.threadsOnStopSession = firstStopSession ? await threadsOf(firstStopSession) : null;

      // What the flag-filtered session can actually tell you, for contrast.
      const flagged = vscode.debug.activeDebugSession;
      result.activeSessionIsChild = !!(flagged && flagged.parentSession);

      if (firstStopSession) {
        const threads = await threadsOf(firstStopSession);
        if (Array.isArray(threads) && threads.length > 0) {
          const st = await firstStopSession.customRequest("stackTrace", {
            threadId: threads[0],
            startFrame: 0,
            levels: 3,
          });
          result.topFrames = (st.stackFrames || []).map(
            (f) => `${(f.source && (f.source.name || f.source.path)) || "?"}:${f.line}`,
          );
        }
      }
    } finally {
      tracker.dispose();
      try {
        vscode.debug.removeBreakpoints(owned);
      } catch {
        /* ignore */
      }
      while (vscode.debug.activeDebugSession) {
        await vscode.debug.stopDebugging(vscode.debug.activeDebugSession);
        await new Promise((r) => setTimeout(r, 300));
      }
      if (OUT) fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
    }

    assert.ok(result.started, "startDebugging was refused");
    assert.ok(
      seen.byWalk.stops.length > 0,
      `parentSession walk saw no stop. byWalk=${JSON.stringify(seen.byWalk)}`,
    );
    assert.strictEqual(
      seen.byFlag.stops.length,
      0,
      `the config-flag filter was expected to miss every stop, but saw ${JSON.stringify(seen.byFlag.stops)}`,
    );
    assert.ok(result.stopSessionIsChild, "the stop should arrive on a child session");
    assert.strictEqual(
      result.stopSessionCarriesFlag,
      false,
      "child sessions were expected NOT to inherit the launch config flag",
    );
    assert.ok(
      Array.isArray(result.topFrames) && result.topFrames.length > 0,
      `no stack trace from the stopped session: ${JSON.stringify(result.topFrames)}`,
    );
  });
});

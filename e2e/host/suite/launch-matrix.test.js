// Launch-matrix bisection: which launch shape actually pauses js-debug?
// Runs INSIDE the dev host. For each variant we track every DAP event for
// up to 12s, then report { paused, reason, events }. No extension code used.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");

const OUT = process.env.LLM_E2E_OUT;
const RESULTS = { when: new Date().toISOString(), variants: [] };

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function wsFile(rel) {
  const folder = vscode.workspace.workspaceFolders[0].uri.fsPath;
  return path.join(folder, rel);
}

async function probeVariant(name, { stopOnEntry, consoleMode, setBreakpoints, programRel, programAbs }) {
  const events = [];
  const outputText = [];
  const folder = vscode.workspace.workspaceFolders[0];
  const program = programAbs || wsFile(programRel || "run.js");
  const disp = vscode.debug.registerDebugAdapterTrackerFactory("*", {
    createDebugAdapterTracker(session) {
      if (!session.configuration || session.configuration.e2eProbe !== name) return undefined;
      return {
        onDidSendMessage(message) {
          if (message.type !== "event") return Promise.resolve();
          if (message.event === "output" && outputText.join("").length < 1500) {
            const chunk = String(message.body?.output || "");
            if (!/js-debug|dap\/operation|cdp\/operation|operationjs-debug/i.test(chunk)) {
              outputText.push(chunk.slice(0, 300));
            }
          }
          if (message.event === "stopped") events.push(`stopped:${message.body?.reason}`);
          else if (message.event === "breakpoint") {
            const bp = message.body?.breakpoint;
            events.push(`breakpoint:${bp?.verified ? "verified" : "unverified"}:${bp?.source?.name || ""}:${bp?.line ?? ""}`);
          } else events.push(message.event);
          return Promise.resolve();
        },
      };
    },
  });
  let owned = [];
  try {
    while (vscode.debug.activeDebugSession) {
      await vscode.debug.stopDebugging(vscode.debug.activeDebugSession);
      await sleep(300);
    }
    if (setBreakpoints) {
      const mk = (rel, line) =>
        new vscode.SourceBreakpoint(
          new vscode.Location(vscode.Uri.file(wsFile(rel)), new vscode.Position(line - 1, 0)),
          true,
        );
      // First executable line of run.js (skips ESM imports) + two money lines.
      const dots = [mk("run.js", 6), mk("pricing.js", 22), mk("orders.js", 9)];
      vscode.debug.addBreakpoints(dots);
      owned = dots;
      await sleep(500);
    }
    const ok = await vscode.debug.startDebugging(folder, {
      type: "node",
      request: "launch",
      name: `E2E ${name}`,
      program,
      console: consoleMode,
      stopOnEntry,
      e2eProbe: name,
      // Bypass the extension's autonomous LLM loop tracker: we want the raw
      // adapter behavior. The quiet agent tracker only forwards events.
      llmDebuggerAgentMode: true,
    });
    assert.strictEqual(ok, true, "startDebugging refused");
    const deadline = Date.now() + 15000;
    let paused = null;
    while (Date.now() < deadline) {
      if (events.some((e) => e.startsWith("stopped:"))) {
        paused = events.find((e) => e.startsWith("stopped:"));
        break;
      }
      if (events.includes("terminated") || events.includes("exited")) break;
      if (!vscode.debug.activeDebugSession) break;
      await sleep(400);
    }
    const stillAlive = !!vscode.debug.activeDebugSession;
    const liveSession = vscode.debug.activeDebugSession;
    let where = "";
    let continueOutcome = "";
    if (stillAlive && !paused && liveSession) {
      // If entry-held, a continue should resume to completion or the next
      // breakpoint — proves whether the session is healthy despite no events.
      try {
        const threads = (await liveSession.customRequest("threads"))?.threads || [];
        if (threads[0]) {
          await liveSession.customRequest("continue", { threadId: threads[0].id });
          const t0 = Date.now();
          while (Date.now() - t0 < 8000) {
            if (events.some((e) => e.startsWith("stopped:"))) { continueOutcome = "paused-after-continue"; break; }
            if (events.includes("terminated") || events.includes("exited") || !vscode.debug.activeDebugSession) { continueOutcome = "finished-after-continue"; break; }
            await sleep(400);
          }
          if (!continueOutcome) continueOutcome = "continue-no-effect";
        }
      } catch (e) {
        continueOutcome = `continue-error:${String(e).slice(0, 100)}`;
      }
      const probeSession = liveSession;
      try {
        const threads = (await probeSession.customRequest("threads"))?.threads || [];
        for (const th of threads.slice(0, 2)) {
          try {
            const sf = await probeSession.customRequest("stackTrace", { threadId: th.id, startFrame: 0, levels: 3 });
            const frames = (sf?.stackFrames || []).map(
              (f) => `${f?.source?.name || "?"}:${f?.line ?? "?"}`,
            );
            where += `thread${th.id}:[${frames.join(",")}] `;
          } catch (e) {
            where += `thread${th.id}:unpaused(${String(e).slice(0, 60)}) `;
          }
        }
      } catch (e) {
        where = `threads-error:${String(e).slice(0, 100)}`;
      }
    }
    try {
      while (vscode.debug.activeDebugSession) {
        await vscode.debug.stopDebugging(vscode.debug.activeDebugSession);
        await sleep(300);
      }
    } catch { /* ignore */ }
    await sleep(500);
    const leftoverBps = vscode.debug.breakpoints.length;
    RESULTS.variants.push({
      name, stopOnEntry, consoleMode, setBreakpoints, leftoverBps, program: programRel || "run.js",
      paused, stillAlive, where, continueOutcome, events, outputPreview: outputText.join("").slice(0, 500),
    });
    try { fs.writeFileSync(OUT, JSON.stringify(RESULTS, null, 1)); } catch { /* ignore */ }
  } finally {
    disp.dispose();
    if (owned.length) vscode.debug.removeBreakpoints(owned);
    try {
      if (vscode.debug.activeDebugSession) await vscode.debug.stopDebugging();
    } catch { /* ignore */ }
  }
}

suite("launch matrix", () => {
  test("bisect pause behavior", async () => {
    await probeVariant("bps-terminal", { stopOnEntry: false, consoleMode: "integratedTerminal", setBreakpoints: true });
    await probeVariant("entry-terminal", { stopOnEntry: true, consoleMode: "integratedTerminal", setBreakpoints: false });
    await probeVariant("both-terminal", { stopOnEntry: true, consoleMode: "integratedTerminal", setBreakpoints: true });
    await probeVariant("both-console", { stopOnEntry: true, consoleMode: "internalConsole", setBreakpoints: true });
    await probeVariant("hello-console", { stopOnEntry: false, consoleMode: "internalConsole", setBreakpoints: false, programAbs: require("node:path").resolve(__dirname, "..", "hello.js") });
    // Pure launch: no breakpoints, no entry stop. If THIS hangs, the launch
    // itself stalls; if it completes, breakpoints are the poison.
    await probeVariant("bare-terminal", { stopOnEntry: false, consoleMode: "integratedTerminal", setBreakpoints: false });
    await probeVariant("bare-console", { stopOnEntry: false, consoleMode: "internalConsole", setBreakpoints: false });
    fs.writeFileSync(OUT, JSON.stringify(RESULTS, null, 1));
    console.log(JSON.stringify(RESULTS, null, 1));
  }).timeout(360000);
});

// Driver primitives: the exact DAP chain DebugDriver uses, asserted end to
// end — pause via polling, scopes/variables reads, next-step line advance,
// continue onto pricing.js:22, clean stop. No stopped events required.
const assert = require("node:assert");
const vscode = require("vscode");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function wsFile(rel) {
  return require("node:path").join(vscode.workspace.workspaceFolders[0].uri.fsPath, rel);
}

async function liveSession() {
  return vscode.debug.activeDebugSession;
}

async function waitHeld(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const session = await liveSession();
      if (!session) { await sleep(400); continue; }
      const threads = (await session.customRequest("threads"))?.threads || [];
      if (threads[0]) {
        try {
          const sf = await session.customRequest("stackTrace", { threadId: threads[0].id, startFrame: 0, levels: 1 });
          if (sf?.stackFrames?.length > 0) return { threadId: threads[0].id, frameId: sf.stackFrames[0].id, line: sf.stackFrames[0].line, source: sf.stackFrames[0]?.source?.name };
        } catch { /* not held yet */ }
      }
    } catch { /* ignore */ }
    await sleep(500);
  }
  return null;
}

suite("driver primitives", () => {
  test("pause, read vars, step, land on pricing.js:22, stop", async () => {
    const folder = vscode.workspace.workspaceFolders[0];
    const mk = (rel, line) =>
      new vscode.SourceBreakpoint(
        new vscode.Location(vscode.Uri.file(wsFile(rel)), new vscode.Position(line - 1, 0)),
        true,
      );
    const dots = [mk("run.js", 6), mk("pricing.js", 22), mk("orders.js", 9)];
    vscode.debug.addBreakpoints(dots);
    await sleep(500);
    const ok = await vscode.debug.startDebugging(folder, {
      type: "node",
      request: "launch",
      name: "E2E primitives",
      program: wsFile("run.js"),
      console: "internalConsole",
      stopOnEntry: true,
      llmDebuggerAgentMode: true,
      e2eProbe: "primitives",
    });
    assert.strictEqual(ok, true);
    try {
      assert.ok(await liveSession(), "no active session");
      const held = await waitHeld(20000);
      assert.ok(held, "never held at entry");
      // Read runtime values at the top frame (what the chat shows as evidence).
      const session = await liveSession();
      const scopes = await session.customRequest("scopes", { frameId: held.frameId });
      assert.ok(scopes?.scopes?.length > 0, "no scopes");
      const vars = await session.customRequest("variables", { variablesReference: scopes.scopes[0].variablesReference });
      assert.ok(vars?.variables, "no variables");
      // Step over twice; the line must advance from the entry line.
      const l0 = held.line;
      await session.customRequest("next", { threadId: held.threadId });
      const h1 = await waitHeld(10000);
      assert.ok(h1 && h1.line !== l0, `next did not advance (${l0} -> ${h1 && h1.line})`);
      // Run to the pricing breakpoint.
      await session.customRequest("continue", { threadId: h1.threadId });
      const deadline = Date.now() + 20000;
      let landed = null;
      while (Date.now() < deadline) {
        const h = await waitHeld(1500);
        if (!h) break;
        if (h.source === "pricing.js" && h.line === 22) { landed = h; break; }
        await session.customRequest("continue", { threadId: h.threadId });
      }
      assert.ok(landed, "never landed on pricing.js:22");
    } finally {
      while (vscode.debug.activeDebugSession) {
        await vscode.debug.stopDebugging(vscode.debug.activeDebugSession);
        await sleep(300);
      }
      vscode.debug.removeBreakpoints(dots);
    }
  }).timeout(120000);
});

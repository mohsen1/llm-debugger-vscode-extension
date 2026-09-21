// VscodeDebugTarget against the real debugger, inside a dev host.
//
// Covers exactly what the hunt loop and the benchmark depend on: a launch that
// actually pauses where asked, reading state, evaluating in the paused frame,
// stepping, clean teardown, and — the one that decides whether a benchmark can
// run 26 sessions in one host — launching again straight afterwards.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");

const OUT = process.env.LLMDBG_OUT;
const results = { when: new Date().toISOString(), cases: [] };

function wsFile(rel) {
  return path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, rel);
}

function record(name, detail) {
  results.cases.push({ name, ...detail });
}

async function getTarget() {
  const ext = vscode.extensions.getExtension("mohsen1.llm-debugger");
  assert.ok(ext, "extension mohsen1.llm-debugger not found in the dev host");
  const api = await ext.activate();
  assert.ok(api && api.target, "activate() did not return a target");
  return api.target;
}

suite("VscodeDebugTarget", function () {
  let target;

  suiteSetup(async function () {
    target = await getTarget();
  });

  teardown(async function () {
    await target.stop();
  });

  suiteTeardown(function () {
    if (OUT) fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
  });

  test("pauses at a breakpoint set before launch", async function () {
    await target.setBreakpoint(wsFile("pricing.js"), 22);
    const status = await target.launch(wsFile("run.js"));
    const paused = await target.paused();
    record("pause-at-breakpoint", {
      status,
      reason: paused && paused.reason,
      top: paused && paused.frames[0] && `${path.basename(paused.frames[0].source)}:${paused.frames[0].line}`,
      locals: paused ? paused.scopes.flatMap((s) => s.vars.map((v) => `${v.name}=${v.value}`)).slice(0, 6) : [],
    });
    record("launch-trace", target.trace ? target.trace() : { note: "no trace()" });
    record("scopes-offered", { names: paused ? paused.scopes.map((s) => s.name) : [] });
    assert.strictEqual(status, "paused", "launch did not end paused");
    assert.ok(paused, "paused() returned nothing while status said paused");
    assert.strictEqual(path.basename(paused.frames[0].source), "pricing.js");
    assert.strictEqual(paused.frames[0].line, 22);
    const locals = paused.scopes.flatMap((s) => s.vars.map((v) => v.name));
    assert.ok(
      locals.includes("totalsCents"),
      `the function argument should be readable as a local, got ${JSON.stringify(locals)}`,
    );
  });

  test("evaluates an expression in the paused frame", async function () {
    await target.setBreakpoint(wsFile("pricing.js"), 22);
    await target.launch(wsFile("run.js"));
    const ok = await target.evaluate("totalsCents");
    const bad = await target.evaluate("nopeNotDefined");
    record("evaluate", { ok: ok.value, badOk: bad.ok, badValue: bad.value.slice(0, 120) });
    assert.ok(ok.ok, `evaluate failed: ${ok.value}`);
    assert.match(ok.value, /2000/, `expected the totals array, got ${ok.value}`);
    assert.strictEqual(bad.ok, false, "an undefined identifier should not report success");
  });

  test("stepping advances execution and stays paused", async function () {
    await target.setBreakpoint(wsFile("pricing.js"), 22);
    await target.launch(wsFile("run.js"));
    const at = (s) =>
      s && `${path.basename(s.frames[0].source)}:${s.frames[0].line}:${s.frames[0].column}`;
    const before = await target.paused();
    const status = await target.step("next");
    const after = await target.paused();
    // `return totalsCents.slice().sort()` is several call positions on one
    // line, so a step over legitimately stays on line 22 at a new column.
    // What must hold is that execution moved and the session is still ours.
    const positions = [at(before), at(after)];
    for (let i = 0; i < 6 && target.status() === "paused"; i++) {
      await target.step("next");
      positions.push(at(await target.paused()));
    }
    record("step-trace", target.trace ? target.trace() : { note: "no trace()" });
    record("step", { status, reason: after && after.reason, positions });
    assert.strictEqual(status, "paused", "stepping ended the session unexpectedly");
    assert.ok(after, "no paused state after stepping");
    assert.strictEqual(after.reason, "step", `expected a step stop, got ${after.reason}`);
    assert.notStrictEqual(positions[1], positions[0], "execution did not advance at all");
    assert.ok(
      positions.some((p) => p && !p.startsWith("pricing.js:22")),
      `stepping never left line 22: ${JSON.stringify(positions)}`,
    );
  });

  test("stop removes only the breakpoints it created", async function () {
    const mine = new vscode.SourceBreakpoint(
      new vscode.Location(vscode.Uri.file(wsFile("orders.js")), new vscode.Position(8, 0)),
      true,
    );
    vscode.debug.addBreakpoints([mine]);
    try {
      await target.setBreakpoint(wsFile("pricing.js"), 22);
      await target.launch(wsFile("run.js"));
      await target.stop();
      const left = vscode.debug.breakpoints.filter((b) => b instanceof vscode.SourceBreakpoint);
      record("cleanup", {
        owned: target.ownedBreakpoints().length,
        userBreakpointSurvived: left.some((b) => path.basename(b.location.uri.fsPath) === "orders.js"),
        ourBreakpointGone: !left.some((b) => path.basename(b.location.uri.fsPath) === "pricing.js"),
      });
      assert.strictEqual(target.ownedBreakpoints().length, 0, "owned breakpoints survived stop");
      assert.ok(
        left.some((b) => path.basename(b.location.uri.fsPath) === "orders.js"),
        "the user's own breakpoint was removed",
      );
      assert.ok(
        !left.some((b) => path.basename(b.location.uri.fsPath) === "pricing.js"),
        "our breakpoint was left behind",
      );
    } finally {
      vscode.debug.removeBreakpoints([mine]);
    }
  });

  test("a second hunt can launch right after the first stops", async function () {
    const runs = [];
    for (const line of [22, 29]) {
      await target.setBreakpoint(wsFile("pricing.js"), line);
      const status = await target.launch(wsFile("run.js"));
      const paused = await target.paused();
      runs.push({
        line,
        status,
        at: paused && `${path.basename(paused.frames[0].source)}:${paused.frames[0].line}`,
      });
      await target.stop();
    }
    record("sequential-sessions", { runs });
    assert.deepStrictEqual(
      runs.map((r) => r.status),
      ["paused", "paused"],
      `back-to-back sessions did not both pause: ${JSON.stringify(runs)}`,
    );
    assert.strictEqual(runs[1].at, "pricing.js:29");
  });

  test("a program that hits no breakpoint ends instead of hanging", async function () {
    const status = await target.launch(wsFile("run.js"));
    record("no-breakpoint", { status, stdoutTail: target.output().stdout.slice(-200) });
    assert.notStrictEqual(status, "paused", "there was nothing to pause on");
    assert.match(target.output().stdout, /FAIL|PASS/, "program output was not captured");
  });
});

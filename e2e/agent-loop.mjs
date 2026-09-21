// Deterministic "script agent": drives the visible debugger through the same
// MCP tools a sidebar agent would call. Zero dependencies.
//   node e2e/agent-loop.mjs --mode=jev|llm [--steps=12] [--out=transcript.json]
// Run with cwd = examples/order-processor (bridge discovery), extension host open.
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, "..", "mcp-server", "server.mjs");

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(=(.*))?$/);
    return [m[1], m[3] ?? "true"];
  }),
);
const MODE = args.mode === "llm" ? "llm" : "jev";
const STEP_CAP = Number(args.steps || 12);

let nextId = 1;
const pending = new Map();
const child = spawn("node", [SERVER], { stdio: ["pipe", "pipe", "inherit"] });
let buf = "";
child.stdout.setEncoding("utf-8");
child.stdout.on("data", (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg);
    } catch { /* ignore */ }
  }
});

function call(tool, toolArgs) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, (msg) => {
      pending.delete(id);
      if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else resolve(msg.result);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call",
      params: { name: tool, arguments: toolArgs || {} } }) + "\n");
  });
}

const transcript = [];
async function step(label, tool, toolArgs) {
  const t0 = Date.now();
  const result = await call(tool, toolArgs);
  const text = result.content?.[0]?.text ?? JSON.stringify(result);
  transcript.push({ t: new Date().toISOString(), label, tool, input: toolArgs || {}, latencyMs: Date.now() - t0,
    output: text.slice(0, 3000) });
  console.log(`### ${label} [${tool}] ${Date.now() - t0}ms`);
  console.log(text.slice(0, 1200));
  return text;
}

function parseFileLine(text) {
  const m = text.match(/([\w\-./]+\.m?js)\s*[:#]\s*(\d{1,4})/i)
    || text.match(/([\w\-./]+\.m?js)[^\d]{1,20}line[^\d]{0,5}(\d{1,4})/i);
  if (!m || !Number(m[2])) return null;
  return { file: m[1], line: Number(m[2]) };
}

function firstWordIndicatingAction(text) {
  const line = (text.split("\n").find((l) => l.trim()) || "").toUpperCase();
  if (/\bFIX\b/.test(line)) return null;
  if (/\bSTEP[_\s-]?IN\b|\bIN\b/.test(line)) return "in";
  if (/\bSTEP[_\s-]?OUT\b|\bOUT\b/.test(line)) return "out";
  if (/\bCONTINUE\b/.test(line)) return "continue";
  return "next";
}

async function main() {
  console.log(`mode=${MODE} cap=${STEP_CAP} cwd=${process.cwd()}`);
  await step("start", "llm-debugger_start", { program: "run.js" });
  await step("bp-pricing", "llm-debugger_breakpoint", { file: "pricing.js", line: 22 });
  await step("bp-orders", "llm-debugger_breakpoint", { file: "orders.js", line: 9 });
  await step("continue-to-bp", "llm-debugger_step", { kind: "continue" });

  for (let i = 0; i < STEP_CAP; i++) {
    const stateText = await step(`observe-${i}`, "llm-debugger_state", {});
    let state;
    try { state = JSON.parse(stateText.split(":\n").slice(1).join(":\n")); }
    catch { state = {}; }
    if (state.status === "ended") { console.log("session ended"); break; }

    if (MODE === "jev") {
      const triageText = await step(`triage-${i}`, "llm-debugger_triage_jev", {});
      let triage;
      try {
        triage = JSON.parse(triageText);
      } catch {
        await step(`nudge-${i}`, "llm-debugger_step", { kind: "next" });
        continue;
      }
      const action = triage.recommendedAction;
      if (action === "finishWithFix") {
        const fix = await step("final-fix", "llm-debugger_diagnose_llm",
          { question: `Jev is confident the evidence suffices (ready p=${triage.readyForFixProb}). Write the minimal code fix with explanation.` });
        transcript.push({ t: new Date().toISOString(), label: "done", verdict: "FINISH", fix: fix.slice(0, 2000) });
        break;
      }
      if (action === "setBreakpoint") {
        const advice = await step(`escalate-${i}`, "llm-debugger_diagnose_llm",
          { question: "Jev wants a new breakpoint. Reply FIRST line with file and 1-based line, then why." });
        const loc = parseFileLine(advice);
        if (!loc) {
          await step(`act-${i}`, "llm-debugger_step", { kind: "next" });
          continue;
        }
        await step(`act-${i}`, "llm-debugger_breakpoint",
          { file: loc.file, line: loc.line });
        // Run to the new breakpoint so the pause visibly lands on it.
        await step(`land-${i}`, "llm-debugger_step", { kind: "continue" });
        continue;
      }
      await step(`act-${i}`, "llm-debugger_step",
        { kind: action === "stepIn" ? "in" : action === "stepOut" ? "out" : action === "continue" ? "continue" : "next" });
    } else {
      const diag = await step(`diagnose-${i}`, "llm-debugger_diagnose_llm",
        { question: `Step ${i}: reply FIRST line with one of NEXT/IN/OUT/CONTINUE/FIX, then brief reasoning.` });
      const kind = firstWordIndicatingAction(diag);
      if (!kind) {
        transcript.push({ t: new Date().toISOString(), label: "done", verdict: "FIX", fix: diag.slice(0, 2000) });
        break;
      }
      await step(`act-${i}`, "llm-debugger_step", { kind });
    }
  }

  let endText = "";
  try {
    endText = await step("stop", "llm-debugger_stop", {});
  } catch (e) {
    endText = `stop failed: ${e.message}`;
  }
  const out = args.out || `e2e-transcript-${MODE}.json`;
  fs.writeFileSync(out, JSON.stringify({ mode: MODE, transcript, stop: endText.slice(0, 3000) }, null, 1));
  console.log(`transcript -> ${out}`);
  child.kill();
}

main().catch((e) => { console.error("AGENT LOOP FAILED:", e.message); child.kill(); process.exit(1); });

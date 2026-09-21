// Zero-dependency MCP (stdio) server for the VSCode LLM-Debugger extension.
// Forwards tool calls to the extension's localhost bridge, so Claude Code,
// Codex CLI, Copilot — anything speaking MCP — can drive the VISIBLE debugger.
//
// Setup (from the repo root, with the extension host running):
//   claude mcp add llm-debugger -- node /ABS/REPO/mcp-server/server.mjs
//   codex mcp add llm-debugger -- node /ABS/REPO/mcp-server/server.mjs
// The bridge file .llm-debugger/bridge.json is written by the extension on
// activation; override with LLM_DEBUGGER_BRIDGE='{"port":N,"token":"..."}'.
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";

const TOOL_DEFS = [
  { name: "llm-debugger_start", description: "Launch a program under the VISIBLE VSCode debugger. Set breakpoints FIRST or it may run to exit without pausing. Input: { program: workspace-relative or absolute path, stopOnEntry?: boolean }.", inputSchema: { type: "object", properties: { program: { type: "string" }, stopOnEntry: { type: "boolean" } }, required: ["program"] } },
  { name: "llm-debugger_breakpoint", description: "Set or remove a breakpoint shown as a red dot. Input: { file, line (1-based), action: set|remove, default set }.", inputSchema: { type: "object", properties: { file: { type: "string" }, line: { type: "number" }, action: { type: "string", enum: ["set", "remove"] } }, required: ["file", "line"] } },
  { name: "llm-debugger_step", description: "Advance the paused program visibly; the editor highlight moves. Input: { kind: next|in|out|continue }. Returns the new paused state.", inputSchema: { type: "object", properties: { kind: { type: "string", enum: ["next", "in", "out", "continue"] } }, required: ["kind"] } },
  { name: "llm-debugger_state", description: "Read current debugger state (stack, variables, breakpoints, output) without moving execution.", inputSchema: { type: "object", properties: {} } },
  { name: "llm-debugger_evaluate", description: "Evaluate a JavaScript expression in the paused frame and return its value — the cheapest way to test a hypothesis about runtime state. Input: { expression }.", inputSchema: { type: "object", properties: { expression: { type: "string" } }, required: ["expression"] } },
  { name: "llm-debugger_triage_jev", description: "Fast typed decision (sub-second, output tokens free): recommended next debugger action with confidence plus a ready-for-fix probability. Prefer over slow reasoning for routine step routing. Input: { symptom? }.", inputSchema: { type: "object", properties: {} } },
  { name: "llm-debugger_diagnose_llm", description: "Ask the generation model to analyse the paused state — the expensive path. Use for fix synthesis and explanations, not routine step routing. Input: { question, symptom? }.", inputSchema: { type: "object", properties: { question: { type: "string" }, symptom: { type: "string" } } } },
  { name: "llm-debugger_stop", description: "End the session and remove every breakpoint these tools created. The user's own breakpoints are left alone.", inputSchema: { type: "object", properties: {} } },
];

function findBridge() {
  if (process.env.LLM_DEBUGGER_BRIDGE) return JSON.parse(process.env.LLM_DEBUGGER_BRIDGE);
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const f = path.join(dir, ".llm-debugger", "bridge.json");
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf-8"));
    dir = path.dirname(dir);
  }
  throw new Error("Bridge not found: open the repo in VSCode with the LLM-Debugger extension running (it writes .llm-debugger/bridge.json), or set LLM_DEBUGGER_BRIDGE.");
}

function callBridge(name, input) {
  const { port, token } = findBridge();
  const body = JSON.stringify({ name, input: input || {} });
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: "/tool", method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const j = JSON.parse(data);
            resolve(j.text ?? JSON.stringify(j));
          } catch { reject(new Error(`bridge bad response: ${data.slice(0, 200)}`)); }
        });
      });
    req.on("error", (e) => reject(new Error(`bridge unreachable (is the extension host running?): ${e.message}`)));
    req.end(body);
  });
}

const stdin = process.stdin;
stdin.setEncoding("utf-8");
let buffer = "";
stdin.on("data", async (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (line) await handle(line);
  }
});

async function handle(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === "notifications/initialized") return;
  const reply = (result, error) => {
    const out = { jsonrpc: "2.0", id: msg.id };
    if (error) out.error = error;
    else out.result = result ?? {};
    process.stdout.write(JSON.stringify(out) + "\n");
  };
  try {
    switch (msg.method) {
      case "initialize":
        reply({ protocolVersion: "2024-11-05", capabilities: { tools: {} },
          serverInfo: { name: "llm-debugger", version: "0.1.0" } });
        break;
      case "tools/list":
        reply({ tools: TOOL_DEFS });
        break;
      case "tools/call": {
        const text = await callBridge(msg.params?.name, msg.params?.arguments);
        reply({ content: [{ type: "text", text: String(text).slice(0, 12000) }] });
        break;
      }
      case "ping":
        reply({});
        break;
      default:
        reply(null, { code: -32601, message: `unknown method: ${msg.method}` });
    }
  } catch (e) {
    if (msg.method === "tools/call") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id,
        result: { content: [{ type: "text", text: `Tool error: ${e.message}` }], isError: true } }) + "\n");
    } else reply(null, { code: -32603, message: e.message });
  }
}

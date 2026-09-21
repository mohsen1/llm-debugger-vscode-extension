import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import type { DebugTarget } from "../debug/DebugTarget";
import { AGENT_TOOL_DEFS, callAgentTool } from "./registry";
import logger from "../logger";

const log = logger.createSubLogger("Bridge");

export interface BridgeInfo {
  port: number;
  token: string;
}

/**
 * Localhost HTTP bridge so OUT-OF-PROCESS agents (Claude Code, Codex CLI —
 * anything that speaks MCP) can drive the same visible debugger.
 * Listens on 127.0.0.1 only, bearer token, workspace-local discovery file.
 */
export function startBridge(
  target: DebugTarget,
  workspaceDir: string,
): Promise<{ info: BridgeInfo; stop: () => void }> {
  const token = crypto.randomBytes(24).toString("hex");
  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/tool") {
      res.writeHead(404).end();
      return;
    }
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401).end(JSON.stringify({ ok: false, error: "unauthorized" }));
      return;
    }
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 1_000_000) req.destroy();
    });
    req.on("end", async () => {
      try {
        const { name, input } = JSON.parse(body || "{}");
        if (!AGENT_TOOL_DEFS.some((d) => d.name === name)) {
          res.writeHead(400).end(JSON.stringify({ ok: false, error: `unknown tool: ${name}` }));
          return;
        }
        const text = await callAgentTool(target, name, input || {});
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true, text }));
      } catch (err) {
        res.writeHead(200, { "Content-Type": "application/json" }).end(
          JSON.stringify({ ok: true, text: `Tool error: ${String(err)}` }),
        );
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("bridge failed to bind"));
        return;
      }
      const info = { port: addr.port, token };
      try {
        const dir = path.join(workspaceDir, ".llm-debugger");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "bridge.json"), JSON.stringify({ ...info, pid: process.pid }));
      } catch (err) {
        log.warn(`could not write bridge.json: ${String(err).slice(0, 160)}`);
      }
      log.debug(`bridge listening on 127.0.0.1:${info.port}`);
      resolve({ info, stop: () => server.close() });
    });
  });
}

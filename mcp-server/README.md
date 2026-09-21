# llm-debugger MCP server

Zero-dependency stdio MCP server. Forwards the 7 debugger tools to the
VSCode extension's localhost bridge (127.0.0.1 + bearer token, discovered
via `.llm-debugger/bridge.json` written by the extension on activation).

```bash
# from the repo root, extension host running:
claude mcp add llm-debugger -- node $PWD/mcp-server/server.mjs
codex mcp add llm-debugger -- node $PWD/mcp-server/server.mjs
```

Smoke test (no bridge needed for list):

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | node mcp-server/server.mjs
```

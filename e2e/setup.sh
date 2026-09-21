#!/bin/bash
# One-time setup: register the debugger MCP server with Claude Code and Codex.
# Idempotent — skips servers that are already registered.
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
SERVER="$REPO/mcp-server/server.mjs"
node --check "$SERVER" || exit 1

if command -v claude >/dev/null 2>&1; then
  if claude mcp list 2>/dev/null | grep -q "llm-debugger"; then
    echo "claude: llm-debugger already registered"
  else
    claude mcp add llm-debugger -- node "$SERVER" && echo "claude: registered"
  fi
else
  echo "claude: CLI not found, skipping"
fi

if command -v codex >/dev/null 2>&1; then
  if codex mcp list 2>/dev/null | grep -q "llm-debugger"; then
    echo "codex: llm-debugger already registered"
  else
    codex mcp add llm-debugger -- node "$SERVER" && echo "codex: registered"
  fi
else
  echo "codex: CLI not found, skipping"
fi

echo "Copilot needs no setup: it uses the extension's native languageModelTools in the IDE."

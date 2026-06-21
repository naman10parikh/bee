# bee MCP — dual-mode transport

bee's MCP server ships in **two transports**. Stdio is the primary (built + tested);
Streamable-HTTP is the documented prod path (the dual-mode obligation, HARNESS-OVERRIDES
§7 — "a documented dual-mode (stdio local + Streamable-HTTP hosted path)").

## 1. Stdio (PRIMARY — built, this directory)

The default consumption pattern for a dev-tool employee. A coding agent (or `.mcp.json`)
spawns the server as a subprocess and speaks line-delimited JSON-RPC 2.0 over stdin/stdout.

```jsonc
// .mcp.json (already wired — see C2)
"bee": {
  "command": "node",
  "args": ["./src/backend/mcp/server.js"],
  "env": { "REDIS_URL": "${REDIS_URL}" }   // env-ref only; no literal keys
}
```

Smoke test (tokenless): `node src/backend/mcp/server.js --list` prints the 9 tool names.
Protocol test: pipe a `tools/list` JSON-RPC request on stdin (see the C1 verify line).

## 2. Streamable-HTTP (DOCUMENTED — the hosted/cross-org path, JTBD-10)

When bee's jobs operations must be reachable **across an org boundary** (the A2A
hand-a-job-across-orgs case, JTBD-10), the same 9 tools are exposed over the MCP
**Streamable-HTTP** transport (the `2025-03-26` spec successor to HTTP+SSE):

- A single `POST /mcp` endpoint accepts JSON-RPC requests; the server MAY upgrade the
  response to an SSE stream for long-running/streamed tool calls (e.g. a `worker` that
  reports progress) via `Content-Type: text/event-stream`.
- `GET /mcp` opens a server→client SSE channel for server-initiated messages.
- A `Mcp-Session-Id` header (issued on `initialize`) correlates requests in a session.

### Why it's documented-not-built (Karpathy Simplicity-First)

The merge-gating acceptance test, the cockpit, and the `.mcp.json` consumption pattern
all use **stdio** — that is the surface bee is actually consumed through today. Building a
hosted HTTP listener now would be speculative (no caller needs it yet) and would pull in
an HTTP framework + auth (OAuth 2.1 PKCE, the MCP-first-connectors pattern) that is not on
the critical path. The contract below is the implementation spec for when a remote caller
appears; the tool catalog (`tools.js`) is transport-agnostic and is reused verbatim.

### Implementation sketch (when a remote caller appears)

```
POST /mcp  { jsonrpc:"2.0", id, method:"tools/call", params:{ name, arguments } }
  → reuse handleToolCall() from server.js (same TOOLS catalog)
  → respond application/json for fast tools (enqueue/check/explain/search_brain)
  → respond text/event-stream for streamed tools (worker progress)

Auth: OAuth 2.1 + PKCE per the fleet's mcp-first-connectors rule
      (Authorization: Bearer <token bound to the canonical bee MCP URL>).
Secrets: still env-ref only (REDIS_URL); no provider key is bundled.
```

### A2A linkage

The A2A card (`.well-known/agent.json`, F3) advertises this Streamable-HTTP URL as the
`endpoint`. The `capabilities` array is the DELIVERED tool set (enqueue/worker/scaffold/
wire-webhook/audit/pick-tool/check/brain/explain); `plannedCapabilities` carries the
frontier token-bucket (honest stub — never "solved").

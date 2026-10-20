#!/usr/bin/env node
// bee MCP server — stdio transport (the PRIMARY mode, PLAN Q4 default).
//
// bee ships its OWN MCP server (HARNESS-OVERRIDES §7 — NOT satisfied by the inherited
// github/context7/memory/obsidian template). It is a thin CLI-wrapper: each tool spawns
// `node bin/bee.js <cmd> ... --json` and returns the parsed JSON. That keeps the server
// honest (parity-by-construction with the CLI) and zero-dep (no @modelcontextprotocol/sdk
// — bee's only runtime deps stay bullmq + ioredis).
//
// DUAL-MODE (the prod obligation): this stdio server is the local/dev surface a coding
// agent consumes. The Streamable-HTTP path (hosting bee's MCP over HTTP for cross-org /
// remote consumption — JTBD-10) is DOCUMENTED, not over-built, in
// `src/backend/mcp/STREAMABLE-HTTP.md`. No live keys here — Redis is env-ref'd
// (REDIS_URL); no vendor secret is needed for the core enqueue/worker path.
//
// PROTOCOL: line-delimited JSON-RPC 2.0 over stdin/stdout. We implement `initialize`,
// `tools/list`, `tools/call`, and the `notifications/initialized` no-op. Diagnostics go
// to stderr so stdout stays a clean JSON-RPC stream (the verify line pipes one
// `tools/list` request and parses `result.tools`).

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BEE_CLI = join(__dirname, "..", "..", "..", "bin", "bee.js");

import { TOOLS, findTool, listTools } from "./tools.js";

const PROTOCOL_VERSION = "2024-11-05"; // the MCP stdio protocol revision bee speaks
const SERVER_VERSION = "0.1.0";

/** Write a single JSON-RPC message as one stdout line. @param {object} msg */
function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

/**
 * A JSON-RPC error response.
 * @param {string|number|null} id
 * @param {number} code
 * @param {string} message
 */
function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/**
 * Run the bee CLI with the given argv and resolve its parsed-JSON stdout.
 * The CLI emits exactly one JSON line on stdout for `--json` commands; stderr
 * carries diagnostics (per-job logs, notes) which we surface only on failure.
 *
 * @param {string[]} argv  - argv AFTER `bee` (e.g. ["enqueue","--queue","q","--json"])
 * @returns {Promise<{ ok: boolean, data?: any, raw: string, stderr: string, code: number }>}
 */
function runBee(argv) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BEE_CLI, ...argv], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => resolve({ ok: false, raw: "", stderr: String(e), code: -1 }));
    child.on("close", (code) => {
      const raw = out.trim();
      let data;
      let parsed = false;
      // The CLI's last stdout line is the JSON result (some commands print nothing
      // but exit 0). Parse the last non-empty line defensively.
      const lastLine = raw.split("\n").filter(Boolean).pop() ?? "";
      try {
        data = JSON.parse(lastLine);
        parsed = true;
      } catch {
        parsed = false;
      }
      resolve({ ok: code === 0, data: parsed ? data : undefined, raw, stderr: err.trim(), code: code ?? 0 });
    });
  });
}

/**
 * Handle a `tools/call`.
 * @param {string|number} id
 * @param {any} params
 * @returns {Promise<object>} the JSON-RPC result/error
 */
async function handleToolCall(id, params) {
  const name = params?.name;
  const args = params?.arguments ?? {};
  const tool = findTool(name);
  if (!tool) {
    return rpcError(id, -32602, `unknown tool: ${name}`);
  }
  const argv = tool.argv(args);
  const res = await runBee(argv);
  if (!res.ok) {
    // Surface the CLI's exit code + stderr as a tool error (isError content block).
    return {
      jsonrpc: "2.0",
      id,
      result: {
        isError: true,
        content: [
          { type: "text", text: `bee ${argv.join(" ")} exited ${res.code}\n${res.stderr || res.raw}` },
        ],
      },
    };
  }
  // MCP content: a structured `text` block carrying the JSON result (the canonical
  // way to return tool output over MCP). The parsed object is echoed for clients
  // that read structuredContent.
  const text = res.data !== undefined ? JSON.stringify(res.data) : res.raw;
  return {
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text", text }],
      structuredContent: res.data,
    },
  };
}

/**
 * Dispatch one parsed JSON-RPC request.
 * @param {{ id?: string|number|null, method?: string, params?: any }} req
 */
async function dispatch(req) {
  const { id, method, params } = req;

  // Notifications (no id) — acknowledge silently per the spec.
  if (id === undefined || id === null) {
    return; // e.g. notifications/initialized
  }

  switch (method) {
    case "initialize":
      send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "bee", version: SERVER_VERSION },
          instructions:
            "bee — background-jobs/queues/durable-workflows employee. THE ONE INVARIANT: at-least-once transport + idempotent consumer + DB-unique-constraint dedupe; on ambiguous timeout, query state, never blind-retry. Never bare 'exactly-once' — exactly-once *effect*.",
        },
      });
      return;

    case "tools/list":
      send({ jsonrpc: "2.0", id, result: { tools: listTools() } });
      return;

    case "tools/call":
      send(await handleToolCall(id, params));
      return;

    case "ping":
      send({ jsonrpc: "2.0", id, result: {} });
      return;

    default:
      send(rpcError(id, -32601, `method not found: ${method}`));
  }
}

// `--help` and `--version` answer and exit before the stdio loop starts (the one-step install
// check runs `npx -y -p github:naman10parikh/bee bee-mcp --help`).
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  process.stdout.write(
    "bee-mcp: bee's MCP server over stdio (newline-delimited JSON-RPC, 9 tools that wrap the bee CLI).\n" +
      "Register it in an MCP client. `--list` prints the tool names and `--version` the version.\n" +
      "The enqueue and worker tools read REDIS_URL (default redis://localhost:6379).\n",
  );
  process.exit(0);
}
if (process.argv.includes("--version")) {
  process.stdout.write(`${SERVER_VERSION}\n`);
  process.exit(0);
}

// ── stdio loop: one JSON-RPC object per line ────────────────────────────────
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  /** @type {{ id?: string|number|null, method?: string, params?: any }} */
  let req;
  try {
    req = JSON.parse(trimmed);
  } catch {
    send(rpcError(null, -32700, "parse error"));
    return;
  }
  // Don't let one bad request kill the server.
  dispatch(req).catch((e) => {
    process.stderr.write(`[bee-mcp] dispatch error: ${e?.stack || e}\n`);
    if (req && req.id != null) send(rpcError(req.id, -32603, String(e?.message || e)));
  });
});

// A bare `--list` flag prints the tool names + exits (a tokenless smoke check that
// does NOT require driving the stdio protocol — handy for CI / the plugin manifest).
if (process.argv.includes("--list")) {
  process.stdout.write(JSON.stringify({ tools: TOOLS.map((t) => t.name) }) + "\n");
  process.exit(0);
}

process.stderr.write("[bee-mcp] stdio server ready (9 tools) — pipe JSON-RPC on stdin\n");

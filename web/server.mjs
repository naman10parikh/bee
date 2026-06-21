#!/usr/bin/env node
// bee cockpit — Node stdlib HTTP server (zero npm deps, no build). CP123 Cluster G (G1).
//
// The chairman's read-mostly window into the bee employee (DECISIONS D3, PLAN §10, Q5).
// bee is a Node repo, so the "stdlib server" is Node's own `node:http` — not Python like the
// sentinel/talent-intel reference. Same architecture as turbo's cockpit: a static SPA + a
// small JSON API that reads the canonical sources (the brain/ markdown, logs/runs.jsonl, the
// cached eval result, the cached dispatch-run queue/DLQ result).
//
// Read-mostly (Q5): the only CLI it shells out to are the READ-ONLY queries `bee brain` /
// `bee explain` / `bee pick-tool` (--json). It NEVER enqueues, triggers, scaffolds, or audits
// from the browser — those mutating ops belong on the CLI/MCP (the agent surfaces). The
// Queue & DLQ view *displays* the last dispatch run's lifecycle; it does not *drive* one.
//
// bee's CLI is plain JS (`node bin/bee.js`) — no `dist/` build step (tsconfig is noEmit/
// typecheck-only), so unlike turbo this server shells straight at bin/bee.js.
//
// Run:  bash scripts/serve.sh            -> http://localhost:7777
// Env:  BEE_WEB_PORT (default 7777)
//
// Endpoints (all GET — there are NO mutating routes, Q5):
//   GET /                       -> web/index.html (the SPA)
//   GET /app.js | /style.css    -> static assets
//   GET /api/health             -> { ok, port, ts }
//   GET /api/brain?q=...        -> bee brain --json (ranked BM25 hits over brain/)
//   GET /api/explain?id=...     -> bee explain <id> --json (detection+fix for a P-/S-/O-/G-id)
//   GET /api/pick-tool?profile= -> bee pick-tool --profile <p> --json (decision oracle)
//   GET /api/brain-doc?file=... -> raw markdown of one brain/ artifact (allow-listed)
//   GET /api/runs?limit=N       -> tail of logs/runs.jsonl (parsed, newest-first)
//   GET /api/eval               -> cached eval pyramid result (eval/eval-result.json) + as-of ts
//   GET /api/queue              -> cached dispatch-run queue/DLQ lifecycle (web/queue-result.json)

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");
const WEB = __dirname;
const CLI = join(REPO, "bin", "bee.js");
const RUNS = join(REPO, "logs", "runs.jsonl");
const EVAL_CACHE = join(REPO, "eval", "eval-result.json");
const QUEUE_CACHE = join(WEB, "queue-result.json");
const PORT = Number(process.env.BEE_WEB_PORT || 7777);

// The six brain artifacts the brain-browser renders. Allow-list = no path traversal (the
// energy browser-agent security rule: sanitize before any file read; this is a fixed set).
const BRAIN_FILES = new Set([
  "EXPERTISE-MAP.md",
  "BATTLE-TESTED-SCENARIOS.md",
  "KNOWN-PITFALLS.md",
  "OPINIONS.md",
  "GAPS-AND-DISPUTES.md",
  "TOOL-MATRIX.md",
]);

// The pick-tool profiles bee's decision oracle accepts (PLAN §4) — allow-listed so a bad
// query param can never become an arbitrary CLI arg.
const PICK_PROFILES = new Set([
  "serverless",
  "cloudflare",
  "aws",
  "http-only",
  "scale",
  "complex",
  "postgres",
]);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(res, status, body) {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": buf.length,
    "cache-control": "no-store",
  });
  res.end(buf);
}

async function sendStatic(res, file) {
  try {
    const buf = await readFile(file);
    const ext = file.slice(file.lastIndexOf("."));
    res.writeHead(200, {
      "content-type": MIME[ext] || "application/octet-stream",
      "content-length": buf.length,
    });
    res.end(buf);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
}

// Shell out to the bee CLI for a READ-ONLY query. Returns parsed JSON or a typed error
// object (never throws — the law: convert errors at the boundary, no try-catch-swallow-crash).
function runCli(args) {
  return new Promise((resolveP) => {
    execFile(
      process.execPath,
      [CLI, ...args, "--json"],
      { cwd: REPO, timeout: 15000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (!stdout) {
          resolveP({ ok: false, error: err ? err.message : "no output" });
          return;
        }
        // bee CLI commands print one JSON value as the last non-empty stdout line.
        const last = String(stdout).trim().split("\n").filter(Boolean).pop() ?? "";
        try {
          resolveP(JSON.parse(last));
        } catch {
          resolveP({ ok: false, error: "non-json output", raw: String(stdout).slice(0, 400) });
        }
      },
    );
  });
}

async function tailRuns(limit) {
  try {
    const raw = await readFile(RUNS, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim());
    const parsed = [];
    for (const line of lines) {
      try {
        parsed.push(JSON.parse(line));
      } catch {
        // skip a half-written line — the run-logger appends atomically per line, but be safe
      }
    }
    parsed.reverse(); // newest first
    return { ok: true, total: parsed.length, runs: parsed.slice(0, limit) };
  } catch {
    return { ok: true, total: 0, runs: [] };
  }
}

// A cached JSON sidecar (eval result / dispatch queue result). Both are too slow / need Redis
// to run per-request, so serve.sh warms them once on boot; the UI degrades gracefully if absent.
async function cachedJson(file, note) {
  try {
    const [raw, st] = await Promise.all([readFile(file, "utf8"), stat(file)]);
    return { ok: true, asOf: st.mtime.toISOString(), result: JSON.parse(raw) };
  } catch {
    return { ok: false, asOf: null, result: null, note };
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  // Read-only API surface only. No POST/PATCH/PUT routes exist (Q5 — read-mostly cockpit).
  if (req.method !== "GET") {
    sendJson(res, 405, { ok: false, error: "read-only cockpit (Q5) — only GET" });
    return;
  }

  if (path === "/api/health") {
    sendJson(res, 200, { ok: true, port: PORT, ts: new Date().toISOString() });
    return;
  }
  if (path === "/api/brain") {
    const q = (url.searchParams.get("q") || "").trim();
    if (!q) {
      sendJson(res, 200, { ok: true, query: "", hits: [] });
      return;
    }
    // `bee brain` prints a bare array of hits; wrap it so the UI always sees {ok, hits}.
    const hits = await runCli(["brain", q]);
    sendJson(res, 200, Array.isArray(hits) ? { ok: true, query: q, hits } : hits);
    return;
  }
  if (path === "/api/explain") {
    const id = (url.searchParams.get("id") || "").trim();
    // Brain IDs: a category cluster (P/S/O/G/JTBD), an optional dash, an optional sub-category
    // letter cluster (X/B/TE/I/S/Q…), then 1-4 digits. e.g. P-X5 · P-TE1 · S-3 · O-8 · G-4 ·
    // G1 · JTBD-11. The strict shape doubles as path-traversal defense (no slashes/dots).
    if (!/^[A-Za-z]{1,4}-?[A-Za-z]{0,3}\d{1,4}$/.test(id)) {
      sendJson(res, 400, { ok: false, error: "id must look like P-X5 / P-TE1 / S-3 / O-8 / G1 / JTBD-11" });
      return;
    }
    sendJson(res, 200, await runCli(["explain", id]));
    return;
  }
  if (path === "/api/pick-tool") {
    const profile = (url.searchParams.get("profile") || "").trim();
    if (!PICK_PROFILES.has(profile)) {
      sendJson(res, 400, { ok: false, error: "unknown profile", allowed: [...PICK_PROFILES] });
      return;
    }
    sendJson(res, 200, await runCli(["pick-tool", "--profile", profile]));
    return;
  }
  if (path === "/api/brain-doc") {
    const file = url.searchParams.get("file") || "";
    if (!BRAIN_FILES.has(file)) {
      sendJson(res, 400, { ok: false, error: "unknown brain file", allowed: [...BRAIN_FILES] });
      return;
    }
    try {
      const md = await readFile(join(REPO, "brain", file), "utf8");
      sendJson(res, 200, { ok: true, file, markdown: md });
    } catch {
      sendJson(res, 404, { ok: false, error: "brain file not found" });
    }
    return;
  }
  if (path === "/api/runs") {
    const limit = Math.min(Number(url.searchParams.get("limit") || 50) || 50, 500);
    sendJson(res, 200, await tailRuns(limit));
    return;
  }
  if (path === "/api/eval") {
    sendJson(
      res,
      200,
      await cachedJson(EVAL_CACHE, "eval cache not built yet — run `node bin/bee.js eval --json > eval/eval-result.json`"),
    );
    return;
  }
  if (path === "/api/queue") {
    sendJson(
      res,
      200,
      await cachedJson(
        QUEUE_CACHE,
        "queue cache not built yet — run `REDIS_URL=redis://localhost:6379 node src/backend/dispatch/route.js --json > web/queue-result.json` (needs an ephemeral Redis)",
      ),
    );
    return;
  }

  // Static SPA.
  if (path === "/" || path === "/index.html") {
    await sendStatic(res, join(WEB, "index.html"));
    return;
  }
  if (path === "/app.js") {
    await sendStatic(res, join(WEB, "app.js"));
    return;
  }
  if (path === "/style.css") {
    await sendStatic(res, join(WEB, "style.css"));
    return;
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
});

server.listen(PORT, () => {
  process.stdout.write(`bee cockpit on http://localhost:${PORT}\n`);
});

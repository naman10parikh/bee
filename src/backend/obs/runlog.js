// Observability — bee's OWN run telemetry (E3, layer a). Every `bee` invocation
// appends one append-only row to logs/runs.jsonl: the command, the model that ran
// it, wall-clock duration, tool-calls, and the outcome. This is the employee's
// self-telemetry — the cost/latency/trace-per-run the checklist §10 + PLAN §3.10
// require ("token/cost + duration + tool-calls per bee run appended to
// logs/runs.jsonl (append-only)").
//
// Layer (b) — the GENERATED jobs layer's structured per-job logs + the append-only
// audit row per state-mutating job — lives in src/db/dedup.js (audit_log table) +
// src/backend/queue.js (logJob) and is exercised by the acceptance test (E2). This
// file is bee's OWN run log only.
//
// Append-only by construction: O_APPEND open via appendFileSync, one JSON line per
// run. logs/ is gitignored (generated telemetry — never committed).

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// repo root = src/backend/obs → ../../../
const REPO_ROOT = join(__dirname, "..", "..", "..");
const RUNS_LOG = join(REPO_ROOT, "logs", "runs.jsonl");

/**
 * The model bee runs under. Per D14 the budget is disabled as a constraint and the
 * fleet always runs the latest flagship Opus at max effort — but the telemetry records the ACTUAL env-pinned
 * model (ANTHROPIC_MODEL / CLAUDE_CODE_SUBAGENT_MODEL) when present, falling back to
 * "default", Claude Code's own model, so the row is never empty (the verify line asserts `e.model`).
 * @returns {string}
 */
export function activeModel() {
  return (
    process.env.ANTHROPIC_MODEL ||
    process.env.CLAUDE_CODE_SUBAGENT_MODEL ||
    "default"
  );
}

/**
 * A live run timer. `start()` captures the high-resolution clock; `.end(extra)`
 * writes the append-only row and returns it. Tool-calls default to 1 (the command
 * itself is one tool invocation from the harness's POV); callers that fan out can
 * pass a real count.
 *
 * @param {{ command: string|undefined, toolCalls?: number }} ctx
 * @returns {{ end: (extra?: { outcome?: string, toolCalls?: number, cost?: number|null }) => RunRow }}
 */
export function startRun(ctx) {
  const startedNs = process.hrtime.bigint();
  const startedAt = new Date().toISOString();
  return {
    end(extra = {}) {
      const durationMs = Number(process.hrtime.bigint() - startedNs) / 1e6;
      /** @type {RunRow} */
      const row = {
        ts: Date.now(),
        startedAt,
        command: ctx.command ?? "(none)",
        model: activeModel(),
        duration: Math.round(durationMs * 1000) / 1000, // ms, 3dp
        durationMs: Math.round(durationMs * 1000) / 1000,
        // cost is unknown for a $0 local CLI run (no model call) — recorded as null,
        // not faked. The RSI Claude-half (D8) is the only path that incurs token cost.
        cost: extra.cost ?? null,
        toolCalls: extra.toolCalls ?? ctx.toolCalls ?? 1,
        outcome: extra.outcome ?? "ok",
      };
      appendRunRow(row);
      return row;
    },
  };
}

/**
 * @typedef {object} RunRow
 * @property {number} ts            - epoch ms when the row was written
 * @property {string} startedAt     - ISO timestamp when the run started
 * @property {string} command       - the bee subcommand
 * @property {string} model         - the model the run executed under
 * @property {number} duration      - wall-clock ms (alias of durationMs)
 * @property {number} durationMs    - wall-clock ms
 * @property {number|null} cost     - token cost (null for $0 local runs)
 * @property {number} toolCalls     - tool invocations during the run
 * @property {string} outcome       - ok | error
 */

/**
 * Append one row to logs/runs.jsonl (creating logs/ if needed). Never throws —
 * telemetry must not break a real command (a disk error degrades to a stderr note).
 * @param {RunRow} row
 */
export function appendRunRow(row) {
  try {
    mkdirSync(dirname(RUNS_LOG), { recursive: true });
    appendFileSync(RUNS_LOG, JSON.stringify(row) + "\n");
  } catch (err) {
    // Intentionally non-fatal: observability is best-effort, the command still ran.
    process.stderr.write(`[bee] runlog: could not append telemetry: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

export { RUNS_LOG };

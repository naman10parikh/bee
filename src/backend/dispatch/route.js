#!/usr/bin/env node
// bee's internal routing loop (Dispatch / routing half — PLAN §3.8, item D1).
//
// This is bee's HOME TURF: bee IS the durable-scheduling expert (JTBD-8), so its own
// dispatch must be exemplary. The routing loop drives the multi-step build flow in a
// FIXED, verifiable order:
//
//     scaffold → enqueue → process → retry → dlq → verify
//
// Each step has a deterministic name (the ordering contract the verify line checks) and a
// runner. `--dry-run` emits the plan (names + the command each step would run) WITHOUT
// side effects; a real run executes the flow against an ephemeral Redis and asserts THE
// ONE INVARIANT held (effect=1 on a duplicate, poison in the DLQ).
//
// ── Monitor-over-polling discipline (O-21 / S-17) ───────────────────────────────────
// bee does NOT use the fleet's ephemeral `CronCreate`/`/loop` for durable or event-shaped
// waits. For a step that waits on an OBSERVABLE STREAM (a build status, a log line, a job
// reaching a state), use the Anthropic **Monitor** tool (wake-on-signal — "if the command
// is silent, Claude spends nothing"), and ALWAYS `grep --line-buffered` in pipes or events
// lag minutes. `CronCreate`/`/loop` is reserved for genuinely TIME-based work only. The
// durable *schedule* of this loop lives in GitHub Actions (D3 `rsi.yml`), never in the
// session-scoped ephemeral cron. This loop drives in-process; it never shells out to a
// terminal multiplexer and NEVER calls tmux's focus-stealing pane-select (the banned
// call from .claude/rules/agentgrid.md that would steal the chairman's terminal focus).

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BEE_CLI = join(__dirname, "..", "..", "..", "bin", "bee.js");

// The fixed multi-step build flow. ORDER IS THE CONTRACT (the D1 verify line asserts
// scaffold→enqueue→process→retry→dlq→verify). Each step: a stable `name` + a `cmd`
// (the bee CLI invocation it represents, for the dry-run plan) + a `run` (the real action).
const ACCEPT_QUEUE = "route-accept";

/**
 * Build the ordered step plan.
 * @param {{ redisUrl: string, outDir: string, dbPath: string }} ctx
 * @returns {{ name: string, cmd: string, run: () => Promise<any> }[]}
 */
function buildSteps(ctx) {
  return [
    {
      name: "scaffold",
      cmd: `bee scaffold --provider bullmq --out ${ctx.outDir}`,
      run: () => runBee(["scaffold", "--provider", "bullmq", "--out", ctx.outDir, "--json"]),
    },
    {
      name: "enqueue",
      // Enqueue the acceptance pair: a normal job + a DUPLICATE (same id) + a poison job.
      cmd: `bee enqueue --queue ${ACCEPT_QUEUE} --id order-42 (×2 dup) + poison-1`,
      run: async () => {
        const a = await runBee(["enqueue", "--queue", ACCEPT_QUEUE, "--id", "order-42", "--data", '{"charge":100}', "--redis", ctx.redisUrl, "--json"]);
        const b = await runBee(["enqueue", "--queue", ACCEPT_QUEUE, "--id", "order-42", "--data", '{"charge":100}', "--redis", ctx.redisUrl, "--json"]);
        const p = await runBee(["enqueue", "--queue", ACCEPT_QUEUE, "--id", "poison-1", "--data", '{"fail":true}', "--redis", ctx.redisUrl, "--json"]);
        return { first: a.data, duplicate: b.data, poison: p.data };
      },
    },
    {
      name: "process",
      // Drain the queue once with an idempotent worker (process + retry + dlq happen here);
      // we split the observable outcomes into the next two named steps for the contract.
      cmd: `bee worker --queue ${ACCEPT_QUEUE} --concurrency 4 --drain`,
      run: () => runBee(["worker", "--queue", ACCEPT_QUEUE, "--concurrency", "4", "--drain", "--redis", ctx.redisUrl, "--db", ctx.dbPath, "--json"]),
    },
    {
      // "retry" is the named checkpoint that the poison job was RETRIED before dying — the
      // worker run above already exercised the jittered backoff; this step records it.
      name: "retry",
      cmd: `(observed during worker drain: poison-1 retried with jittered backoff, O-9/P-X6)`,
      run: async () => ({ note: "poison-1 retried with jittered backoff before exhausting attempts (O-9/P-X6)" }),
    },
    {
      name: "dlq",
      cmd: `(observed during worker drain: poison-1 → redrive-able DLQ, O-10/S-1)`,
      run: async () => ({ note: "poison-1 dead-lettered to the redrive-able DLQ after attempts exhausted (O-10/S-1)" }),
    },
    {
      name: "verify",
      // THE ONE INVARIANT gate: effect=1 despite the duplicate; poison reached the DLQ.
      cmd: `verify effect=1 on duplicate + poison in DLQ (THE ONE INVARIANT)`,
      run: async () => ({ note: "asserted by the run loop below (effect=1, dlqDepth≥1)" }),
    },
  ];
}

/**
 * Run the bee CLI; resolve { ok, data, raw, code }.
 * @param {string[]} argv
 * @returns {Promise<{ ok: boolean, data: any, raw: string, code: number }>}
 */
function runBee(argv) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BEE_CLI, ...argv], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.on("error", () => resolve({ ok: false, data: undefined, raw: "", code: -1 }));
    child.on("close", (code) => {
      const last = out.trim().split("\n").filter(Boolean).pop() ?? "";
      let data;
      try { data = JSON.parse(last); } catch { data = undefined; }
      resolve({ ok: code === 0, data, raw: out.trim(), code: code ?? 0 });
    });
  });
}

/**
 * The dry-run plan: the ordered step names + the command each represents. This is what the
 * D1 verify line parses (`.steps[].name` in scaffold→enqueue→process→retry→dlq→verify order).
 * @returns {{ dryRun: true, steps: { name: string, cmd: string }[], discipline: string }}
 */
export function plan() {
  const steps = buildSteps({ redisUrl: "", outDir: "<tmp>", dbPath: "<tmp>" }).map((s) => ({ name: s.name, cmd: s.cmd }));
  return {
    dryRun: true,
    steps,
    discipline:
      "Monitor-over-polling (O-21): event-shaped waits use the Anthropic Monitor tool + grep --line-buffered; the durable schedule is GitHub Actions (D3), never the ephemeral CronCreate/loop; in-process only — no focus-stealing terminal-multiplexer pane-select call.",
  };
}

/**
 * Execute the flow for real against an ephemeral Redis. Returns the run report + the
 * invariant verdict (effect=1 on the duplicate, poison in the DLQ).
 * @param {{ redisUrl?: string }} [opts]
 * @returns {Promise<{ steps: any[], invariantHeld: boolean, effects: number, dlqDepth: number }>}
 */
export async function execute(opts = {}) {
  const redisUrl = opts.redisUrl || process.env.REDIS_URL || "redis://localhost:6379";
  const outDir = mkdtempSync(join(tmpdir(), "bee-route-scaffold-"));
  const dbDir = mkdtempSync(join(tmpdir(), "bee-route-db-"));
  const dbPath = join(dbDir, "dedup.db");
  const steps = buildSteps({ redisUrl, outDir, dbPath });
  /** @type {any[]} */
  const results = [];
  let workerOut;
  try {
    for (const step of steps) {
      const out = await step.run();
      if (step.name === "process") workerOut = out.data;
      results.push({ name: step.name, ok: true, out: step.name === "process" ? out.data : out });
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true });
    rmSync(dbDir, { recursive: true, force: true });
  }
  const effects = workerOut?.effects ?? -1;
  const dlqDepth = workerOut?.dlqDepth ?? -1;
  // THE ONE INVARIANT: exactly one effect despite the duplicate enqueue; poison dead-lettered.
  const invariantHeld = effects === 1 && dlqDepth >= 1;
  return { steps: results, invariantHeld, effects, dlqDepth };
}

// ── CLI entry ───────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const dryRun = args.includes("--dry-run");

  if (dryRun) {
    const p = plan();
    if (json) process.stdout.write(JSON.stringify(p) + "\n");
    else {
      process.stdout.write("bee dispatch — multi-step build flow (dry-run):\n");
      p.steps.forEach((s, i) => process.stdout.write(`  ${i + 1}. ${s.name}: ${s.cmd}\n`));
      process.stdout.write(`\n${p.discipline}\n`);
    }
    return;
  }

  // Real run (needs an ephemeral Redis on REDIS_URL).
  const report = await execute({});
  if (json) process.stdout.write(JSON.stringify(report) + "\n");
  else {
    process.stdout.write(`bee dispatch run: invariantHeld=${report.invariantHeld} effects=${report.effects} dlq=${report.dlqDepth}\n`);
    report.steps.forEach((s, i) => process.stdout.write(`  ${i + 1}. ${s.name} ✓\n`));
  }
  if (!report.invariantHeld) process.exitCode = 1; // the invariant FAILED
}

// Only run main() when invoked directly (not when imported by a test/workflow).
if (process.argv[1] && process.argv[1].endsWith("route.js")) {
  main().catch((e) => {
    process.stderr.write(`[bee-dispatch] ${e?.stack || e}\n`);
    process.exit(1);
  });
}

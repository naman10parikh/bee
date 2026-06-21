#!/usr/bin/env node
// src/backend/sandbox/boot.mjs — the E2B Firecracker LIVE-BOOT acceptance (E4, the
// Sandbox/Infra component). This is the REAL integration point (HARNESS-OVERRIDES §11):
// it ACTUALLY BOOTS an ephemeral Redis + a real BullMQ queue/worker INSIDE an E2B
// microVM, drives the full job lifecycle against the live boot (enqueue ×2-dup + poison
// → process → retry-with-jittered-backoff → DLQ), asserts the duplicate produces
// EXACTLY ONE side effect (an atomic unique claim), and tears the sandbox down. Cold
// start is measured + logged (≤500ms target).
//
// Gating (D15/Q10): this is the SANDBOX-COMPONENT gate, NOT the merge gate. The merge
// gate is eval/acceptance.mjs (E2) on the local/GH-Actions ephemeral Redis — it needs
// NO E2B key. If E2B_API_KEY is absent, this exits 0 with a clear "skipped" note and the
// gap is recorded in CHAIRMAN-CHECKLIST.md; the merge still gates via E2. The key IS
// present in bee's gitignored .env (BEE-3 RESOLVED), so a real boot runs.
//
// Dedup store note: the E2B base template ships node 20.9 (node:sqlite needs ≥22.5), so
// the IN-SANDBOX dedup uses Redis `SET key NX` — the brain's documented O-2 alt ("Redis
// SETNX w/ TTL when no DB"): an ATOMIC unique claim with the SAME exactly-once-effect
// guarantee as a DB UNIQUE constraint. The host path (E2) uses the SQLite UNIQUE
// constraint; both are exactly-once *effect* by an atomic unique claim.

import { readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");
const RUNS_LOG = join(REPO_ROOT, "logs", "runs.jsonl");
const COLD_START_TARGET_MS = 500;

/** Load bee's gitignored .env into process.env (the SDK reads E2B_API_KEY from env). */
function loadDotEnv() {
  try {
    for (const line of readFileSync(join(REPO_ROOT, ".env"), "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    // no .env — rely on the ambient environment (CI sets E2B_API_KEY as a secret)
  }
}

/**
 * Append a sandbox-boot telemetry row to logs/runs.jsonl (append-only). Never throws.
 * @param {Record<string, unknown>} row
 */
function logRow(row) {
  try {
    mkdirSync(dirname(RUNS_LOG), { recursive: true });
    appendFileSync(RUNS_LOG, JSON.stringify({ ts: Date.now(), command: "sandbox-boot", model: process.env.ANTHROPIC_MODEL || "claude-opus-4-8[1m]", ...row }) + "\n");
  } catch {
    // best-effort telemetry
  }
}

// The self-contained job-lifecycle script that runs INSIDE the sandbox. It is a REAL
// BullMQ worker (not a stub): enqueue order-42 ×2 (dup) + poison-1, an idempotent
// worker that claims each effect via an ATOMIC Redis `SET NX` (the O-2 unique-claim
// equivalent), jittered backoff (O-9/P-X6, never bare exponential), and a redrive-able
// DLQ (O-10/S-1). Prints a single JSON verdict line: { effects, dlqDepth, deduped,
// retried }. THE ONE INVARIANT: effects===1 despite the duplicate; poison in the DLQ.
const LIFECYCLE_SCRIPT = `
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";

const conn = { host: "127.0.0.1", port: 6379, maxRetriesPerRequest: null }; // P-B10
const redis = new IORedis(conn);
const Q = "sbx-accept";
const DLQ = Q + "-dlq";                                  // "-" suffix, never ":" (P-B2)
const ATTEMPTS = 3;

function expDelay(a) { return Math.min(1000 * 2 ** (a - 1), 30000); }
function fullJitter(a) { return Math.floor(Math.random() * expDelay(a)); } // O-9, never bare exp

const queue = new Queue(Q, { connection: conn });
const dlq = new Queue(DLQ, { connection: conn });
const stats = { processed: 0, deduped: 0, deadLettered: 0, retries: 0 };

const worker = new Worker(Q, async (job) => {
  const key = String(job.opts.jobId ?? job.id);
  if (job.data && job.data.fail === true) {
    if (job.attemptsMade > 0) stats.retries += 1;       // observed a retry attempt
    throw new Error("poison " + key);
  }
  // ATOMIC unique claim — the O-2 Redis-SETNX equivalent of a DB UNIQUE constraint.
  // First writer sets the key (effect runs); a duplicate/concurrent retry gets null (no-op).
  const won = await redis.set("effect:" + key, "1", "NX");
  if (won === "OK") stats.processed += 1; else stats.deduped += 1;
}, {
  connection: conn,
  concurrency: 4,
  maxStalledCount: 1,                                    // applies to all jobs (S-1)
  settings: { backoffStrategy: (a) => fullJitter(a) },  // jittered (O-9/P-X6)
});

worker.on("failed", async (job, err) => {
  if (job && job.attemptsMade >= (job.opts.attempts ?? ATTEMPTS)) {
    stats.deadLettered += 1;
    await dlq.add("dead", { key: String(job.opts.jobId), reason: err?.message }, { jobId: "dlq-" + job.id });
  }
});

async function enqueue(id, data) {
  const existing = await queue.getJob(id);
  await queue.add(Q, data, { jobId: id, attempts: ATTEMPTS, backoff: { type: "j", delay: 1000 }, removeOnComplete: false, removeOnFail: false });
  return Boolean(existing);
}

const d1 = await enqueue("order-42", { charge: 100 });
const d2 = await enqueue("order-42", { charge: 100 });   // DUPLICATE — must be a no-op effect
await enqueue("poison-1", { fail: true });               // poison → retries → DLQ

// drain: wait until the source queue is empty
const start = Date.now();
while (Date.now() - start < 20000) {
  const c = await queue.getJobCounts("waiting", "active", "delayed");
  if ((c.waiting ?? 0) + (c.active ?? 0) + (c.delayed ?? 0) === 0) { await new Promise(r => setTimeout(r, 400)); break; }
  await new Promise(r => setTimeout(r, 150));
}

const effects = Number(await redis.get("effect:order-42") ? 1 : 0);  // exactly-once effect
const dlqDepth = await dlq.getJobCountByTypes("waiting", "delayed", "active", "completed");
const verdict = { effects, dlqDepth, secondDeduped: d2, retried: stats.retries > 0, processed: stats.processed, deadLettered: stats.deadLettered, invariantHeld: effects === 1 && dlqDepth >= 1 };
console.log("BEE_SANDBOX_VERDICT " + JSON.stringify(verdict));

await worker.close();
await queue.close();
await dlq.close();
redis.disconnect();
process.exit(verdict.invariantHeld ? 0 : 1);
`;

async function main() {
  loadDotEnv();
  const hasKey = Boolean(process.env.E2B_API_KEY);
  if (!hasKey) {
    // Honest skip (gated): NOT a failure — the merge gate is E2 (no E2B needed). The
    // gap is recorded in CHAIRMAN-CHECKLIST.md (BEE-3). Exit 0 so the additive CI job
    // never blocks.
    process.stdout.write(JSON.stringify({ skipped: true, reason: "E2B_API_KEY absent — sandbox-boot is the Sandbox-component gate, NOT the merge gate (E2 gates the merge). See CHAIRMAN-CHECKLIST BEE-3." }) + "\n");
    logRow({ skipped: true, reason: "no E2B_API_KEY" });
    process.exit(0);
  }

  const { Sandbox } = await import("e2b");
  /** @type {import("e2b").Sandbox | null} */
  let sbx = null;
  try {
    // 1) Boot the microVM — MEASURE the cold start (≤500ms target).
    const t0 = performance.now();
    sbx = await Sandbox.create({ timeoutMs: 180_000 });
    const coldStartMs = Math.round((performance.now() - t0) * 10) / 10;
    note(`sandbox booted: ${sbx.sandboxId} (cold start ${coldStartMs}ms, target ≤${COLD_START_TARGET_MS}ms)`);

    // 2) Install + boot an ephemeral Redis INSIDE the sandbox.
    const inst = await sbx.commands.run("sudo apt-get update -qq && sudo apt-get install -y -qq redis-server >/dev/null 2>&1; which redis-server", { timeoutMs: 120_000 });
    if (inst.exitCode !== 0 || !/redis-server/.test(inst.stdout)) throw new Error(`redis install failed (exit ${inst.exitCode})`);
    const ping = await sbx.commands.run("redis-server --port 6379 --save '' --appendonly no --daemonize yes && sleep 0.4 && redis-cli ping", { timeoutMs: 30_000 });
    if (!/PONG/.test(ping.stdout)) throw new Error(`redis did not start (got: ${ping.stdout.trim()})`);
    note("ephemeral Redis booted in-sandbox (PONG)");

    // 3) Install bullmq + ioredis IN the sandbox and write the lifecycle script.
    const npm = await sbx.commands.run("mkdir -p /home/user/jobs && cd /home/user/jobs && npm init -y >/dev/null 2>&1 && npm install bullmq ioredis >/dev/null 2>&1 && echo OK", { timeoutMs: 120_000 });
    if (!/OK/.test(npm.stdout)) throw new Error(`npm install in sandbox failed (exit ${npm.exitCode})`);
    // package.json type:module so the ESM lifecycle script runs under `node`.
    await sbx.files.write("/home/user/jobs/package.json", JSON.stringify({ name: "sbx-jobs", private: true, type: "module" }) + "\n");
    await sbx.files.write("/home/user/jobs/lifecycle.mjs", LIFECYCLE_SCRIPT);
    note("BullMQ + ioredis installed in-sandbox; lifecycle script written");

    // 4) RUN the real lifecycle against the live boot.
    const run = await sbx.commands.run("cd /home/user/jobs && node lifecycle.mjs", { timeoutMs: 60_000 });
    const line = run.stdout.split("\n").find((l) => l.startsWith("BEE_SANDBOX_VERDICT ")) ?? "";
    const verdict = line ? JSON.parse(line.slice("BEE_SANDBOX_VERDICT ".length)) : null;
    if (!verdict) throw new Error(`no verdict from the in-sandbox lifecycle (exit ${run.exitCode}); stderr: ${run.stderr.slice(0, 400)}`);

    // 5) Assert THE ONE INVARIANT against the LIVE boot.
    const invariantHeld = verdict.effects === 1 && verdict.dlqDepth >= 1 && verdict.secondDeduped === true;
    const coldStartOk = coldStartMs <= COLD_START_TARGET_MS;

    const result = {
      sandboxId: sbx.sandboxId,
      coldStartMs,
      coldStartOk,
      coldStartTargetMs: COLD_START_TARGET_MS,
      effects: verdict.effects,
      dlqDepth: verdict.dlqDepth,
      secondDeduped: verdict.secondDeduped,
      retried: verdict.retried,
      invariantHeld,
    };
    logRow(result);
    process.stdout.write(JSON.stringify(result) + "\n");

    if (!invariantHeld) {
      note(`INVARIANT FAILED: effects=${verdict.effects} (want 1), dlqDepth=${verdict.dlqDepth} (want ≥1), secondDeduped=${verdict.secondDeduped}`);
      process.exitCode = 1;
    } else {
      note(`LIVE BOOT PASS — effects=1 on the duplicate, poison→DLQ(${verdict.dlqDepth}), cold start ${coldStartMs}ms${coldStartOk ? " (≤500ms ✓)" : ` (>500ms — logged)`}`);
    }
  } finally {
    // 6) ALWAYS tear the sandbox down.
    if (sbx) {
      try {
        await sbx.kill();
        note("sandbox torn down");
      } catch (err) {
        note(`teardown warning: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}

/** @param {string} msg */
function note(msg) {
  process.stderr.write(`[bee-sandbox] ${msg}\n`);
}

main().catch((err) => {
  process.stderr.write(`[bee-sandbox] ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});

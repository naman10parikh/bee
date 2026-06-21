// The queue core — `bee enqueue` + `bee worker` — THE acceptance path (PLAN §5).
//
// THE ONE INVARIANT made executable: at-least-once transport (BullMQ on Redis) +
// idempotent consumer (the worker) + dedupe store (the SQLite UNIQUE constraint,
// TTL = retry window). Every side effect carries a deterministic idempotency key
// enforced by a DB unique constraint; on a duplicate, the effect runs ONCE.
//
// Pitfalls honored here:
//  - P-B10: ioredis connection uses `maxRetriesPerRequest: null` (treat connection
//    loss as retryable, not job failure).
//  - O-9 / P-X6: retries use a jittered backoff (see ./backoff.js) — never bare
//    exponential.
//  - O-10 / S-1: a real, redrive-able DLQ (BullMQ only gives you a `failed` set;
//    bee writes the redrive UX on top) + `maxStalledCount` applies to ALL jobs.
//  - O-2: the effect is claimed through the DB unique constraint, so two workers
//    racing the same key produce exactly one effect.

import { Queue, Worker, QueueEvents } from "bullmq";
import { createHash } from "node:crypto";
import { openDedupStore } from "../db/dedup.js";
import { jitteredDelay } from "./backoff.js";

const DEFAULT_ATTEMPTS = 3;
// BullMQ uses ":" as its Redis key delimiter and rejects it in a queue NAME
// (P-B2 — colons in keys are a footgun). Use a "-" suffix for the DLQ queue.
const DLQ_SUFFIX = "-dlq";

/**
 * Build the ioredis connection options for BullMQ. P-B10: `maxRetriesPerRequest:null`
 * so a transient Redis socket drop is retried at the connection layer, not surfaced
 * as a job failure.
 *
 * `oneShot` is for the CLI commands that must terminate (`bee enqueue`): a bounded
 * `retryStrategy` + `connectTimeout` makes an unreachable Redis fail fast with a
 * clear error instead of retrying the initial connection FOREVER (the default
 * ioredis behavior would hang the `enqueue` process indefinitely — caught in
 * T-user QA). This does NOT touch `maxRetriesPerRequest:null`, so the long-running
 * worker keeps its P-B10 resilience (ride out blips, never drop a job).
 *
 * @param {string} [redisUrl]
 * @param {{ oneShot?: boolean }} [opts]
 * @returns {{ connection: object }}
 */
export function connectionOpts(redisUrl, opts = {}) {
  const url = redisUrl || process.env.REDIS_URL || "redis://localhost:6379";
  const u = new URL(url);
  /** @type {Record<string, unknown>} */
  const connection = {
    host: u.hostname,
    port: Number(u.port || 6379),
    // P-B10 — connection loss is retryable, not a job failure.
    maxRetriesPerRequest: null,
    ...(u.password ? { password: u.password } : {}),
  };
  if (opts.oneShot) {
    // Give up after ~5 connection attempts (~1.5s total) so a one-shot CLI command
    // surfaces ECONNREFUSED instead of hanging. Worker path never sets this.
    connection.connectTimeout = 3000;
    connection.maxRetriesPerRequest = 3;
    connection.retryStrategy = (/** @type {number} */ times) =>
      times > 5 ? null : Math.min(times * 100, 500);
  }
  return { connection };
}

/**
 * Derive a deterministic idempotency key. Prefer the caller's `--id` (immutable,
 * O-7); else hash the immutable payload. NEVER a random per-attempt value (P-TE5).
 * @param {string|undefined} id
 * @param {unknown} data
 * @returns {string}
 */
export function deriveKey(id, data) {
  if (id) return id;
  const json = JSON.stringify(data ?? {});
  return "auto-" + createHash("sha256").update(json).digest("hex").slice(0, 24);
}

/**
 * `bee enqueue` — add a job with an idempotency key. Re-enqueuing the SAME key is
 * duplicate-safe at the queue layer (BullMQ `jobId` collision is a no-op) AND the
 * worker enforces exactly-one-effect via the DB constraint.
 *
 * @param {{ queue: string, data: unknown, id?: string, redisUrl?: string }} opts
 * @returns {Promise<{ jobId: string, deduped: boolean, queue: string }>}
 */
export async function enqueue(opts) {
  const key = deriveKey(opts.id, opts.data);
  // oneShot: fail fast on an unreachable Redis (don't hang the CLI forever).
  const q = new Queue(opts.queue, connectionOpts(opts.redisUrl, { oneShot: true }));
  // Swallow the ioredis connection 'error' event so a dead Redis doesn't dump a raw
  // AggregateError stack to stderr — the rejected getJob/add promise below carries
  // the same error to the command's catch, which prints one clean line (T-user QA).
  q.on("error", () => {});
  try {
    // Detect a duplicate at enqueue time: if a job with this jobId already exists
    // (waiting/active/delayed/completed/failed), the second enqueue is a no-op.
    const existing = await q.getJob(key);
    const job = await q.add(opts.queue, opts.data, {
      jobId: key,
      attempts: DEFAULT_ATTEMPTS,
      // O-9: a jittered backoff (BullMQ "custom" strategy is wired in the worker;
      // here we set the type so the worker's strategy applies).
      backoff: { type: "bee-jitter", delay: 1000 },
      removeOnComplete: false,
      removeOnFail: false,
    });
    return { jobId: String(job.id ?? key), deduped: Boolean(existing), queue: opts.queue };
  } finally {
    await q.close();
  }
}

/**
 * `bee worker` — run an idempotent worker with retry + jittered backoff + a
 * redrive-able DLQ. Returns a handle the caller can `drain()` (process until the
 * queue is empty) and `close()`.
 *
 * @param {{ queue: string, concurrency?: number, redisUrl?: string, dbPath?: string }} opts
 * @returns {WorkerHandle}
 */
export function startWorker(opts) {
  const conn = connectionOpts(opts.redisUrl);
  const dedup = openDedupStore(opts.dbPath);
  const dlqQueue = new Queue(opts.queue + DLQ_SUFFIX, conn);

  const stats = { processed: 0, deduped: 0, failed: 0, deadLettered: 0 };

  const worker = new Worker(
    opts.queue,
    async (job) => {
      const key = String(job.opts.jobId ?? deriveKey(undefined, job.data));
      // Poison-job affordance for the acceptance test: data.fail === true throws,
      // exercising the retry→backoff→DLQ path.
      if (job.data && job.data.fail === true) {
        throw new Error(`poison job ${key} (intentional failure)`);
      }
      // O-2: claim the effect through the DB unique constraint. First writer wins
      // (runs the effect); a duplicate/concurrent retry is a no-op effect.
      const won = dedup.claim(key, opts.queue, hashPayload(job.data));
      if (won) {
        stats.processed += 1;
        dedup.audit({ key, queue: opts.queue, jobId: String(job.id), attempt: job.attemptsMade + 1, outcome: "applied" });
      } else {
        stats.deduped += 1;
        dedup.audit({ key, queue: opts.queue, jobId: String(job.id), attempt: job.attemptsMade + 1, outcome: "deduped" });
      }
      // Structured per-job log line (O-25 / checklist §10): id + attempt + key + outcome.
      logJob({ queue: opts.queue, jobId: String(job.id), key, attempt: job.attemptsMade + 1, outcome: won ? "applied" : "deduped" });
      return { key, effectApplied: won };
    },
    {
      ...conn,
      concurrency: opts.concurrency ?? 1,
      // O-10 / S-1: the stall cap applies to every job type (the 5.78.1 floor fix);
      // a low maxStalledCount + the DLQ below means a poison job CAN die.
      maxStalledCount: 1,
      // O-9 / P-X6: a jittered custom backoff strategy — never bare exponential.
      settings: {
        backoffStrategy: (attemptsMade /* , type, err, job */) =>
          jitteredDelay(attemptsMade),
      },
    },
  );

  // O-10 / S-1: when a job exhausts its attempts, move it to the redrive-able DLQ
  // (BullMQ leaves it in `failed`; bee adds the explicit DLQ record + redrive UX).
  worker.on("failed", (job, err) => {
    if (!job) return;
    if (job.attemptsMade >= (job.opts.attempts ?? DEFAULT_ATTEMPTS)) {
      stats.deadLettered += 1;
      const key = String(job.opts.jobId ?? "");
      dlqQueue
        .add("dead", { originalQueue: opts.queue, originalJobId: job.id, key, data: job.data, reason: err?.message }, { jobId: `dlq-${job.id}` })
        .catch(() => {});
      dedup.audit({ key, queue: opts.queue, jobId: String(job.id), attempt: job.attemptsMade, outcome: "dead-lettered" });
      logJob({ queue: opts.queue, jobId: String(job.id), key, attempt: job.attemptsMade, outcome: "dead-lettered" });
    } else {
      stats.failed += 1;
    }
  });

  return new WorkerHandle(worker, dlqQueue, dedup, conn, opts.queue, stats);
}

/**
 * Hash a payload for the effect ledger (so the audit row can prove WHAT ran).
 * @param {unknown} data
 * @returns {string}
 */
function hashPayload(data) {
  return createHash("sha256").update(JSON.stringify(data ?? {})).digest("hex").slice(0, 16);
}

/**
 * Structured per-job log to stderr (stdout stays clean for --json).
 * @param {{ queue: string, jobId: string, key: string, attempt: number, outcome: string }} entry
 */
function logJob(entry) {
  process.stderr.write(JSON.stringify({ kind: "job", ts: Date.now(), ...entry }) + "\n");
}

export class WorkerHandle {
  /**
   * @param {Worker} worker
   * @param {Queue} dlqQueue
   * @param {import("../db/dedup.js").DedupStore} dedup
   * @param {{ connection: object }} conn
   * @param {string} queueName
   * @param {{ processed: number, deduped: number, failed: number, deadLettered: number }} stats
   */
  constructor(worker, dlqQueue, dedup, conn, queueName, stats) {
    this.worker = worker;
    this.dlqQueue = dlqQueue;
    this.dedup = dedup;
    this.conn = conn;
    this.queueName = queueName;
    this.stats = stats;
  }

  /** Total effects applied (proves duplicate-safety: effect=1 for two enqueues). */
  totalEffects() {
    return this.dedup.totalEffects();
  }

  /** Count of jobs currently in the redrive-able DLQ. @returns {Promise<number>} */
  async dlqCount() {
    return this.dlqQueue.getJobCountByTypes("waiting", "delayed", "active", "completed");
  }

  /**
   * Wait until the source queue has drained (no waiting/active/delayed jobs) OR a
   * timeout elapses. Used by the acceptance test + CLI one-shot runs.
   * @param {{ timeoutMs?: number, idleMs?: number }} [o]
   * @returns {Promise<void>}
   */
  async drain(o = {}) {
    const timeoutMs = o.timeoutMs ?? 15_000;
    const idleMs = o.idleMs ?? 600;
    const q = new Queue(this.queueName, this.conn);
    const start = Date.now();
    try {
      let idleSince = 0;
      // poll the queue counts (the only state that matters for "drained")
      while (Date.now() - start < timeoutMs) {
        const counts = await q.getJobCounts("waiting", "active", "delayed");
        const pending = (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0);
        if (pending === 0) {
          if (idleSince === 0) idleSince = Date.now();
          if (Date.now() - idleSince >= idleMs) return; // stably empty
        } else {
          idleSince = 0;
        }
        await sleep(120);
      }
    } finally {
      await q.close();
    }
  }

  async close() {
    await this.worker.close();
    await this.dlqQueue.close();
    this.dedup.close();
  }
}

/** @param {number} ms */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export { QueueEvents };

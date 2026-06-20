// BullMQ reference baseline — the law baked in (O-15: never use BullMQ naively).
//   - deps pinned EXACT (bullmq 5.78.1, never `^5` — O-17/P-B1)
//   - Job Schedulers API (upsertJobScheduler), NOT legacy `repeatable` (P-B2)
//   - idempotent handler + DB-unique-constraint dedupe (O-2)
//   - retry with jittered backoff (O-9/P-X6) + a redrive-able DLQ (O-10/S-1)
//   - ioredis maxRetriesPerRequest:null (P-B10), lockDuration > job (P-B4)

/** @returns {{ path: string, content: string }[]} */
export function bullmqFiles() {
  return [
    {
      path: "package.json",
      content: JSON.stringify(
        {
          name: "jobs-layer-bullmq",
          private: true,
          type: "module",
          description: "bee-scaffolded BullMQ jobs layer (law-compliant baseline)",
          scripts: {
            worker: "node worker.js",
            "schedule:setup": "node scheduler.js",
          },
          // PINNED EXACT — BullMQ ships multiple patches/week and minors have
          // regressed badly (O-17/P-B1). Never `^5`. 5.78.1 = the stall-loop floor.
          dependencies: {
            bullmq: "5.78.1",
            ioredis: "5.4.1",
          },
          engines: { node: ">=20" },
        },
        null,
        2,
      ),
    },
    {
      path: "connection.js",
      content: `// Shared ioredis connection. P-B10: maxRetriesPerRequest:null so a transient
// Redis socket drop is retried at the connection layer, not surfaced as a job failure.
export const connection = {
  host: process.env.REDIS_HOST || "localhost",
  port: Number(process.env.REDIS_PORT || 6379),
  maxRetriesPerRequest: null,
};
`,
    },
    {
      path: "worker.js",
      content: `import { Worker, Queue } from "bullmq";
import { connection } from "./connection.js";

// A redrive-able DLQ queue (BullMQ only gives you a "failed" set — this is the
// explicit dead-letter store you can redrive from). O-10/S-1.
// NOTE: BullMQ uses ":" as its Redis key delimiter and rejects it in a queue NAME
// (P-B2) — use a "-" suffix.
const dlq = new Queue("jobs-dlq", { connection });

// Replace this with your real effect. THE ONE INVARIANT: make it idempotent —
// claim the idempotency key through a DB UNIQUE constraint BEFORE the side effect
// (O-2). In-memory dedup is bypassed by restart/concurrency (never do that).
async function applyEffect(job) {
  const key = String(job.opts.jobId ?? job.id);
  // const won = await db.claim(key);            // INSERT … ON CONFLICT DO NOTHING
  // if (!won) return { deduped: true };          // duplicate → no-op effect
  // ... your effect here, exactly once ...
  return { key, applied: true };
}

const worker = new Worker(
  "jobs",
  async (job) => {
    // Structured per-job log (O-25): id + attempt + key + outcome.
    const line = { kind: "job", jobId: job.id, attempt: job.attemptsMade + 1, key: job.opts.jobId };
    const res = await applyEffect(job);
    process.stderr.write(JSON.stringify({ ...line, outcome: res.deduped ? "deduped" : "applied" }) + "\\n");
    return res;
  },
  {
    connection,
    concurrency: 4,
    // The stall cap MUST apply to every job type incl. schedulers (the 5.78.1 fix, S-1).
    maxStalledCount: 1,
    // lockDuration MUST exceed the longest expected job, else false stalls re-run it (P-B4).
    lockDuration: 60_000,
    settings: {
      // O-9/P-X6: jittered backoff, NEVER bare exponential. Full jitter for transient;
      // swap to equal jitter for 429/throttle (guarantees a minimum wait).
      backoffStrategy: (attemptsMade) => {
        const cap = 30_000;
        const exp = Math.min(1000 * 2 ** (attemptsMade - 1), cap);
        return Math.floor(Math.random() * exp); // full jitter
      },
    },
  },
);

worker.on("failed", async (job, err) => {
  if (job && job.attemptsMade >= (job.opts.attempts ?? 3)) {
    // Exhausted → move to the redrive-able DLQ (O-10).
    await dlq.add("dead", { originalJobId: job.id, data: job.data, reason: err?.message });
  }
});

process.on("SIGINT", async () => { await worker.close(); await dlq.close(); process.exit(0); });
`,
    },
    {
      path: "enqueue.js",
      content: `import { Queue } from "bullmq";
import { connection } from "./connection.js";

const queue = new Queue("jobs", { connection });

// Always pass a deterministic idempotency key as jobId, derived from IMMUTABLE
// domain data (O-7) — NEVER a random per-call value. Re-enqueuing the same key is
// a no-op at the queue layer; the worker enforces exactly-one-effect at the DB layer.
export async function enqueue(idempotencyKey, data) {
  return queue.add("jobs", data, {
    jobId: idempotencyKey,
    attempts: 3,
    backoff: { type: "bee-jitter", delay: 1000 }, // custom (jittered) strategy in worker.js
    removeOnComplete: true,
    removeOnFail: false,
  });
}
`,
    },
    {
      path: "scheduler.js",
      content: `import { Queue } from "bullmq";
import { connection } from "./connection.js";

const queue = new Queue("jobs", { connection });

// Use the v5 Job Schedulers API — NOT the legacy repeat option (deprecated in v5),
// which re-registers repeats on worker restart and on bad keys → the job fires far
// more often than its interval (P-B2). Job Schedulers are idempotent by scheduler id.
// Make the handler idempotent anyway: a restart CAN double-fire.
await queue.upsertJobScheduler(
  "nightly-rollup",                 // scheduler id (stable, no user-controlled colons — P-B2)
  { pattern: "0 3 * * *" },         // 03:00 daily
  { name: "rollup", data: { kind: "nightly" } },
);

await queue.close();
`,
    },
    {
      path: "README.md",
      content: `# BullMQ jobs layer (bee-scaffolded)

Law-compliant baseline. THE ONE INVARIANT: at-least-once transport + idempotent
consumer + DB-unique-constraint dedupe; on ambiguous timeout, query state, never
blind-retry.

- \`bullmq\` is pinned EXACT (never \`^5\` — it ships multiple patches/week, O-17/P-B1).
- Scheduling uses the **Job Schedulers** API, not the legacy repeat option (P-B2).
- The worker retries with **jittered** backoff (O-9/P-X6) and dead-letters to a
  redrive-able \`jobs-dlq\` queue (O-10/S-1).
- Wire \`applyEffect\` to claim the idempotency key through a DB UNIQUE constraint
  BEFORE the side effect (O-2) — this is what makes the effect exactly-once.

This does **exactly-once *effect***, not "exactly-once delivery" (which does not exist).
`,
    },
  ];
}

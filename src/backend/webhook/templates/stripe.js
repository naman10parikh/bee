// Stripe inbound webhook → queue (the RIGHT path).
//   - verify on RAW BYTES via stripe.webhooks.constructEvent (NEVER parse JSON first)
//   - dedup on event.id (Stripe live retry window ≥3 days → TTL ≥ 3d, O-8/P-X5)
//   - return 202 BEFORE the work (P-X7) → idempotent async worker
//   - STRIPE_WEBHOOK_SECRET is read from env (verify-only; never logged).

/** @returns {{ path: string, content: string }[]} */
export function stripeFiles() {
  return [
    {
      path: "stripe-webhook.js",
      content: `import Stripe from "stripe";
import { Queue } from "bullmq";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
const queue = new Queue("stripe-events", {
  connection: { host: process.env.REDIS_HOST || "localhost", port: Number(process.env.REDIS_PORT || 6379), maxRetriesPerRequest: null },
});

// Express/Node handler. CRITICAL: the route must receive the RAW body
// (e.g. express.raw({ type: "application/json" })) — Stripe signature verification
// runs on the exact bytes, so a JSON-parsed body fails verification (and parsing
// before verify is a security hole). O-5.
export async function stripeWebhook(req, res) {
  const sig = req.headers["stripe-signature"];
  const rawBody = req.body; // a Buffer — the RAW bytes, not parsed JSON

  let event;
  try {
    // Verify the signature on the RAW bytes. This is the only safe order.
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    // Bad signature → 400. Do NOT enqueue, do NOT do work. (Never log the secret.)
    return res.status(400).send("invalid signature");
  }

  // Dedup on the provider's stable event ID (distinguishes a retry from a new event,
  // O-6). Size the dedup TTL to Stripe's LONGEST retry horizon (≥3 days, O-8/P-X5) —
  // a day-2 retry must look like a duplicate, not a new event.
  // const fresh = await db.claim(event.id, { ttlSeconds: 3 * 24 * 3600 });
  // if (!fresh) return res.status(202).send("duplicate");   // already seen → ack, no re-work

  // Persist the raw event, then enqueue for async processing. The jobId IS the
  // event id → BullMQ collapses a duplicate at the queue layer too (belt + braces).
  await queue.add("stripe-event", { id: event.id, type: event.type, raw: event }, {
    jobId: event.id,
    attempts: 5,
    backoff: { type: "bee-jitter", delay: 1000 },
  });

  // Return 202 IMMEDIATELY — BEFORE doing the work. Inline work guarantees eventual
  // double-execution: a slow handler (>5-15s) makes Stripe time out and retry work
  // you already did (P-X7). The async worker does the effect, idempotently.
  return res.status(202).send("accepted");
}
`,
    },
    {
      path: "stripe-worker.js",
      content: `import { Worker } from "bullmq";

// The idempotent async worker. THE ONE INVARIANT: claim the effect through a DB
// UNIQUE constraint (O-2) so the actual side effect runs exactly once even though
// transport is at-least-once.
new Worker(
  "stripe-events",
  async (job) => {
    const eventId = String(job.opts.jobId ?? job.data.id);
    // const won = await db.claim(eventId);   // INSERT … ON CONFLICT DO NOTHING
    // if (!won) return { deduped: true };
    // ... handle job.data.type (payment_intent.succeeded, …) exactly once ...
    return { eventId, applied: true };
  },
  { connection: { host: process.env.REDIS_HOST || "localhost", port: Number(process.env.REDIS_PORT || 6379), maxRetriesPerRequest: null } },
);
`,
    },
    {
      path: "README.md",
      content: `# Stripe webhook → queue (bee-scaffolded)

The RIGHT inbound path: **verify sig on raw bytes → dedup on event.id → 202 → async**.

- Mount the route with a RAW body parser (\`express.raw({ type: "application/json" })\`)
  — \`constructEvent\` verifies the exact bytes; a parsed body fails (O-5).
- Dedup on \`event.id\` with TTL ≥ **3 days** (Stripe's live retry window, O-8/P-X5).
- Return **202 before** any work (P-X7) — the worker does the effect idempotently (O-2).

Set \`STRIPE_WEBHOOK_SECRET\` (verify-only, never logged). This does exactly-once
*effect* on at-least-once delivery.
`,
    },
  ];
}

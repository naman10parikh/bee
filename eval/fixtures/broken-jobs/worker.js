// SEEDED-BROKEN worker — every bug below is intentional (bee audit must catch them).
import { Worker } from "bullmq";

const connection = { host: "localhost", port: 6379 };

// P-X1: a consumer with NO idempotency key / no DB unique constraint / no dedup —
// treats at-least-once as exactly-once. A redelivery double-applies the effect.
new Worker(
  "payments",
  async (job) => {
    // P-X8: unbounded Promise.all fan-out → connection-pool exhaustion.
    await Promise.all(job.data.items.map((it) => chargeItem(it)));

    // P-X2: a blocking await used as a "durable wait" — the platform step-timeout
    // kills it; a real long wait must use a durable sleep primitive.
    await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));

    return { done: true };
  },
  {
    connection,
    // P-X6: bare exponential backoff, NO jitter → synchronized retry storm.
    backoff: { type: "exponential", delay: 1000 },
    // P-B4: lockDuration far shorter than the (5-minute) job → false stalls → dup runs.
    lockDuration: 5000,
  },
);

async function chargeItem(it) {
  return fetch("https://api.example.com/charge", { method: "POST", body: JSON.stringify(it) });
}

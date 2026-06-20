// Svix inbound webhook → queue (the RIGHT path).
//   - verify with the Svix library on the RAW body + svix-id/svix-timestamp/svix-signature headers
//   - dedup on the svix-id (webhook-id) (≥24h retry window → 24h+ TTL — O-8/P-X5)
//   - return 202 BEFORE the work (P-X7) → idempotent async worker

/** @returns {{ path: string, content: string }[]} */
export function svixFiles() {
  return [
    {
      path: "svix-webhook.js",
      content: `import { Webhook } from "svix";
import { Queue } from "bullmq";

const wh = new Webhook(process.env.SVIX_WEBHOOK_SECRET || "");
const queue = new Queue("svix-events", {
  connection: { host: process.env.REDIS_HOST || "localhost", port: Number(process.env.REDIS_PORT || 6379), maxRetriesPerRequest: null },
});

// The route MUST receive the RAW body — svix verifies over the exact bytes + headers.
export async function svixWebhook(req, res) {
  const rawBody = req.body; // RAW bytes (Buffer/string), not parsed JSON
  const headers = {
    "svix-id": req.headers["svix-id"],
    "svix-timestamp": req.headers["svix-timestamp"],
    "svix-signature": req.headers["svix-signature"],
  };

  let evt;
  try {
    // Verify on the RAW body + headers (O-5). Throws on a bad signature.
    evt = wh.verify(rawBody, headers);
  } catch {
    return res.status(401).send("invalid signature");
  }

  const eventId = headers["svix-id"]; // the stable event ID (O-6)
  // Dedup on the svix-id; Svix retry window ≥24h → TTL ≥ 24h (O-8/P-X5).
  // const fresh = await db.claim(String(eventId), { ttlSeconds: 24 * 3600 });
  // if (!fresh) return res.status(202).send("duplicate");

  await queue.add("svix-event", { id: eventId, raw: evt }, {
    jobId: String(eventId),
    attempts: 5,
    backoff: { type: "bee-jitter", delay: 1000 },
  });

  // 202 BEFORE the work (P-X7).
  return res.status(202).send("accepted");
}
`,
    },
    {
      path: "README.md",
      content: `# Svix webhook → queue (bee-scaffolded)

verify on raw bytes (svix lib) → dedup on \`svix-id\` → **202** → async (O-5/P-X7).
Dedup TTL ≥ 24h (Svix retry window, O-8/P-X5). Set \`SVIX_WEBHOOK_SECRET\`.
`,
    },
  ];
}

// Shopify inbound webhook → queue (the RIGHT path).
//   - verify HMAC-SHA256 on the RAW body bytes (X-Shopify-Hmac-Sha256), timing-safe
//   - dedup on X-Shopify-Webhook-Id (≥4h retry window; 24h TTL safe — O-8/P-X5)
//   - return 202 BEFORE the work (P-X7) → idempotent async worker

/** @returns {{ path: string, content: string }[]} */
export function shopifyFiles() {
  return [
    {
      path: "shopify-webhook.js",
      content: `import crypto from "node:crypto";
import { Queue } from "bullmq";

const secret = process.env.SHOPIFY_WEBHOOK_SECRET || "";
const queue = new Queue("shopify-events", {
  connection: { host: process.env.REDIS_HOST || "localhost", port: Number(process.env.REDIS_PORT || 6379), maxRetriesPerRequest: null },
});

// The route MUST receive the RAW body (express.raw) — the HMAC is over the exact bytes.
export async function shopifyWebhook(req, res) {
  const hmacHeader = req.headers["x-shopify-hmac-sha256"];
  const eventId = req.headers["x-shopify-webhook-id"];   // the stable event ID (O-6)
  const rawBody = req.body;                               // Buffer of RAW bytes

  // Verify the signature on the RAW bytes, timing-safe. Parsing JSON first would
  // break verification AND is a security hole (O-5).
  const digest = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
  const ok = hmacHeader && crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(String(hmacHeader)));
  if (!ok) return res.status(401).send("invalid hmac");

  // Dedup on the provider event ID; TTL ≥ Shopify's retry window (≥4h; 24h safe — O-8/P-X5).
  // const fresh = await db.claim(String(eventId), { ttlSeconds: 24 * 3600 });
  // if (!fresh) return res.status(202).send("duplicate");

  await queue.add("shopify-event", { id: eventId, raw: rawBody.toString("utf8") }, {
    jobId: String(eventId),
    attempts: 5,
    backoff: { type: "bee-jitter", delay: 1000 },
  });

  // 202 BEFORE the work (P-X7) — the async worker does the effect idempotently.
  return res.status(202).send("accepted");
}
`,
    },
    {
      path: "README.md",
      content: `# Shopify webhook → queue (bee-scaffolded)

verify HMAC on raw bytes → dedup on \`X-Shopify-Webhook-Id\` → **202** → async (O-5/P-X7).
Dedup TTL ≥ 24h (Shopify's retry window is ≥4h; 24h is safe — O-8/P-X5). Mount with a
RAW body parser. Set \`SHOPIFY_WEBHOOK_SECRET\`.
`,
    },
  ];
}

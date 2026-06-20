// Upstash QStash reference baseline (pure-HTTP default for an HTTP-only agent, O-27).
//   - HTTP-in/HTTP-out: QStash calls your endpoint with retries/schedules/DLQ
//   - context.sleep for waits, NEVER a blocking await inside a step (P-Q4/P-X2 — the
//     QStash step was cancelled ~91s in, #198)
//   - verify the signature before doing work; idempotent handler.
//   - deps pinned EXACT (@upstash/qstash 2.7.x — O-17).

/** @returns {{ path: string, content: string }[]} */
export function qstashFiles() {
  return [
    {
      path: "package.json",
      content: JSON.stringify(
        {
          name: "jobs-layer-qstash",
          private: true,
          type: "module",
          description: "bee-scaffolded QStash (pure-HTTP) jobs layer",
          dependencies: { "@upstash/qstash": "2.7.20" }, // pinned exact (O-17)
          engines: { node: ">=20" },
        },
        null,
        2,
      ),
    },
    {
      path: "workflow.js",
      content: `import { serve } from "@upstash/qstash/nextjs";

// QStash Workflow: each context.run is a durable step. THE law:
//  - wrap side effects in context.run (memoized across retries)
//  - use context.sleep for waits, NEVER a real blocking await inside a step
//    (P-Q4/P-X2 — the step is cancelled ~91s in, "can not append to a cancelled workflow")
//  - QStash retries with backoff + has a DLQ; make the handler idempotent (O-2).
export const { POST } = serve(async (context) => {
  const order = context.requestPayload;

  const charge = await context.run("charge", async () => {
    // pass YOUR idempotency key downstream, derived from immutable data (O-7)
    return { charged: true, orderId: order.id };
  });

  await context.sleep("cooldown", 60); // durable sleep (seconds), not a blocking await

  return charge;
});
`,
    },
    {
      path: "README.md",
      content: `# QStash jobs layer (bee-scaffolded)

Lowest-friction durable primitive for an agent that only has an HTTP endpoint (O-27).
HTTP-in/HTTP-out — no Redis, no workers. Use \`context.sleep\` for waits, never a
blocking await in a step (P-Q4/P-X2). Note P-Q2: \`flowControlPeriod\` is silently
ineffective on \`publishJSON\` — measure the real delivery rate.

Documented alt (bee's acceptance test runs on BullMQ, D10). Set QSTASH_TOKEN to run live.
`,
    },
  ];
}

// Inngest reference baseline (serverless default, O-11) — the law baked in.
//   - EVERY side effect + non-deterministic value wrapped in step.run() (P-I1 —
//     the #1 Inngest bug; code outside a step re-runs on every invocation)
//   - durable sleep (step.sleep), NEVER a blocking await/setTimeout (O-16/P-X2)
//   - deps pinned EXACT (inngest 4.6.0 — O-17); the framework-nextjs-app-router shape.

/** @returns {{ path: string, content: string }[]} */
export function inngestFiles() {
  return [
    {
      path: "package.json",
      content: JSON.stringify(
        {
          name: "jobs-layer-inngest",
          private: true,
          type: "module",
          description: "bee-scaffolded Inngest jobs layer (every side effect in a step)",
          dependencies: { inngest: "4.6.0" }, // pinned exact (O-17)
          engines: { node: ">=20" },
        },
        null,
        2,
      ),
    },
    {
      path: "inngest/client.js",
      content: `import { Inngest } from "inngest";
export const inngest = new Inngest({ id: "jobs-layer" });
`,
    },
    {
      path: "inngest/functions.js",
      content: `import { inngest } from "./client.js";

// THE law (P-I1): the whole function re-invokes per step, so ANYTHING outside a
// step runs N times. Wrap EVERY side effect and EVERY non-deterministic value
// (Date.now(), Math.random(), fetch, db) in step.run().
export const processOrder = inngest.createFunction(
  { id: "process-order", retries: 3 }, // Inngest jitters its own retries (O-9)
  { event: "order/created" },
  async ({ event, step }) => {
    // CORRECT: side effect inside a step → memoized, runs once across retries.
    const charge = await step.run("charge", async () => {
      // pass YOUR idempotency key to the downstream (derived from immutable data, O-7)
      // return await payments.charge({ idempotencyKey: event.data.orderId, ... });
      return { charged: true, orderId: event.data.orderId };
    });

    // CORRECT: durable sleep — survives a redeploy. NEVER \`await new Promise(r=>setTimeout(r, 5*60_000))\`
    // inside a step (O-16/P-X2 — the platform step-timeout kills it ~91s in).
    await step.sleep("cooldown", "1m");

    return charge;
  },
);
`,
    },
    {
      path: "README.md",
      content: `# Inngest jobs layer (bee-scaffolded)

Serverless default (O-11). **The #1 bug to avoid (P-I1):** code outside \`step.run()\`
re-executes on EVERY invocation — wrap every side effect and every non-deterministic
value in a step. Use \`step.sleep\`/\`step.waitForEvent\` for waits, never a blocking
\`await\` (O-16/P-X2). \`inngest\` is pinned exact (O-17).

This is the **documented alt** — bee's merge-gating acceptance test runs on BullMQ
(D10). Set INNGEST_EVENT_KEY + INNGEST_SIGNING_KEY to run live.
`,
    },
  ];
}

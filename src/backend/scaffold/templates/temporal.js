// Temporal reference baseline (complex/long workflows — a ONE-WAY DOOR, O-13).
//   - side effects ONLY in Activities; workflows must be pure/deterministic (P-TE4)
//   - the idempotency key is derived ONCE in workflow state, passed into the
//     activity — NEVER generated per-retry inside the activity (P-TE5)
//   - exact-version UNIFORMITY across all @temporalio/* — "not even patch versions"
//     may differ (O-18/P-TE2)
//   - no Retry Policy on workflows (a workflow failure = a code bug); Activities
//     are the retry layer (P-TE4).
//
// This is the heaviest, least-reversible option — apply the most Socratic scrutiny
// before adopting it (O-13). bee's acceptance test runs on BullMQ (D10).

/** @returns {{ path: string, content: string }[]} */
export function temporalFiles() {
  return [
    {
      path: "package.json",
      content: JSON.stringify(
        {
          name: "jobs-layer-temporal",
          private: true,
          type: "module",
          description: "bee-scaffolded Temporal jobs layer (side effects only in activities)",
          // EXACT-VERSION UNIFORMITY across @temporalio/* (O-18/P-TE2). All four
          // pinned to the SAME exact version — mixing even patch versions → phantom NDE.
          dependencies: {
            "@temporalio/client": "1.18.1",
            "@temporalio/worker": "1.18.1",
            "@temporalio/workflow": "1.18.1",
            "@temporalio/activity": "1.18.1",
          },
          engines: { node: ">=20" },
        },
        null,
        2,
      ),
    },
    {
      path: "workflows.js",
      content: `import { proxyActivities } from "@temporalio/workflow";

const { chargeCard } = proxyActivities({
  startToCloseTimeout: "30s",
  retry: { maximumAttempts: 5 }, // Activities are the retry layer (P-TE4)
});

// Workflows must be PURE/DETERMINISTIC. No fetch/db/Date.now()/Math.random() here —
// those re-execute on replay → duplicates/NDE (P-TE4). Derive the idempotency key
// ONCE in workflow state and pass it into the activity (P-TE5).
export async function orderWorkflow(order) {
  const idempotencyKey = order.id; // immutable, derived in workflow state — NOT in the activity
  return await chargeCard({ idempotencyKey, amount: order.amount });
}
`,
    },
    {
      path: "activities.js",
      content: `// Side effects live ONLY in Activities. The idempotency key arrives from workflow
// state (P-TE5) — do NOT generate a new uuid() here per retry, or each retry is a
// new charge. Enforce it with a DB UNIQUE constraint (O-2); on an ambiguous timeout,
// query state before re-firing (O-4).
export async function chargeCard({ idempotencyKey, amount }) {
  // const won = await db.claim(idempotencyKey);  // INSERT … ON CONFLICT DO NOTHING
  // if (!won) return { deduped: true };
  // return await gateway.charge({ idempotencyKey, amount });
  return { charged: true, idempotencyKey, amount };
}
`,
    },
    {
      path: "README.md",
      content: `# Temporal jobs layer (bee-scaffolded)

A **one-way door** (O-13) — migrating to/from Temporal is a full rewrite. Pick it
ONLY for genuinely complex, long-lived, multi-service workflows where replay
correctness is worth the determinism + ops + bundler tax.

Law: side effects ONLY in Activities (P-TE4); idempotency key derived once in
workflow state, not per-retry in the activity (P-TE5); EXACT-version uniformity
across all \`@temporalio/*\` — not even patch versions may differ (O-18/P-TE2); run
replay/history-compat tests in CI (O-20). Exclude workflow code from aggressive
minification (P-TE7).

Documented alt (bee's acceptance test runs on BullMQ, D10).
`,
    },
  ];
}

// `bee pick-tool` — the decision oracle (JTBD-11). Walks the brain's decision tree
// → recommends a tool WITH its named falls-short (O-28: a recommendation without the
// trade-off is slop) AND the reversibility cost (O-13: Temporal is a one-way door).
//
// The stances encoded: O-11 (Inngest=serverless default), O-12 (Trigger.dev=long/
// human-in-loop), O-13/O-14 (Temporal=one-way door, only for genuinely complex),
// O-24 (Postgres trichotomy — track, don't default), O-27 (QStash=HTTP-only,
// CF Queues=pure-Cloudflare), O-15 (BullMQ=scale, foot-guns baked in).

/**
 * @typedef {{ recommendation: string, fallsShort: string, reversibility: string,
 *   rationale: string, alternatives: string[], source: string }} Recommendation
 */

/** @type {Record<string, Recommendation>} */
const PROFILES = {
  serverless: {
    recommendation: "Inngest 4.6",
    fallsShort:
      "opaque step debugging + a single-long-execution ceiling (bounded by your host timeout); flow control is function-scoped, so a shared-LLM-key throttle is unsolved (P-I7).",
    reversibility:
      "MEDIUM — Inngest's step model is portable in shape; migrating off is real work but not a full rewrite.",
    rationale:
      "Zero-infra default for a NEW serverless product job-layer; step durability, 50k execs/mo free, maps cleanly onto agent execution. Wrap every side effect in step.run() (P-I1). (O-11)",
    alternatives: ["Trigger.dev (if jobs are long / need human-in-loop)", "QStash (if HTTP-only)"],
    source: "O-11 / ecosystem-06",
  },
  cloudflare: {
    recommendation: "Cloudflare Queues",
    fallsShort:
      "at-least-once only (no exactly-once); free-tier retention 24h; no API to dead-letter a specific message on demand (P-C2); `wrangler dev` silently ignores remote:true (P-C1) — verify against a real deploy.",
    reversibility: "MEDIUM — only worth it if you're already on Workers/R2/D1; leaving means leaving the CF runtime.",
    rationale:
      "The right call ONLY when you're already on the Cloudflare stack (Workers/R2/D1). Otherwise QStash or Inngest fit better. (O-27)",
    alternatives: ["QStash (HTTP-only, not CF-locked)", "Inngest (serverless, portable)"],
    source: "O-27 / ecosystem-02",
  },
  aws: {
    recommendation: "AWS SQS + bbc/sqs-consumer",
    fallsShort:
      "FIFO 'exactly-once' is only a 5-minute dedup window (P-S1) — still need an idempotent consumer; AWS ships no first-class Node poller (P-S2); ADOT can corrupt SigV4 in Lambda (P-S3).",
    reversibility: "MEDIUM — SQS is standard; the consumer library is swappable.",
    rationale:
      "On AWS, SQS is the native queue — but never treat FIFO as free exactly-once; use bbc/sqs-consumer (1,905★) for the poll/delete/visibility loop you'd otherwise hand-roll wrong. (P-S1/P-S2)",
    alternatives: ["Inngest (if you want steps over raw SQS)", "Temporal (if workflows are complex)"],
    source: "P-S1/P-S2 / ecosystem-05",
  },
  "http-only": {
    recommendation: "Upstash QStash",
    fallsShort:
      "step-timeout bounds a single step (P-Q4/P-X2 — use context.sleep, not a blocking await); `flowControlPeriod` is silently ineffective on publishJSON (P-Q2) — measure the real rate; CDN headers can trip its loop-detection (P-Q3).",
    reversibility: "LOW — pure HTTP in/out; swapping it out is the easiest migration in the matrix.",
    rationale:
      "Lowest-friction durable primitive for an agent that only has an HTTP endpoint — no Redis, no workers; it calls your endpoint with retries/schedules/DLQ. (O-27)",
    alternatives: ["CF Queues (if pure-Cloudflare)", "Inngest (if you want a richer step model)"],
    source: "O-27 / ecosystem-02",
  },
  scale: {
    recommendation: "BullMQ ≥5.78.1 on Redis",
    fallsShort:
      "Redis CPU (not job count) is the ceiling (P-B8); foot-guns everywhere — pin EXACT (multi-patch/week, P-B1), Job Schedulers not the legacy repeat API (P-B2), lockDuration > job (P-B4), maxStalledCount must apply to schedulers (P-B3); no first-party MCP (JTBD-9 gap).",
    reversibility: "MEDIUM — a plain queue; migrating to durable-exec is a model change, not a one-way door.",
    rationale:
      "Wins on unit cost at high volume (~$15-50 vs $75-150 managed @ 500k jobs/mo) and full control — but ONLY with the rules baked in. Monitor Redis CPU as the SLO. (O-15)",
    alternatives: ["Inngest (if you'd trade cost for zero-infra)", "Postgres-resident (if already on PG — see `postgres`)"],
    source: "O-15 / field-01",
  },
  complex: {
    recommendation: "Temporal 1.18.1",
    fallsShort:
      "the determinism tax — any async-ordering change is a replay-time NDE (P-TE1, green in dev, explodes on pod-roll); exact-version uniformity across @temporalio/* even at patch level (P-TE2); the bundler fights the deterministic sandbox (P-TE7); Worker Versioning is young (P-TE3).",
    reversibility:
      "ONE-WAY DOOR (O-13) — adopting Temporal is the LEAST reversible decision in the matrix; migrating anything↔Temporal is a full rewrite (fundamentally different execution model). ToolJet reverse-migrated AWAY from it to drop a service tier. Apply the most Socratic scrutiny before adopting.",
    rationale:
      "Pick it ONLY when workflows are genuinely complex, long-lived, multi-service, and replay correctness is worth the determinism + ops + bundler tax — 'the only choice when failure isn't an option'. NOT for simple/short jobs (O-13). And 'replace our queue with durable workflows' is OFTEN wrong (O-14) — check a plain queue first.",
    alternatives: ["Trigger.dev (long jobs without the full determinism tax)", "Inngest (if steps are bounded)"],
    source: "O-13/O-14 / field-04",
  },
  postgres: {
    recommendation: "PgBoss / Graphile Worker (track DBOS/pg_durable, don't default)",
    fallsShort:
      "the emerging PG-native durable-exec options (DBOS, microsoft/pg_durable, Absurd Workflows) have a versioning/observability/testing story their OWN maintainers concede is unsolved (G-3) — don't recommend them for workflow logic that changes often yet.",
    reversibility: "LOW-MEDIUM — a PG-resident queue keeps everything in your existing DB; reversible within the PG ecosystem.",
    rationale:
      "For a team already on Postgres, a PG-resident queue deletes BOTH the Redis-ops and the separate-cluster problems. Use PgBoss/Graphile Worker for modest volume now; TRACK DBOS/pg_durable as emerging (the 2026 trichotomy) but don't default to them for changing logic. (O-24)",
    alternatives: ["BullMQ (if you'll run Redis)", "Inngest (if you want managed serverless)"],
    source: "O-24 / field-06",
  },
};

const DEFAULT_PROFILE = "serverless";

/**
 * Recommend a jobs tool for a profile.
 * @param {string} [profile]
 * @returns {Recommendation & { profile: string }}
 */
export function pickTool(profile) {
  const key = (profile || DEFAULT_PROFILE).toLowerCase();
  const rec = PROFILES[key];
  if (!rec) {
    throw new Error(
      `unknown --profile "${profile}" (expected: ${Object.keys(PROFILES).join("|")})`,
    );
  }
  return { profile: key, ...rec };
}

export const supportedProfiles = Object.keys(PROFILES);

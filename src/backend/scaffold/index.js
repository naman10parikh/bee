// `bee scaffold` — stand up a LAW-COMPLIANT jobs layer from a reference baseline.
//
// Not a blank file: every emitted layer bakes in THE ONE INVARIANT (idempotent
// consumer + DB-unique-constraint dedupe), retry-with-jitter (O-9/P-X6), a DLQ
// (O-10), and provider-specific law:
//   - bullmq  : Job Schedulers API (NOT legacy `repeatable` — P-B2); deps pinned
//               EXACT (bullmq 5.78.1, never `^5` — O-17/P-B1); maxStalledCount,
//               lockDuration > job (P-B3/P-B4).
//   - inngest : every side effect wrapped in step.run() (P-I1); durable sleep, not
//               blocking await (O-16/P-X2).
//   - qstash  : pure-HTTP verify→202→async; context.sleep not blocking await (P-Q4).
//   - temporal: side effects only in Activities (P-TE4); key derived in workflow
//               state, not per-retry in the activity (P-TE5); exact-version
//               uniformity across @temporalio/* (O-18/P-TE2).
//
// Pinned versions are sourced from brain/TOOL-MATRIX.md (verified this wave).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bullmqFiles } from "./templates/bullmq.js";
import { inngestFiles } from "./templates/inngest.js";
import { qstashFiles } from "./templates/qstash.js";
import { temporalFiles } from "./templates/temporal.js";

/** @typedef {"bullmq"|"inngest"|"qstash"|"temporal"} Provider */

const PROVIDERS = {
  bullmq: bullmqFiles,
  inngest: inngestFiles,
  qstash: qstashFiles,
  temporal: temporalFiles,
};

/**
 * Generate a jobs-layer scaffold into `out`.
 * @param {{ provider: Provider, out: string }} opts
 * @returns {{ provider: string, out: string, files: string[] }}
 */
export function scaffold(opts) {
  const gen = PROVIDERS[opts.provider];
  if (!gen) {
    throw new Error(
      `unknown provider "${opts.provider}" (expected: ${Object.keys(PROVIDERS).join("|")})`,
    );
  }
  const files = gen();
  mkdirSync(opts.out, { recursive: true });
  /** @type {string[]} */
  const written = [];
  for (const f of files) {
    const target = join(opts.out, f.path);
    const dir = target.slice(0, target.lastIndexOf("/"));
    if (dir) mkdirSync(dir, { recursive: true });
    writeFileSync(target, f.content);
    written.push(f.path);
  }
  return { provider: opts.provider, out: opts.out, files: written };
}

export const supportedProviders = Object.keys(PROVIDERS);

// G5 — Retry storm with no jitter (S-13#7 / P-X6 / O-9). Synchronized retries re-kill
// the recovering downstream. RESOLUTION: Full-Jitter (transient) / Equal-Jitter (429) +
// a cap.
//
// L2 behavioral binary, CI-blocking. HERMETIC: bee's backoff functions produce a
// NON-CONSTANT delay sequence that stays ≤ the cap and (for throttles) guarantees a
// minimum wait (equal jitter ≥ exp/2) — never bare exponential; AND `bee audit` flags
// the broken fixture's bare-exponential config as P-X6. No self-grading: the gate is
// the statistical properties of the pure backoff fns + the audit finding.

import { expDelay, fullJitter, equalJitter, backoffConfig } from "../src/backend/backoff.js";
import { auditDir, BROKEN_FIXTURE } from "./_lib.mjs";

/** @type {import("./runner.mjs").GoldenTask} */
const task = {
  id: "G5",
  level: 2,
  ciBlocking: true,
  sids: ["S-13"],
  title: "Retry storm → jitter + cap (Full transient / Equal throttle) — bare-exp flagged P-X6",
  async run() {
    const attempt = 4;
    const envelope = expDelay(attempt);

    // Full jitter (transient): non-constant, all in [0, envelope].
    /** @type {number[]} */
    const full = [];
    for (let i = 0; i < 300; i += 1) full.push(fullJitter(attempt));
    const fullNonConstant = new Set(full).size > 1;
    const fullWithinEnvelope = full.every((d) => d >= 0 && d <= envelope);

    // Equal jitter (throttle/429): guarantees a MINIMUM wait (≥ envelope/2) so we never
    // collapse to ~0 and hammer a throttled downstream (the aws-sdk-net#4341 fix).
    /** @type {number[]} */
    const equal = [];
    for (let i = 0; i < 300; i += 1) equal.push(equalJitter(attempt));
    const equalNonConstant = new Set(equal).size > 1;
    const equalHasFloor = equal.every((d) => d >= Math.floor(envelope / 2));

    // Always capped — an uncapped backoff is not a backoff (O-9).
    const cappedAtCeiling = expDelay(100) === backoffConfig.CAP_MS;

    // bee audit flags the broken fixture's bare-exponential (no jitter) as P-X6.
    const broken = await auditDir(BROKEN_FIXTURE);
    const flaggedBareExp = (broken?.findings ?? []).some((/** @type {any} */ f) => f.pitfall === "P-X6");

    const pass = fullNonConstant && fullWithinEnvelope && equalNonConstant && equalHasFloor && cappedAtCeiling && flaggedBareExp;
    return {
      pass,
      detail: `full jitter non-constant=${fullNonConstant} within[0,${envelope}]=${fullWithinEnvelope}; equal jitter non-constant=${equalNonConstant} floor≥${Math.floor(envelope / 2)}=${equalHasFloor}; capped at ${backoffConfig.CAP_MS}ms=${cappedAtCeiling}; broken bare-exp flagged P-X6=${flaggedBareExp}`,
    };
  },
};

export default task;

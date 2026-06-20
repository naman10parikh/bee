// Backoff strategies — encodes O-9 / P-X6 (NEVER bare exponential).
//
// O-9: ALWAYS jitter. FULL jitter for transient errors (AWS-measured to do the
// least work); EQUAL jitter for throttles/429 (Full Jitter can collapse to ~0 —
// real bug aws-sdk-net#4341 — so guarantee a minimum wait under throttle).
// P-X6: bare exponential creates synchronized retry storms.
//
// These are pure functions so the eval pyramid (E1) and `bee audit` (B4) can assert
// the delay SEQUENCE is non-constant (the acceptance test gate, PLAN §5 step 3).

const BASE_MS = 1000;
const CAP_MS = 30_000; // always cap — an uncapped backoff is not a backoff (O-9)

/**
 * Deterministic exponential ceiling for an attempt (the pre-jitter envelope).
 * @param {number} attempt 1-based
 * @returns {number}
 */
export function expDelay(attempt) {
  const raw = BASE_MS * 2 ** (attempt - 1);
  return Math.min(raw, CAP_MS);
}

/**
 * FULL jitter — `random(0, exp)`. For transient errors. (O-9; AWS Architecture Blog.)
 * @param {number} attempt 1-based
 * @param {() => number} [rng]
 * @returns {number}
 */
export function fullJitter(attempt, rng = Math.random) {
  return Math.floor(rng() * expDelay(attempt));
}

/**
 * EQUAL jitter — `exp/2 + random(0, exp/2)`. For throttle/429: guarantees a minimum
 * wait so we never hammer a throttled downstream (the aws-sdk-net#4341 fix). (O-9.)
 * @param {number} attempt 1-based
 * @param {() => number} [rng]
 * @returns {number}
 */
export function equalJitter(attempt, rng = Math.random) {
  const half = expDelay(attempt) / 2;
  return Math.floor(half + rng() * half);
}

/**
 * Pick the jittered delay by error class. Throttle/429 → equal jitter (minimum
 * wait guaranteed); everything else transient → full jitter.
 * @param {number} attempt 1-based
 * @param {{ throttle?: boolean }} [opts]
 * @param {() => number} [rng]
 * @returns {number}
 */
export function jitteredDelay(attempt, opts = {}, rng = Math.random) {
  return opts.throttle ? equalJitter(attempt, rng) : fullJitter(attempt, rng);
}

export const backoffConfig = { BASE_MS, CAP_MS };

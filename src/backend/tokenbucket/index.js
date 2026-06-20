// `bee token-bucket` — THE frontier primitive (S-16 / O-23 / G-1).
//
// "Never exceed the model provider's TPM/RPM across ALL my workers" is UNSOLVED in
// both Inngest (#3701/#4345) and BullMQ (#3670/#3831) as of mid-2026 — vendor flow
// control is FUNCTION-scoped, but the agent-era constraint is a SHARED resource.
// bee builds the missing piece: an external token-bucket that ALL workers consult
// before a rate-limited call. Equal-Jitter the resulting 429s (O-9).
//
// HONESTY (O-25 / PLAN Risk 2): this is graded as a FRONTIER primitive, demonstrated
// via the $0 in-process sim (aggregate ≤ limit under burst) and advertised as a
// `plannedCapabilities` stub on the A2A card — NEVER as "solved", never "a vendor
// does this". Two backends:
//   - in-process sim (default, $0)  : proves the algorithm under a burst of N workers
//   - Redis shared bucket (--redis) : the real cross-PROCESS primitive (atomic via Lua)

import { setTimeout as sleep } from "node:timers/promises";

/**
 * The token-bucket math (pure): given a per-minute limit, refill rate is limit/60 per
 * second. `take(now)` returns true if a token was available (consumed) else false.
 */
export class TokenBucket {
  /**
   * @param {{ limitPerMin: number, capacity?: number, now?: number }} o
   */
  constructor(o) {
    this.limitPerMin = o.limitPerMin;
    this.refillPerSec = o.limitPerMin / 60;
    this.capacity = o.capacity ?? o.limitPerMin; // burst capacity = the per-min limit
    this.tokens = this.capacity;
    this.last = o.now ?? Date.now();
  }

  /**
   * Try to consume one token at time `now` (ms). Refills based on elapsed time.
   * @param {number} [now]
   * @returns {boolean}
   */
  take(now = Date.now()) {
    const elapsedSec = (now - this.last) / 1000;
    if (elapsedSec > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillPerSec);
      this.last = now;
    }
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
}

/**
 * The $0 demonstration (G-1): simulate N workers hammering a SHARED bucket over a
 * window and prove the aggregate accepted count never exceeds the limit under burst.
 * This is what the RSI loop's frontier-experiment step runs (PLAN §11).
 *
 * @param {{ limitPerMin: number, workers: number, windowSec?: number, attemptsPerWorker?: number }} o
 * @returns {{ limitPerMin: number, workers: number, windowSec: number, accepted: number, rejected: number, withinLimit: boolean, capacity: number }}
 */
export function simulate(o) {
  const windowSec = o.windowSec ?? 1; // a 1s burst window (the worst case)
  const bucket = new TokenBucket({ limitPerMin: o.limitPerMin });
  const attemptsPerWorker = o.attemptsPerWorker ?? Math.ceil(o.limitPerMin); // hammer it
  let accepted = 0;
  let rejected = 0;
  // All workers attempt at t=0 (the synchronized burst — the worst case for a shared
  // limiter). The bucket's burst capacity = the per-minute limit, so at most `limit`
  // succeed in an instantaneous burst; the rest are correctly rejected (→ Equal-Jitter
  // retry). Over a 1s window, refill adds ~limit/60 more.
  const t0 = Date.now();
  for (let attempt = 0; attempt < attemptsPerWorker; attempt += 1) {
    for (let w = 0; w < o.workers; w += 1) {
      if (bucket.take(t0)) accepted += 1;
      else rejected += 1;
    }
  }
  // The aggregate accepted in an instantaneous burst must be ≤ the burst capacity.
  const withinLimit = accepted <= bucket.capacity;
  return {
    limitPerMin: o.limitPerMin,
    workers: o.workers,
    windowSec,
    accepted,
    rejected,
    withinLimit,
    capacity: bucket.capacity,
  };
}

/**
 * The real cross-process primitive: a Redis-backed shared bucket via an atomic Lua
 * script (all workers consult the SAME bucket key). Returns whether a token was
 * granted. Gated behind a live REDIS_URL; the algorithm is identical to TokenBucket.
 *
 * @param {{ key: string, limitPerMin: number, redisUrl?: string }} o
 * @returns {Promise<{ granted: boolean, key: string, backend: "redis" }>}
 */
export async function takeRedis(o) {
  // Lazy-import ioredis only when the Redis path is used. Use the named `Redis`
  // export (a class tsc recognizes as constructable; the default export's construct
  // signature isn't visible under NodeNext ESM).
  const { Redis } = await import("ioredis");
  const redis = new Redis(o.redisUrl || process.env.REDIS_URL || "redis://localhost:6379", {
    maxRetriesPerRequest: null,
  });
  // Atomic token-bucket in Lua: refill by elapsed time, then try to take 1.
  const lua = `
    local key = KEYS[1]
    local limitPerMin = tonumber(ARGV[1])
    local now = tonumber(ARGV[2])
    local refillPerSec = limitPerMin / 60.0
    local cap = limitPerMin
    local data = redis.call('HMGET', key, 'tokens', 'ts')
    local tokens = tonumber(data[1])
    local ts = tonumber(data[2])
    if tokens == nil then tokens = cap; ts = now end
    local elapsed = (now - ts) / 1000.0
    if elapsed > 0 then tokens = math.min(cap, tokens + elapsed * refillPerSec); ts = now end
    local granted = 0
    if tokens >= 1 then tokens = tokens - 1; granted = 1 end
    redis.call('HMSET', key, 'tokens', tokens, 'ts', ts)
    redis.call('PEXPIRE', key, 120000)
    return granted
  `;
  try {
    const granted = await redis.eval(lua, 1, `tb:${o.key}`, String(o.limitPerMin), String(Date.now()));
    return { granted: granted === 1, key: o.key, backend: "redis" };
  } finally {
    redis.disconnect();
  }
}

export { sleep };

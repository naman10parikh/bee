// `bee token-bucket --key <k> --limit <rpm> [--workers <n>] [--redis] [--json]`
//
// THE frontier primitive (S-16/O-23/G-1) — UNSOLVED in Inngest+BullMQ. Default mode
// runs the $0 in-process sim (proves aggregate ≤ limit under a burst of N workers).
// --redis grants/denies a single token against the real cross-process Redis bucket.
//
// HONESTY: this is advertised as a frontier `plannedCapabilities` primitive, never
// "solved" (O-25). The sim demonstrates the algorithm; the Redis path is the real
// cross-worker store.

import { simulate, takeRedis } from "../tokenbucket/index.js";
import { str, int, bool } from "../cli/args.js";
import { emit, fail } from "../cli/output.js";

/**
 * @param {{ positionals: string[], flags: Record<string, string|boolean> }} ctx
 */
export default async function run({ flags }) {
  const key = str(flags, "key");
  const limit = int(flags, "limit", 0);
  if (!key) fail("`bee token-bucket` requires --key <provider-key>");
  if (limit <= 0) fail("`bee token-bucket` requires --limit <rpm> (a positive integer)");

  const json = bool(flags, "json");
  const workers = int(flags, "workers", 10);

  if (bool(flags, "redis")) {
    // The real cross-process primitive (gated on a live REDIS_URL).
    const res = await takeRedis({ key: /** @type {string} */ (key), limitPerMin: limit, redisUrl: str(flags, "redis-url") });
    emit(json, { ...res, frontier: true, status: "plannedCapability" }, (r) =>
      `[redis bucket "${r.key}"] token ${r.granted ? "GRANTED" : "DENIED"} (frontier primitive — not vendor-solved)`,
    );
    return;
  }

  // The $0 demonstration: N workers burst the shared bucket; aggregate must stay ≤ limit.
  const sim = simulate({ limitPerMin: limit, workers });
  const out = {
    key,
    ...sim,
    frontier: true,
    status: "plannedCapability",
    note: "Shared-LLM-key throttling is UNSOLVED in Inngest (#3701/#4345) + BullMQ (#3670/#3831) — bee builds the missing token-bucket (S-16/O-23/G-1). Equal-Jitter the rejected calls (O-9).",
  };
  emit(json, out, (r) =>
    `[sim] key="${r.key}" limit=${r.limitPerMin}/min workers=${r.workers}: accepted=${r.accepted} rejected=${r.rejected} (burst capacity ${r.capacity}) → withinLimit=${r.withinLimit}\nFRONTIER primitive — not solved by any vendor (O-23/G-1).`,
  );

  if (!sim.withinLimit) process.exitCode = 1; // the invariant FAILED — aggregate exceeded the limit
}

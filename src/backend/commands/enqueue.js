// `bee enqueue` — THE acceptance path (half 1). Add a job with an idempotency key;
// re-enqueuing the SAME key is duplicate-safe (returns deduped:true).

import { enqueue } from "../queue.js";
import { str, bool } from "../cli/args.js";
import { emit, fail } from "../cli/output.js";

/**
 * @param {{ positionals: string[], flags: Record<string, string|boolean> }} ctx
 */
export default async function run({ flags }) {
  const queue = str(flags, "queue");
  if (!queue) fail("`bee enqueue` requires --queue <name>");

  const rawData = str(flags, "data", "{}") ?? "{}";
  /** @type {unknown} */
  let data;
  try {
    data = JSON.parse(rawData);
  } catch {
    return fail(`--data must be valid JSON (got: ${rawData})`);
  }

  const id = str(flags, "id");
  const json = bool(flags, "json");

  const result = await enqueue({ queue, data, id, redisUrl: str(flags, "redis") });

  emit(json, result, (r) =>
    r.deduped
      ? `deduped: job ${r.jobId} on queue "${r.queue}" already enqueued (no-op)`
      : `enqueued: job ${r.jobId} on queue "${r.queue}"`,
  );
}

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

  /** @type {{ jobId: string, deduped: boolean, queue: string }} */
  let result;
  try {
    result = await enqueue({ queue, data, id, redisUrl: str(flags, "redis") });
  } catch (err) {
    // Most common: Redis unreachable. Surface a clear, actionable error + non-zero
    // exit instead of a raw stack trace or an indefinite hang (T-user QA). Note: a
    // connection AggregateError has an EMPTY .message but a .code (ECONNREFUSED) —
    // match on the code too, not just the message.
    const code = /** @type {{ code?: string }} */ (err)?.code ?? "";
    const msg = (err instanceof Error ? err.message : String(err)) || code || "connection error";
    const redis = str(flags, "redis") || process.env.REDIS_URL || "redis://localhost:6379";
    return fail(
      /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|getaddrinfo|connect/i.test(`${code} ${msg}`)
        ? `cannot reach Redis at ${redis} — is it running? (set REDIS_URL or --redis) [${code || msg}]`
        : `enqueue failed: ${msg}`,
    );
  }

  emit(json, result, (r) =>
    r.deduped
      ? `deduped: job ${r.jobId} on queue "${r.queue}" already enqueued (no-op)`
      : `enqueued: job ${r.jobId} on queue "${r.queue}"`,
  );
}

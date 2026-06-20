// `bee worker` — THE acceptance path (half 2). Run an idempotent worker with retry +
// jittered backoff + a redrive-able DLQ. Each job's effect runs exactly once (the DB
// unique constraint); poison jobs dead-letter after exhausting attempts.
//
// Modes:
//   bee worker --queue q                 → long-lived (runs until SIGINT)
//   bee worker --queue q --drain         → process until the queue is empty, then exit
//                                          (one-shot; what the verify lines + tests use)

import { startWorker } from "../queue.js";
import { str, int, bool } from "../cli/args.js";
import { emit, note, fail } from "../cli/output.js";

/**
 * @param {{ positionals: string[], flags: Record<string, string|boolean> }} ctx
 */
export default async function run({ flags }) {
  const queue = str(flags, "queue");
  if (!queue) fail("`bee worker` requires --queue <name>");

  const concurrency = int(flags, "concurrency", 1);
  const json = bool(flags, "json");
  const drain = bool(flags, "drain");

  const handle = startWorker({
    queue,
    concurrency,
    redisUrl: str(flags, "redis"),
    dbPath: str(flags, "db"),
  });

  if (drain) {
    // One-shot: wait for the queue to drain, then report and exit cleanly.
    await handle.drain({ timeoutMs: int(flags, "timeout", 15000) });
    const dlq = await handle.dlqCount();
    const result = {
      started: true,
      queue,
      processed: handle.stats.processed,
      deduped: handle.stats.deduped,
      deadLettered: handle.stats.deadLettered,
      effects: handle.totalEffects(),
      dlqDepth: dlq,
    };
    await handle.close();
    emit(json, result, (r) =>
      `worker drained queue "${r.queue}": processed=${r.processed} deduped=${r.deduped} dead-lettered=${r.deadLettered} effects=${r.effects} dlq=${r.dlqDepth}`,
    );
    return;
  }

  // Long-lived mode.
  emit(json, { started: true, queue, concurrency }, (r) =>
    `worker started on queue "${r.queue}" (concurrency=${r.concurrency}). Ctrl-C to stop.`,
  );
  const shutdown = async () => {
    note("shutting down worker...");
    await handle.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  // keep the event loop alive
  await new Promise(() => {});
}

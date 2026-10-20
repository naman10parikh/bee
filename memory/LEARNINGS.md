# bee — LEARNINGS (append-only)

Every error → root cause → rule. Auto-compressed when >500 lines (memory-compress.sh).

## 2026-06-20 · A BullMQ queue name cannot contain ":"
- **What broke:** creating the dead-letter queue `jobs:dlq` threw "Queue name cannot contain :".
- **Root cause:** `:` is BullMQ's Redis key delimiter (P-B2).
- **Rule:** name a dead-letter queue with a `-dlq` suffix, never `:dlq`.

## 2026-06-20 · Strip comments before matching code
- **What broke:** the audit detectors missed pitfalls in the seeded fixture, and later the pin-exact
  hook blocked a commented doc example such as `// never write "bullmq": "^5"`.
- **Root cause:** explanatory comments ("no jitter", "no idempotency key") triggered or defeated the
  heuristics, and the first comment-strip regex kept any comment that contained a quote.
- **Rule:** drop whole comment lines (first non-space is `//` or `#`), then trailing `//` comments,
  before any detector or gate matches.

## 2026-06-20 · Keep the qualified phrase on one line
- **What broke:** bee's own Stripe webhook template failed the O-1 gate twice.
- **Root cause:** the gate is line-based, and a line wrap put "exactly-once" and "effect" on different lines.
- **Rule:** write "exactly-once effect" on a single line, in templates and in docs.

## 2026-06-20 · pnpm does not hoist
- **What broke:** `bee token-bucket` failed with `ERR_MODULE_NOT_FOUND` for ioredis.
- **Root cause:** ioredis came in only as a dependency of bullmq, and pnpm does not hoist it.
- **Rule:** any module the code imports directly is a direct, exactly pinned dependency.

## 2026-06-21 · A scan that read nothing is an error
- **What broke:** `bee audit ./typo-path` printed "0 findings" and exited 0, which reads as "clean".
- **Root cause:** the directory walk caught ENOENT and returned quietly.
- **Rule:** check the input path first; a missing path or a file where a directory is expected exits 1
  with a clear message. Never swallow an error in a catch block.

## 2026-06-21 · One-shot commands need bounded Redis retries
- **What broke:** `bee enqueue` against a Redis that was not running hung forever and printed a raw
  `AggregateError` stack.
- **Root cause:** it shared the worker's connection options (`maxRetriesPerRequest: null`, right for a
  long-running worker) and had no handler for the connection's `error` event.
- **Rule:** one-shot commands use a bounded retry strategy and a connect timeout, and report a plain
  error; only the worker keeps unlimited retries so it never drops a job.

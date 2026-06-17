---
title: "bee KNOWN PITFALLS — Version-Specific Gotchas with Detection + Avoidance"
type: synthesis
created: "2026-06-16"
updated: "2026-06-16"
tags: [pitfalls, gotchas, version-specific, detection, avoidance, bee]
synthesizer: "SYNTHESIS (taste node, CP123 Wave-R)"
sources: ["brain/research/raw/ecosystem-01-versions-changelogs.md", "brain/research/raw/ecosystem-04-github-breakage.md", "brain/research/raw/ecosystem-07-docs-deepdive-durable-execution.md", "brain/research/raw/field-01-bullmq-issues.md", "brain/research/raw/field-02-inngest-issues.md", "brain/research/raw/field-03-temporal-issues.md", "brain/research/raw/field-05-idempotency-patterns.md", "brain/research/raw/field-06-what-changed-2026.md"]
summary: "The gotcha list. Each pitfall: what bites, the version/condition, how to DETECT it (a concrete signal/command), how to AVOID it. Grouped by tool, with cross-cutting traps last."
---

# bee KNOWN PITFALLS

> Format per entry: **Pitfall → Version/Condition → Detect → Avoid.** "Detect" is a concrete observable
> (a log string, a metric, a command), not "be careful." Version pins are as of 2026-06-16.

---

## CROSS-CUTTING (true for every tool — read first)

### P-X1 — Treating at-least-once as exactly-once
- **Pitfall:** Assuming the consumer runs exactly once. BullMQ, SQS Standard, CF Queues, QStash, Inngest steps, Temporal activities are ALL at-least-once — your processor WILL run twice on stall/crash/redelivery.
- **Condition:** Always.
- **Detect:** Duplicate side effects (two charges, two emails, doubled row counts) that appear under load/crash but never in calm dev. If re-running a job doubles output, it's not idempotent.
- **Avoid:** Idempotent consumer + dedupe store (TTL = retry window) + deterministic key on a DB unique constraint. Never market/believe "exactly-once delivery."
- **Source:** `ecosystem-03` §3, `field-05` §1.

### P-X2 — "Long step" treated as a "durable wait"
- **Pitfall:** A blocking `await`/`setTimeout` inside a step to wait minutes/hours. The platform's per-step timeout kills it; the workflow is marked failed while the handler still runs.
- **Condition:** Any durable-exec engine. Concrete: QStash `context.run` step cancelled ~91s in (#198).
- **Detect:** Log string `can not append to a cancelled workflow` (QStash); a `failureFunction` firing while your handler is still executing; runs failing at a suspiciously round time (~90s).
- **Avoid:** Use the durable sleep primitive — `step.sleep`/`step.waitForEvent` (Inngest), `context.sleep`/`sleepUntil` (QStash), Timers/Signals (Temporal), waitpoints (Trigger.dev). Never a real long blocking await inside a step.
- **Source:** `ecosystem-04` Upstash #198, `ecosystem-07` §5.

### P-X3 — Observability instrumentation breaks the happy path (2026 theme)
- **Pitfall:** Adding OTel/ADOT instrumentation breaks the thing you were trying to make safer.
- **Condition:** Temporal determinism (#1677 interceptor yield points, #2023 PRNG drift), Inngest step OTel context lost (#1436), AWS SigV4 corrupted in Lambda (#8019), self-hosted Inngest RSS leak in `pkg/tracing/*` (#3892).
- **Detect:** Failures that appear ONLY with instrumentation enabled — NDE after pod rolls (Temporal), `Invalid signature`/SigV4 errors (AWS), RSS climbing with tracing on (Inngest).
- **Avoid:** **Test WITH instrumentation enabled**, not just clean. For Temporal use the dedicated `@inngest/otel` path / avoid interceptors that add yield points. Treat any tracing change as a potential correctness change.
- **Source:** `ecosystem-04` §meta, `field-03` §1, `field-02` §3.

### P-X4 — Idempotency key derived from mutable / refactor-fragile data
- **Pitfall:** A dedup key computed from a field that later moves/renames in a refactor → every event computes a unique key → no dedup.
- **Condition:** Any derived (non-provider-ID) key. Concrete: Inngest #2307 double-charged checkouts after a refactor; passed in dev.
- **Detect:** Dedup works in dev/dev-server, fails in prod; OR duplicates start right after a deploy that touched the event/payload shape.
- **Avoid:** Derive only from immutable data; prefer the provider event ID for inbound dedup; add a test asserting two identical events → one side effect, run on prod-like infra.
- **Source:** `field-02` §1, `field-05` §2.

### P-X5 — Dedup TTL shorter than the provider's retry window
- **Pitfall:** Dedup cache expires before the provider's last retry, so a day-2 retry looks brand-new.
- **Condition:** Any inbound webhook. Provider windows: Stripe live ≥3 days, Shopify ≥4h, Svix ≥24h, SQS ≥ retention.
- **Detect:** Duplicate processing that lags the original by hours/days (not seconds); correlates with the provider's retry schedule.
- **Avoid:** Size dedup TTL to the LONGEST provider retry horizon, not the average.
- **Source:** `field-05` §3.

### P-X6 — Bare exponential backoff (synchronized retry storm)
- **Pitfall:** No jitter → a thousand backed-up jobs retry at the same instant when a downstream recovers, re-killing it.
- **Condition:** Any retry path without jitter.
- **Detect:** Downstream recovers then immediately falls over again; retry timestamps cluster.
- **Avoid:** Full Jitter (`random(0, exp_delay)`) for transient errors; **Equal Jitter** for throttle/429 (Full Jitter can collapse to ~0, `aws-sdk-net#4341`); always cap attempts.
- **Source:** `field-05` §4, `ecosystem-03` §1.

### P-X7 — Doing webhook work inline (timeout-induced duplicate)
- **Pitfall:** Slow work inside the request → response lands after the provider's 5-15s timeout → provider retries completed work.
- **Condition:** Any inbound webhook handler doing real work before responding.
- **Detect:** Duplicates under load only; handler p99 latency near/over the provider timeout; provider shows the delivery as "failed/timed out" though you did the work.
- **Avoid:** verify sig → dedup on event ID → persist raw → return **202** → process async.
- **Source:** `field-05` §6.

### P-X8 — Unbounded `Promise.all` fan-out (resource exhaustion)
- **Pitfall:** Fanning out many concurrent jobs/attempts without a concurrency bound → DB connection pool / socket exhaustion.
- **Condition:** Any fan-out. Concrete: Trigger.dev #3728 SharedQueueConsumer.
- **Detect:** Connection-pool-acquire timeouts; failures that scale with batch size.
- **Avoid:** p-limit / batch size on every fan-out; idempotent + durable fan-in join.
- **Source:** `ecosystem-04` Trigger.dev #3728, `ecosystem-03` §5.

### P-X9 — Polling when you should be waking on a signal
- **Pitfall:** `/loop 5m`/`CronCreate` polling for an event-shaped condition → wasted API calls/tokens.
- **Condition:** Trigger is an observable stream (log line, file change, PR status), not a clock. Claude Code ≥v2.1.98.
- **Detect:** A loop that mostly returns "nothing changed"; token spend on idle checks.
- **Avoid:** Use the **Monitor tool**; **always `grep --line-buffered` in pipes** (else events lag minutes). Keep cron only for time-based work.
- **Source:** `field-06` SHIFT 1.

---

## BullMQ

### P-B1 — Floating `^5` instead of pinning
- **Pitfall:** BullMQ ships multiple patches/week (12 releases in ~3 weeks, v5.76.11→v5.78.1) and minor bumps have regressed badly.
- **Condition:** Any `package.json` with `"bullmq": "^5..."`.
- **Detect:** `gh release list --repo taskforcesh/bullmq --limit 12` shows weekly cadence; your lockfile drifts on `npm i`.
- **Avoid:** Pin an exact version. Gate every bump on a FULL job-suite run, not unit tests.
- **Source:** `ecosystem-01` §1, `field-01` §2, `field-07` Dispute 5.

### P-B2 — Legacy `repeatable` API → duplicate scheduled jobs
- **Pitfall:** The legacy `repeatable` option re-registers repeats on worker restart and on bad keys → the job runs far more often than its interval.
- **Condition:** Using `repeatable` (not Job Schedulers); 5+ colon segments in a repeat key (#3828); `count` option (#453); restart (#2889).
- **Detect:** A scheduled job firing more often than configured; multiple copies in the delayed set.
- **Avoid:** Use the v5 **Job Schedulers** API. Never put user-controlled colon-strings in repeat keys (colons = BullMQ's key delimiter). Make repeatable handlers idempotent — a restart CAN double-fire. Verify the actual next-run (#3343 lost minute precision).
- **Source:** `ecosystem-04` BullMQ §, `field-01` §1.

### P-B3 — `maxStalledCount` silently exempts scheduler/repeat jobs (pre-5.78.1)
- **Pitfall:** A stalling scheduler job loops forever; `maxStalledCount` has no effect, never dead-letters.
- **Condition:** v5.76.8 (fixed v5.78.1, 2026-06-13). Worse if the scheduler was removed (`removeJobScheduler`).
- **Detect:** A repeat/scheduler job cycling stall→wait→stall indefinitely; failed-set stays empty for it.
- **Avoid:** Upgrade ≥5.78.1; idempotent handler; `lockDuration` > longest job; don't block the event loop with sync CPU work.
- **Source:** `field-01` §1.

### P-B4 — `lockDuration` < job time → false stalls → duplicate execution
- **Pitfall:** A long job whose lock isn't renewed in time is declared "stalled," re-queued, and re-run.
- **Condition:** `lockDuration` shorter than the longest expected job; OR a blocked event loop (sync CPU) preventing lock renewal.
- **Detect:** Same job re-running; stalled-job counters climbing; users report "ran twice."
- **Avoid:** `lockDuration` MUST exceed the longest expected job OR the job must renew its lock. Set sane `maxStalledCount`. Move CPU-heavy work off the event loop.
- **Source:** `ecosystem-04` BullMQ stalled cluster, `field-01` §1.

### P-B5 — Dedup drops your custom jobId in Flows / `keepLastIfActive`
- **Pitfall:** `if (job.id !== jobId)` dup-detection breaks silently when a job moves into a Flow; `keepLastIfActive` discards a custom jobId on requeue.
- **Condition:** Flows (#3878, fixed v5.70.4); `keepLastIfActive` (#4030); parent-job dedup in flows (#3761).
- **Detect:** Dup-detection that works for plain jobs but not flow jobs; duplicates appearing only in flow paths.
- **Avoid:** Key idempotency on a value YOU control end-to-end, not the broker's returned id.
- **Source:** `field-01` §4.

### P-B6 — Deduplication-while-active drops the trigger you cared about (policy, not bug)
- **Pitfall:** Simple/throttle/debounce dedup modes drop a trigger that arrives during active processing — "lost forever."
- **Condition:** Any dedup mode where a same-key trigger arrives mid-flight. (#3427 — maintainer argues this is *desirable* for DB-update ordering.)
- **Detect:** A coalesced job (cache-invalidation/sync) that misses the final state because the last trigger was dropped mid-flight.
- **Avoid:** Decide the *policy* deliberately: "coalesce + run once more after the last event" (sync) vs "collapse to in-flight to avoid out-of-order writes" (DB update) are OPPOSITE and both valid. Know which your mode picks. (No `requeue` mode existed as of the issue.)
- **Source:** `field-01` §4, `field-07` Dispute 4.

### P-B7 — Manual-fetch mode has a broken stall→failed lifecycle
- **Pitfall:** With `getNextJob()`, stalled jobs never reach `failed` (only `deferredFailure` is set); they pile up in `waiting`; `waiting`/`active` events don't fire as expected.
- **Condition:** Manual-fetch mode (#3911, OPEN). Activepieces hit this in prod.
- **Detect:** `waiting` set growing with un-processable jobs; nothing in `failed`; missing lifecycle events.
- **Avoid:** Treat manual-fetch as advanced — explicitly move exhausted-stall jobs to failed and wire your own DLQ.
- **Source:** `field-01` §5.

### P-B8 — Redis CPU is the ceiling; groups/priorities/`waitUntilFinished` cost the most
- **Pitfall:** Redis saturates before the app does; "each worker service starts workers for all queues" amplifies any per-poll cost (N×M pollers).
- **Condition:** Many queues + groups + priorities + rate limiters + `QueueEvents`/`waitUntilFinished` (BullMQ Pro 6.9→7.46 doubled Redis CPU, #4196).
- **Detect:** Redis CPU near 100% while app CPU is fine; `QueueEvents` pub/sub volume high.
- **Avoid:** Shard worker→queue assignment (don't start all workers in every service). Minimize `waitUntilFinished`/`QueueEvents`/priorities/groups. Monitor Redis CPU as the SLO.
- **Source:** `field-01` §3.

### P-B9 — BullMQ v5 mixed-version worker fleet misses job notifications
- **Pitfall:** v5 changed the worker-notification Redis data structure; a rolling deploy with mixed versions misses notifications.
- **Condition:** Rolling v5 upgrade where not all workers upgrade together.
- **Detect:** Jobs sitting in waiting while some workers are idle; intermittent "jobs not picked up."
- **Avoid:** Upgrade ALL workers together for v5-structure-changing bumps.
- **Source:** `ecosystem-01` §1.

### P-B10 — `connection lost` surfaces as job FAILURE, not retry
- **Pitfall:** Transient Redis socket drops mark jobs failed instead of retrying.
- **Condition:** ioredis defaults without reconnect tuning (#2542).
- **Detect:** `Error UNKNOWN while writing to socket. Connection lost` → failed jobs.
- **Avoid:** ioredis `maxRetriesPerRequest: null` + reconnect; treat connection-loss as retryable.
- **Source:** `ecosystem-04` BullMQ #2542.

### P-B11 — BullMQ + `tsc --watch`/nodemon → runaway memory + phantom stalls
- **Pitfall:** Running the worker inside the dev watcher accumulates memory and creates phantom stalled jobs.
- **Condition:** Worker-thread/isolated processes + dev watch-mode (#2610/#3040/#2913).
- **Detect:** RSS climbing in dev; stalled jobs you didn't cause; heapdump growth.
- **Avoid:** Run the worker as a SEPARATE process, not inside `tsc --watch`/nodemon.
- **Source:** `ecosystem-04` BullMQ memory cluster.

## Inngest

### P-I1 — Side effect / non-deterministic value OUTSIDE `step.run()` (the #1 Inngest bug)
- **Pitfall:** Code outside a step re-executes on EVERY invocation (because the whole function is re-invoked per step). A stray `await fetch`, `Date.now()`, `Math.random()`, or DB call outside a step runs N times.
- **Condition:** Always — it's the execution model.
- **Detect:** Duplicate work / non-deterministic branching that scales with the number of steps; values that change between steps unexpectedly.
- **Avoid:** Wrap EVERY side effect and every non-deterministic value in `step.run()`. Treat code outside steps as "runs N times."
- **Source:** `ecosystem-07` §1.

### P-I2 — Self-hosted server↔SDK version skew → all steps `Invalid signature`
- **Pitfall:** Every step fails signature validation.
- **Condition:** Self-hosted server v1.22 + SDK v4 (GET-with-body signing mismatch, #1543).
- **Detect:** `Unauthorized / Invalid signature` on ALL steps (not one) after an upgrade, with a correct signing key.
- **Avoid:** Pin server and SDK versions together when self-hosting.
- **Source:** `ecosystem-04` Inngest #1543.

### P-I3 — Plan a v3→v4 migration
- **Pitfall:** v4 became the default line late April 2026; staying on `^3` accrues migration debt.
- **Condition:** `inngest@^3`.
- **Detect:** `gh release list --repo inngest/inngest-js` shows the v4.2.6/v3.54.2 crossover (2026-04-29).
- **Avoid:** Plan the v4 migration; current line is `inngest@4.6.0` (2026-06-16).
- **Source:** `ecosystem-01` §2.

### P-I4 — OTel context lost across the `step.run()` boundary
- **Pitfall:** Third-party OTel context entries are dropped inside a step callback; chained middleware `stepOutputTransform` collapses inferred types.
- **Condition:** Ambient OTel context expected to survive into a step (#1436/#1532/#1555).
- **Detect:** Traces broken inside steps; `step.run` return types degrading to `JsonifyObject<{}>`.
- **Avoid:** Pass trace context explicitly; use the new `@inngest/otel` package (the supported path).
- **Source:** `ecosystem-04` Inngest #1436, `ecosystem-01` §2.

### P-I5 — Debounce/throttle tail latency under contention
- **Pitfall:** Debounce adds ~3.75s (750ms×5 retries) on conflicts; a 2s debounce measured p99 5.82s, max 10.10s.
- **Condition:** Contended debounce (#4150, OPEN); tracing `is_debounce` flag was broken (#3632).
- **Detect:** User-visible debounced action landing far later than nominal; no observability into the cause.
- **Avoid:** Budget p99, not the nominal window; don't debounce latency-sensitive UX hot paths; demand period-vs-queue-vs-retry observability.
- **Source:** `field-02` §2.

### P-I6 — Self-hosting "serverless" Inngest = real ops cost (RSS leak)
- **Pitfall:** RSS grows to 10+ GiB → OOM/freeze; community workaround is "let pods OOM-kill on rotation."
- **Condition:** Self-hosted, telemetry-heavy hot path (#3892, OPEN); concurrency 100/throttle 50/s/~1000 runs-day.
- **Detect:** RSS climbing linearly, never reclaimed; `GOMEMLIMIT` makes GC spin at 700% CPU without reducing RSS.
- **Avoid:** Plan pod rotation, or use managed Cloud (cost/lock-in trade). The managed/self-host axis is an ops-headcount decision.
- **Source:** `field-02` §3.

### P-I7 — Flow control is function-scoped; shared-LLM-key throttle is unsolved
- **Pitfall:** Per-function throttle can't express "throttle one shared provider key across all functions" → 429 storms.
- **Condition:** N functions sharing one model key (#3701/#4345 OPEN).
- **Detect:** 429s from the provider though no single function exceeds its throttle.
- **Avoid:** Build an external token-bucket on the provider key consulted by ALL workers; Equal-Jitter the 429 backoff. (Frontier — no productized answer.)
- **Source:** `field-02` §4, `field-07` GAP 1.

### P-I8 — Idempotency/event-schema discipline is a human-factor vulnerability
- **Pitfall:** Inngest type-safety is "contingent on discipline in defining accurate event schemas upfront" — wrong schemas = type-safety theater.
- **Condition:** Loosely-defined event schemas.
- **Detect:** Runtime payload mismatches that the types claimed were safe.
- **Avoid:** Define comprehensive, accurate event schemas; test that two identical events → one side effect.
- **Source:** `field-04` §1, `field-02` §1.

## Trigger.dev

### P-T1 — v4 queues are declared upfront (breaking change from v3)
- **Pitfall:** v3's on-demand queues are gone; v4 requires declaring queues upfront.
- **Condition:** Migrating v3→v4 (GA; current stable v4.4.6, v4.5.0 in RC).
- **Detect:** Code creating queues on-demand failing under v4.
- **Avoid:** Declare queues in config; review the v4 GA migration notes.
- **Source:** `ecosystem-06` §falls-short, `ecosystem-01` §3.

### P-T2 — Uncaught throw masqueraded as a duration timeout (pre-v4.4.6)
- **Pitfall:** An uncaught exception hung until `MAX_DURATION_EXCEEDED` instead of failing fast with the real error.
- **Condition:** < v4.4.6 (fixed 2026-05-12).
- **Detect:** Tasks "timing out" at MAX_DURATION when the real cause was an uncaught throw.
- **Avoid:** Upgrade ≥v4.4.6 (fails the attempt fast with the original error + status FAILED).
- **Source:** `ecosystem-01` §3.

### P-T3 — Managed runtime runs YOUR code on Trigger.dev servers (data residency)
- **Pitfall:** In managed mode your task code executes on Trigger.dev infra → data-residency concern; self-host loses warm starts/auto-scale/checkpoints.
- **Condition:** Regulated/data-residency-sensitive workloads.
- **Detect:** Compliance review flags where task data lives.
- **Avoid:** Self-host (Docker/Helm) for residency, accepting the perf trade; or keep sensitive data out of task payloads.
- **Source:** `ecosystem-06` §falls-short, `field-04` §1.

### P-T4 — Unbounded `Promise.all` fan-out exhausts the pool
- **Pitfall:** SharedQueueConsumer fanning attempts via `Promise.all` saturated the DB connection pool (#3728).
- **Condition:** Any unbounded fan-out.
- **Detect:** Connection-acquire timeouts scaling with batch size.
- **Avoid:** Bound concurrency (p-limit / batch size).
- **Source:** `ecosystem-04` Trigger.dev #3728.

### P-T5 — Multi-tenant fairness / native parallel fan-in not all landed (mid-2026)
- **Pitfall:** Per-tenant concurrency control, native `Promise.all` parallel waits, queue lifecycle (delete/archive), and queue rate-limiting were actively-requested OPEN gaps.
- **Condition:** Need per-tenant fairness or native parallel fan-in (#3235/#3346/#3250/#3863).
- **Detect:** No config for per-tenant max concurrency; manual fan-in workarounds.
- **Avoid:** Check the installed version for these features before designing around them; don't assume they exist.
- **Source:** `ecosystem-04` Trigger.dev queue gaps.

### P-T6 — Youngest/most-churning API surface
- **Pitfall:** "As a newer framework, its type system and APIs are still evolving."
- **Condition:** Any version — fastest-moving of the three.
- **Detect:** Type/API breakage across minor upgrades.
- **Avoid:** Pin; read changelogs on every bump; prefer stable line over RC for production.
- **Source:** `field-04` §1.

## Temporal

### P-TE1 — NDE from ANY async-ordering change (replay-time, not runtime)
- **Pitfall:** A read-only query handler, an SDK interceptor upgrade, or added `await`s shift execution order → DeterminismViolationError on replay. Green in dev/sticky-cache, explodes hours later on pod-roll eviction.
- **Condition:** OTel interceptors + `uuid4()` after a handled query (#2023); OTel interceptor 1.11.5+ reordering signals (#1677).
- **Detect:** `[TMPRL1100] Nondeterminism error` appearing AFTER pod rolls / cache eviction, not at deploy; failures only with OTel on.
- **Avoid:** Run replay/history-compat tests in CI; treat anything touching the deterministic RNG (interceptors/queries/updates) as load-bearing; use Worker Versioning; avoid SDK interceptors that add yield points.
- **Source:** `field-03` §1, `ecosystem-04` Temporal #1677.

### P-TE2 — Mixed `@temporalio/*` package versions (even patch) → phantom NDE
- **Pitfall:** "Mixing packages of different versions of `@temporalio/*` is not supported, not even patch versions."
- **Condition:** Lockfile drift across `@temporalio/*` transitive deps (#1790).
- **Detect:** Child-workflow-id mismatch NDE even on what looks like a single SDK version.
- **Avoid:** Pin and assert exact-version uniformity across ALL `@temporalio/*` packages.
- **Source:** `field-03` §2.

### P-TE3 — Worker Versioning (the fix for P-TE1) is young and server-coupled
- **Pitfall:** The sanctioned safe-evolution mechanism had its own bugs.
- **Condition:** `defaultVersioningBehavior=UNSPECIFIED` rejected (#1962); PINNED `versionOverrides` broke on Server ≥1.28.0 (#1753); high-level TS client still being built (#1716).
- **Detect:** Worker Versioning config rejected; pinning failing after a server upgrade.
- **Avoid:** Keep `patched()`/`getVersion()` as the proven escape hatch; verify Worker Versioning works on your exact server version before relying on it.
- **Source:** `field-03` §3.

### P-TE4 — Side effects / external I/O in workflow code
- **Pitfall:** External I/O in the workflow (not an Activity) re-executes on replay → duplicates.
- **Condition:** Any direct network/DB call in workflow logic.
- **Detect:** Duplicate external effects correlated with replays; NDE if the call is non-deterministic.
- **Avoid:** Side effects ONLY in Activities; workflows must be pure/deterministic. Don't add a Retry Policy to workflows (a workflow failure = code bug/bad input); Activities are the retry layer.
- **Source:** `ecosystem-07` §3.

### P-TE5 — `uuid()` / idempotency key generated INSIDE an activity
- **Pitfall:** A key generated per-retry inside the activity is a NEW key each time → new charge.
- **Condition:** Money/side-effect activities (Temporal money-slip #2).
- **Detect:** Duplicate charges despite "having an idempotency key."
- **Avoid:** Derive the key once in workflow state deterministically, pass it into the activity; enforce a DB unique constraint.
- **Source:** `ecosystem-07` §4.

### P-TE6 — Local activities give FALSE non-determinism results in replay
- **Pitfall:** Local activities (an optimization to skip the task-queue round-trip) interact badly with replay validation — false negatives/confusing failures.
- **Condition:** Local activities + replay tests (sdk-go #983).
- **Detect:** Replay says "fine" when it isn't, or a confusing replay failure tied to a local activity.
- **Avoid:** Be cautious using local activities with replay-based CI tests; prefer regular activities where determinism verification matters.
- **Source:** `field-03` §4.

### P-TE7 — Bundler/minifier fights the deterministic sandbox
- **Pitfall:** "Code minification during a build process can sometimes cause issues, requiring workarounds." The deterministic sandbox is allergic to minifiers/tree-shaking.
- **Condition:** Bundling/minifying workflow code.
- **Detect:** Determinism errors or sandbox failures that appear only in the built/minified artifact, not in dev.
- **Avoid:** Exclude workflow code from aggressive minification/tree-shaking; follow Temporal's bundler guidance.
- **Source:** `field-04` §1.

### P-TE8 — String-name activity references → runtime-only type mismatch
- **Pitfall:** Activities referenced by string name can mismatch in a way only caught at runtime/replay.
- **Condition:** Any string-keyed activity reference.
- **Detect:** Activity-not-found / arg-mismatch surfacing at runtime, not compile time.
- **Avoid:** Centralize activity name constants; test the wiring; treat the string boundary as untyped.
- **Source:** `field-04` §1.

## Cloudflare Queues

### P-C1 — `wrangler dev` silently ignores `remote: true`
- **Pitfall:** Producer messages go to Miniflare's in-memory broker, not the deployed queue, with no warning.
- **Condition:** `wrangler dev` + producer binding `remote: true` (#13727; related #9795/#9642/#5543).
- **Detect:** Messages "sent" locally never appear in the deployed queue; no error.
- **Avoid:** Verify against a real deployment, not just `wrangler dev`.
- **Source:** `ecosystem-04` Cloudflare §.

### P-C2 — No API to dead-letter a specific message on demand
- **Pitfall:** You can't programmatically DLQ one chosen message.
- **Condition:** As of June 2026 (#13816, feature request).
- **Detect:** No method for targeted dead-lettering in the API.
- **Avoid:** Design DLQ around `maxRetries`/retry-marking, not on-demand single-message DLQ; if you need targeted DLQ, pick another queue.
- **Source:** `ecosystem-04` Cloudflare #13816.

### P-C3 — Free-tier retention is 24h; at-least-once only
- **Pitfall:** Free plan max retention = 24h (paid = 14 days); at-least-once, no exactly-once, tied to Workers runtime.
- **Condition:** Free tier; non-Cloudflare stack.
- **Detect:** Messages aging out at 24h; need for exactly-once or complex orchestration.
- **Avoid:** Use paid tier for longer retention; don't pick CF Queues if you need exactly-once or you're not on Workers.
- **Source:** `ecosystem-02` §1.

## AWS SQS

### P-S1 — FIFO "exactly-once" is a 5-minute dedup window
- **Pitfall:** Treating FIFO as end-to-end exactly-once. It de-dupes the same `MessageDeduplicationId` only within 5 minutes; outside it does NOT, and the consumer must still delete the message.
- **Condition:** FIFO queues.
- **Detect:** Duplicates from re-sends >5 min apart; "exactly-once" assumptions in design docs.
- **Avoid:** Still implement an idempotent consumer; pick a good `MessageGroupId` (ordering/throughput partition); don't rely on FIFO for free exactly-once.
- **Source:** `ecosystem-02` §2.

### P-S2 — No official Node poller → hand-rolled receive/delete/visibility bugs
- **Pitfall:** AWS doesn't ship a first-class long-poll consumer loop for JS (#6015 OPEN); hand-rolled loops mis-handle visibility/delete.
- **Condition:** SQS on Node without a library.
- **Detect:** Messages re-appearing (visibility timeout) or lost (deleted too early); custom poll loop in the codebase.
- **Avoid:** Use **bbc/sqs-consumer** (1,905★, v15.0.2 2026-05-26).
- **Source:** `ecosystem-04` AWS #6015, `ecosystem-05` Part B.

### P-S3 — OTel/ADOT corrupts SigV4 signing in Lambda
- **Pitfall:** ADOT auto-instrumentation can corrupt SigV4; long-cold Lambdas hit signature expiration.
- **Condition:** Lambda + newer Smithy runtime + ADOT (#8019/#7135).
- **Detect:** Signing failures / signature-expiration errors only with instrumentation or after long cold starts.
- **Avoid:** Test signing WITH instrumentation enabled; mitigate cold-start signature expiry.
- **Source:** `ecosystem-04` AWS §.

## Upstash QStash / Workflow

### P-Q1 — `ratePerSecond` deprecated; migrate to new flow-control fields
- **Pitfall:** Code using `ratePerSecond` must move to the rewritten flow-control (`flowControlPeriod` added).
- **Condition:** 2026 flow-control rewrite.
- **Detect:** `ratePerSecond` in code; rate limits not applying as expected.
- **Avoid:** Use the new Flow Control Management API fields; VERIFY actual delivery rate after setting them.
- **Source:** `ecosystem-02` §3.

### P-Q2 — `flowControlPeriod` silently ineffective on `publishJSON`
- **Pitfall:** The period param doesn't work with `publishJSON` (param-plumbing bug).
- **Condition:** `flowControl` period via `publishJSON` (#240 OPEN; #245).
- **Detect:** Configured period has no effect on actual delivery rate.
- **Avoid:** After setting QStash flow-control, measure the real rate; don't trust the param blindly.
- **Source:** `ecosystem-04` Upstash #240.

### P-Q3 — CDN headers trip QStash loop-detection (503)
- **Pitfall:** Forwarded Fastly/Cloudflare headers tripped QStash's own loop-detection → 503 loop.
- **Condition:** A CDN in front of a QStash-Workflow endpoint (#183).
- **Detect:** 503 loop-detection responses on a CDN-fronted endpoint.
- **Avoid:** Strip CDN-injected headers (`recreateUserHeaders` filtering) before they reach QStash.
- **Source:** `ecosystem-04` Upstash #183.

### P-Q4 — Long blocking `await` inside a step (covered cross-cutting P-X2)
- See **P-X2**. QStash `context.run` step cancelled ~91s in; use `context.sleep`. (#198.)
- **Source:** `ecosystem-04` Upstash #198.

---

> **Fastest-signal lookup:** every entry's **Detect** line is the symptom→pitfall index — grep this file for the
> error string you observe (`can not append to a cancelled workflow` → P-X2; `[TMPRL1100]` after pod rolls → P-TE1;
> `Invalid signature` on ALL Inngest steps → P-I2; Redis CPU 100% / app fine → P-B8).

### Sources
Inline per pitfall. All trace to `brain/research/raw/ecosystem-01/04/07` and `field-01..06`.

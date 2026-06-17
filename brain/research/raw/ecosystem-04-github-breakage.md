---
title: "bee Ecosystem Research — Real-World Breakage (GitHub Issues that Reveal Production Gotchas)"
type: source
created: "2026-06-16"
updated: "2026-06-16"
tags: [ecosystem, github-issues, breakage, gotchas, postmortem, bee]
researcher: "ecosystem (CP123 Wave-R)"
summary: "The issues that reveal how these tools actually break in production — root causes extracted, not titles copied. Each is a rule bee should encode."
---

# bee — Real-World Breakage (GitHub Issues, root-cause extracted) — 2026-06-16

> Anti-slop: every entry below has the ROOT CAUSE, not just the title. Source = `gh issue view` (run 2026-06-16).
> These are the failure modes an agent operating these tools WILL hit. Each ends with the bee rule.

---

## BullMQ

### #2889 — Duplicate delayed jobs on repeatable (CLOSED) — v5.23.0
- **Symptom:** multiple copies of the *same* repeatable job land in the delayed set, so the job runs **far more often** than its repeat interval. Triggered by **worker stop/start (restart)**.
- **Root cause:** the legacy `repeatable` API keys repeats in a way that a restart can re-register → duplicate schedules. Maintainers steered users to the newer **Job Schedulers** API (see #2876) as the fix; `deduplication` does NOT fix it (and "seems to break / stop repeating jobs").
- **Related duplicates family:** #3828 "Repeatable jobs with **5+ colon segments in key** create duplicates" (CLOSED); #453 "Repeatable jobs duplicating due to **`count` option**" (CLOSED). Source: https://github.com/taskforcesh/bullmq/issues/2889 , /3828 , /453 (2026-06-16).
- **bee rule:** Use **Job Schedulers** (the v5 successor), NOT the legacy `repeatable` option. Never put user-controlled strings with colons into a repeat-job key (colons are BullMQ's key delimiter → collisions/dupes). Make every repeatable handler idempotent because a restart CAN double-fire.

### #3343 — `startDate` not respected with pattern/`every` (minute precision lost) (CLOSED)
- **Root cause:** repeatable scheduling lost minute precision for pattern/`every` combos. Source: https://github.com/taskforcesh/bullmq/issues/3343 (2026-06-16).
- **bee rule:** verify the *actual* next-run time after creating a scheduler; don't trust the requested cadence blindly.

### #2542 — Random "Error UNKNOWN while writing to socket. Connection lost" → failed jobs (CLOSED)
- **Root cause:** transient Redis socket drops surface as **job failures**, not retries, if not handled. Source: https://github.com/taskforcesh/bullmq/issues/2542 (2026-06-16).
- **bee rule:** configure ioredis `maxRetriesPerRequest: null` + reconnect; treat connection-loss as retryable, not a job failure.

### Memory-leak cluster (mostly OPEN) — #2610 worker threads, #3040 heapdump growth, #2913 stalled jobs + insane memory on `tsc --watch`
- **Root cause:** isolated/worker-thread processes and dev watch-mode accumulate memory; stalled-job churn compounds it. Source: https://github.com/taskforcesh/bullmq/issues/2610 , /3040 , /2913 (2026-06-16).
- **bee rule:** in dev, BullMQ + `tsc --watch`/nodemon causes runaway memory + phantom stalled jobs — run the worker as a separate process, not inside the watcher. Set `maxStalledCount` and a sane `lockDuration`.

### Stalled-job semantics confusion (OPEN) — #3078, #2501, #3911
- **Root cause:** users repeatedly misunderstand `lockDuration` vs `stalledInterval` vs `maxStalledCount`. A job is "stalled" when its lock isn't renewed in time (worker too slow/blocked event loop) → it gets re-queued → **duplicate execution**. Source: https://github.com/taskforcesh/bullmq/issues/3078 , /2501 (2026-06-16).
- **bee rule:** `lockDuration` MUST exceed the longest expected job time, OR the job must renew its lock; otherwise long jobs get re-run. A blocked event loop (sync CPU work) is the usual cause of false stalls.

## Inngest

### #1543 — Self-hosted server v1.22 + SDK v4 → every step fails signature validation (OPEN)
- **Root cause (exact):** the self-hosted server sends step-execution as a **`GET` with a JSON body**, signing `x-inngest-signature` over `body + ts`. The SDK only includes the body in the signature when `method === "POST" || "PUT"`; for `GET` it signs `"" + ts` → signatures NEVER match → `Unauthorized / Invalid signature`. Reproduced offline with `createHmac`. Source: https://github.com/inngest/inngest-js/issues/1543 (2026-06-16).
- **bee rule:** when self-hosting Inngest, pin server↔SDK versions together; this GET-body-signing mismatch silently breaks ALL steps. A symptom of "every step is Unauthorized" = version skew, not your signing key.

### #1436 / #1532 / #1555 — OTel context lost inside `step.run()`; middleware output-transform stacking collapses `step.run` inference (OPEN)
- **Root cause:** third-party OpenTelemetry context entries are dropped across the `step.run()` boundary; chained middlewares stack `stepOutputTransform` collapsing inferred types to `JsonifyObject<{}>`. Source: https://github.com/inngest/inngest-js/issues/1436 , /1532 (2026-06-16).
- **bee rule:** don't rely on ambient OTel context surviving inside a step callback; pass trace context explicitly. (Note the brand-new `@inngest/otel` package — ecosystem-01 — is the supported path.)

### #1171 — "How to monitor step retry status?" (OPEN, high-interest question)
- **Signal:** observability of *retry* state is non-obvious — a recurring user pain. Source: https://github.com/inngest/inngest-js/issues/1171 (2026-06-16).

## Trigger.dev

### #3728 — `Promise.all` over chunked attempts in SharedQueueConsumer risks connection-pool saturation (CLOSED)
- **Root cause:** fanning attempts through `Promise.all` without bounded concurrency can exhaust the DB connection pool. Source: https://github.com/triggerdotdev/trigger.dev/issues/3728 (2026-06-16).
- **bee rule (general):** unbounded `Promise.all` fan-out is a classic resource-exhaustion bug — always bound concurrency (p-limit / batch size) on fan-out.

### Queue-management gaps (OPEN) — #3235 max concurrency irrespective of tenant queue, #3346 native `Promise.all` parallel waits, #3250 delete/archive unused queues, #3863 queue rate-limiting
- **Signal:** multi-tenant concurrency control + parallel waits + queue lifecycle are actively-requested gaps as of mid-2026. Source: https://github.com/triggerdotdev/trigger.dev/issues/3235 , /3346 , /3250 , /3863 (2026-06-16).
- **bee rule:** if you need per-tenant fairness or native parallel fan-in on Trigger.dev, check version — these were not all landed by June 2026.

## Temporal (TypeScript SDK)

### #1677 — Upgrading OTel Interceptor to 1.11.5+ breaks `signalWithStart` ordering and may cause NDE (CLOSED)
- **Root cause (exact + quotable):** 1.11.5 added tracing propagation on inbound signals (#1449) and 1.11.6 changed promise-completion order on `scheduleLocalActivity` (#1577). These **added `await` statements**, so code that ran synchronously now runs as a **microtask** → execution order changed from A-B-C to A-C-B → **Non-Determinism Errors (NDE)** when older workflows replay on the newer SDK *with the OTel interceptor*. Maintainer rule: "interceptors provided by the SDK itself should as much as possible avoid adding yield points." Source: https://github.com/temporalio/sdk-typescript/issues/1677 (2026-06-16).
- **bee rule:** Temporal workflow code is **replay-deterministic** — ANY change that alters async ordering (even an SDK interceptor upgrade) can break in-flight workflows with NDE. Pin SDK versions; use **Worker Versioning** (Replay 2026, ecosystem-01) so running workflows stay on the worker that started them. THIS is the #1 Temporal foot-gun.

### #770 — Timeout on last `runReplayHistory` (CLOSED); #1362 — `runReplayHistory()` should accept serialized History (OPEN)
- **Signal:** replay-testing ergonomics (the way you VERIFY determinism before deploy) are still rough. Source: https://github.com/temporalio/sdk-typescript/issues/770 , /1362 (2026-06-16).
- **bee rule:** run replay-tests against production histories before any workflow-code deploy — but expect tooling friction.

## Cloudflare Queues

### #13727 — Queue producer binding silently ignores `remote: true` in `wrangler dev` (OPEN)
- **Root cause (exact):** a producer binding with `remote: true` is silently treated as local in `wrangler dev` — messages go to **Miniflare's in-memory broker** instead of the deployed queue, with **no warning/error/runtime indication**. Source: https://github.com/cloudflare/workers-sdk/issues/13727 (2026-06-16).
- **Related local-dev breakage:** #9795 Queues broken with multiple dev commands; #9642 producer binding causes 500 on all routes with `--remote`; #5543 can't test any `--remote` binding with Queues; #13816 (feature) no API to immediately dead-letter a specific message. Source: https://github.com/cloudflare/workers-sdk/issues/9795 , /9642 , /5543 , /13816 (2026-06-16).
- **bee rule:** Cloudflare Queues **local dev is a minefield** — `remote: true` may be ignored silently, so a message you "sent" in dev may never reach the real queue. Verify against a real deployment, not just `wrangler dev`. There is (as of June 2026) **no API to dead-letter a specific message on demand**.

## AWS SQS (aws-sdk-js-v3)

### #6015 — "Official SQS poller for JavaScript" still open (OPEN, long-running ask)
- **Signal:** AWS does NOT ship a first-class long-poll consumer loop for JS — everyone hand-rolls or uses the community `sqs-consumer`. Source: https://github.com/aws/aws-sdk-js-v3/issues/6015 (2026-06-16).
- **bee rule:** for SQS-on-Node, use **bbc/sqs-consumer** (community standard) rather than hand-rolling the receive/delete/visibility loop.

### #8019 / #7135 — SigV4 signing fails in Lambda with newer Smithy runtime + ADOT instrumentation / signature expiration (CLOSED/OPEN)
- **Root cause:** OpenTelemetry (ADOT) auto-instrumentation can corrupt SigV4 signing in Lambda; long-cold Lambdas hit signature expiration. Source: https://github.com/aws/aws-sdk-js-v3/issues/8019 , /7135 (2026-06-16).
- **bee rule:** OTel auto-instrumentation + AWS SDK SigV4 is a known collision (also seen in Temporal #1677 and Inngest #1436) — **observability instrumentation breaking the happy path is a recurring 2026 theme**; test signing/determinism WITH instrumentation enabled.

## Upstash QStash / Workflow

### workflow-js #198 — Run marked failed/cancelled while a long-running `context.run` step is still executing (CLOSED)
- **Root cause (exact):** a `context.run(...)` step that does **real async waiting** (300_000ms with heartbeats) on Vercel gets the workflow marked failed ~91s in; `failureFunction` fires; when the still-running handler finishes it errors `can not append to a cancelled workflow`. i.e. QStash's server-side timeout for a step is **shorter than a genuinely long step** unless you use `context.sleep`. Source: https://github.com/upstash/workflow-js/issues/198 (2026-06-16).
- **bee rule:** on Upstash Workflow, a single `context.run` step must finish within the platform step-timeout — for long waits use `context.sleep`/`sleepUntil` (durable wait), NOT a blocking in-step `await`. Don't do real long sleeps inside a step.

### qstash-js #240 — `flowControl` period param does not work with `publishJSON` (OPEN); #245 "Error with flow-control" (CLOSED)
- **Root cause:** the rewritten flow-control (`flowControlPeriod`, ecosystem-02) had/has rough edges — the period param silently ineffective on `publishJSON`. Source: https://github.com/upstash/qstash-js/issues/240 , /245 (2026-06-16).
- **bee rule:** after setting QStash flow-control, VERIFY the actual delivery rate; the new `flowControlPeriod` field has known param-plumbing bugs.

### workflow-js #183 — `recreateUserHeaders()` doesn't filter Fastly CDN headers → 503 loop-detection (CLOSED)
- **Root cause:** forwarded CDN headers tripped QStash's own loop-detection. Source: https://github.com/upstash/workflow-js/issues/183 (2026-06-16).
- **bee rule:** when a CDN (Fastly/Cloudflare) sits in front of a QStash-Workflow endpoint, strip CDN-injected headers or hit 503 loop-detection.

---

## Cross-tool meta-patterns (the real lessons)

1. **OTel/observability instrumentation breaks the happy path** — Temporal #1677 (NDE), Inngest #1436 (lost context), AWS #8019 (SigV4) all in 2026. Test WITH instrumentation on.
2. **"Long step" ≠ "durable wait"** — Upstash #198: blocking `await` inside a step hits platform timeouts; use the durable sleep primitive instead. (Same trap exists conceptually on Inngest/Trigger.dev — use `step.sleep`, not `setTimeout`.)
3. **Repeatable/cron scheduling is the duplicate-jobs epicenter** — BullMQ #2889/#3828/#453: restarts + bad keys → duplicate fires. Always idempotent handlers + the newer scheduler API.
4. **Local-dev lies** — Cloudflare #13727: dev silently diverges from prod. Verify on real infra.
5. **Determinism is sacred (Temporal)** — any async-ordering change breaks replays. Worker Versioning is the escape hatch.

---

### Sources (all `gh issue view` / `gh search issues`, accessed 2026-06-16)
- BullMQ: github.com/taskforcesh/bullmq/issues/{2889,3828,453,3343,2542,2610,3040,2913,3078,2501,3911}
- Inngest: github.com/inngest/inngest-js/issues/{1543,1436,1532,1555,1171}
- Trigger.dev: github.com/triggerdotdev/trigger.dev/issues/{3728,3235,3346,3250,3863}
- Temporal: github.com/temporalio/sdk-typescript/issues/{1677,770,1362}
- Cloudflare: github.com/cloudflare/workers-sdk/issues/{13727,9795,9642,5543,13816}
- AWS SDK JS v3: github.com/aws/aws-sdk-js-v3/issues/{6015,8019,7135}
- Upstash: github.com/upstash/workflow-js/issues/{198,183}, github.com/upstash/qstash-js/issues/{240,245}

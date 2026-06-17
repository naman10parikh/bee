---
title: "bee BATTLE-TESTED SCENARIOS — Real Production Failures, Migrations & Their Resolutions"
type: synthesis
created: "2026-06-16"
updated: "2026-06-16"
tags: [scenarios, postmortem, failures, migrations, eval-seed, bee]
synthesizer: "SYNTHESIS (taste node, CP123 Wave-R)"
sources: ["brain/research/raw/ecosystem-04-github-breakage.md", "brain/research/raw/ecosystem-07-docs-deepdive-durable-execution.md", "brain/research/raw/field-01-bullmq-issues.md", "brain/research/raw/field-02-inngest-issues.md", "brain/research/raw/field-03-temporal-issues.md", "brain/research/raw/field-04-comparison-and-migrations.md", "brain/research/raw/field-05-idempotency-patterns.md"]
summary: "≥16 specific, real failure/migration/production scenarios with named issues, affected versions, the symptom, the root cause, and the resolution. These are the golden eval-task seeds for Wave S."
---

# bee BATTLE-TESTED SCENARIOS

> Each scenario is REAL (named GitHub issue / named source, with version) — not invented. Format:
> **Symptom → Trigger → Root cause → Resolution → bee rule → Eval-seed.** The Eval-seed line is the
> question to pose to a candidate (the agent) in Wave S; passing means it produces the Resolution.
> "Verdict" judges whether this is a clean golden task (deterministic, gradable) or needs framing.

---

## S-1 — The infinite stall loop: a "capped" retry that never dead-letters
- **Symptom:** A BullMQ scheduler/repeat job that stalls loops forever — stall → back to wait → picked up → stalls again — and **`maxStalledCount` has no effect**. The poison message never dies.
- **Trigger:** A worker hangs (sync CPU work / blocked event loop) so the lock expires; the job was created by a Job Scheduler.
- **Root cause (exact):** `moveStalledJobsToWait` saw `repeat` in the job opts and **skipped the `maxStalledCount` check entirely**, moving the job back to wait unconditionally — and only checked whether the job *was created by* a scheduler, not whether the scheduler still exists. (BullMQ #4220, affected v5.76.8, fixed v5.78.1, 2026-06-13.)
- **Resolution:** Upgrade to ≥v5.78.1. Independently: make the handler idempotent (it WILL re-run), ensure `lockDuration` exceeds the longest job, and don't do sync CPU work that blocks the event loop (the cause of the lock expiry).
- **bee rule:** A safety cap with *exemptions* is not a cap. Verify `maxStalledCount`/DLQ caps apply to ALL job types including repeatables/schedulers.
- **Source:** `field-01` §1, `ecosystem-04` (BullMQ stalled cluster).
- **Verdict:** Clean golden task — "Here is a BullMQ scheduler job stalling forever despite maxStalledCount=3. Diagnose and fix." Deterministic answer.

## S-2 — The double-charged checkout (idempotency key pointed at the wrong field)
- **Symptom:** A Stripe `checkout.session.completed` handler with `idempotency: 'event.data.checkoutSessionId'` runs multiple times for the same session in production — every checkout could double-fire. **Worked fine on the dev server.**
- **Trigger:** A code refactor moved/renamed the field the idempotency key expression pointed at.
- **Root cause:** The idempotency *engine* worked; the *key expression* silently pointed at the wrong field after the refactor, so each event computed a unique key → no dedup. Dev-vs-prod divergence hid it. (Inngest #2307, resolution quote: "the idempotency key was wrong due to a refactor 🙈".)
- **Resolution:** Derive the key from **immutable** event data; add a TEST asserting two identical events collapse to ONE side effect, run against prod-like infra (not just the dev server).
- **bee rule:** Idempotency bugs are key-derivation bugs, not engine bugs. The bug is never "the dedup didn't run," it's "the key was subtly wrong."
- **Source:** `field-02` §1, `field-05` §2.
- **Verdict:** Clean golden task — "This idempotent function double-fires in prod but not dev. Find the bug." Excellent eval.

## S-3 — The day-two retry that looked brand-new (dedup TTL too short)
- **Symptom:** Work already completed on day 1 is reprocessed when the provider retries on day 2 (duplicate fulfillment / duplicate email).
- **Trigger:** The dedup cache key expired before the provider's full retry window closed; the provider's later retry arrived with the same event ID but found no dedup record.
- **Root cause:** Dedup TTL sized to the *average* retry, not the *longest possible* provider retry horizon. Stripe live mode retries for ≥3 days; Svix/Shopify ≥24h.
- **Resolution:** Set dedup TTL ≥ provider's FULL retry window: Stripe ≥3 days, Shopify ≥4h (24h safe), Svix ≥24h, SQS ≥ retention.
- **bee rule:** The #1 *silent* idempotency failure is a dedup TTL shorter than the retry window. Size to the longest horizon.
- **Source:** `field-05` §3.
- **Verdict:** Clean golden task — "Duplicate fulfillment happens ~2 days after the order. The dedup cache has a 6h TTL. What's wrong?" Deterministic.

## S-4 — The timeout-induced duplicate (work done inline in the webhook handler)
- **Symptom:** A webhook handler completes the work, but the provider retries anyway and the work runs twice.
- **Trigger:** The handler's HTTP response arrived AFTER the provider's 5-15s timeout (slow inline work), so the provider treated it as a failure and retried.
- **Root cause:** Doing the work inside the request. The provider times out before the slow handler returns → duplicates by construction.
- **Resolution:** Verify signature → dedup on provider event ID → persist the raw event to a durable queue → **return 202 immediately** → process asynchronously from the queue.
- **bee rule:** Inline work = duplicates by construction. This is WHY background jobs exist in the webhook path: ack-fast(202) → enqueue → idempotent async worker.
- **Source:** `field-05` §6.
- **Verdict:** Clean golden task — "A webhook double-processes under load even though it's idempotent-keyed. The handler does a 9s API call inline. Fix the architecture." Strong eval (tests the ack-fast pattern, not just dedup).

## S-5 — Determinism explodes hours later: OTel + uuid4 + a pod roll
- **Symptom:** A Temporal workflow runs fine for hours, then **DeterminismViolationError [TMPRL1100]** halts it after a pod roll — `workflow.uuid4()` returns a different value on replay than what was recorded.
- **Trigger:** Stock OTel workflow interceptors installed + a handled **query or update-validation** between two `uuid4()` ticks + the workflow gets evicted from sticky cache and replays on a fresh worker.
- **Root cause (exact):** The query handler advances the deterministic PRNG during live execution, but replay never re-invokes the query handler → the PRNG isn't advanced by those bytes → `uuid4()` drifts → the recorded child-workflow-id/activity-arg no longer matches. The trigger was *adding observability*. (Temporal sdk-typescript #2023, dup of #1895, fix in #1992.)
- **Resolution:** Treat ANYTHING touching the deterministic RNG (interceptors, queries, updates) as load-bearing. Run replay/history-compatibility tests in CI. Avoid SDK interceptors that add yield points; use Worker Versioning so running workflows stay on the worker that started them.
- **bee rule:** Durable-exec engines move the failure from runtime to **replay-time** — green in dev/sticky-cache, explodes hours later on pod-roll eviction. The hardest class of bug to catch. Adding observability can BREAK you.
- **Source:** `field-03` §1, `ecosystem-04` Temporal #1677.
- **Verdict:** Golden but hard — needs framing ("a Temporal workflow NDEs only after pod rolls, only with OTel on; explain why"). Tests deep understanding; grade on naming the PRNG/query-replay mechanism.

## S-6 — Every step is "Unauthorized" after a self-hosted Inngest upgrade
- **Symptom:** On self-hosted Inngest, **every** step fails signature validation with `Unauthorized / Invalid signature`.
- **Trigger:** Self-hosted server v1.22 + SDK v4 (version skew).
- **Root cause (exact):** The server sends step-execution as a **`GET` with a JSON body**, signing `x-inngest-signature` over `body + ts`. The SDK only includes the body in the signature when method is POST/PUT; for GET it signs `"" + ts` → signatures never match. (Inngest #1543.)
- **Resolution:** Pin server↔SDK versions together when self-hosting. "Every step is Unauthorized" = version skew, not your signing key.
- **bee rule:** When self-hosting Inngest, pin server and SDK together; a GET-body-signing mismatch silently breaks ALL steps.
- **Source:** `ecosystem-04` Inngest #1543.
- **Verdict:** Clean golden task — "Self-hosted Inngest: every step returns Invalid signature after upgrading the SDK. The signing key is correct. Diagnose." Deterministic.

## S-7 — The reverse migration: Temporal → BullMQ (drop a service tier)
- **Symptom (decision scenario):** A product team (ToolJet) running Temporal decides the durable-execution ceremony isn't worth it and migrates to BullMQ.
- **Trigger:** Temporal's separate cluster (frontend/history/matching/worker services + a DB) is operational overhead they already pay Redis for elsewhere.
- **Root cause / rationale:** "Simplified Architecture: No need for separate Temporal server deployment"; "Leverages your existing Redis instance"; deployment complexity High(multi-service)→Low(single-service); cost Higher→Lower.
- **Resolution / outcome:** They consolidated onto existing Redis and were happy. The trade: lose durable replay, gain simplicity.
- **bee rule:** "Everyone's moving to durable execution" has a credible counter-current. For many workloads the right 2026 move is the OPPOSITE — drop the orchestration engine, use a queue on existing Redis. Adopting Temporal is the least-reversible decision (a rewrite either way).
- **Source:** `field-04` §2/§4, `field-07` Dispute 2.
- **Verdict:** Golden decision task — "A team runs Temporal for mostly-short jobs and already operates Redis. Should they migrate to BullMQ? Argue both sides, then recommend." Tests taste + reversibility reasoning, not a single right answer — grade on holding both sides.

## S-8 — The long step that wasn't durable (QStash 91s timeout)
- **Symptom:** An Upstash Workflow run is marked failed ~91s in; `failureFunction` fires; when the still-running handler finishes it errors `can not append to a cancelled workflow`.
- **Trigger:** A `context.run(...)` step does **real async waiting** (e.g. 300,000ms with heartbeats) on Vercel.
- **Root cause:** QStash's server-side per-step timeout is shorter than a genuinely long step. A blocking in-step `await` is not a durable wait. (Upstash workflow-js #198.)
- **Resolution:** For long waits use `context.sleep`/`sleepUntil` (durable wait), NOT a blocking in-step `await`. A single `context.run` step must finish within the platform step-timeout.
- **bee rule:** "Long step" ≠ "durable wait." The same trap exists conceptually on Inngest/Trigger.dev — use `step.sleep`, not `setTimeout`.
- **Source:** `ecosystem-04` Upstash #198, `ecosystem-07` §5.
- **Verdict:** Clean golden task — "An Upstash Workflow step that awaits a 5-min job gets cancelled ~90s in. Fix it." Deterministic.

## S-9 — Dedup dropped your custom job id (silent in flows)
- **Symptom:** Dup-detection code (`if (job.id !== jobId) // deduplicated`) silently breaks the moment you move a regular job into a Flow.
- **Trigger:** Migrating a deduplicated job into a BullMQ Flow (or using `keepLastIfActive`).
- **Root cause:** Regular jobs: a de-duplicated `queue.add` returns the SAME `job.id` as the original (detectable). **Flows do NOT** return the same id (#3878, fixed v5.70.4 via PR #3905); `keepLastIfActive` discards a custom jobId on requeue (#4030).
- **Resolution:** Never trust the queue's returned id to carry your dedup signal. Key your idempotency on a value YOU control end-to-end, not the queue's returned id.
- **bee rule:** Dedup IDs get dropped in flows / `keepLastIfActive`. Key idempotency on domain identity you own, not the broker's id.
- **Source:** `field-01` §4.
- **Verdict:** Clean golden task — "Dedup detection works for jobs but breaks when wrapped in a Flow. Why, and how do you fix the design?" Deterministic.

## S-10 — Local dev lied: the message never reached the real queue
- **Symptom:** Messages "sent" in local dev never appear in the deployed Cloudflare queue — with **no warning, error, or runtime indication**.
- **Trigger:** A Cloudflare Queues producer binding with `remote: true` under `wrangler dev`.
- **Root cause:** `remote: true` is silently treated as local in `wrangler dev` — messages go to Miniflare's in-memory broker, not the deployed queue. (workers-sdk #13727; related #9795/#9642/#5543.)
- **Resolution:** Verify against a real deployment, not just `wrangler dev`. Don't trust local Queues dev for producer/consumer wiring.
- **bee rule:** Cloudflare Queues local dev is a minefield — `remote: true` may be silently ignored. There is (as of June 2026) also **no API to dead-letter a specific message on demand** (#13816).
- **Source:** `ecosystem-04` Cloudflare §.
- **Verdict:** Clean golden task — "Messages sent in `wrangler dev` never reach the deployed CF queue, no errors. What's happening?" Deterministic.

## S-11 — Minor version bump bricked every processor
- **Symptom:** After a BullMQ upgrade, jobs transition `waiting`→`active`, the processor's sync code runs and logs appear, but **the first `await` never resolves and no error is thrown** — affecting ALL processors (email, batch, PDF).
- **Trigger:** Upgrading BullMQ 5.65.1 → 5.77.3 (a "minor" range) with `@nestjs/bullmq` 11.0.4, ioredis 5.10.1, Node 22.17. (#4194, OPEN — maintainers couldn't reproduce.)
- **Root cause:** Unconfirmed (live dispute). Pairs lethally with #4220 — a hang feeds the infinite-stall loop.
- **Resolution:** Pin BullMQ to an exact version; gate every bump on a FULL job-suite run (not unit tests). Pre-v5.78.1, also expect the stall-loop amplifier.
- **bee rule:** BullMQ ships multiple patches/week — treat minor bumps as risky. 5.65→5.77 bricked every processor for one team.
- **Source:** `field-01` §2, `field-07` Dispute 5.
- **Verdict:** Golden-with-caveat — root cause is unconfirmed, so grade the *response process* (pin + full-suite gate + rollback), not a root-cause diagnosis. Good for testing upgrade discipline.

## S-12 — Redis CPU melted before the app did
- **Symptom:** After a BullMQ Pro upgrade, Redis CPU jumps from ~50% steady-state to ~100%.
- **Trigger:** BullMQ Pro 6.9.0 → 7.46.0 (nested bullmq 4.17.0→5.76.6), with many queues + groups + priorities + rate limiters + `QueueEvents`/`waitUntilFinished`, **each worker service starting workers for ALL queues**.
- **Root cause:** The v5 "marker changes" altered Redis command volume; groups/priorities are extra sorted-set ops, `waitUntilFinished`/`QueueEvents` add pub/sub load. N services × M queues = N×M pollers. (#4196.)
- **Resolution:** Don't start workers for all queues in every service (shard worker→queue assignment). Watch `QueueEvents`/`waitUntilFinished`/priorities/groups as the cost drivers. Treat Redis CPU as the ceiling.
- **bee rule:** Redis CPU is BullMQ's real scaling wall, not job throughput. This is the failure behind most "our BullMQ melted" stories — Redis saturates before the app does.
- **Source:** `field-01` §3.
- **Verdict:** Clean golden task — "BullMQ Redis CPU doubled after an upgrade; we run all workers for all queues with groups+priorities. Diagnose the scaling model." Deterministic-ish (tests the Redis-ceiling mental model).

## S-13 — The 10 ways a Temporal workflow duplicates money
- **Symptom:** Money-moving operations double-fire across a range of subtle slips.
- **Trigger / Root cause / Resolution (each is its own micro-scenario, postmortem-grade):**
  1. Activity retry treated as safe → charge times out *after* the gateway processed it → double-charge. **Fix:** every money call gets an idempotency key stable across retries + worker restarts.
  2. `uuid()` generated INSIDE the activity per retry = new key = new charge. **Fix:** derive the key once in workflow state, pass it in.
  3. `StartToCloseTimeout` misread as "didn't run." **Fix:** confirm-before-repeat — query the gateway by idempotency key before re-charging.
  4. In-memory dedup bypassed by restart/concurrency. **Fix:** unique constraint on the key in the DB.
  5. External I/O in workflow code re-executes on replay. **Fix:** side effects only in Activities.
  6. Assuming `ActivityId` dedupes the external gateway (it dedupes workflow history only). **Fix:** domain-level keys both your DB and the external system recognize.
  7. Infinite retry on ambiguous errors → eventual dupes. **Fix:** classify — connection-reset-before-send = safe retry; timeout/ambiguous = switch to a status query.
  8. A `PaymentConfirmed` signal processed twice → duplicate payout. **Fix:** dedupe signals by tracking processed event IDs in workflow state.
  9. Parent times out waiting, starts another child; both charge. **Fix:** deterministic child-workflow IDs + reattach.
  10. Refund times out after succeeding, retry double-refunds. **Fix:** compensation must be as idempotent as the forward path.
- **bee meta-rule:** The dangerous failure is "it ran but I didn't hear back." On ambiguous timeout: **query state, don't blind-retry**; every side effect carries a deterministic key enforced by a DB unique constraint.
- **Source:** `ecosystem-07` §4 (generalizes to EVERY at-least-once system).
- **Verdict:** A scenario *family* = 10 golden micro-tasks. Each (symptom → fix) is independently gradable. The richest single eval vein in the corpus.

## S-14 — Debounce tail latency made a "save" feel broken
- **Symptom:** A debounced user-visible action fires 3-7s later than its configured window under contention, with no observability into where the latency came from.
- **Trigger:** `debounce()` retries up to 5× with 750ms backoff on `ErrDebounceInProgress`/`ErrDebounceNotFound`/`DeadlineExceeded` → ~3.75s tail; under contention a 2s debounce measured p50 3.09s, p99 5.82s, max 10.10s. (Inngest #4150, OPEN.)
- **Root cause:** Debounce creation/update isn't atomic in the queue; the retry tail is invisible (the `is_debounce` tracing flag was even broken, #3632).
- **Resolution:** Budget **p99, not the nominal window**, for any user-visible debounced action. Demand observability into period-vs-queue-vs-retry latency. Don't debounce latency-sensitive UX in a hot loop.
- **bee rule:** Debounce/throttle windows have a hidden retry tail — budget p99.
- **Source:** `field-02` §2.
- **Verdict:** Golden — "A debounced 'autosave' sometimes lands 7s late though configured at 2s. Explain and mitigate." Tests tail-latency awareness.

## S-15 — Self-hosting the "serverless" tool: 10 GiB RSS leak, OOM-on-rotation
- **Symptom:** Self-hosted Inngest RSS grows linearly and is never reclaimed: ~500 MiB fresh → ~3 GiB at 12h → 10+ GiB at 2-3 days → system freeze. Heap shows ~1 GiB inuse but RSS is 10.6 GiB; `GOMEMLIMIT=8GiB` makes GC spin at 700% CPU without reducing RSS.
- **Trigger:** Concurrency 100 global / 4 per key + throttle 50/s + ~1000 runs/day on PG17+Redis7. Root-cause hint: the tracing/telemetry subsystem (`pkg/tracing/*`).
- **Root cause:** Go-runtime RSS pathology in a telemetry-heavy hot path. (#3892, OPEN; corroborated — community workaround is "run multiple pods and let them OOM-kill on rotation.")
- **Resolution:** If you must self-host Inngest, plan for pod rotation / OOM-kill as an operational reality, or use managed Cloud (reintroduces vendor cost/lock-in). Background-jobs choice is partly an ops-team-size decision.
- **bee rule:** The "serverless/AI-first" pitch hides that self-hosting Inngest is operationally nontrivial. The managed/self-host axis is an ops-headcount decision, not a feature decision.
- **Source:** `field-02` §3.
- **Verdict:** Golden taste task — "We picked self-hosted Inngest to avoid vendor lock-in; pods OOM every 2-3 days. What trade-off did we miss?" Tests the ops-cost-of-self-host insight.

## S-16 — Throttle the shared LLM key across many functions (the unsolved one)
- **Symptom:** Many agent functions each call the same rate-limited model provider; together they exceed the provider's TPM/RPM and get 429-stormed, even though no single function exceeds its own limit.
- **Trigger:** Per-function/per-queue flow control (the default in Inngest and BullMQ) with N functions sharing one provider key.
- **Root cause:** Flow control is **function-scoped by default**. "Throttle a shared external resource across functions" is a first-class OPEN gap in both: Inngest #3701 (shared throttle scope) + #4345 (burstable keyed concurrency), BullMQ #3670/#3831 (global/points-based rate limit).
- **Resolution (no productized answer — bee's frontier):** Implement an external token-bucket on the provider key (shared store, e.g. Redis/Upstash) that ALL workers consult before calling the model; treat it as a core requirement, not an add-on. Pin Equal-Jitter backoff for the resulting 429s.
- **bee rule:** The single most important flow-control feature for an agent jobs harness — "never exceed the model provider's TPM/RPM across all my workers" — is unsolved in both leading tools as of mid-2026. Build it.
- **Source:** `field-02` §4, `field-06` SHIFT 4, `field-07` GAP 1.
- **Verdict:** Golden frontier task — "10 Inngest functions share one OpenAI key and hit 429s though each is under its own throttle. Solve it." Tests whether the agent KNOWS this is unsolved and reaches for an external token bucket. High-value.

## S-17 — Polling burned tokens; the Monitor tool was the answer
- **Symptom:** A `/loop 5m` polling a deploy/test status burns ~5 full API calls over 10 minutes, 4 of them wasteful.
- **Trigger:** Using time-driven polling (`CronCreate`/`/loop`) for an event-shaped wait ("wake me when the build fails").
- **Root cause:** Polling is the wasteful path for observable streams as of Claude Code v2.1.98 (2026-04-09). The Monitor tool is event-driven: "if the command is silent, Claude spends nothing."
- **Resolution:** Use the **Monitor tool** (`command`, `description`, `timeout_ms`, `persistent`) for stream/poll-and-if waits; **always `grep --line-buffered` in pipes** or events lag minutes. Keep `CronCreate`/`/loop` only for genuinely time-based work ("nightly at 2am").
- **bee rule:** Polling is now the wasteful path. Prefer Monitor (wake-on-signal) when the trigger is an observable stream. (This OVERRIDES the internal `loop-integration` skill's `/loop 5m` guidance for event-shaped waits.)
- **Source:** `field-06` SHIFT 1, `field-00` A.
- **Verdict:** Clean golden task — "An agent polls deploy status every 5 min with /loop. Make it cheaper." Deterministic (answer = Monitor + line-buffered).

## S-18 — Replay tests in CI failed on child-workflow id mismatch
- **Symptom:** A correct `Worker.runReplayHistory` CI test (the right thing to do) fails with `[TMPRL1100] Nondeterminism error: Child workflow id of scheduled event '...' does not match child workflow id of command '...'`.
- **Trigger:** Building a history-compatibility test in CI — even on a single SDK version (1.13.0 everywhere here).
- **Root cause:** Replay tooling itself is fragile; separately, "mixing packages of different versions of `@temporalio/*` is not supported, not even patch versions" (maintainer) — a lockfile drift can produce phantom nondeterminism. (sdk-typescript #1790.)
- **Resolution:** Run replay/history-compat tests in CI anyway (they're the only real defense), but pin + assert exact-version uniformity across all `@temporalio/*` packages and expect tooling friction (#770/#1362).
- **bee rule:** Even the defense mechanism (replay tests) has sharp edges; pin and assert Temporal SDK version uniformity.
- **Source:** `field-03` §2, `ecosystem-04` Temporal #770/#1362.
- **Verdict:** Golden — "A Temporal replay CI test fails on child-workflow-id mismatch on a single SDK version. What's the likely cause and the discipline to prevent it?" Tests version-uniformity awareness.

## S-19 — Unbounded fan-out exhausted the connection pool
- **Symptom:** A fan-out over many attempts saturates the DB connection pool and jobs start failing on connection acquisition.
- **Trigger:** `Promise.all` over chunked attempts in Trigger.dev's SharedQueueConsumer without bounded concurrency. (#3728.)
- **Root cause:** Unbounded `Promise.all` fan-out is a classic resource-exhaustion bug.
- **Resolution:** Bound concurrency on every fan-out (p-limit / batch size). For fan-in, ensure the aggregation/join step is itself idempotent + durable.
- **bee rule:** Always bound concurrency on fan-out; make the fan-in join idempotent and durable (a crash mid-aggregate must not double-count).
- **Source:** `ecosystem-04` Trigger.dev #3728, `ecosystem-03` §5.
- **Verdict:** Clean golden task — "A batch fan-out of 5,000 child jobs exhausts the DB pool. Fix the fan-out and the fan-in." Deterministic.

## S-20 — Manual-fetch mode inherited a broken stall lifecycle
- **Symptom:** With BullMQ manual `getNextJob()`, stalled jobs never move to `failed` — they sit in `waiting` forever; `waiting`/`active` events don't fire as expected.
- **Trigger:** Using manual-fetch mode (common when you want your own concurrency/observability) instead of the automatic Worker.
- **Root cause:** The stall checker only sets `deferredFailure`; jobs are moved to `failed` ONLY by automatic processing, which never runs in manual mode. Docs are wrong. (#3911, OPEN; Activepieces hit this and patched at the consumer level, PR activepieces#13110.)
- **Resolution:** Treat manual-fetch as an advanced mode with its OWN DLQ wiring — explicitly move exhausted-stall jobs to failed yourself.
- **bee rule:** Manual `getNextJob()` inherits a different, more broken stall lifecycle than automatic mode; poison messages accumulate in `waiting` instead of dead-lettering.
- **Source:** `field-01` §5.
- **Verdict:** Golden — "Using BullMQ getNextJob(), stalled jobs never dead-letter. Why, and what must you build?" Tests deep BullMQ knowledge.

---

## Eval-task summary (for Wave S)
- **Deterministic-answer golden tasks (single right answer):** S-1, S-2, S-3, S-4, S-6, S-8, S-9, S-10, S-12, S-17, S-19. → highest-confidence pass/fail grading.
- **Taste / both-sides tasks (grade on reasoning quality):** S-7, S-15, S-16.
- **Process-discipline tasks (grade on method, not root cause):** S-11.
- **Deep-mechanism tasks (grade on naming the mechanism):** S-5, S-14, S-18, S-20.
- **Scenario family = 10 micro-tasks:** S-13.
- **Total seeds: 20 scenarios → ~30 gradable eval tasks** (S-13 expands to 10).

### Sources
Inline per scenario. All trace to `brain/research/raw/ecosystem-04`, `-07`, and `field-01..05`, which carry the issue URLs + versions + dates.

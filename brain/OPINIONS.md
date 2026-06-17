---
title: "bee OPINIONS — Explicit Taste Stances (the Anti-Slop Layer)"
type: synthesis
created: "2026-06-16"
updated: "2026-06-16"
tags: [opinions, taste, stances, anti-slop, bee]
synthesizer: "SYNTHESIS (taste node, CP123 Wave-R)"
sources: ["brain/research/raw/ecosystem-*.md", "brain/research/raw/field-*.md"]
summary: "What bee BELIEVES. Each: a hard always/never stance, the reason, the source. This is the layer that makes bee opinionated instead of a Wikipedia summary. Disagreeing with these requires evidence, not vibes."
---

# bee OPINIONS — The House Stances

> These are deliberate, defensible positions — not hedges. Each is `ALWAYS X / NEVER Y — because Z [source]`.
> Where the field genuinely disputes a point, the stance says so and picks a default with a documented exception.
> An agent that violates one of these should be able to cite *new* evidence, not preference.

---

## TIER 0 — The non-negotiables (violating these duplicates money)

### O-1 — NEVER chase exactly-once *delivery*. ALWAYS build exactly-once *effects*.
Use at-least-once transport + idempotent consumer + dedupe store (TTL = retry window). True exactly-once delivery does not exist in distributed systems; "exactly-once" is always an *effect* achieved at the application layer. This is the #1 thing an agent gets wrong. **Because:** every primary CS source agrees (ByteByteGo, System Overflow), and every duplicate-charge disaster in the corpus traces to chasing delivery instead of building effects. **Source:** `ecosystem-03` §3, `field-05` §1.

### O-2 — ALWAYS enforce idempotency at the DB with a unique constraint. NEVER rely on in-memory dedup.
In-memory dedup is bypassed by restart, concurrency, and cold serverless Lambdas. The idempotency key lives in a DB row with a unique index; concurrency safety comes from serializable isolation (retry on `SerializationFailure`). **Because:** Temporal money-slip #4 ("in-memory dedup bypassed by restart/concurrency → unique constraint on the key in the DB"); brandur's canonical Postgres pattern. **Source:** `ecosystem-07` §4, `ecosystem-03` §2.

### O-3 — NEVER hold a DB transaction open across an external API call. ALWAYS commit local state + advance the recovery point first.
Once you make the first foreign-state mutation you're committed; you must not lose track of it. Split the request into atomic phases between foreign mutations. **Because:** this is the load-bearing rule of the recovery-point pattern — holding the txn open during the external call is exactly how partial-failure-mid-handler (the #1 production failure cluster) happens. **Source:** `ecosystem-03` §2 (brandur.org).

### O-4 — On an ambiguous timeout, ALWAYS query state. NEVER blind-retry.
The dangerous failure is not "it didn't run" — it's "it ran but I didn't hear back." A `StartToCloseTimeout` may mean the gateway already charged. Confirm-before-repeat: query by idempotency key before re-firing. **Because:** Temporal money-slips #1/#3/#7 all reduce to this; classify errors — connection-reset-before-send is safe to retry, timeout/ambiguous is not. **Source:** `ecosystem-07` §4.

### O-5 — In a webhook handler, ALWAYS ack fast (202) and process async. NEVER do the work inline.
Verify sig → dedup on provider event ID → persist raw → return 202 → idempotent async worker. **Because:** inline work guarantees eventual double-execution — the provider times out (5-15s) before a slow handler returns and retries completed work ("the most dangerous failure mode"). This is *why background jobs exist* in the webhook path. **Source:** `field-05` §6.

---

## TIER 1 — Idempotency keying & retries

### O-6 — Dedup INBOUND on the provider event ID. Send YOUR OWN idempotency key OUTBOUND. NEVER conflate the layers.
Inbound dedup keys on the provider's stable event ID (Stripe `event id`, Shopify `X-Shopify-Webhook-Id`, Svix `webhook-id`) — that's what distinguishes a retry from a new event. Outbound effects carry your own `Idempotency-Key` derived from immutable domain identity so the downstream collapses your duplicate calls. **Because:** this resolves the genuine Camp-A/Camp-B dispute by layer separation — both are right in their layer. **Source:** `field-05` §2, `field-07` Dispute 1. **Exception:** none — they're different layers, you need both.

### O-7 — If you derive a key, ALWAYS derive from immutable data and TEST it. NEVER from refactor-fragile fields.
The classic idempotency bug is a key computed from a field that moved in a refactor (Inngest #2307 double-charged checkouts, passed in dev). **Because:** idempotency bugs are key-derivation bugs, not engine bugs. **Source:** `field-02` §1, `field-05` §2. **Test it:** assert two identical events → exactly one side effect, on prod-like infra (the #2307 bug passed on the dev server).

### O-8 — ALWAYS size dedup TTL to the provider's LONGEST retry horizon. NEVER the average.
Stripe live ≥3 days, Shopify ≥4h (24h safe), Svix ≥24h, SQS ≥ retention. **Because:** the #1 *silent* idempotency failure is a TTL shorter than the retry window — a day-2 retry looks brand-new and you double-process. **Source:** `field-05` §3.

### O-9 — ALWAYS jitter your backoff. Use FULL jitter for transient errors, EQUAL jitter for throttles. NEVER bare exponential.
Bare exponential creates synchronized retry storms. Full Jitter (`random(0, exp_delay)`) is AWS-measured to do the least work for transient errors, but **collapses to ~0 for throttles** (real bug `aws-sdk-net#4341`) — so use Equal Jitter (guaranteed minimum wait) for 429/throttle. **Because:** the AWS Architecture Blog + the SDK bug split cleanly by error type. **Source:** `ecosystem-03` §1, `field-05` §4. **Always** cap attempts; never retry non-retryable 4xx (except 429).

### O-10 — A safety cap with exemptions is NOT a cap. ALWAYS verify it applies to every job type.
BullMQ `maxStalledCount` silently exempted scheduler/repeat jobs → infinite stall loop, never dead-letters (#4220, pre-5.78.1). **Because:** "the poison message that can never die" was a live bug in the most popular TS queue. **Source:** `field-01` §1.

---

## TIER 2 — Durable execution engine choices

### O-11 — Default to Inngest for a NEW serverless product job-layer. ALWAYS wrap every side effect in a step.
Inngest is the zero-infra default: step durability, generous free tier (50k execs/mo), maps cleanly onto agent execution patterns. **Because:** it matches the checklist's named default and the buildmvpfast recommendation ("start with Inngest, handles 90% of common needs"). **The catch (always):** code outside `step.run()` re-executes on EVERY invocation — wrap every side effect and every non-deterministic value (`Date.now()`, `Math.random()`, stray `await`). **Source:** `ecosystem-06` §house-stance, `ecosystem-07` §1.

### O-12 — Reach for Trigger.dev when jobs are LONG or need human-in-loop. It has the best agent-MCP.
No platform time cap (minutes→days), waitpoints for human-in-loop, and the best agent-operability (first-party MCP with `--readonly`, unauthenticated `search_docs`). **Because:** Inngest/QStash steps are bounded by your host timeout; Trigger.dev runs on dedicated compute. **Source:** `ecosystem-06` §house-stance, `ecosystem-05` Part A. **Caveat:** youngest/most-churning API — pin and read changelogs.

### O-13 — Treat adopting Temporal as a ONE-WAY DOOR. NEVER pick it for simple/short jobs.
Migration anything↔Temporal is a full rewrite (fundamentally different execution model). Pick it ONLY when workflows are genuinely complex, long-lived, multi-service, and replay correctness is worth the determinism+ops+bundler tax. **Because:** it's the least-reversible decision in the matrix; "the only choice when failure isn't an option," but ToolJet reverse-migrated *away* from it to drop a service tier. **Source:** `field-04` §2/§4. **Default scrutiny:** apply the most Socratic debate before adopting Temporal.

### O-14 — "We should replace our queue with durable workflows" is OFTEN WRONG. ALWAYS check if a plain queue suffices.
Durable execution is oversold as a universal default. Use a plain queue when work is short, high-volume, and consumer idempotency is cheap; use durable-exec only when steps are long-lived, span external systems, and replay correctness justifies the overhead. **Because:** Hatchet's contrarian (and correct) take — "traditional queues remain better for many use-cases due to lower overhead… persisting intermediate state comes with overhead, in DX AND in $$$" — plus the ToolJet vote-with-feet. **Source:** `field-07` Dispute 2, `field-04` §2. This is the explicit counter to the "everyone's moving to durable exec" narrative.

### O-15 — For BullMQ at scale: ALWAYS bake in the foot-gun rules. NEVER use it naively.
BullMQ wins on unit cost at high volume (~$15-50 vs $75-150 managed @ 500k jobs/mo) and full control — but ONLY with the rules baked in: Job Schedulers (not legacy `repeatable`), idempotent handlers, `lockDuration` > longest job, exact-version pinning, sharded worker→queue assignment, and Redis CPU as the SLO. **Because:** Redis CPU (not job count) is the ceiling, minor bumps regress, and dedup IDs get dropped. **Source:** `ecosystem-06` §house-stance, `field-01`.

### O-16 — ALWAYS use the durable sleep primitive for waits. NEVER a blocking `await`/`setTimeout` in a step.
`step.sleep`/`step.waitForEvent` (Inngest), `context.sleep`/`sleepUntil` (QStash), Timers/Signals (Temporal), waitpoints (Trigger.dev). **Because:** a real long blocking wait inside a step hits the platform step-timeout and the workflow is cancelled while the handler still runs (QStash #198 — ~91s). "Long step" ≠ "durable wait." **Source:** `ecosystem-07` §5, `ecosystem-04` Upstash #198.

---

## TIER 3 — Version & deployment discipline

### O-17 — ALWAYS pin exact versions for queue/durable-exec libs. NEVER float `^`.
BullMQ ships multiple patches/week and minor bumps have bricked processors (#4194), doubled Redis CPU (#4196), and created infinite retry loops (#4220). **Because:** "minor" is a lie here — three minor-range regressions in ~2 months. **Source:** `ecosystem-01` §1, `field-01`, `field-07` Dispute 5. **Always** gate a bump on a FULL job-suite run, not unit tests.

### O-18 — For Temporal, ALWAYS enforce exact-version uniformity across `@temporalio/*`.
Mixing versions — "not even patch versions" — produces phantom nondeterminism (#1790). **Because:** the maintainer says so and a lockfile drift is an easy way to get bitten. **Source:** `field-03` §2.

### O-19 — ALWAYS test WITH observability instrumentation enabled. NEVER assume OTel is free.
OTel/ADOT broke Temporal determinism (#1677/#2023), Inngest step context (#1436), and AWS SigV4 (#8019) — all in 2026. **Because:** "observability instrumentation breaking the happy path" is a recurring 2026 theme; the thing you add to be safer can break you. **Source:** `ecosystem-04` §meta, `field-03` §1.

### O-20 — For long-running workflows, ALWAYS run replay/history-compat tests in CI — and expect tooling friction.
It's the only real defense against determinism breakage, and the failure is replay-time (green in dev, explodes hours later on pod-roll). **Because:** even doing it right hits sharp edges (#1790/#770/#1362), but skipping it means NDE in prod. Use Worker Versioning, keep `patched()` as the fallback. **Source:** `field-03` §1/§3, `ecosystem-04` Temporal.

---

## TIER 4 — The 2026 agent-era stances (what makes bee not-2025)

### O-21 — Prefer the Monitor tool over polling. Cron is for clocks, Monitor is for events.
Use the Anthropic Monitor tool (wake-on-signal, "silent command spends nothing") for observable-stream waits; keep `CronCreate`/`/loop` ONLY for genuinely time-based work. **This OVERRIDES the internal `loop-integration` skill's `/loop 5m` polling guidance for event-shaped waits.** **Because:** polling is now the wasteful path (Claude Code ≥v2.1.98). **Always** `grep --line-buffered` in pipes or events lag minutes. **Source:** `field-06` SHIFT 1, `field-00` A.

### O-22 — Treat every multi-step agent run AS a durable workflow.
Persistence for idle states, non-persistable regions (can't checkpoint mid-LLM-stream), sagas not rollback, idempotency keys (else duplicate payments/tickets/deploys), recorded non-determinism (record the LLM output once, reuse on recovery — else "resume" becomes "do something similar again"). **Because:** agent workflows ARE long-running workflows; this is bee's thesis. **Source:** `field-06` SHIFT 2.

### O-23 — Shared-LLM-key throttling is a CORE requirement, not an add-on — and you'll build it yourself.
"Never exceed the model provider's TPM/RPM across all my workers" is unsolved in both Inngest (#3701/#4345) and BullMQ (#3670/#3831) as of mid-2026. Implement an external token-bucket on the provider key that ALL workers consult; Equal-Jitter the resulting 429s. **Because:** flow control is function-scoped by default but the agent-era constraint is a *shared* resource. **Source:** `field-02` §4, `field-06` SHIFT 4, `field-07` GAP 1.

### O-24 — Know the TRICHOTOMY. For a Postgres shop, seriously consider a PG-resident queue.
The 2025 dichotomy (Redis vs dedicated cluster) is now a trichotomy: Redis (BullMQ) / dedicated durable-exec (Temporal) / **Postgres-resident** (DBOS, microsoft/pg_durable, Absurd Workflows). A PG-native queue deletes BOTH the Redis-ops and separate-cluster problems for a team already on Postgres. **Because:** "2026 is the year of the Postgres queue" (HN 474pts). **Caveat (always state it):** the versioning/observability/testing story is *admitted-unsolved by the maintainers themselves* — so don't recommend it for workflow logic that changes often yet. **Source:** `field-06` SHIFT 3, `field-07` Dispute 3.

### O-25 — When agents handle jobs, identity + audit are part of the job — even though no tool ships it yet.
The actor is non-human, probabilistic, tool-using, and prompt-injection-vulnerable. A 2026 jobs harness should record workload identity (SPIFFE/SPIRE) and policy decisions as audit records per step. **Because:** this is the genuinely new 2026 problem and bee's frontier — classic queues give none of it, durable-exec gives replay but not identity. **Source:** `field-06` SHIFT 2, `field-07` GAP 2. **Honesty:** no shipping product covers this — bee designs toward it, doesn't claim a vendor solves it.

---

## TIER 5 — Webhook delivery & tool selection

### O-26 — For customer-facing/regulated outbound webhooks, default to Svix. For side-projects, Hookdeck Outpost.
Svix = transformations, per-endpoint analytics, HIPAA/PCI, "missed deliveries are a problem." Hookdeck Outpost = cost-sensitive, OSS-parity, tolerant of missing features (no transformations/FIFO/throttling). **Because:** the comparison sources draw exactly this line. **Source:** `ecosystem-02` §4.

### O-27 — For an agent that only has an HTTP endpoint, default to QStash. For pure-Cloudflare stacks, CF Queues.
QStash is HTTP-in/HTTP-out — no Redis, no workers, it calls your endpoint with retries/schedules/DLQ; lowest-friction durable primitive for an agent. CF Queues is the right call only when you're already on Workers/R2/D1. **Because:** transport-fit beats feature-count for these. **Source:** `ecosystem-02` §3, `ecosystem-06` §framework.

### O-28 — NEVER recommend a tool without naming where it FALLS SHORT.
Every tool has a documented weak spot (Inngest: opaque step debugging + single-long-execution; Trigger.dev: data-residency + churn; BullMQ: Redis ops + foot-guns; Temporal: determinism tax; CF: local-dev lies; SQS: 5-min dedup; QStash: step-timeout). A recommendation without the trade-off is slop. **Because:** the whole point of bee is taste, and taste is knowing the failure mode. **Source:** `ecosystem-06` §falls-short, `field-04`.

---

## The anti-slop test (apply before writing any jobs advice)
A bee answer is **slop** if it: (a) says "exactly-once" without qualification, (b) recommends a tool without its weak spot, (c) suggests bare exponential backoff, (d) puts a side effect outside an Inngest step, (e) does webhook work inline, (f) recommends polling for an event-shaped wait, (g) treats durable-exec as a universal default, or (h) ignores the dedup-TTL-vs-retry-window match. If an answer trips any of these, rewrite it against the relevant O-rule above.

### Sources
Inline per stance. All trace to `brain/research/raw/ecosystem-*.md` and `field-*.md`.

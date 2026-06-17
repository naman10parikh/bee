---
title: "bee EXPERTISE MAP — What the Background-Jobs/Queues/Workflows Employee Must Master"
type: synthesis
created: "2026-06-16"
updated: "2026-06-16"
tags: [expertise, map, jobs, queues, workflows, durable-execution, bee]
synthesizer: "SYNTHESIS (taste node, CP123 Wave-R)"
sources: ["brain/research/raw/ecosystem-*.md", "brain/research/raw/field-*.md"]
summary: "The structured competence map for bee, organized by JOB-TO-BE-DONE (not by tool). Every node cites its raw source. A fresh Claude session reading this becomes dangerous in this vertical."
---

# bee EXPERTISE MAP

> **Domain:** Background jobs / queues / workflows.
> **Why bee exists:** Energy's harness checklist grades this component 🟡 *partial* — only `node-cron` (alpha, wikimem) + `cron-parser` (runtime), **no durable queue**. (`field-00`, citing `energy/audit/HARNESS-CHECKLIST-2026.md` L78/L332-337/L397.) bee is the employee that converts that flat tool-shortlist into TASTE: when each tool wins, how each breaks, and the version-specific traps.
> **Organizing principle:** a competence is a *job to be done*, not a tool. Tools are means; the invariants below are the ends.

---

## THE ONE INVARIANT (master it before anything else)

**At-least-once transport + idempotent consumer + dedupe store (TTL = retry window). NEVER chase true exactly-once *delivery*.** Every side effect carries a **deterministic idempotency key enforced by a DB unique constraint**. On any ambiguous timeout → **query state, don't blind-retry**.

This single sentence is the load-bearing wall behind every duplicate-charge, duplicate-email, duplicate-deploy disaster in the corpus. Sources: `ecosystem-03` §3 (ByteByteGo "exactly-once *effect*"), `ecosystem-07` §4 (the 10 Temporal money-slips), `field-05` §1 ("the load-bearing wall"), `field-05` §6 (timeout-induced duplicate). Everything else in this map is a corollary or a tool-specific expression of it.

---

## JTBD-1 — "Make a side effect safe to run twice" (idempotency)

The non-negotiable core. An agent that gets this wrong duplicates money.

| Node | What to master | Source |
|---|---|---|
| **Idempotency-key contract** | Client owns the key; retries because it didn't get a response, not because it wants a new op. "Same key → same response." Guarantees at-most-once *execution*. | `ecosystem-03` §2 (Stripe blog) |
| **The recovery-point pattern** | Split a request into atomic phases (local mutations between foreign mutations); each phase = one serializable txn returning `RecoveryPoint`/`Response`/`NoOp`. **NEVER hold a DB transaction open during an external API call** — commit local state + advance `recovery_point` *before* the external call. | `ecosystem-03` §2 (brandur.org — canonical impl) |
| **The `idempotency_keys` table** | Columns that matter: `locked_at` (concurrency guard → 409 if locked within LOCK_TIMEOUT), `recovery_point` (DAG checkpoint), `response_code`/`response_body` (cached reply), `request_params` (validate the retry's params match). Unique index `(user_id, idempotency_key)`. Serializable isolation → retry on `SerializationFailure`. | `ecosystem-03` §2 (brandur.org) |
| **Two-layer keying (DISPUTED — hold both)** | *Inbound dedup* → key on the **provider event ID** (Stripe `event id`, Shopify `X-Shopify-Webhook-Id`, Svix `webhook-id`) — stable across the provider's retries. *Outbound effect* → send **YOUR own** `Idempotency-Key` to the downstream API, derived from immutable domain identity (order id). Don't conflate the layers. | `field-05` §2, `field-07` Dispute 1 |
| **Dedup-window sizing** | Dedup cache TTL **≥ provider's FULL retry window**: Stripe ≥3 days, Shopify ≥4h (24h safe), Svix ≥24h, SQS ≥ retention. Too-short TTL = day-2 retry looks new = double-process. The #1 *silent* idempotency failure. | `field-05` §3 |
| **Derived-key fragility** | If you derive a key, derive from **immutable** data and TEST that two identical inputs → one effect. The classic bug is a key computed from a field that *moved in a refactor* (Inngest #2307 double-charged checkouts; passed in dev). | `field-02` §1, `field-05` §2 |
| **Forward your key downstream** | Pass your idempotency key into the downstream's `Idempotency-Key` so even if your local state is lost, the downstream replays its cached response. | `ecosystem-03` §2 (Stripe) |

## JTBD-2 — "Retry without melting the system" (backoff, jitter, retry storms)

| Node | What to master | Source |
|---|---|---|
| **The four backoff algorithms (exact formulas)** | No-jitter: `min(cap, base·2^attempt)`. Full Jitter: `random(0, min(cap, base·2^attempt))`. Equal Jitter: `half + random(0, half)`. Decorrelated: `min(cap, random(base, sleep·3))`. | `ecosystem-03` §1 (AWS Architecture Blog) |
| **Jitter choice by error type (DISPUTED — split, don't pick globally)** | **Full Jitter** for transient network errors (fastest recovery, AWS-measured least work). **Equal Jitter** for throttle/429 errors (guaranteed minimum wait — Full Jitter can collapse to ~0, real bug `aws-sdk-net#4341`). | `ecosystem-03` §1, `field-07` Dispute (Full vs Equal) |
| **Thundering herd / synchronized retries** | Bare exponential backoff creates synchronized retries: when a downstream recovers, a thousand backed-up jobs retry at the same instant and re-kill it. Jitter spreads the herd. This is the mechanism behind "the queue melted." | `field-05` §4 |
| **Always bound retries** | `cap` + max attempts; uncapped retries cause retry storms (AWS Well-Architected REL05-BP03). Never retry non-retryable errors (4xx except 429). | `ecosystem-03` §1 |
| **The retry-storm-that-never-dies** | A safety cap with *exemptions* is not a cap: BullMQ `maxStalledCount` was silently bypassed for scheduler/repeat jobs (#4220) → infinite stall→wait→stall loop, never dead-letters. Verify your cap applies to ALL job types. | `field-01` §1 |
| **Status-code retry rules** | Retry on 408 (timeout) and 429 (honor `Retry-After`). 3xx redirects are non-retriable → register the final URL. | `field-05` §7 |

## JTBD-3 — "Pick the right delivery guarantee" (semantics)

| Node | What to master | Source |
|---|---|---|
| **At-most-once** | May lose, never duplicates. Telemetry/metrics/live updates — trades guarantees for latency. | `ecosystem-03` §3 (oneuptime) |
| **At-least-once** | Never loses, may duplicate (consumer crashes after processing, before ack). The practical middle ground. **BullMQ, SQS Standard, Cloudflare Queues, QStash, Inngest steps, Temporal activities are ALL this.** | `ecosystem-03` §3, `field-05` §1 |
| **"Exactly-once" is a marketing word** | In distributed systems it's "exactly-once *effect*," never true exactly-once *delivery*. Always state the qualified version. | `ecosystem-03` §3, `field-07` (no bare "exactly-once") |
| **SQS FIFO "exactly-once" = a 5-minute dedup window** | Re-sending the same `MessageDeduplicationId` within 5 min is de-duped; outside it is NOT, and the consumer must still delete the message. NOT end-to-end exactly-once. | `ecosystem-02` §2 |
| **Temporal's qualified guarantee** | Exactly-once *workflow logic* (deterministic replay) ON TOP OF at-least-once *activity* execution. Activities still run ≥1× → activity idempotency is still your job. | `ecosystem-07` §3, `field-03` §synthesis-5 |

## JTBD-4 — "Run durable async work that survives a crash" (durable execution mechanics)

The three engines have **three different execution models and three different determinism contracts.** Getting these wrong = duplicated money / lost work. This is the deepest node in the map.

| Node | What to master | Source |
|---|---|---|
| **Inngest = re-invoke + memoize by step-ID hash** | Each step runs as a separate HTTP request; completed steps are memoized (hash of step ID) and skipped on resume. **The #1 gotcha:** code *outside* `step.run()` re-executes on EVERY invocation — wrap every side effect AND every non-deterministic value (`Date.now()`, `Math.random()`, stray `await fetch`) in a step. | `ecosystem-07` §1 |
| **Trigger.dev = CRIU process snapshot + idempotency-keyed subtask cache** | On pause, CRIU snapshots the live process (memory, CPU registers, FDs), compresses, resumes from the exact point. No "code outside steps re-runs" trap. Subtask output cached by idempotency key; only failed subtask + downstream retry. (v3 mechanic; v4 "Run Engine 2" + waitpoints — *internals unconfirmed*, see GAPS.) | `ecosystem-07` §2 |
| **Temporal = replay workflow code against recorded history** | No memory snapshot — recovery replays the workflow and verifies decisions match history. A different path (wall-clock, random, direct I/O) → **Non-Determinism Error (NDE), execution halts.** Side effects live ONLY in Activities. Workflows don't retry by default; Activities do. | `ecosystem-07` §3, `field-03` |
| **Durable wait ≠ long step** | Use the durable sleep primitive (`step.sleep`/`step.waitForEvent`, Temporal Timers, Trigger waitpoints), NEVER a blocking in-step `await`/`setTimeout`. A real long `await` inside a QStash `context.run` step hits the platform timeout (~91s) and the workflow is marked failed while the handler still runs → "can not append to a cancelled workflow." | `ecosystem-07` §5, `ecosystem-04` Upstash #198 |
| **The 10 money-duplication slips** | Generalize to EVERY at-least-once system: (1) retry-as-safe-by-default, (2) random key INSIDE the activity, (3) timeout misread as "didn't run," (4) skipping DB-layer idempotency, (5) replay re-runs side effects, (6) ActivityId ≠ external dedup, (7) retry on wrong errors forever, (8) signals deliver >once, (9) child-workflow start spawns duplicates, (10) saga compensation not idempotent. | `ecosystem-07` §4 |
| **The meta-rule** | The dangerous failure is NOT "it didn't run" — it's "it ran but I didn't hear back." On any ambiguous timeout: **query state, don't blind-retry.** | `ecosystem-07` §4 |

## JTBD-5 — "Orchestrate many jobs" (fan-out / fan-in, flow control, concurrency)

| Node | What to master | Source |
|---|---|---|
| **Fan-out / fan-in shape** | Fan-out: one trigger → N parallel jobs. Fan-in: wait for all N → aggregate → continue (map-reduce of background work). Per-tool: Inngest native parallel steps; Trigger.dev `batchTriggerAndWait`; Temporal child workflows + `Promise.all` (most robust large fan-in); BullMQ **Flows** (parent waits for children); SQS = SNS→N queues, app counts completions. | `ecosystem-03` §5 |
| **Bounded fan-out (resource exhaustion)** | Unbounded `Promise.all` over a fan-out exhausts the DB connection pool (Trigger.dev #3728). ALWAYS bound concurrency (p-limit / batch size) on fan-out. | `ecosystem-04` Trigger.dev #3728 |
| **Idempotent + durable JOIN** | The fan-in aggregation step must itself be idempotent and durable — a crash during aggregation after some children completed must not double-count. Apply the recovery-point pattern to the join. | `ecosystem-03` §5 |
| **Flow control is function-scoped by default** | Inngest/BullMQ rate-limiting is per-function/per-queue. The 2026 agent-era need — **throttle a shared external resource (one LLM key) across many functions** — is a first-class OPEN gap in BOTH (Inngest #3701/#4345, BullMQ #3670/#3831). | `field-02` §4, `field-06` SHIFT 4, `field-07` GAP 1 |
| **Debounce / throttle tail latency** | Debounce has a hidden retry tail: ~750ms×5 ≈ 3.75s added under contention (Inngest #4150). For a user-visible action, p99 can be 3× the nominal window — budget p99, not nominal. | `field-02` §2 |
| **BullMQ scaling wall = Redis CPU** | Not job throughput. Groups/priorities/`QueueEvents`/`waitUntilFinished` cost the most (sorted-set ops + pub/sub). "Each worker service starts workers for all queues" = N×M pollers hammering Redis. | `field-01` §3 |

## JTBD-6 — "Dead-letter and recover poison messages" (DLQ)

| Node | What to master | Source |
|---|---|---|
| **Why DLQ exists** | A poison message (received, un-processable) consumes worker capacity forever and, in FIFO/ordered systems, blocks everything behind it. DLQ isolates it. | `ecosystem-03` §4 |
| **Redrive policy** | `maxReceiveCount` → DLQ after N failed receives. AWS native DLQ redrive (back to source) is the recommended replay path. | `ecosystem-03` §4 |
| **DLQ is a REPLAY BUFFER, not a graveyard** | Pair with tooling to inspect → fix the handler bug → redrive. Replaying a previously-processed event is safe *only because* the consumer is idempotent — the dedup layer absorbs it. DLQ + idempotent consumer is a package deal. | `field-05` §5 |
| **DLQ best practices** | DLQ retention > source retention; same account/region; alarm on depth>10 / oldest-age>1h; retain 14-30d; distinguish retryable vs non-retryable in consumer code (reduces DLQ noise + retry storms). | `ecosystem-03` §4, `field-05` §5 |
| **Sometimes letting go is right** | Not every DLQ message should be replayed (e.g. rebuilding read models). DLQ "only works if retries are bounded, triage has an owner, replay is deliberate not a panic button." | `ecosystem-03` §4 |
| **Tool-specific DLQ reality** | BullMQ: exhausted-retry jobs sit in the `failed` set forever, **no built-in redrive UX — you build it**; manual-fetch mode is worse (stalled jobs never reach `failed`, #3911). Cloudflare: **no API to dead-letter a specific message on demand** (#13816). | `field-01` §5, `ecosystem-04` CF #13816 |

## JTBD-7 — "Receive and send webhooks reliably" (the webhook sub-domain)

| Node | What to master | Source |
|---|---|---|
| **Inbound vs outbound** | Inbound = receiving 3rd-party webhooks reliably (Hookdeck classic). Outbound = sending webhooks to YOUR customers (Svix Dispatch, Hookdeck Outpost). bee needs both — vendors blur this. | `ecosystem-02` §4 |
| **Ack fast, work async (the most dangerous failure)** | The timeout-induced duplicate: handler completes the work but the HTTP response arrives after the provider's 5-15s timeout → retry of completed work. FIX: verify sig → dedup on event ID → persist raw → return **202** → process async. **Inline work = duplicates by construction.** This is WHY background jobs exist in the webhook path. | `field-05` §6 |
| **Signature verification** | Verify on **raw body bytes before JSON parse**; constant-time compare (`crypto.timingSafeEqual`). Stripe embeds a timestamp, 5-min default tolerance → validate freshness (replay protection). | `field-05` §7 |
| **Svix vs Hookdeck Outpost decision** | Hookdeck Outpost = cost-sensitive/side-projects, tolerant of missing features (no transformations/FIFO/throttling, no HIPAA/PCI). **Svix = production / customer-facing / regulated / "missed deliveries are a problem"** (transformations, per-endpoint analytics, HIPAA/PCI). OSS: Convoy, Hook0. | `ecosystem-02` §4 |
| **The AI-native webhook primitive** | agent finishes → fires webhook → downstream reacts ("Managed Agents 'Outcomes'"). Svix / Hookdeck Outpost are the delivery rail. | `ecosystem-02` §4, `field-00` C |

## JTBD-8 — "Schedule recurring work" (cron / scheduling)

| Node | What to master | Source |
|---|---|---|
| **The fleet's primitive is NON-durable** | `CronCreate`/`/loop` is session-scoped: "tasks die when Claude Code exits," max 50 tasks, 3-day expiry, fires between turns, local TZ. For durable scheduling → GitHub Actions `schedule`/`workflow_dispatch`. **This is the single most important internal lesson — it's the exact gap bee owns.** | `field-00` A |
| **Repeatable scheduling = the duplicate-jobs epicenter** | BullMQ restarts + bad keys → duplicate fires (#2889/#3828/#453). Use **Job Schedulers** (v5 successor), NEVER the legacy `repeatable` option. Never put user-controlled colon-strings in a repeat key (colons = BullMQ's key delimiter). Always idempotent handlers — a restart CAN double-fire. | `ecosystem-04` BullMQ §, `field-01` §1 |
| **Verify the actual next-run** | Don't trust the requested cadence blindly — BullMQ lost minute precision for pattern/`every` combos (#3343). | `ecosystem-04` BullMQ #3343 |
| **Per-tool cron** | Inngest/Trigger.dev/Temporal Schedules all have cron; CF Queues via delay; SQS via EventBridge; QStash native scheduler. | `ecosystem-06` master matrix |

## JTBD-9 — "Operate the jobs layer as an AGENT" (agent-operability)

bee is an agent-native employee — this is how bee *itself* drives these tools.

| Node | What to master | Source |
|---|---|---|
| **Trigger.dev = best agent-operability** | First-party MCP in the CLI. `search_docs` works UNAUTHENTICATED (RAG the docs for free). `--yolo` installs MCP into all clients. **`--readonly` hides write tools** (`deploy`/`trigger_task`/`cancel_run`) — the safety default for inspection. 11 new MCP tools in v4.4.4. | `ecosystem-05` Part A |
| **Temporal = most powerful control MCP** | Code-Exchange MCP exposes **19 tools**: per-workflow start/cancel/terminate, real-time query+signal, batch ops across many workflows, full schedule management via cron. Best for steering RUNNING workflows. | `ecosystem-05` Part A |
| **QStash = pure HTTP (most agent-friendly transport)** | No MCP needed — POST a message + destination URL, it delivers with retries/schedules/DLQ. An agent with only an HTTP client fully drives it. | `ecosystem-05` Part A, `ecosystem-02` §3 |
| **The gaps** | NO first-party MCP for **Inngest, BullMQ, AWS SQS** (confirmed via negative search — weaker than positive, see GAPS). BullMQ = TS library + bull-board + redis-cli. | `ecosystem-05` Part A, `ecosystem-08` gap #2 |
| **Best scaffold repos** | AI-job shape: `inngest-js/examples/framework-nextjs-app-router` or `triggerdotdev/examples/building-effective-agents`. Durable orchestration w/ signals/child-workflows: `temporalio/samples-typescript` (462★). SQS poller: `bbc/sqs-consumer` (1,905★). Dashboard: `felixmosh/bull-board`. | `ecosystem-05` Part B |

## JTBD-10 — "Run async work for a PROBABILISTIC AGENT" (the 2026 thesis — bee's reason to exist)

This is what makes bee a 2026 employee, not a 2025 BullMQ tutorial. A 2025 doc gets all of this wrong.

| Node | What to master | Source |
|---|---|---|
| **Polling is obsolete — use the Monitor tool** | Anthropic Monitor (Claude Code v2.1.98, 2026-04-09): event-driven, "if the command is silent, Claude spends nothing." Prefer Monitor (wake-on-signal) over `CronCreate`-polling whenever the trigger is an observable stream (log line, file change, PR status). `CronCreate`/`/loop` is correct only for genuinely time-based work ("run nightly at 2am"). **Always `grep --line-buffered` in pipes** or events lag by minutes. | `field-06` SHIFT 1 |
| **Every multi-step agent IS a long-running workflow** | Durable execution is no longer enterprise/Temporal niche — it's the default substrate for multi-step agents. Five lessons agent specs steal: persistence for idle states, non-persistable regions (can't checkpoint mid-LLM-stream), sagas not rollback, idempotency keys (else duplicate payments/tickets/deploys), recorded non-determinism (record the LLM output once, reuse on recovery — else "resume" becomes "do something similar again"). | `field-06` SHIFT 2 |
| **The genuinely NEW problem: accountability for non-human actors** | The actor is non-human, short-lived, probabilistic, tool-using, vulnerable to **prompt injection / tool poisoning**. Demands workload identity (SPIFFE/SPIRE) recorded in every event + policy decisions as audit records. **No shipping product fully covers this — it's bee's frontier** (see GAPS). | `field-06` SHIFT 2, `field-07` GAP 2 |
| **The trichotomy (was a dichotomy in 2025)** | Redis (BullMQ) / dedicated durable-exec (Temporal) / **Postgres-resident** (DBOS, microsoft/pg_durable, Absurd Workflows). For a Postgres shop, PG-native deletes BOTH the Redis-ops AND separate-cluster problems — at the cost of an admitted-unsolved versioning/observability story. "2026 is the year of the Postgres queue" (HN, 474pts). | `field-06` SHIFT 3, `field-08` |
| **Durable-exec is being baked into agent SDKs** | "PydanticAI has DBOS built in" (jedberg). The Vercel AI SDK + pydantic-ai have NO built-in durable execution → you drive the loop yourself (Ronacher). Temporal shipped a Vercel-AI-SDK integration + Workflow Streams for token batches. | `field-08`, `ecosystem-01` §4 |
| **Cross-org handoff (A2A v1.0)** | 150+ orgs; A2A card now table-stakes. A 2026 jobs harness may hand a job across an org boundary with a verifiable agent identity attached — didn't exist for a 2025 BullMQ worker on local Redis. | `field-06` SHIFT 5, `field-00` C |

## JTBD-11 — "Choose the right tool and know when it's WRONG" (decision + reversibility)

| Node | What to master | Source |
|---|---|---|
| **The decision framework** | Serverless host → Inngest/Trigger.dev. Pure-Cloudflare → CF Queues. Agent-only-has-HTTP → QStash. Jobs >60s → Trigger.dev or BullMQ (NOT a single Inngest/QStash step). Multi-step+sleep+branch → Inngest or Temporal. Complex multi-service/sagas/days → Temporal or Trigger waitpoints. Cost at 500K+/mo → BullMQ. Data residency → BullMQ/Trigger.dev self-host. | `ecosystem-06` §framework |
| **Cost crossover** | At 500K jobs/mo: BullMQ ~$15-50 (Redis only) vs Inngest/Trigger.dev ~$75-150. Managed wins TCO below a scale/team-size; self-host wins above it (or with existing Redis+SRE). *(Single-source number — treat as order-of-magnitude, see GAPS.)* | `field-04` §3, `ecosystem-06` §pricing |
| **Reversibility matrix** | BullMQ→managed: medium. Inngest↔Trigger.dev: low-medium (both step models). **anything↔Temporal: HIGH (rewrite — fundamentally different execution model).** Temporal→BullMQ: medium-high (ToolJet did it to drop a service tier). **Adopting Temporal is the least-reversible decision = a one-way door.** | `field-04` §4 |
| **The per-tool taxes** | Temporal = determinism + ops + bundler tax (allergic to minifiers). Inngest = schema-discipline tax (event types must be right or type-safety is theater). Trigger.dev = best TS ergonomics but youngest/most-churning API. | `field-04` §1 |
| **The counter-current** | "Everyone's moving to durable exec" has a credible counter: Hatchet — "'replace our queue with durable workflows' is often wrong; traditional queues remain better for many use-cases due to lower overhead." ToolJet reverse-migrated Temporal→BullMQ and was happy. | `field-07` Dispute 2, `field-04` §2 |

## JTBD-12 — "Upgrade and deploy without breaking in-flight work" (version discipline)

| Node | What to master | Source |
|---|---|---|
| **BullMQ ships multiple patches/week** | 12 releases in ~3 weeks (v5.76.11→v5.78.1). **Pin an exact version, never float `^5`.** | `ecosystem-01` §1 |
| **BullMQ minor bumps are NOT safe** | 5.65→5.77 made every processor hang on first `await` (#4194); Pro 6.9→7.46 doubled Redis CPU (#4196); 5.76.8 let scheduler jobs retry forever (#4220). Gate upgrades on a FULL job-suite run, not unit tests. | `field-01` §2/§3, `field-07` Dispute 5 |
| **BullMQ v5 mixed-fleet trap** | v5 changed the worker-notification Redis data structure; migration is seamless ONLY if ALL workers upgrade together — mixed-version fleets miss job notifications during rolling deploy. | `ecosystem-01` §1 |
| **Temporal determinism is replay-sacred** | ANY async-ordering change breaks in-flight workflows with NDE — even an SDK interceptor upgrade (#1677), even a read-only query handler shifting the PRNG (#2023). The failure is **replay-time, not runtime**: green in dev/sticky-cache, explodes hours later on pod-roll eviction. | `field-03` §1, `ecosystem-04` Temporal #1677 |
| **Temporal version uniformity** | "Mixing packages of different versions of `@temporalio/*` is not supported, not even patch versions" (maintainer). Pin + assert SDK version uniformity; a lockfile drift → phantom nondeterminism. | `field-03` §2 |
| **Worker Versioning (the escape hatch, but young)** | Pins running workflows to the worker that started them (Replay 2026) — eliminates the `patched()` dance. But the subsystem itself had server-version-coupled bugs (#1962, #1753); `patched()`/`getVersion()` remains the proven fallback. | `ecosystem-01` §4, `field-03` §3 |
| **Observability instrumentation breaks the happy path (cross-tool 2026 theme)** | OTel/ADOT broke: Temporal determinism (#1677/#2023), Inngest step context (#1436), AWS SigV4 signing (#8019). **Test WITH instrumentation enabled.** | `ecosystem-04` §meta, `field-03` §1 |

---

## How to read this map (for a fresh agent)
1. Internalize **THE ONE INVARIANT** above — it's the spine.
2. JTBD-1 through JTBD-3 are the universal physics (idempotency, retries, semantics) — true for every tool, forever.
3. JTBD-4 is the deepest: three engines, three determinism contracts. Re-read `ecosystem-07` before touching any durable-exec engine.
4. JTBD-10 is bee's *reason to exist* — the 2026 agent shift. It's what separates bee from a 2025 tutorial.
5. For "which tool," jump to JTBD-11 + `TOOL-MATRIX.md`. For "what'll bite me," `KNOWN-PITFALLS.md`. For "what do I believe," `OPINIONS.md`.

### Sources
All nodes cite `brain/research/raw/ecosystem-*.md` and `brain/research/raw/field-*.md` inline. Those files carry the URL+date for every primary claim.

---
title: "bee Ecosystem Research — Core Concepts: Idempotency, Retries/Backoff/Jitter, DLQ, Delivery Semantics, Fan-out/Fan-in"
type: concept
created: "2026-06-16"
updated: "2026-06-16"
tags: [ecosystem, idempotency, backoff, jitter, dlq, exactly-once, at-least-once, fan-out, fan-in, bee]
researcher: "ecosystem (CP123 Wave-R)"
summary: "The load-bearing distributed-systems concepts bee must encode, with exact formulas and the gotchas that bite in production. Primary sources quoted."
---

# bee Core Concepts — The Load-Bearing Flows (2026-06-16)

> These are NOT vendor features — they are the invariants every job/queue/workflow tool implements
> (or makes you implement). bee's SKILL.md set should encode these as the non-negotiable defaults.

---

## 1. Retries: Exponential Backoff + Jitter (exact formulas)

Source of truth: **AWS Architecture Blog, "Exponential Backoff And Jitter"** — https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/ (fetched 2026-06-16). Four algorithms, with `base` = initial delay, `cap` = max delay, `attempt` = retry number, `sleep` = previous sleep:

1. **No Jitter (plain exponential):** `sleep = min(cap, base * 2^attempt)`
2. **Full Jitter:** `sleep = random(0, min(cap, base * 2^attempt))`
3. **Equal Jitter:** `sleep = min(cap, base * 2^attempt)/2 + random(0, min(cap, base * 2^attempt)/2)` (always keeps ≥50% of the base delay)
4. **Decorrelated Jitter:** `sleep = min(cap, random(base, sleep * 3))` (grows the jitter ceiling from the LAST sleep)

**AWS verdict (quote):** "The 'Full Jitter' approach uses less work, but slightly more time." Both Full and Decorrelated Jitter "substantially reduced load compared to non-jittered exponential backoff." Recommendation: "jittered backoff … should be considered a standard approach for remote clients." Source: same blog (2026-06-16).

**The nuance that bites (cite both):**
- **Full Jitter can collapse to near-zero delay** when the random draw is small — *bad for throttling/rate-limit errors* where you need a guaranteed minimum wait. Real bug: `aws/aws-sdk-net#4341` "StandardRetryPolicy: Full Jitter backoff can collapse to near-zero delays for throttling errors." Source: https://github.com/aws/aws-sdk-net/issues/4341 (2026-06-16).
- Therefore: **Equal Jitter for throttling/429 errors** (guaranteed minimum), **Full Jitter for transient network errors** (faster recovery OK). Source: https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/ + Medium write-up https://medium.com/@titoadeoye/requests-at-scale-exponential-backoff-with-jitter-with-examples-4d0521891923 (2026-06-16).
- **Always bound retries** (`cap` + max attempts) — uncapped retries cause retry storms. Source: AWS Well-Architected REL05-BP03 "Control and limit retry calls" https://docs.aws.amazon.com/en_us/wellarchitected/2022-03-31/framework/rel_mitigate_interaction_failure_limit_retries.html (2026-06-16).

**bee default:** Decorrelated or Full jitter for general retries; Equal jitter when the error is a throttle; hard cap on attempts; never retry non-retryable (4xx-except-429) errors.

## 2. Idempotency Keys (the recovery-point pattern)

Two primary sources:
- **Stripe blog "Designing robust and predictable APIs with idempotency"** — https://stripe.com/blog/idempotency (2026-06-16). Contract: client sends a UUID in `Idempotency-Key` header per *intent*; "give me the same key, get the same response"; guarantees **at-most-once execution**.
- **brandur.org "Implementing Stripe-like Idempotency Keys in Postgres"** — https://brandur.org/idempotency-keys (fetched 2026-06-16). This is the canonical implementation.

**The recovery-point architecture (quoted specifics):**
- Split a request into **atomic phases**: "a set of local state mutations that occur in transactions *between* foreign state mutations." Each phase = one serializable transaction returning a `RecoveryPoint`, a `Response` (finished), or a `NoOp`.
- **THE RULE:** "never hold a database transaction open during external API calls." Quote: "Once we make our first foreign state mutation, we're committed one way or another … we shouldn't lose track of it." → commit local state + advance `recovery_point` BEFORE the external call.
- `idempotency_keys` table columns that matter: `locked_at` (concurrency guard — "if key.locked_at && locked_at > now - LOCK_TIMEOUT, return 409 Conflict"), `recovery_point` (checkpoint in a DAG of states `started → … → finished`), `response_code`/`response_body` (cached reply for finished keys), `request_params` (validate the retry's params match — prevents accidental param change reusing a key).
- Unique index: `(user_id, idempotency_key)`. Concurrency safety from **serializable** isolation: "If two different transactions both try to lock any one key, one of them will be aborted by Postgres" → retry on `SerializationFailure`.

**Gotchas (cite):**
- **Client owns the key** — it retries because it didn't get a response, not because it wants a new op. Source: https://stripe.com/blog/idempotency (2026-06-16).
- **Keys must expire** (time-bounded) — don't store forever. Source: Stripe blog + httptoolkit RFC write-up https://httptoolkit.com/blog/idempotency-keys/ (2026-06-16).
- **Partial failure mid-handler** is the #1 production failure cluster — fix = "record the external side effect inside the same database transaction as the key claim." Source: https://aloknecessary.github.io/blogs/idempotency-distributed-systems/ (2026-06-16).
- **Forward your key into downstream idempotency** (e.g. pass your key into Stripe's `Idempotency-Key`) so even if your local state is lost, the downstream replays its cached response. Source: Stripe blog (2026-06-16).
- There is now an **IETF Idempotency-Key HTTP header RFC** standardizing this. Source: https://httptoolkit.com/blog/idempotency-keys/ (2026-06-16).

## 3. Delivery Semantics: at-most-once / at-least-once / exactly-once

Primary: Alex Xu (ByteByteGo) "At most once, at least once, exactly once" https://blog.bytebytego.com/p/at-most-once-at-least-once-exactly (2026-06-16); exactly-once.github.io https://exactly-once.github.io/posts/exactly-once-delivery/ (2026-06-16); System Overflow https://www.systemoverflow.com/learn/message-queues/queue-fundamentals/delivery-semantics-at-most-once-at-least-once-and-exactly-once (2026-06-16).

- **At-most-once:** may lose, never duplicates. Use for telemetry/metrics/live updates — trades guarantees for latency. Source: oneuptime https://oneuptime.com/blog/post/2026-01-30-at-most-once-delivery/view (2026-01-30).
- **At-least-once:** never loses, may duplicate (consumer crashes after processing but before ack → redelivery). "The practical middle ground." This is what **BullMQ, SQS Standard, Cloudflare Queues, QStash** all are. Source: oneuptime https://oneuptime.com/blog/post/2026-01-30-at-least-once-delivery/view (2026-01-30).
- **Exactly-once:** "in distributed systems this is usually **'exactly once effect'** rather than true exactly once delivery." Source: ByteByteGo (2026-06-16).

**THE KEY INSIGHT for bee (quote):** "Most teams implement at-least-once delivery with **idempotent consumers** using **deduplication keys**. You store processed message IDs in a cache or DB with a **TTL matching your retry window**, and when a duplicate arrives you check the dedupe store and skip. This achieves exactly-once *effects* at the application level without distributed-transaction complexity." Source: ByteByteGo + System Overflow (2026-06-16).

→ **bee's stance:** Do NOT chase true exactly-once delivery. Use at-least-once transport + idempotent consumer + dedupe store (TTL = retry window). This is the #1 thing an agent gets wrong. (Note: SQS FIFO offers "exactly-once *processing*" but only via a **5-minute dedup window** — see ecosystem-02.)

## 4. Dead-Letter Queues (DLQ) + poison messages

Primary: AWS SQS DLQ docs https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html (2026-06-16); abstractalgorithms "Dead Letter Queue Pattern: Isolating Poison Messages" https://www.abstractalgorithms.dev/dead-letter-queue-pattern-poison-message-recovery (2026-06-16); ctaverna https://ctaverna.github.io/dead-letters/ (2026-06-16).

- **Purpose:** a **poison message** (received but un-processable) would "consume worker capacity forever" and, in FIFO/ordered systems, **block everything behind it**. DLQ isolates it. Source: AWS docs + abstractalgorithms (2026-06-16).
- **Redrive policy:** redirects a message to the DLQ "after the source queue fails to process it a specified number of times" (`maxReceiveCount`). AWS introduced **native DLQ redrive** (back to source) in Dec 2021 — now the recommended replay path. Source: AWS docs; oneuptime DLQ redrive guide https://oneuptime.com/blog/post/2026-02-02-sqs-dlq-redrive/view (2026-02-02).
- **Best practices (cite):**
  - **DLQ retention MUST be longer than the source queue's** — give time to investigate. Source: AWS re:Post https://repost.aws/questions/QUqS_YG85LTH2qAOfmxtyh2g/... (2026-06-16).
  - **Keep source + DLQ in same account/region.** Source: AWS docs (2026-06-16).
  - **Alarm on `ApproximateNumberOfMessagesVisible`** on the DLQ. Source: AWS re:Post (2026-06-16).
  - **Distinguish retryable vs non-retryable errors in consumer code** — "directly reduces DLQ noise and prevents retry storms." Source: abstractalgorithms (2026-06-16).
  - **The operational truth (quote):** DLQ "only works if retries are bounded, triage has an owner, and replay is a deliberate workflow instead of a panic button." Source: search synthesis of abstractalgorithms / architecture-weekly (2026-06-16).
- Sometimes **letting go is the answer** — not every DLQ message should be replayed (e.g. when rebuilding read models). Source: https://www.architecture-weekly.com/p/on-rebuilding-read-models-dead-letter (2026-06-16).

## 5. Fan-out / Fan-in (parallel orchestration)

- **Fan-out:** one trigger → many parallel jobs (e.g. one event → N per-user emails). **Fan-in:** wait for all N to finish → aggregate → continue. This is the map-reduce shape of background work.
- Tool support (cite ecosystem-01/04 sources):
  - **Inngest:** `step.run` for each branch + native parallel steps; events fan-out to multiple functions automatically. Source: https://www.inngest.com/docs (2026-06-16).
  - **Trigger.dev:** `batchTriggerAndWait` / child-task triggers for fan-out, then await results for fan-in. Source: https://trigger.dev/docs/how-it-works (2026-06-16).
  - **Temporal:** start N child workflows / activities, `Promise.all` (TS) to fan-in; this is Temporal's bread and butter and the most robust for large fan-in. Source: https://temporal.io/product (2026-06-16).
  - **BullMQ:** **Flows** (parent/child job trees) — a parent job waits for all children to complete (native fan-in). Source: https://docs.bullmq.io (Flows) (2026-06-16).
  - **SQS:** fan-out classically via **SNS → multiple SQS queues**; fan-in is app-managed (count completions). Source: https://aws.amazon.com/sqs/features/ (2026-06-16).
- **Fan-in gotcha:** the join/aggregation step must itself be **idempotent and durable** — a crash during aggregation after some children completed must not double-count. (Apply §2 recovery-point pattern to the join.)

---

### Sources (this file)
- https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/ (fetched 2026-06-16)
- https://github.com/aws/aws-sdk-net/issues/4341 (2026-06-16)
- https://docs.aws.amazon.com/en_us/wellarchitected/2022-03-31/framework/rel_mitigate_interaction_failure_limit_retries.html (2026-06-16)
- https://stripe.com/blog/idempotency (2026-06-16)
- https://brandur.org/idempotency-keys (fetched 2026-06-16)
- https://aloknecessary.github.io/blogs/idempotency-distributed-systems/ (2026-06-16)
- https://httptoolkit.com/blog/idempotency-keys/ (2026-06-16)
- https://blog.bytebytego.com/p/at-most-once-at-least-once-exactly (2026-06-16)
- https://exactly-once.github.io/posts/exactly-once-delivery/ (2026-06-16)
- https://www.systemoverflow.com/learn/message-queues/queue-fundamentals/delivery-semantics-at-most-once-at-least-once-and-exactly-once (2026-06-16)
- https://oneuptime.com/blog/post/2026-01-30-at-least-once-delivery/view (2026-01-30)
- https://oneuptime.com/blog/post/2026-01-30-at-most-once-delivery/view (2026-01-30)
- https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html (2026-06-16)
- https://www.abstractalgorithms.dev/dead-letter-queue-pattern-poison-message-recovery (2026-06-16)
- https://ctaverna.github.io/dead-letters/ (2026-06-16)
- https://oneuptime.com/blog/post/2026-02-02-sqs-dlq-redrive/view (2026-02-02)
- https://repost.aws/questions/QUqS_YG85LTH2qAOfmxtyh2g/what-are-the-best-practices-for-monitoring-sqs-dead-letter-queues-in-production (2026-06-16)
- https://www.architecture-weekly.com/p/on-rebuilding-read-models-dead-letter (2026-06-16)
- Tool docs: inngest.com/docs, trigger.dev/docs/how-it-works, temporal.io/product, docs.bullmq.io (all 2026-06-16)

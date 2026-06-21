---
name: idempotent-side-effects
description: Make a side effect safe to run twice. Use when the task says "make this idempotent", "duplicate charge", "duplicate email", "this ran twice in prod", "dedupe a webhook/event", or anywhere a job's effect must run exactly-once-in-effect on at-least-once transport. Encodes bee's TIER-0 invariant — at-least-once + idempotent consumer + a DB unique constraint.
opinions: [O-1, O-2, O-6, O-7, O-8]
pitfalls: [P-X1, P-X4, P-X5]
scenarios: [S-2, S-3, S-9]
owner: bee
---

# Skill — idempotent-side-effects

> bee's load-bearing skill. THE ONE INVARIANT made operational: a side effect that runs twice must produce the
> effect **once**. There is no exactly-once *delivery* in distributed systems — only exactly-once *effects* built at
> the application layer. The bug is almost never "the dedup didn't run"; it's "the key was subtly wrong" or "the TTL
> was too short." (`brain/OPINIONS.md` O-1/O-2/O-6/O-7/O-8 · `brain/KNOWN-PITFALLS.md` P-X1/P-X4/P-X5.)

## Trigger

Invoke this skill when the request contains any of:
- "make this idempotent" / "safe to run twice" / "we need an exactly-once effect"
- "duplicate charge" / "double charge" / "duplicate email" / "duplicate fulfillment" / "ran twice"
- "dedupe a webhook" / "dedupe an event" / "two identical events"
- a money-moving or otherwise irreversible side effect inside a job, worker, webhook, or agent step.

Also auto-fires when `bee audit` reports **P-X1** (an at-least-once transport mistaken for an exactly-once effect),
**P-X4** (refactor-fragile key), or **P-X5** (dedup TTL < retry window).

## Steps

1. **Refuse the bare claim first (O-1).** If the ask demands the bare guarantee, correct it: that does not exist —
   the deliverable is an exactly-once *effect* (**at-least-once transport + idempotent consumer + a dedupe store
   whose TTL ≥ the retry window**), never exactly-once *delivery* of the effect. Say so explicitly; don't paper over it.

2. **Locate the side effect and classify it.** Every external mutation (charge, email, ticket, deploy, row write)
   is a place the consumer WILL run twice on stall/crash/redelivery (P-X1 — BullMQ, SQS Standard, CF Queues,
   QStash, Inngest steps, Temporal activities are ALL at-least-once). List each one.

3. **Pick the idempotency key — and which layer it lives on (O-6).** Do NOT conflate the two layers:
   - **Inbound dedup** keys on the **provider's stable event ID** (Stripe `event.id`, Shopify
     `X-Shopify-Webhook-Id`, Svix `webhook-id`) — that is what distinguishes a retry from a new event.
   - **Outbound effects** carry **your own** `Idempotency-Key` derived from immutable domain identity so the
     downstream collapses your duplicate calls. You need BOTH; they are different layers.

4. **Derive the key from IMMUTABLE data and assert it (O-7 / P-X4).** Never compute the key from a field that a
   refactor can move/rename — that is exactly how Inngest #2307 double-charged every checkout while passing on the
   dev server (S-2). Prefer the provider event ID inbound. Then write the test that is the real gate: **two
   identical events → exactly one side effect**, run on prod-like infra (the #2307 bug passed in dev).

5. **Enforce at the DB with a UNIQUE constraint (O-2).** In-memory dedup is bypassed by restart, concurrency, and
   cold serverless Lambdas (Temporal money-slip #4, S-13). The key lives in a DB row with a unique index; the
   effect is written through `INSERT … ON CONFLICT (idempotency_key) DO NOTHING`; concurrency safety comes from
   serializable isolation (retry on `SerializationFailure`). bee's CLI already does this — `src/db/dedup.js`.

6. **Size the dedup TTL to the LONGEST provider retry horizon (O-8 / P-X5).** Not the average. Stripe live ≥3
   days, Shopify ≥4h (24h safe), Svix ≥24h, SQS ≥ retention. A TTL shorter than the window is the #1 *silent*
   failure: a day-2 retry looks brand-new and you double-process (S-3).

7. **Watch the broker-id trap (S-9).** Never key dedup on the queue's *returned* job id — a de-duplicated
   `queue.add` returns the same id for plain jobs but NOT inside a Flow (BullMQ #3878), and `keepLastIfActive`
   drops a custom jobId. Key on a value YOU control end-to-end.

8. **Verify, don't assert.** Run the binary check:
   - `bee enqueue --queue <q> --id <key> --data '<json>'` twice with the same `--id`; the second returns
     `deduped:true` and `bee worker --queue <q>` produces **effect row count = 1**.
   - or hand the surface to the packaged `idempotency-auditor` sub-agent (`.claude/agents/idempotency-auditor.md`)
     for the full P-X1/P-X4/P-X5 + missing-DB-constraint + inline-webhook sweep.

## Output

A concrete remediation, not prose advice. Produce:
- **The diagnosis**, keyed by ID — which of P-X1 / P-X4 / P-X5 (and S-2 / S-3 / S-9) the surface trips, with the
  file:line of the offending key derivation / TTL / broker-id reliance.
- **The fix**: (a) the immutable key derivation (provider event ID inbound / domain key outbound), (b) the
  `INSERT … ON CONFLICT DO NOTHING` write through a DB unique constraint, (c) the TTL set to the provider's
  longest retry horizon with the number stated.
- **The proof**: the two-identical-events → one-effect test, plus the `bee enqueue` ×2 (same `--id`) → `effect=1`
  command the reviewer can re-run. No "exactly-once" without the word *effect* anywhere in the output (O-1).

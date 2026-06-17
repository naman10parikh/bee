---
title: "field-05 — Idempotency, at-least-once, retry-storm patterns (the load-bearing wall)"
type: synthesis
created: 2026-06-16
tags: [idempotency, at-least-once, exactly-once, dedup-window, jitter, thundering-herd, dlq, poison-message, webhooks]
sources:
  - "https://www.digitalapplied.com/blog/webhook-reliability-idempotency-retries-engineering-reference-2026"
  - "https://medium.com/@ayasc/designing-for-failure-idempotency-in-data-pipelines-f1d6003521f4"
  - "https://www.designgurus.io/answers/detail/atleastonce-vs-atmostonce-vs-exactlyonce-where-to-use-each"
  - "https://oneuptime.com/blog/post/2026-02-17-how-to-implement-idempotent-cloud-functions-to-handle-duplicate-event-deliveries/view"
summary: "Concrete 2026 idempotency engineering: provider-event-ID vs derived-key DISPUTE, dedup-window-must-exceed-retry-window (Stripe ≥3 days), full-jitter to kill thundering herd, accept-202-then-async, DLQ-as-replay-buffer."
---

# field-05 — Idempotency / at-least-once / retry-storm patterns (June-2026 currency)

> "Idempotency is not a nice-to-have — it is the **load-bearing wall** of any production webhook integration."
> "Every major provider delivers events at least once, never exactly once." (digitalapplied 2026)

This is the cross-cutting wall behind every duplicate-side-effect disaster in fields 01-04.

---

## 1. THE CENTRAL TRUTH — exactly-once *effects* on at-least-once *delivery*
Kafka, SQS, BullMQ, Inngest, Temporal-activities — ALL are at-least-once at the consumer/activity layer. "Exactly
once" is achieved at the *effect* layer via idempotency, never at the delivery layer. Real consequences (verbatim):
> "A payment event processed twice becomes a duplicate charge, and an order-created event processed twice becomes a
> duplicate fulfillment." / "If re-running a pipeline doubles your row count, sends a customer two confirmation
> emails, or charges a credit card twice — your pipeline is not idempotent."

---

## 2. ⚠️ DISPUTE (feeds GAPS-AND-DISPUTES) — provider event ID vs derived idempotency key
Two credible camps directly contradict each other on how to KEY idempotency:

**Camp A — use the provider's stable event ID, do NOT derive your own** (digitalapplied 2026, verbatim):
> "Every well-designed webhook carries a unique event ID that stays the same across retries — Stripe's `event id`,
> Shopify's `X-Shopify-Webhook-Id`, Svix's `webhook-id`. Store this provider-issued identifier; **do not attempt to
> construct one from order ID, attempt number, or tenant data.** The provider's ID is what distinguishes a retry
> from a genuinely new event."

**Camp B — derive a deterministic key from your domain data** (designgurus / DZone, verbatim sense):
> "For payment charges, use at-least-once delivery with idempotent charge requests on the payment gateway using a
> **deterministic idempotency key derived from order id and attempt number**."

**Reconciliation (bee's take):** These solve DIFFERENT layers and BOTH are right in their layer:
- *Inbound dedup* (am I processing the same delivered event twice?) → Camp A: key on the **provider event ID**,
  because that's what's stable across the provider's retries.
- *Outbound idempotency* (am I calling Stripe/charge twice?) → Camp B: send YOUR own
  `Idempotency-Key` to the downstream API derived from a stable domain identity (e.g., order id), so the
  *downstream* collapses your duplicate calls.
- The trap (Inngest #2307): a derived key computed from a field that **moved in a refactor** silently breaks. If
  you derive, derive from immutable data and TEST that two identical inputs → one effect.
→ **bee rule:** dedup inbound on the provider event ID; for downstream effects send your own idempotency key keyed
  on immutable domain identity. Don't conflate the two layers.

---

## 3. DEDUP WINDOW — must exceed the provider's FULL retry window (concrete numbers)
Verbatim rule: "Your deduplication cache must persist **at least as long as** the provider's full retry window."
- **Stripe live mode: ≥3 days**
- **Shopify: ≥4 hours** (24h recommended as safe margin)
- **Svix: ≥24 hours**
- **AWS SQS: ≥ retention window**
> "Missing this window causes day-two retries to be treated as new events, reprocessing work already completed."

**bee TASTE:** The #1 silent idempotency failure is a dedup TTL shorter than the retry window — your dedup key
expires, the provider's day-2 retry looks brand-new, and you double-process. Size the TTL to the LONGEST possible
provider retry horizon, not the average.

---

## 4. RETRY STORM / THUNDERING HERD — use FULL JITTER, not bare exponential backoff
Verbatim: "Exponential backoff alone creates **synchronized retries**." Recommended default = **full jitter**:
> "`random(0, exp_delay)` — Picks a delay uniformly between zero and the full exponential value. Maximum spread,
> the most common choice in production senders. This breaks the thundering herd problem where a thousand failed
> events retry simultaneously and overwhelm a recovering endpoint."

This is the exact mechanism behind BullMQ #4220's infinite stall loop and the "queue melted" stories: when a
downstream recovers, EVERY backed-up job retries at the same instant and re-kills it. Jitter spreads the herd.
(AWS Architecture Blog "Exponential Backoff And Jitter" is the canonical primary source for full vs equal jitter.)

---

## 5. POISON MESSAGE / DLQ — the DLQ is a REPLAY BUFFER, not a graveyard
Verbatim:
> "The DLQ is not a graveyard but a **replay buffer**. Pair it with tooling to inspect, fix the handler bug, and
> redrive events. Since events are idempotent-keyed, replaying a previously-processed event that failed on response
> is safe — the dedup layer absorbs the duplicate."

Alert thresholds (verbatim): "DLQ depth > 10 events triggers page. Oldest event age > 1 hour requires
investigation. Retention floor: 14-30 days."

**bee TASTE:** A DLQ with no redrive tooling and no idempotent consumer is useless — you can't safely replay. The
DLQ only works *because* the consumer is idempotent. The two are a package deal. (Contrast BullMQ's reality: jobs
that exhaust retries sit in the `failed` set forever with no built-in redrive UX — you build it.)

---

## 6. THE MOST DANGEROUS FAILURE — timeout-induced duplicate (accept fast, queue async)
Verbatim: "the timeout-induced duplicate — the most dangerous failure mode, where your handler completes the work
but the HTTP response arrives **after the provider's timeout (5-15 seconds)**, triggering a retry of
already-completed work."
Fix (verbatim): "**Do not do the work in the request.** Verify the signature, deduplicate on the event ID, persist
the raw event to a durable queue, and **return 200 or 202 immediately.** Then process asynchronously from the queue."

**bee TASTE:** This is WHY background jobs exist at all in the webhook path: doing work inline guarantees eventual
double-execution because the provider times out before your slow handler returns. The correct shape is
ack-fast(202) → enqueue raw event → idempotent async worker. Inline = duplicates by construction.

---

## 7. Status-code + signature rules worth pinning
- Retry on **408** (timeout) and **429** (honor `Retry-After`). 3xx redirects are non-retriable — register the
  final URL.
- Verify signature on **raw body bytes before JSON parse**; constant-time compare (`crypto.timingSafeEqual` /
  `hmac.compare_digest`). Stripe embeds a timestamp with **5-minute default tolerance** — validate freshness
  (replay protection).

---

## bee idempotency checklist (the wall, in order)
1. Ack fast: verify sig → dedup on provider event ID → persist raw → return 202. Never work inline.
2. Dedup TTL ≥ provider's full retry window (Stripe ≥3d, Svix/Shopify ≥24h).
3. Consumer effects keyed on immutable domain identity; downstream calls carry YOUR idempotency key.
4. Retry with **full jitter** (`random(0, exp_delay)`), capped; not bare exponential.
5. Cap retries → DLQ with **redrive tooling**; alert on depth>10 / age>1h; retain 14-30d.
6. TEST: two identical events produce exactly one side effect, on prod-like infra (Inngest #2307 passed in dev).

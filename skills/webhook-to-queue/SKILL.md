---
name: webhook-to-queue
description: Receive an inbound webhook the right way. Use when the task says "receive a webhook", "Stripe/Shopify/Svix webhook", "handle a webhook", "ack fast", "return 202", or "the webhook double-processes under load". Encodes bee's verify-sig-on-raw-bytes → dedup-on-event-id → 202 → idempotent-async-worker pattern. Inline work = duplicates by construction.
opinions: [O-5, O-6, O-26]
pitfalls: [P-X7, P-X5]
scenarios: [S-4]
owner: bee
---

# Skill — webhook-to-queue

> This is *why background jobs exist* in the webhook path. A handler that does the work inline will be
> double-executed by construction: the provider times out (5–15s) before a slow handler returns and retries
> completed work — "the most dangerous failure mode." bee's pattern: **verify sig on raw bytes → dedup on the
> provider event ID → persist raw → return 202 → idempotent async worker.** (`brain/OPINIONS.md` O-5/O-6/O-26 ·
> `brain/KNOWN-PITFALLS.md` P-X7/P-X5.)

## Trigger

Invoke when the request contains any of:
- "receive a webhook" / "handle a webhook" / "webhook endpoint"
- "Stripe webhook" / "Shopify webhook" / "Svix webhook" / "provider sends us events"
- "ack fast" / "return 202" / "respond quickly to the webhook"
- "the webhook double-processes" / "duplicates under load" / "provider retried though we did the work."

Also auto-fires when `bee audit` reports **P-X7** (inline webhook work).

## Steps

1. **Verify the signature on the RAW BYTES — before anything else (O-5).** Signature verification must run against
   the exact raw request body, BEFORE any JSON parsing or framework body-parser touches it. If you verify a
   re-serialized JSON object, the signature won't match and you'll either reject valid events or (worse) disable
   verification. Stripe: `stripe.webhooks.constructEvent(rawBody, sig, secret)`. Shopify: timing-safe HMAC over the
   raw bytes. Svix: `wh.verify(rawBody, headers)`. bee's CLI emits all three — `src/backend/webhook/`.

2. **Dedup on the PROVIDER's event ID (O-6).** The inbound dedup key is the provider's stable event ID (Stripe
   `event.id`, Shopify `X-Shopify-Webhook-Id`, Svix `webhook-id`) — that is what distinguishes a retry from a new
   event. Do NOT invent your own inbound key; do NOT conflate this with the outbound `Idempotency-Key` you send on
   YOUR downstream calls (those are different layers — see the `idempotent-side-effects` skill).

3. **Size the dedup TTL to the provider's LONGEST retry window (P-X5).** Stripe live ≥3 days, Shopify ≥4h (24h
   safe), Svix ≥24h. A TTL shorter than the window means a day-2 retry looks brand-new and you double-process (the
   silent failure from S-3). State the number in the generated handler.

4. **Persist the raw event, then return 202 IMMEDIATELY (O-5 / P-X7 / S-4).** Write the raw event to a durable
   queue/store and respond `202 Accepted` *before* doing any real work. The handler's p99 must be far under the
   provider's 5–15s timeout. The detect signal for getting this wrong: "duplicates under load only; handler p99
   near/over the provider timeout; provider shows the delivery as failed/timed out though you did the work" (S-4 —
   a 9s inline call retried by the provider).

5. **Do the work in an idempotent async worker.** The queued event is processed by a worker that itself upholds THE
   ONE INVARIANT — every downstream side effect carries your own idempotency key enforced by a DB unique
   constraint, retried with jitter, dead-lettered on exhaustion. The 202 path and the worker are two separate
   surfaces; wire the worker via `bee worker` / the `bee scaffold` baseline.

6. **Outbound webhooks are a different question (O-26).** If the task is *sending* webhooks to customers (not
   receiving), default to **Svix** for customer-facing/regulated delivery (transformations, per-endpoint
   analytics, HIPAA/PCI) and **Hookdeck Outpost** for cost-sensitive side-projects. Carry your own outbound
   `Idempotency-Key`. (Hand a tool choice to the `pick-the-jobs-tool` skill.)

7. **Verify.** Generate the handler with `bee wire-webhook --provider <stripe|shopify|svix> --out <dir>` and assert
   the binary gate: the handler returns **202 before the work**, verifies on **raw bytes** (grep for
   `constructEvent` / raw-HMAC / `wh.verify`), and under duplicate delivery produces **one effect**. `bee audit
   <dir>` on the output must report **zero P-X7**.

## Output

- **The diagnosis** keyed by ID — P-X7 (inline work) / P-X5 (TTL too short) — with the file:line where work runs
  before the 202 or where the body is parsed before signature verification.
- **The fix**: the restructured handler — verify-on-raw-bytes → dedup-on-provider-event-id (TTL = provider's
  longest window, number stated) → persist raw → **return 202** → idempotent async worker.
- **The proof**: the `bee wire-webhook` command, the grep showing raw-byte verification + the 202, and the
  duplicate-delivery → one-effect check the reviewer can re-run.

---
title: "bee Ecosystem Research — Cloud-Native Queues (Cloudflare/SQS/QStash) + Webhook Delivery (Svix/Hookdeck)"
type: source
created: "2026-06-16"
updated: "2026-06-16"
tags: [ecosystem, cloudflare-queues, aws-sqs, qstash, svix, hookdeck, webhooks, bee]
researcher: "ecosystem (CP123 Wave-R)"
summary: "June-2026 state of the managed/cloud queue layer + the webhook-delivery sub-domain the checklist calls out (Svix/Hookdeck)."
---

# bee Ecosystem — Cloud-Native Queues + Webhook Delivery (2026-06-16)

## 1. Cloudflare Queues

- **Now on the Workers FREE plan** — **2026-02-04**. Guaranteed delivery across up to **10,000 queues** to Workers or **HTTP pull consumers**; every account gets **10,000 operations/day** (reads+writes+deletes). Free-tier **max retention = 24h** (paid = 14 days). Source: https://developers.cloudflare.com/changelog/2026-02-04-queues-free-plan/ (2026-06-16). DELTA: a year ago Queues was paid-only; now an agent can prototype durable async on Cloudflare for $0.
- **Pull-consumer throughput hugely raised**: now **pull + ack up to 5,000 messages/sec per queue**; previously rate-limited to **1,200 requests / 5 minutes aggregated across all queues**. Source: https://developers.cloudflare.com/changelog/2025-04-17-pull-consumer-limits/ + Queues changelog (2026-06-16). This is a ~100x+ practical throughput jump for the HTTP-pull pattern (the pattern an external agent/worker would use).
- **Max concurrent consumers raised 20 → 250** — applies to new AND existing queues; queues without an explicit limit auto-scale to 250. Source: https://developers.cloudflare.com/queues/configuration/consumer-concurrency/ + changelog (2026-06-16).
- **Explicit message delay** — messages published OR marked-for-retry can now be **deferred to later**, enabling backpressure handling and scheduled-ish delivery. Source: https://developers.cloudflare.com/queues/platform/changelog/ (2026-06-16). Relevant to retry/backoff (delay a retry) and to "run this in 10 min" without a separate scheduler.
- Architecture note: Cloudflare Queues integrates natively with Workers (push consumers) AND exposes an **HTTP pull API** — the pull API is the seam a non-Cloudflare agent uses. Source: https://architectingoncloudflare.com/chapter-08/ (2026-06-16).
- TASTE: Cloudflare Queues is **at-least-once**, push-or-pull, tightly bound to the Workers runtime. Best when the rest of the stack is already on Cloudflare (R2/D1/Workers). NOT a fit if you need exactly-once or complex orchestration.

## 2. AWS SQS

- **Two queue types, unchanged baseline**: **Standard** (at-least-once, best-effort ordering, near-unlimited throughput) and **FIFO** (exactly-once *processing*, strict ordering). Source: https://aws.amazon.com/sqs/features/ ; https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-fifo-queues.html (2026-06-16).
- **FIFO exactly-once is bounded by a 5-minute deduplication interval** — re-sending the SAME `MessageDeduplicationId` (or content hash) within 5 min is de-duped; outside that window it is NOT. Source: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues-exactly-once-processing.html (2026-06-16). CRITICAL GOTCHA: "exactly-once" is a **5-minute** guarantee at the producer side, plus the consumer must still delete the message — it is NOT end-to-end exactly-once for free.
- **FIFO throughput**: default up to **3,000 msg/s with batching** (300 without); **high-throughput mode → up to 70,000 msg/s** without batching (more with batching). Source: https://aws.amazon.com/sqs/faqs/ (2026-06-16).
- **Message groups**: FIFO ordering is per **MessageGroupId**; throughput and ordering are partitioned by group — picking a good group key is the central FIFO design decision. Source: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-key-terms.html (2026-06-16); practical write-up https://oneuptime.com/blog/post/2026-01-30-aws-sqs-fifo-advanced/view (2026-01-30).
- **CAVEAT on currency**: web search did NOT surface a *2026-specific* SQS feature launch — the docs pages are recently *updated* (Apr 2026) but describe long-standing features. Flagging this as a GAP: no confirmed net-new SQS capability shipped H1 2026 from these sources. (See ecosystem-GAPS.)
- TASTE: SQS is the boring-reliable substrate. DLQ is a first-class concept (redrive policy → DLQ after N receives). Pairs with Lambda for serverless consumers. Heavyweight IAM/region ceremony for an agent vs HTTP-native QStash/Cloudflare.

## 3. Upstash QStash (serverless HTTP message queue + scheduler)

- **Flow Control was rewritten from the ground up (2026)** — new **Flow Control Management API** lets you **override rate/parallelism dynamically** and **pin** a rate/parallelism value that overrides per-message values. **`flowControlPeriod` added; `ratePerSecond` deprecated.** Source: https://upstash.com/blog/rewrite-flow-control (2026-06-16) + https://upstash.com/docs/qstash/overall/changelog (2026-06-16). MIGRATION GOTCHA: code using `ratePerSecond` must move to the new flow-control fields.
- **Parallelism + Rate Limit for Workflow & QStash** — control concurrent in-flight requests and per-second rate. Source: https://upstash.com/blog/QStash-rateLimit (2026-06-16).
- **DLQ separated from Workflow DLQ** — QStash and Upstash **Workflow** consoles (and their DLQ message streams) were split for clarity. Source: https://upstash.com/docs/qstash/overall/changelog (2026-06-16). There is an explicit **flow-control test for DLQ** in the qstash-js CI. Source: https://github.com/upstash/qstash-js (2026-06-16).
- **Positioning**: QStash is **HTTP-in / HTTP-out** — you POST a message + a destination URL; QStash delivers it later with retries, schedules, delays, DLQ. No Redis to run, no workers to host — it calls *your* endpoint. This is the lowest-friction durable-queue primitive for an agent that only has an HTTP endpoint. Source: https://deepwiki.com/upstash/docs/3-qstash-message-queue-and-scheduler (2026-06-16).
- **Upstash Workflow** (built on QStash) is the durable-execution layer (`context.run` steps, `invoke`, logs, flow-control, local dev server). Source: https://upstash.com/blog/workflow-updates (2026-06-16). This is QStash's answer to Inngest/Trigger.dev.
- Named in Energy's own playbook: `resources/read/2026-03-30_agentdial_platform_integration_playbook.md` lists **Upstash QStash** + Inngest as the jobs picks (per `audit/HARNESS-CHECKLIST-2026.md` source line).

## 4. Webhook delivery — Svix vs Hookdeck (the checklist's named pair)

The checklist routes webhooks → **Svix / Hookdeck**. Important nuance these vendors blur: **inbound** (receiving 3rd-party webhooks reliably) vs **outbound** (sending webhooks to YOUR customers). bee needs both.

- **Hookdeck (classic) = inbound webhook proxy/gateway** — receive, queue, retry, replay, fan-out incoming webhooks. Source: https://documentation.hook0.com/comparisons (2026-06-16).
- **Hookdeck Outpost = outbound** event-delivery (newer product) — retries, replay, **OpenTelemetry streaming**, multi-destination, **full open-source parity**. BUT: **no transformations, no FIFO, no throttling**; lacks HIPAA/PCI-DSS. Measured 99.9% historical uptime. Source: https://hookdeck.com/webhooks/platforms/hookdeck-outpost-vs-svix-dispatch-webhook-sending-comparison (2026-06-16).
- **Svix Dispatch = outbound, feature-rich managed** — transformations, connectors, **monetization gating**, **per-endpoint + per-event delivery analytics** (detect a customer's consistently-failing endpoint and proactively notify). Compliance: HIPAA/PCI. Higher price. Source: https://www.svix.com/webhooks/best-webhook-management-platforms/ + the Hookdeck comparison (2026-06-16).
- **Decision rule (from the comparisons)**: Hookdeck Outpost = cost-sensitive small teams / side-projects tolerant of missing features. **Svix = production / customer-facing / regulated / "missed deliveries are a problem."** Source: https://hookdeck.com/webhooks/platforms/hookdeck-outpost-vs-svix-dispatch-webhook-sending-comparison (2026-06-16).
- Third OSS option to know: **Convoy** and **Hook0** (self-host outbound). Source: https://www.pkgpulse.com/guides/svix-vs-hookdeck-vs-convoy-webhook-infrastructure-2026 (2026-06-16); https://documentation.hook0.com/comparisons (2026-06-16).
- AGENT-RELEVANT macro: Energy checklist flags the **emerging AI-native primitive**: *agent finishes → fires webhook → downstream reacts* ("Managed Agents 'Outcomes'"). Source: `energy/audit/HARNESS-CHECKLIST-2026.md` line 336. Svix/Hookdeck Outpost are the delivery rail for that pattern.

---

### Sources (this file)
- https://developers.cloudflare.com/changelog/2026-02-04-queues-free-plan/ (2026-02-04)
- https://developers.cloudflare.com/changelog/2025-04-17-pull-consumer-limits/ (2025-04-17)
- https://developers.cloudflare.com/queues/configuration/consumer-concurrency/ (accessed 2026-06-16)
- https://developers.cloudflare.com/queues/platform/changelog/ (accessed 2026-06-16)
- https://architectingoncloudflare.com/chapter-08/ (accessed 2026-06-16)
- https://aws.amazon.com/sqs/features/ ; /faqs/ (accessed 2026-06-16)
- https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues-exactly-once-processing.html (accessed 2026-06-16)
- https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-key-terms.html (accessed 2026-06-16)
- https://oneuptime.com/blog/post/2026-01-30-aws-sqs-fifo-advanced/view (2026-01-30)
- https://upstash.com/blog/rewrite-flow-control (accessed 2026-06-16)
- https://upstash.com/blog/QStash-rateLimit (accessed 2026-06-16)
- https://upstash.com/docs/qstash/overall/changelog (accessed 2026-06-16)
- https://upstash.com/blog/workflow-updates (accessed 2026-06-16)
- https://deepwiki.com/upstash/docs/3-qstash-message-queue-and-scheduler (accessed 2026-06-16)
- https://hookdeck.com/webhooks/platforms/hookdeck-outpost-vs-svix-dispatch-webhook-sending-comparison (accessed 2026-06-16)
- https://www.svix.com/webhooks/best-webhook-management-platforms/ (accessed 2026-06-16)
- https://documentation.hook0.com/comparisons (accessed 2026-06-16)
- https://www.pkgpulse.com/guides/svix-vs-hookdeck-vs-convoy-webhook-infrastructure-2026 (accessed 2026-06-16)

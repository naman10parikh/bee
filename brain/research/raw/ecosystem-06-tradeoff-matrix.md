---
title: "bee Ecosystem Research — Honest Trade-off Matrix (When to Pick What)"
type: synthesis
created: "2026-06-16"
updated: "2026-06-16"
tags: [ecosystem, tradeoffs, comparison, decision-matrix, pricing, bee]
researcher: "ecosystem (CP123 Wave-R)"
summary: "The honest 'which tool when' decision matrix with real 2026 pricing, delivery semantics, lock-in, and ops burden. Explicit taste, not a feature list."
---

# bee — Honest Trade-off Matrix (2026-06-16)

> The bar: real trade-offs, real pricing, explicit taste. Two primary comparison sources cross-checked:
> buildmvpfast (full Inngest/Trigger.dev/BullMQ head-to-head, fetched via firecrawl) +
> digitalapplied 2026 engineering reference. Plus the version/concept files (ecosystem-01..05).

---

## Master matrix

| Dimension | BullMQ | Inngest | Trigger.dev v4 | Temporal | Cloudflare Queues | AWS SQS | Upstash QStash |
|---|---|---|---|---|---|---|---|
| **Type** | Redis queue library | Event-driven durable-exec engine | Managed task-exec platform | Durable workflow engine | Managed queue (Workers) | Managed queue (broker) | HTTP queue + scheduler |
| **Hosting** | Self-host (you run Redis+workers) | Managed OR self-host (Helm) | Managed OR self-host (Docker/Helm) | Self-host OR Cloud OR **serverless (new 2026)** | Managed only | Managed only | Managed only |
| **Delivery** | at-least-once | at-least-once (durable steps) | at-least-once (checkpoint-resume) | at-least-once activities + **exactly-once workflow logic** | at-least-once | Standard=at-least-once; FIFO=exactly-once *processing* (5-min dedup) | at-least-once |
| **Max exec time** | unlimited (your workers) | no platform cap (step-based; each step bounded by YOUR host timeout) | **no platform cap** (dedicated compute, minutes→days) | unlimited (durable) | consumer-bound | consumer-bound (Lambda 15min etc.) | step-bound (use `context.sleep` for long) |
| **Multi-step / sleep / branch** | manual orchestration | **built-in** (`step.run`/`step.sleep`) | SDK + **waitpoints** (human-in-loop) | **built-in** (the whole point) | no | no | Upstash Workflow layer |
| **Cron / schedule** | yes (Job Schedulers) | yes | yes | yes (Schedules) | via delay | EventBridge | yes (native scheduler) |
| **Runtimes** | Node, **Bun, Python, Rust** | TS, Python, Go | TS (Node + Bun) | Go/Java/Python/.NET/TS | Workers (JS/WASM) | any (SDK) | any (HTTP) |
| **Agent operability** | TS library only | REST+SDK (no MCP) | **MCP (`--readonly`)** | **MCP (19 tools)** | `wrangler`/HTTP | `aws` CLI/SDK | **pure HTTP** |
| **Dashboard** | BullBoard (OSS) / Taskforce.sh (paid) | Cloud | Cloud + metrics + TRQL query engine | Web UI + Worker Status (2026) | CF dashboard | CloudWatch | Upstash console |
| **Stars / freshness** | 9,008★ (2026-06-17) | 5,499★ server / 967★ JS | 15,373★ (2026-06-16) | 863★ TS SDK | (CF product) | (AWS product) | 268★ JS SDK |

Sources: buildmvpfast (firecrawl 2026-06-16); digitalapplied (2026-06-16); ecosystem-01..05 (gh api / official docs 2026-06-16).

## Real pricing (2026, cite buildmvpfast firecrawl 2026-06-16)

- **BullMQ**: MIT, free core. Cost = Redis ($0 local; **$5–10/mo** Upstash/Redis Cloud small; **$15–50/mo** ElastiCache at SaaS scale) + your compute. **BullMQ Pro = $1,395/yr per deployment** (groups, batches, observables).
- **Inngest**: Hobby **50,000 executions/mo free** (concurrency cap 5, sleep ≤7 days). Pro **$75/mo** → 1M executions + usage overage (concurrency 100+, sleep ≤1 year).
- **Trigger.dev**: Free **$5 compute credits/mo, 20 concurrent**. Hobby **$10/mo**, Pro **$50/mo**. Per-second billing from **$0.0000169/sec** (micro 0.25 vCPU) + **$0.000025/run invocation fee** ($0.25 per 10k runs). Self-host removes usage limits.
- **At 500K jobs/mo (apples-to-apples, buildmvpfast)**: BullMQ ~**$15–50** (Redis only) · Inngest ~**$75–150** · Trigger.dev ~**$50–150** (compute-dependent).
- **The economics rule (both sources agree)**: managed (Inngest/Trigger.dev) win on ops-simplicity at low/moderate volume; **self-host (BullMQ) wins on unit cost at high tens/hundreds of thousands of jobs/day.** Source: digitalapplied + buildmvpfast (2026-06-16).
- **AWS SQS / Cloudflare Queues / QStash** are per-operation-priced and effectively free at small scale (CF Queues free tier = 10k ops/day, ecosystem-02). NOT covered by the digitalapplied matrix (flagged).

## Honest "where each FALLS SHORT" (cite buildmvpfast 2026-06-16, verbatim-grounded)

- **Inngest weak spot:** struggles with a single unbroken long execution — the step model breaks work into discrete HTTP requests; **each step is still bounded by YOUR host's timeout** (e.g. Vercel function limit) even though the *workflow* has no cap. Step-based debugging "can feel opaque vs reading a linear function." (v4 checkpointing/deferred funcs, Mar 2026, eased inter-step latency.)
- **Trigger.dev weak spot:** adds an infra layer even in managed mode; managed runtime runs YOUR task code on Trigger.dev servers → **data-residency concern**; self-host loses warm starts/auto-scale/checkpoints. v4 **queues are declared upfront** (breaking change from v3's on-demand queues).
- **BullMQ weak spot:** needs Redis + a separate worker process (antithetical to pure serverless); **no built-in dashboard** (BullBoard/Taskforce.sh fill it); multi-step workflows = manual orchestration. Plus the duplicate-jobs/stalled foot-guns (ecosystem-04).
- **Temporal weak spot:** highest learning curve; **workflow code must be deterministic** — any async-ordering change (even an SDK interceptor upgrade) → NDE (ecosystem-04 #1677); historically heavy ops (the new **serverless** tier + **Worker Versioning**, Replay 2026, address both).
- **Cloudflare Queues weak spot:** tied to Workers runtime; **local dev lies** (`remote:true` silently ignored, ecosystem-04 #13727); at-least-once only; no on-demand single-message DLQ.
- **AWS SQS weak spot:** FIFO "exactly-once" is a **5-min dedup window**, not end-to-end; **no official Node poller** (#6015) → community `sqs-consumer`; heavy IAM/region ceremony for an agent.
- **QStash weak spot:** step timeout traps long blocking `await` (#198 — use `context.sleep`); new flow-control has param-plumbing bugs (#240).

## The decision framework (synthesized — buildmvpfast flowchart + Temporal/digitalapplied)

1. **Serverless host (Vercel/Workers)?** → Inngest or Trigger.dev (no Redis/workers). Pure-Cloudflare stack → Cloudflare Queues. Agent-only-has-HTTP → QStash.
2. **Jobs run >60s?** → Trigger.dev (native long-running) or BullMQ (your workers). NOT a single Inngest/QStash step.
3. **Multi-step + sleep + branching?** → Inngest (step durability) or Temporal (complex multi-service).
4. **Complex multi-service orchestration / sagas / human-in-loop over days?** → **Temporal** (exactly-once workflow logic) or Trigger.dev waitpoints.
5. **Cost at scale (500K+/mo)?** → BullMQ (no per-run pricing).
6. **Data residency / full infra control?** → BullMQ (self-host) or Trigger.dev (Docker/Helm self-host).
7. **AWS-native, just need a durable buffer?** → SQS (Standard) + `sqs-consumer`; FIFO only if you truly need ordering.

**buildmvpfast default recommendation (quote-grounded):** "For most early-stage Next.js SaaS, start with **Inngest** on the free tier … handle 90% of common needs (emails, webhooks, scheduled tasks, payment processing). If you outgrow pricing or need long-running tasks, evaluate **Trigger.dev** or migrate to **BullMQ**." Source: buildmvpfast (firecrawl 2026-06-16).

## Don't-forget alternatives (so bee's matrix is complete)

- **Postgres-based queues — PgBoss / Graphile Worker:** skip Redis entirely, use existing Postgres as the queue. Great <1,000 jobs/hr; can't match Redis throughput at high volume. Source: buildmvpfast (2026-06-16). RELEVANT: if a bee-consuming product already has Postgres and modest volume, this is the lowest-dependency option.
- **Celery (Python/Django/FastAPI)** — mature, needs operator expertise (prefetch/process recycling). **Sidekiq (Rails)** — thread-based, fast, keep args simple JSON. Source: digitalapplied (2026-06-16). RELEVANT for non-Node stacks bee might advise.
- **Vercel Workflows / Vercel Queues** — Vercel-native pause/resume; **public beta / not production-ready** (digitalapplied 2026-06-16). Plus the **Temporal + Vercel AI SDK** integration (ecosystem-01) if you want durability under Vercel AI SDK.

## bee's house stance (explicit taste)

- **Default for a new product frontend job-layer:** **Inngest** (zero-infra, step durability, generous free tier) — matches the checklist's named default.
- **When jobs are long/compute-heavy or need human-in-loop:** **Trigger.dev** (no time cap, waitpoints, BEST agent-MCP with `--readonly`).
- **When cost-at-scale or full control matters:** **BullMQ** (self-host) — but ONLY with the ecosystem-04 foot-gun rules baked in (Job Schedulers not legacy repeatable; idempotent handlers; lockDuration > job time).
- **When orchestration is genuinely complex (sagas/multi-service/days):** **Temporal** — accept the determinism tax; use Worker Versioning.
- **For the agent's OWN internal loops (like Energy's helios nightly loops / CronCreate):** session-scoped **CronCreate** for ephemeral; **GitHub Actions `schedule`** for durable; **QStash** when the agent only has an HTTP endpoint and wants durable scheduled callbacks without infra. (Internal ref: `energy/.claude/skills/loop-integration/SKILL.md`; `energy/audit/HARNESS-CHECKLIST-2026.md` §8 Dispatch.)
- **Universal invariant (overrides tool choice):** at-least-once transport + **idempotent consumer + dedupe store (TTL = retry window)** — NEVER chase true exactly-once delivery (ecosystem-03).

---

### Sources (this file)
- https://www.buildmvpfast.com/blog/inngest-vs-trigger-dev-vs-bullmq-background-jobs-nextjs-2026 (fetched via firecrawl stealth 2026-06-16; published 2026-06-09)
- https://www.digitalapplied.com/blog/background-job-queue-patterns-2026-engineering-reference (2026-06-16)
- Cross-refs: ecosystem-01 (versions), ecosystem-02 (cloud/webhooks), ecosystem-03 (concepts), ecosystem-04 (breakage), ecosystem-05 (operability/repos)
- Internal read-only: energy/audit/HARNESS-CHECKLIST-2026.md; energy/.claude/skills/loop-integration/SKILL.md

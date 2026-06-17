---
title: "bee TOOL MATRIX — Canonical Tools, When-to-Use, Agent Access, Secrets"
type: synthesis
created: "2026-06-16"
updated: "2026-06-16"
tags: [tools, matrix, default-vs-alt, agent-operability, secrets, env-vars, bee]
synthesizer: "SYNTHESIS (taste node, CP123 Wave-R)"
sources: ["brain/research/raw/ecosystem-01-versions-changelogs.md", "brain/research/raw/ecosystem-02-cloudnative-queues-webhooks.md", "brain/research/raw/ecosystem-05-agent-operability-and-starters.md", "brain/research/raw/ecosystem-06-tradeoff-matrix.md", "brain/research/raw/field-00-internal-corpus.md", "brain/research/raw/field-06-what-changed-2026.md"]
summary: "The canonical tool list: default vs alternatives, when each wins, the agent-access surface (CLI/API/MCP), and the env vars/secrets each needs. The secrets column feeds the Required-Secrets manifest in Wave P."
---

# bee TOOL MATRIX

> Versions as of 2026-06-16. "When it WINS / when it's WRONG" is the taste, not a feature list.
> The **Secrets** column is the input to Wave P's Required-Secrets manifest — each entry is a real env var.
> Default picks track the Energy checklist (`field-00`): Inngest/Trigger.dev default; BullMQ/Temporal/QStash alts; Svix/Hookdeck webhooks.

---

## 1. The default decision (start here)

```
Need durable async work?
├─ Serverless host (Vercel/Next/Workers)? ─────────────► Inngest (DEFAULT) — zero infra, step durability
│    └─ jobs long (>60s) / human-in-loop? ─────────────► Trigger.dev — no time cap, waitpoints, best agent-MCP
├─ Pure-Cloudflare stack (Workers/R2/D1)? ─────────────► Cloudflare Queues
├─ Agent only has an HTTP endpoint? ───────────────────► Upstash QStash (pure HTTP)
├─ AWS-native, just need a durable buffer? ────────────► AWS SQS + bbc/sqs-consumer
├─ Cost-at-scale (500k+/mo) OR full control? ──────────► BullMQ (self-host Redis) + the foot-gun rules
├─ Complex multi-service / sagas / days? ──────────────► Temporal (one-way door — most scrutiny)
├─ Already on Postgres, modest volume? ────────────────► PgBoss/Graphile Worker, or DBOS/pg_durable (emerging)
└─ Agent's OWN internal loop?
     ├─ event-shaped wait (log/file/PR) ───────────────► Anthropic Monitor tool (NOT polling)
     ├─ ephemeral time-based ──────────────────────────► CronCreate / /loop (session-scoped, dies on exit)
     └─ durable time-based ────────────────────────────► GitHub Actions schedule / workflow_dispatch
```
Source: `ecosystem-06` §framework, `field-00`, `field-06` SHIFT 1.

---

## 2. Durable-execution engines (the core four)

### Inngest — DEFAULT for serverless product job-layers
- **Version:** `inngest@4.6.0` (2026-06-16); v4 default line since ~Apr 2026 (plan v3→v4 migration). `@inngest/otel@0.1.2` is the supported tracing path.
- **Type / delivery:** event-driven durable-exec engine; at-least-once durable steps.
- **When it WINS:** new Next.js/serverless SaaS; emails/webhooks/scheduled/payment flows; maps cleanly onto agent execution patterns; generous free tier (50k execs/mo). Durable Endpoints make ANY HTTP handler durable without provisioning a queue.
- **When it's WRONG:** a single unbroken long execution (each step bounded by YOUR host timeout); self-hosting (Go RSS leak, OOM-on-rotation, #3892); step-based debugging can feel opaque.
- **Agent access:** **NO first-party MCP** (gap). REST API + `inngest` SDK + Dev Server UI. AgentKit is the AI-agent *framework*, not an MCP for operating Inngest.
- **Secrets:** `INNGEST_EVENT_KEY` (send events), `INNGEST_SIGNING_KEY` (verify step calls). Self-host adds server↔SDK version-pinning (not a secret, a discipline — #1543).
- **Source:** `ecosystem-01` §2, `ecosystem-06`, `ecosystem-05` Part A, `field-02`.

### Trigger.dev — for LONG jobs, human-in-loop, and best agent-operability
- **Version:** v4 GA; stable `v4.4.6` (2026-05-12); `v4.5.0` in RC. v4 = "Run Engine 2" (internals unconfirmed — GAPS C-3).
- **Type / delivery:** managed task-exec platform; at-least-once via checkpoint-resume (CRIU in v3) + idempotency-keyed subtask cache.
- **When it WINS:** jobs with no time cap (minutes→days), human-in-loop **waitpoints**, dedicated compute, "90% of web apps" simplest reliable path. **Best agent-operability of the bunch.**
- **When it's WRONG:** data-residency (managed runs YOUR code on their servers); self-host loses warm starts/checkpoints; youngest/most-churning API; v4 queues declared upfront (breaking change).
- **Agent access:** **first-party MCP** in the CLI — `search_docs` works UNAUTHENTICATED (RAG docs free); `--yolo` auto-installs; **`--readonly` hides write tools** (`deploy`/`trigger_task`/`cancel_run`) = the safety default. 11 new MCP tools in v4.4.4. CLI: `npx trigger.dev@latest`.
- **Secrets:** `TRIGGER_API_KEY` (a.k.a. project secret key for deploy/trigger); `TRIGGER_SECRET_KEY` in `trigger.config.ts`. MCP login via CLI (`trigger.dev login`).
- **Source:** `ecosystem-01` §3, `ecosystem-05` Part A, `ecosystem-06`, `field-04`.

### BullMQ — for cost-at-scale / full control (with the foot-gun rules)
- **Version:** `v5.78.1` (2026-06-13) — **PIN EXACTLY, never `^5`** (12 releases in ~3 weeks). Rust core port landing (v5.78.0). Dashboard: `felixmosh/bull-board`.
- **Type / delivery:** Redis-backed queue library; at-least-once (completion/lock-based).
- **When it WINS:** high volume (~$15-50 vs $75-150 managed @ 500k/mo); full control; data residency; you already run Redis + have SRE maturity.
- **When it's WRONG:** pure serverless (needs Redis + a separate worker process); no built-in dashboard; multi-step = manual orchestration; the foot-guns (legacy `repeatable` dupes, stalled-job lifecycle, dedup-id drops, Redis-CPU ceiling, risky minor bumps).
- **Agent access:** **NO MCP/CLI** (gap). Operate via the `bullmq` TS library + bull-board UI + redis-cli. An agent operating BullMQ writes TS.
- **Secrets:** `REDIS_URL` (or `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD`/`REDIS_TLS`). ioredis `maxRetriesPerRequest: null` for reconnect (#2542). BullMQ Pro = `@taskforcesh` npm token + license ($1,395/yr/deployment).
- **MANDATORY rules if chosen:** Job Schedulers (not legacy `repeatable`); idempotent handlers; `lockDuration` > longest job; pin version + full-suite upgrade gate; shard worker→queue assignment; Redis CPU as the SLO.
- **Source:** `ecosystem-01` §1, `ecosystem-05`, `ecosystem-06`, `field-01`.

### Temporal — for complex orchestration (a one-way door)
- **Version:** TS SDK `v1.18.1` (2026-06-11); CLI `v1.7.2` (2026-06-10). Replay 2026 shipped Serverless tier, Worker Versioning, Standalone Activities, Nexus, Workflow Streams + a Vercel-AI-SDK integration.
- **Type / delivery:** durable workflow engine; exactly-once *workflow logic* (deterministic replay) ON at-least-once *activities*.
- **When it WINS:** genuinely complex, long-lived, multi-service workflows; sagas; human-in-loop over days; polyglot workers; "the only choice when failure isn't an option." Standalone Activities (new) = durable jobs without full workflow ceremony.
- **When it's WRONG:** anything simple/short (it's a rewrite to adopt/leave — least reversible); the determinism+ops+bundler tax; NDE from any async-ordering change (replay-time failures).
- **Agent access:** **richest control MCP** — Code-Exchange Temporal MCP exposes **19 tools** (start/cancel/terminate, real-time query+signal, batch ops, full schedule mgmt via cron). CLI: `temporal` (start/signal/query/schedule/worker-status). Best for steering RUNNING workflows.
- **Secrets:** self-host = `TEMPORAL_ADDRESS` + `TEMPORAL_NAMESPACE`; Temporal Cloud = `TEMPORAL_CLOUD_API_KEY` OR mTLS (`TEMPORAL_TLS_CERT`/`TEMPORAL_TLS_KEY`) + namespace. **Discipline:** exact-version uniformity across all `@temporalio/*` (#1790).
- **Source:** `ecosystem-01` §4, `ecosystem-05`, `ecosystem-08` versions, `field-03`, `field-04`.

---

## 3. Cloud-native managed queues

### Cloudflare Queues — when already on the Workers stack
- **Version:** product (no semver). Now on the **Workers FREE plan** (2026-02-04): up to 10,000 queues, 10k ops/day, free-tier retention 24h (paid 14d). Pull+ack up to **5,000 msg/s/queue**; max concurrent consumers 20→**250**; explicit message delay added.
- **When it WINS:** the rest of the stack is on Cloudflare (R2/D1/Workers); $0 prototyping; HTTP pull for non-Worker consumers.
- **When it's WRONG:** not on Cloudflare; need exactly-once or complex orchestration; **local dev lies** (`remote:true` silently ignored, #13727); no on-demand single-message DLQ.
- **Agent access:** `wrangler queues ...` CLI + **HTTP pull API** (the seam for non-Worker agents). No dedicated MCP.
- **Secrets:** `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` (for wrangler/HTTP). Bindings live in `wrangler.toml`.
- **Source:** `ecosystem-02` §1, `ecosystem-05`.

### AWS SQS — AWS-native durable buffer
- **Version:** product. Standard (at-least-once, near-unlimited throughput) + FIFO (exactly-once *processing* via 5-min dedup, default 3k msg/s batched → 70k high-throughput). No confirmed net-new 2026 feature (GAPS C-1).
- **When it WINS:** AWS-native; boring-reliable substrate; first-class DLQ (redrive policy); pairs with Lambda.
- **When it's WRONG:** FIFO "exactly-once" is a 5-min window (not end-to-end); **no official Node poller** (#6015); heavy IAM/region ceremony for an agent.
- **Agent access:** `aws sqs ...` CLI + `@aws-sdk/client-sqs`; **use `bbc/sqs-consumer`** (v15.0.2) for the receive/delete/visibility loop. SQS-specific MCP not confirmed.
- **Secrets:** `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` (or IAM role/`AWS_PROFILE`) + `AWS_REGION` + `SQS_QUEUE_URL`. ADOT+SigV4 collision (#8019) — test signing with instrumentation.
- **Source:** `ecosystem-02` §2, `ecosystem-05`.

### Upstash QStash — pure-HTTP durable queue + scheduler (most agent-friendly transport)
- **Version:** `qstash-js` ~2.27.x; `workflow-js` `v1.3.1` (2026-06-02). Flow Control rewritten 2026 (`flowControlPeriod` added, `ratePerSecond` deprecated).
- **When it WINS:** an agent that only has an HTTP endpoint; no Redis/workers to run — QStash calls YOUR endpoint with retries/schedules/delays/DLQ; native scheduler.
- **When it's WRONG:** long blocking `await` in a step hits the step-timeout (use `context.sleep`, #198); new flow-control has param-plumbing bugs (#240); CDN headers trip loop-detection (#183).
- **Agent access:** **pure HTTP API** (no MCP needed) — POST message + destination URL. SDK `@upstash/qstash`. Upstash Workflow layer = `context.run`/`invoke`.
- **Secrets:** `QSTASH_TOKEN`; `QSTASH_CURRENT_SIGNING_KEY` + `QSTASH_NEXT_SIGNING_KEY` (verify incoming deliveries). Upstash Workflow shares these.
- **Source:** `ecosystem-02` §3, `ecosystem-05`, `ecosystem-08` versions.

---

## 4. Webhook delivery (the sub-domain — inbound vs outbound)

| Tool | Direction | When it WINS | When it's WRONG | Agent access | Secrets |
|---|---|---|---|---|---|
| **Svix Dispatch** (DEFAULT outbound, regulated) | Outbound to YOUR customers | Production / customer-facing / regulated; transformations, per-endpoint analytics, HIPAA/PCI; "missed deliveries are a problem" | Higher price; overkill for side-projects | REST API + SDK | `SVIX_API_KEY` (+ `SVIX_WEBHOOK_SECRET` for verifying Svix→you) |
| **Hookdeck Outpost** (cost-sensitive outbound) | Outbound (OSS-parity) | Cost-sensitive small teams/side-projects; OTel streaming; multi-destination | No transformations/FIFO/throttling; no HIPAA/PCI | API + OSS self-host | `HOOKDECK_API_KEY` |
| **Hookdeck (classic)** | Inbound proxy/gateway | Receive/queue/retry/replay/fan-out incoming webhooks | (Outbound → use Outpost/Svix) | API | `HOOKDECK_API_KEY` |
| **Convoy / Hook0** (OSS alt) | Outbound (self-host) | Full self-host, no vendor | DIY ops | self-host | self-host config |

- **Provider-side secrets you VERIFY (inbound, per-provider):** `STRIPE_WEBHOOK_SECRET`, `SHOPIFY_WEBHOOK_SECRET`, etc. — verify signature on raw bytes before JSON parse; Stripe 5-min timestamp tolerance.
- **AI-native primitive:** agent finishes → fires webhook → downstream reacts ("Managed Agents 'Outcomes'") — Svix / Hookdeck Outpost are the rail.
- **Source:** `ecosystem-02` §4, `field-05` §6/§7.

---

## 5. The agent's OWN internal loops (dogfood layer)

| Need | Tool | Surface | Secrets | Note |
|---|---|---|---|---|
| **Event-shaped wait** (log line, file change, PR status) | **Anthropic Monitor tool** | Claude Code native (`command`/`description`/`timeout_ms`/`persistent`) | none | "silent command spends nothing"; **always `grep --line-buffered`**; **prefer over polling** (overrides loop-integration) |
| **Ephemeral time-based** ("every 5 min this session") | **CronCreate / /loop** | Claude Code native | none | Session-scoped: dies on exit, max 50 tasks, 3-day expiry, local TZ |
| **Durable time-based** ("nightly at 2am, survives restarts") | **GitHub Actions** `schedule`/`workflow_dispatch` | YAML workflow | repo secrets (e.g. `PAT_TOKEN`, `ANTHROPIC_API_KEY`) | The fleet's durable scheduler; the nightly AutoLab/helios loop |
| **Durable HTTP callback** (agent has only an endpoint) | **Upstash QStash** | HTTP | `QSTASH_TOKEN` + signing keys | Durable scheduled callbacks without infra |

Source: `field-00` A/B, `field-06` SHIFT 1, `ecosystem-06` §house-stance.

---

## 6. Postgres-resident (emerging trichotomy — track, don't default yet)

| Tool | What | Status | Secret | bee stance |
|---|---|---|---|---|
| **PgBoss / Graphile Worker** | Postgres-native job queue | Mature for <1,000 jobs/hr | `DATABASE_URL` | Lowest-dependency if already on PG + modest volume |
| **DBOS** | Postgres-backed durable-exec (TS+Python) | Maturing; "PydanticAI has DBOS built in" | `DATABASE_URL` | Promising; versioning story unsettled |
| **microsoft/pg_durable** | In-DB durable execution (on duroxide) | New (HN 474pts 2026-06) | `DATABASE_URL` | Versioning/observability **admitted-unsolved** by maintainers (GAPS G-3) |

Source: `field-06` SHIFT 3, `field-08`, `ecosystem-06` §alts.

---

## 7. Agent-operability ranking (how bee SELF-operates the layer)
1. **Trigger.dev** — first-party MCP + `--readonly` + unauthenticated `search_docs`. Cleanest for an agent that must *create and run* durable jobs itself.
2. **Temporal** — 19-tool MCP. Most powerful for *steering running* workflows.
3. **QStash** — pure HTTP. An agent with only an HTTP client fully drives it.
4. **Inngest / BullMQ / SQS / Cloudflare** — no first-party MCP (SDK/CLI/HTTP-pull). BullMQ = write TS.

Source: `ecosystem-05` Part A.

---

## 8. CONSOLIDATED SECRETS MANIFEST (input to Wave P)

> Only the secrets for tools bee actually wires up will be required. This is the superset to choose from.
> Format: `ENV_VAR` — purpose — which tool. Mark **[verify-only]** for secrets used to validate inbound, not authenticate outbound.

**Durable-exec engines**
- `INNGEST_EVENT_KEY` — send events — Inngest
- `INNGEST_SIGNING_KEY` — verify step invocations **[verify-only]** — Inngest
- `TRIGGER_SECRET_KEY` / `TRIGGER_API_KEY` — deploy + trigger tasks — Trigger.dev
- `REDIS_URL` (or `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD`/`REDIS_TLS`) — queue backend — BullMQ
- `TEMPORAL_ADDRESS` + `TEMPORAL_NAMESPACE` — cluster — Temporal (self-host)
- `TEMPORAL_CLOUD_API_KEY` (or `TEMPORAL_TLS_CERT` + `TEMPORAL_TLS_KEY`) — Temporal Cloud auth

**Cloud-native queues**
- `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` — Cloudflare Queues
- `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` + `AWS_REGION` + `SQS_QUEUE_URL` — AWS SQS (or IAM role / `AWS_PROFILE`)
- `QSTASH_TOKEN` + `QSTASH_CURRENT_SIGNING_KEY` + `QSTASH_NEXT_SIGNING_KEY` — Upstash QStash (last two **[verify-only]**)

**Webhook delivery**
- `SVIX_API_KEY` (+ `SVIX_WEBHOOK_SECRET` **[verify-only]**) — Svix
- `HOOKDECK_API_KEY` — Hookdeck (in/out)
- `STRIPE_WEBHOOK_SECRET` / `SHOPIFY_WEBHOOK_SECRET` / provider-specific — inbound signature verify **[verify-only]**

**Postgres-resident**
- `DATABASE_URL` — PgBoss / Graphile Worker / DBOS / pg_durable

**Agent loops (durable)**
- `PAT_TOKEN` / `ANTHROPIC_API_KEY` — GitHub Actions scheduled workflows (already in fleet `.env`)

**Already in fleet `.env.example` (reuse, don't re-add):** `ANTHROPIC_API_KEY`, `REDIS`-via-Upstash, `STRIPE_WEBHOOK_SECRET`, `SUPABASE_URL`/`SUPABASE_ANON_KEY` (→ `DATABASE_URL` for PG queues), `GITHUB_PERSONAL_ACCESS_TOKEN`. The fleet `.env.example` does NOT yet have a durable-queue secret — that's exactly the 🟡 gap bee fills.

Source: `ecosystem-01/02/05/06`, fleet `.env.example`, `field-00`.

---

### Sources
Inline per tool. Versions/changelogs `ecosystem-01`; cloud queues + webhooks `ecosystem-02`; agent-operability + starters `ecosystem-05`; trade-offs/pricing `ecosystem-06`; internal loops `field-00`/`field-06`.

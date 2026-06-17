---
title: "bee Ecosystem Research — Current Versions & 6-Month Changelog Deltas (June 2026)"
type: source
created: "2026-06-16"
updated: "2026-06-16"
tags: [ecosystem, jobs, queues, workflows, versions, changelog, bee]
researcher: "ecosystem (CP123 Wave-R)"
summary: "Canonical-tool versions as of June 2026 + the deltas that matter from the last 6 months. Every line cited with URL + date."
---

# bee Ecosystem — Versions & Changelog Deltas (as of 2026-06-16)

> Domain: Background jobs / queues / workflows. This file is the version-of-record snapshot.
> Cite-everything rule: each claim carries a URL + date. June-2026 currency prioritized.
> Internal mandate (read-only): `energy/audit/HARNESS-CHECKLIST-2026.md` §"Background jobs / queues / webhooks"
> says Energy today = `node-cron` (alpha, wikimem) + `cron-parser` (runtime), **no durable queue** → _Partial_.
> Default picks named there: **Inngest / Trigger.dev** (serverless/AI-first); alts **BullMQ** (Redis self-host),
> **Temporal** (durable orchestration), **Upstash QStash** (HTTP queue); webhooks → **Svix / Hookdeck**.

---

## 1. BullMQ (Redis-backed queue, Node/TypeScript)

- **Latest version: v5.78.1** — released **2026-06-13**. Source: `gh release list --repo taskforcesh/bullmq` (run 2026-06-16) → `v5.78.1  2026-06-13T21:40:57Z`. Also a separate tag line `vex1.3.3 (2026-06-13)` exists — that is **BullMQ Pro / extras (vex)**, a different artifact, not core v5.
- **v5.78.0** — released **2026-06-02** — headline: **"initial implementation of Rust support."** Source: BullMQ changelog summarized by web search 2026-06-16, https://docs.bullmq.io/changelog ; corroborated by `gh release list` (`v5.78.0  2026-06-02`). SIGNIFICANCE: BullMQ is beginning a **Rust core port** — historically it has been TypeScript + Lua scripts on Redis. This is the single biggest architectural delta of 2026 for BullMQ and worth watching for an agent that pins versions.
- **v5.77.7** — **2026-06-01** — security: bumped dependency **msgpackr to v2.0.2**. Source: web search of https://docs.bullmq.io/changelog (2026-06-16). Relevance: msgpackr is the job-payload (de)serializer; a security bump there touches every job's data path.
- **Release cadence is extremely high**: 12 releases between **2026-05-21 and 2026-06-13** alone (v5.76.11 → v5.78.1). Source: `gh release list --repo taskforcesh/bullmq --limit 12` (2026-06-16). IMPLICATION for an agent: BullMQ ships multiple patches per week — pin an exact version in `package.json`, do not float `^5`.
- **v5 architecture baseline** (still current): v5 introduced a new mechanism for **notifying workers that jobs are waiting** (changed the underlying Redis data structure); migration is seamless **only if ALL workers upgrade together**. Source: https://bullmq.io/news/231221/bullmqv5-release/ (v5 migration notes, originally Dec 2023, still the v5 baseline). GOTCHA: mixed-version worker fleets during a v5 rolling deploy can miss job notifications.
- Ecosystem dashboard: **bull-board** (felixmosh) is the canonical UI; tracks BullMQ closely. Source: https://github.com/felixmosh/bull-board/blob/master/CHANGELOG.md (2026-06-16).

## 2. Inngest (durable, event-driven; serverless-first)

- **Latest JS SDK: inngest@4.6.0** — released **2026-06-16** (today). Source: `gh release list --repo inngest/inngest-js` (2026-06-16) → `inngest@4.6.0  2026-06-16T20:49:32Z`.
- **Major-version jump in 2026: v3 → v4.** The repo shows the crossover at `inngest@4.2.6 (2026-04-29)` published the same minute as the last v3 patch `inngest@3.54.2 (2026-04-29)` — i.e. **v4 became the default line late April 2026**. Source: `gh release list --repo inngest/inngest-js` (2026-06-16). An agent on `inngest@^3` should plan a v4 migration.
- **@inngest/otel@0.1.2** — **2026-06-16** — a **dedicated OpenTelemetry package** now ships alongside the SDK. Source: same `gh release list`. SIGNIFICANCE: first-class OTel export for durable runs (observability is now a separate installable, not bolted on).
- **Durable Endpoints** — released **2026-02-10** — wrap an existing API handler with `inngest.endpoint()` + `step.run()` to get retries/recovery/observability **without provisioning a queue or workers**. Public beta for **Next.js and Bun**. Source: https://www.inngest.com/changelog (web search 2026-06-16). This is Inngest's headline 2026 primitive: "durability inside your existing HTTP handler."
- **Go SDK v0.14.0** — **2026-01-19** — enables `step.run` inside REST APIs (make any endpoint durable). Source: https://www.inngest.com/changelog (2026-06-16).
- **Singleton Functions: new `cancel` mode** — in addition to existing `skip` mode, a new run can now **cancel** an in-flight run with the same key and start fresh. Source: https://www.inngest.com/changelog (2026-06-16). Relevant to "only one of these per user/key at a time" patterns (debounce/dedup).
- **Advanced event filters (CEL expressions)** — filter events via Common Expression Language in the Events page. Source: https://www.inngest.com/changelog (2026-06-16).
- **AgentKit by Inngest** has its own changelog — Inngest is leaning into AI-agent orchestration as a product line. Source: https://agentkit.inngest.com/changelog/overview (2026-06-16).

## 3. Trigger.dev (durable background jobs; open-source, self-hostable)

- **v4 is GA** (announced) and the current stable line is **v4.4.6 (2026-05-12)** with **v4.5.0 in RC** — `v4.5.0-rc.6 (2026-06-12)`. Source: `gh release list --repo triggerdotdev/trigger.dev` (2026-06-16); GA post https://trigger.dev/changelog/trigger-v4-ga.
- **v4.4.0 (2026-02-19)** — 3 features / 8 improvements / 7 fixes / 16 server changes; headline = **metrics dashboards + a query engine** for task-worker perf (workers collect process CPU/mem and Node.js runtime metrics, queryable in-dashboard). Source: https://trigger.dev/changelog/v4-4-0 (2026-06-16).
- **v4.4.3 (2026-03-10)** — `syncSupabaseEnvVars` pulls a Supabase project's DB connection strings into Trigger.dev env vars. Source: https://trigger.dev/changelog/v4-4-3.
- **v4.4.4 (2026-04-13)** — 2 features / **11 new MCP tools** / 6 fixes / 15 server changes; **per-task and global TTL defaults** in `trigger.config.ts`. Source: https://trigger.dev/changelog/v4-4-4 (2026-06-16). SIGNIFICANCE for agents: **11 new MCP tools** = Trigger.dev is investing heavily in agent-operable surface (see ecosystem-05).
- **v4.4.6 (2026-05-12)** — failure-handling fix: uncaught exceptions now **fail the attempt fast with the original error + status FAILED** instead of **hanging until MAX_DURATION_EXCEEDED**. Source: https://trigger.dev/changelog/v4-4-6 (2026-06-16). This is a real-world gotcha fix — pre-v4.4.6, an uncaught throw could masquerade as a duration timeout.
- Durable model: **Checkpoint-Resume System + idempotency keys** → retries/caching of results. Source: https://trigger.dev/docs/how-it-works (2026-06-16).

## 4. Temporal (durable execution / workflow engine; multi-language)

- **Replay 2026 (Temporal's conference) shipped a wave of GA/preview features.** Source: https://temporal.io/blog/replay-2026-product-announcements (2026-06-16) + https://thenewstack.io/temporal-replay-2026-news/ (2026-06-16).
- **Serverless Temporal** — Temporal announced a **serverless option** for its Durable Execution platform at Replay 2026. Source: https://thenewstack.io/temporal-replay-2026-news/ (2026-06-16). Historically Temporal required running (or paying Cloud for) the cluster + workers; a serverless tier lowers the ops floor — directly relevant to the "no durable queue, want low-ops" gap in Energy.
- **Worker Versioning** — pins running Workflows to the Worker version that started them, **eliminating patching/branching** in workflow code; enables progressive rollouts. Source: https://temporal.io/blog/replay-2026-product-announcements (2026-06-16). This addresses Temporal's most notorious pain (the `patched()` / determinism-versioning dance).
- **Worker Status & Heartbeats** — ALL SDKs now send a **worker heartbeat every 60s** (task slots, CPU, config) → new **Worker Status UI** + CLI. Source: same (2026-06-16).
- **Standalone Activities** — run an Activity **without** a wrapping Workflow; **Public Preview** for Go/Python/.NET, **Pre-release** for Java/TypeScript, on Temporal Cloud. "Improve durability/debuggability of job processing while eliminating complex queuing and retry logic." Source: same (2026-06-16). SIGNIFICANCE: this is Temporal moving onto BullMQ/Inngest's turf — durable *jobs* without the full workflow ceremony.
- **Nexus** — GA for Python SDK; **Public Preview for TypeScript + .NET** — durable, observable Workflow-to-Workflow / service-to-service calls. Source: same (2026-06-16).
- **Workflow Streams** — durable streaming built on Signal & Update primitives (token batches, live UI updates, guardrails). Source: same (2026-06-16). Aimed squarely at LLM token-streaming use cases.
- **AI SDK by Vercel integration** — **2026-01-20** — adds long-running workflows, automatic retries, durable state for AI architectures built on Vercel's AI SDK. Source: https://temporal.io/change-log/ai-sdk-vercel-integration (2026-06-16).
- TypeScript SDK repo: https://github.com/temporalio/sdk-typescript (2026-06-16) — exact latest tag to be confirmed in ecosystem GAPS (web summary did not return a precise sdk-typescript version number).

## Cross-tool signal (June 2026)

Every major durable-execution vendor shipped an **AI/agent-specific** primitive in H1 2026:
- Inngest → **AgentKit** + Durable Endpoints
- Trigger.dev → **11 new MCP tools** + agent docs
- Temporal → **Vercel AI SDK integration** + Workflow Streams (token batches)
This is the macro trend bee must track: durable-execution infra is converging on "run an AI agent reliably for a long time."

---

### Sources (this file)
- https://docs.bullmq.io/changelog — BullMQ changelog (accessed 2026-06-16)
- https://bullmq.io/news/231221/bullmqv5-release/ — BullMQ v5 migration notes
- https://github.com/taskforcesh/bullmq/releases — via `gh release list` (2026-06-16)
- https://github.com/felixmosh/bull-board/blob/master/CHANGELOG.md — bull-board
- https://www.inngest.com/changelog — Inngest changelog (accessed 2026-06-16)
- https://github.com/inngest/inngest-js/releases — via `gh release list` (2026-06-16)
- https://agentkit.inngest.com/changelog/overview — AgentKit changelog
- https://trigger.dev/changelog (and /v4-4-0, /v4-4-3, /v4-4-4, /v4-4-6, /trigger-v4-ga) — Trigger.dev (2026-06-16)
- https://github.com/triggerdotdev/trigger.dev/releases — via `gh release list` (2026-06-16)
- https://temporal.io/blog/replay-2026-product-announcements — Temporal Replay 2026 (2026-06-16)
- https://thenewstack.io/temporal-replay-2026-news/ — The New Stack on Replay 2026 (2026-06-16)
- https://temporal.io/change-log/ai-sdk-vercel-integration — Temporal + Vercel AI SDK (2026-01-20)
- https://github.com/temporalio/sdk-typescript — Temporal TS SDK

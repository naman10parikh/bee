---
title: "bee Ecosystem Research — INDEX (Background Jobs / Queues / Workflows, June 2026)"
type: index
created: "2026-06-16"
updated: "2026-06-16"
tags: [ecosystem, index, jobs, queues, workflows, bee]
researcher: "ecosystem (CP123 Wave-R)"
summary: "Entry point for bee's domain research: background jobs / queues / workflows state-of-the-art as of June 2026."
---

# bee Ecosystem Research — INDEX

> bee's domain = **Background jobs / queues / workflows**. Energy checklist (`energy/audit/HARNESS-CHECKLIST-2026.md`)
> grades this component **🟡 partial** today (only `node-cron` + `cron-parser`, no durable queue). These files
> map the June-2026 state of the art so bee can become the fleet's domain-expert employee.
> Every claim is cited (URL + date; GitHub via `gh`). Currency: prioritized sources <6 months old.

## Files (all in `brain/research/raw/`, prefix `ecosystem-`)
- **ecosystem-00-INDEX.md** — this file.
- **ecosystem-01-versions-changelogs.md** — current versions + 6-month deltas for BullMQ / Inngest / Trigger.dev / Temporal / Cloudflare Queues / SQS / QStash. The version-of-record snapshot.
- **ecosystem-02-cloudnative-queues-webhooks.md** — Cloudflare Queues (free tier, 5k msg/s pull), AWS SQS (FIFO/exactly-once caveats), Upstash QStash (rewritten flow-control), + Svix vs Hookdeck webhook delivery.
- **ecosystem-03-core-concepts.md** — THE load-bearing concepts: backoff+jitter (exact formulas), idempotency keys (recovery-point pattern), delivery semantics, DLQ, fan-out/fan-in.
- **ecosystem-04-github-breakage.md** — real-world breakage: GitHub issues with ROOT CAUSES extracted (duplicate jobs, NDE, signature mismatch, local-dev-lies, long-step timeouts). Anti-slop core.
- **ecosystem-05-agent-operability-and-starters.md** — MCP/CLI/API per tool (Trigger.dev + Temporal have MCP; QStash is pure HTTP) + best starter/example repos with stars + freshness.
- **ecosystem-06-tradeoff-matrix.md** — honest "which tool when" with REAL 2026 pricing, lock-in, ops burden, decision framework, bee's house stance.
- **ecosystem-07-docs-deepdive-durable-execution.md** — official-docs deep-dive on durable-execution mechanics (Inngest memoization, Trigger CRIU, Temporal replay) + the 10 Temporal money-duplication slips.
- **ecosystem-08-gaps-and-disputes.md** — what I could NOT confirm, version ambiguities, source disputes.

## The 60-second domain summary
- **Macro trend (June 2026):** every durable-execution vendor shipped an AI/agent primitive in H1 2026 (Inngest AgentKit + Durable Endpoints; Trigger.dev 11 new MCP tools; Temporal Vercel-AI-SDK + Workflow Streams). Durable execution is converging toward a portable standard (HN: "StepKit").
- **The universal invariant bee must encode:** at-least-once transport + **idempotent consumer + dedupe store (TTL = retry window)**. NEVER chase true exactly-once delivery. Every side effect carries a **deterministic idempotency key enforced by a DB unique constraint**. On ambiguous timeout → **query state, don't blind-retry**.
- **Default picks:** Inngest (zero-infra, serverless) · Trigger.dev (long-running + best agent-MCP) · BullMQ (self-host, cost-at-scale, but foot-gun-heavy) · Temporal (complex orchestration, determinism tax) · QStash (agent-only-has-HTTP) · Cloudflare Queues (already-on-Workers) · SQS (AWS-native buffer).

## Internal read-only refs mined
- `energy/audit/HARNESS-CHECKLIST-2026.md` §"Background jobs / queues / webhooks" + §8 Dispatch (cron) — the gap bee fills.
- `energy/.claude/skills/loop-integration/SKILL.md` — CronCreate/`/loop` patterns (session-scoped vs durable GH Actions).
- `energy/agents/earning/helios/` — nightly loops + idempotent `earn()/spend()` append pattern (the in-house durable-loop precedent).

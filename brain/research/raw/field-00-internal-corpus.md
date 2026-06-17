---
title: "field-00 — Internal corpus references (energy/helios/checklist) for bee"
type: source
created: 2026-06-16
tags: [internal, cron, loop, helios, checklist, jobs]
sources:
  - "~/energy/.claude/skills/loop-integration/SKILL.md"
  - "~/energy/agents/earning/helios/{SOUL,README}.md"
  - "~/energy/audit/HARNESS-CHECKLIST-2026.md"
summary: "What the Energy fleet already knows/does about background jobs, scheduling, retries — the baseline bee must beat."
---

# field-00 — Internal corpus references (READ-ONLY, quoted not edited)

This file captures what the Energy fleet already encodes about background jobs / queues / scheduling, so bee's
field-intelligence findings can be positioned against the in-house baseline. All paths below are read-only.

## A. `loop-integration` SKILL — CronCreate is session-scoped, NOT durable
Source: `~/energy/.claude/skills/loop-integration/SKILL.md` (read 2026-06-16)

Key constraints (verbatim from the skill):
- **Session-scoped**: tasks die when Claude Code exits.
- **Max 50 tasks** per session.
- **3-day expiry** for recurring tasks.
- **Fires between turns** (not during a response).
- **Local timezone** for all cron expressions.
- **"For durable scheduling: use GitHub Actions or Desktop scheduled tasks."**

Tools: `CronCreate` / `CronList` / `CronDelete`. Interval syntax via `/loop 5m ...`, `/loop 2h ...`.

> **bee relevance:** This is the single most important internal lesson. The fleet's own primitive (`CronCreate`)
> is explicitly NON-durable — "tasks die when Claude Code exits." Every durability gotcha bee finds in
> BullMQ/Inngest/Temporal is exactly the gap this skill punts to "GitHub Actions." bee is the harness that is
> supposed to OWN durable jobs, which `CronCreate` cannot.

## B. Helios nightly loop — the "deterministic loop" earning pattern
Source: `~/energy/agents/earning/helios/{SOUL,README}.md` (read 2026-06-16)

- SOUL.md: "My pipeline is a deterministic loop (`pipeline/`): **discover** ideas → **score** → **assemble** →
  ... **IMPROVE** (`pipeline/improve.ts`) — nightly AutoLab: kill money-losers (Conway selection), compound
  winners, propagate wins (GEA)."
- README: "## The pipeline (one daily loop)" — discover → gate → assemble (Armory) → plugin → sell/run → $ → nightly.
- "Self-improving. Every loop outcome — win, loss, or block — is a signal that updates the next discovery."

> **bee relevance:** Helios is a real in-house "nightly cron does N steps idempotently or it corrupts money state"
> workload. The earning loop is precisely the class of job where at-least-once + non-idempotent = double charge.
> bee's idempotency-key findings apply directly to `pipeline/improve.ts` nightly runs.

## C. Harness checklist — "Background jobs / queues / webhooks" is flagged PARTIAL
Source: `~/energy/audit/HARNESS-CHECKLIST-2026.md` (read 2026-06-16)

Verbatim lines that define the Jobs component bee is meant to fill:
- L78: "**Background jobs / queues / webhooks** — Inngest / Trigger.dev / BullMQ + Svix·Hookdeck (webhooks) — _partial (`node-cron` only)_"
- L146–155 (Dispatch component): "How work is **routed/orchestrated** AND how the harness runs **on a schedule**
  (cron / routine runs). One component: 'who does what, and when it fires on its own.'"
- L152: "**Routine runs:** session-scoped via **CronCreate**; durable via **GitHub Actions `schedule`/`workflow_dispatch`**;
  the nightly AutoLab loop is **enabled, not just written**."
- L155 (2026 signals): "**A2A Protocol v1.0** — 150+ orgs ... **Mastra v1.0** (22k★) = de-facto TS-first orchestration ...
  **Anthropic Monitor tool** — wake the agent only when needed, kills polling."
- L332–337 (Background jobs / queues / webhooks): "Durable async work — AI inference, email sends, scheduled tasks —
  that must **not** run inline; plus webhook delivery. **Default:** **Inngest** or **Trigger.dev** (serverless / AI-first).
  Alts: **BullMQ** (Redis self-host), **Temporal** (durable orchestration), **Upstash QStash** (HTTP queue).
  Webhooks → **Svix / Hookdeck**. **Energy today:** `node-cron` (alpha, wikimem) + `cron-parser` (runtime) —
  basic scheduling, **no durable queue**. _Partial._"
- L336 note: "_(Emerging AI-native primitive: agent finishes → fires webhook → downstream reacts — see Managed
  Agents 'Outcomes'.)_"
- L397 (rollup): "Product · C2 infra | Jobs/queues/webhooks | 🟡 partial — `node-cron` only; no durable queue"

> **bee relevance:** The checklist already names the exact tool-shortlist bee must have an OPINION about:
> Inngest / Trigger.dev (default), BullMQ (self-host), Temporal (durable orchestration), Upstash QStash (HTTP),
> Svix/Hookdeck (webhooks). bee's job is to convert that flat shortlist into TASTE: when each wins, the
> war stories of each, and the version-specific traps. The Anthropic **Monitor tool** ("wake the agent only
> when needed, kills polling") is the AI-native 2026 wrinkle that didn't exist in 2025 polling-loop wisdom.

## D. Inherited cron/loop references in `.claude/rules/` (energy)
`CronCreate`/`/loop` referenced across: overnight-autonomous.md, never-stop-ralph-loop.md, batch-operations.md,
grid-validation.md. These are orchestration rules, not durable-queue rules — they reinforce that the fleet's
"jobs" today are agent-session loops, not a real queue with retries/DLQ/idempotency. bee fills that void.

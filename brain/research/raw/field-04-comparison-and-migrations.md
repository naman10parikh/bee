---
title: "field-04 — Temporal vs Inngest vs Trigger.dev vs BullMQ (2026): taste + migration war stories"
type: synthesis
created: 2026-06-16
tags: [comparison, migration, temporal, inngest, triggerdev, bullmq, taste, cost]
sources:
  - "https://medium.com/@matthieumordrel/the-ultimate-guide-to-typescript-orchestration-temporal-vs-trigger-dev-vs-inngest-and-beyond-29e1147c8f2d"
  - "https://docs.tooljet.com/docs/setup/workflow-temporal-to-bullmq-migration/"
  - "https://www.digitalapplied.com/blog/ai-workflow-orchestration-tools-2026-comparison"
  - "https://hookdeck.com/webhooks/platforms/inngest-alternatives"
  - "https://codeables.dev/article/best-alternatives-to-bullmq-redis-worker-fleets-for-background-jobs"
summary: "When each tool is the WRONG choice, the determinism tax, cost crossover (~$15-50 BullMQ vs $75-150 managed at 500k jobs/mo), and the ToolJet Temporal→BullMQ reverse migration."
---

# field-04 — Tool comparison + migration war stories (June-2026 currency)

The marketing pages all say their tool is best. This file captures the TASTE — when each is *wrong* — and real
migrations in BOTH directions.

---

## 1. Matthieu Mordrel — "The Ultimate Guide to TS Orchestration" (Medium, 2025-07-08)
The most opinionated TS-specific source. Verbatim taste:

- **Temporal's determinism is the steepest learning curve.** "[Determinism is] the steepest part of Temporal's
  learning curve."
- **Temporal has a string-name type-safety hole:** "it's possible to create a mismatch that is only caught at
  runtime" — because activities are referenced by string names. (Corroborates Temporal #1790's version-mixing
  footgun: failures hide until runtime/replay.)
- **Temporal + bundlers fight:** "code minification during a build process can sometimes cause issues, requiring
  workarounds." (The deterministic sandbox is allergic to minifiers/tree-shaking.)
- **Trigger.dev stability caveat:** "As a newer framework, its type system and APIs are still evolving."
- **Inngest's type safety is discipline-dependent:** "contingent on discipline in defining comprehensive and
  accurate event schemas upfront" — a human-factor vulnerability.
- **Industry direction (author's thesis):** "a clear move away from complex, infrastructure-heavy solutions towards
  frameworks that prioritize developer experience."

**bee TASTE distilled:** Temporal = power + a *determinism/ops/bundler tax* paid up-front; Inngest = DX + a
*schema-discipline* tax (your event types must be right or type-safety is theater); Trigger.dev = best TS
ergonomics but youngest/most-churning API.

---

## 2. REVERSE MIGRATION — ToolJet migrated Temporal → BullMQ (and was happy)
Source: ToolJet official docs "Migrating Workflows from Temporal to BullMQ".

This is the counter-narrative to "everyone is moving to durable execution." ToolJet went the OTHER way. Verbatim
claims for the move:
- "**Simplified Architecture: No need for separate Temporal server deployment**" — eliminates a whole service tier.
- "**Existing Infrastructure: Leverages your existing Redis instance**."
- "Better Resource Management: Flexible worker modes." / "Improved Visibility: Real-time job status tracking and
  retry capabilities."
- Comparison table: Temporal deployment "High (multi-service)" + cost "Higher"; BullMQ "Low (single-service)" + "Lower".

**bee TASTE / DISPUTE for GAPS:** Temporal's "separate server infrastructure" (the cluster: frontend/history/
matching/worker services + a DB) is a real operational tier most teams underestimate. A product company
(ToolJet) decided durable-execution ceremony wasn't worth it and consolidated onto the Redis they already ran.
This is the live counterweight to the Mordrel/digitalapplied "move to durable execution" thesis: **for many
workloads, the right move in 2026 is the OPPOSITE — drop the orchestration engine, use a queue on existing Redis.**

---

## 3. The 2026 consensus shortlist (digitalapplied / Hookdeck / BuildMVPFast / codeables)
Synthesized verbatim positioning:
- **Trigger.dev — "For 90% of web applications: Start with Trigger.dev. It's the simplest path to reliable
  background jobs."**
- **Inngest — "For event-driven architectures ... the sweet spot. Step functions give you durability without
  Temporal's complexity. If you want the fastest path from existing app code to durable workflows, choose Inngest."**
  Also: "Inngest leads with event-driven primitives that map cleanly onto **agent execution patterns**."
- **Temporal — "the only choice when failure isn't an option. Accept the complexity tax — it pays dividends when
  things go wrong. Choose it when your workflows are genuinely complex and long-lived and you need polyglot workers."**
- **BullMQ / Redis worker fleets:** "Self-hosted tools like BullMQ demand that you run and monitor the broker,
  typically Redis, while durable-execution platforms ... trade that operational burden for step-level replay."
  "Serverless job platforms exist to delete the Redis-operations problem."

### COST CROSSOVER (the number that drives real decisions)
Verbatim (codeables / 2026 reference): "A SaaS processing **500,000 jobs per month** pays roughly **$15 to $50 for
Redis hosting with BullMQ**, compared to **$75 to $150 on Inngest or Trigger.dev cloud plans**."

**bee TASTE:** The decision is rarely "which is technically best." It's: do you have the ops maturity to run Redis
correctly (noeviction, AOF, monitoring, the stalled-job lifecycle) AND is the 2-5× managed-cost premium worth
deleting that burden? Below a certain scale/team-size, managed wins on TCO despite the sticker price; above it, or
with an existing Redis + SRE team, BullMQ wins. Migration between Inngest↔Trigger.dev is "manageable" (similar
step model); **migration to/from Temporal is a full rewrite** (fundamentally different execution model) — so the
Temporal decision is the least reversible and deserves the most Socratic scrutiny.

---

## 4. Migration reversibility matrix (bee decision aid)
| From → To | Difficulty | Why |
|---|---|---|
| BullMQ → Inngest/Trigger.dev | Medium | Re-model jobs as events/tasks; gain durability/visibility, lose Redis control & add cost |
| Inngest ↔ Trigger.dev | Low-Medium | "similar enough concepts that migration is manageable" (step functions both) |
| anything ↔ Temporal | **High (rewrite)** | "fundamentally different execution model" — workflows-as-code + deterministic replay |
| Temporal → BullMQ | Medium-High | ToolJet did it to drop a service tier; lose durable replay, gain simplicity |

**Least-reversible decision = adopting Temporal.** Treat it as a one-way door.

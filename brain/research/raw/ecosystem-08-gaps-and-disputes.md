---
title: "bee Ecosystem Research — Gaps, Disputes, and Things I Could NOT Confirm"
type: synthesis
created: "2026-06-16"
updated: "2026-06-16"
tags: [ecosystem, gaps, disputes, open-questions, bee]
researcher: "ecosystem (CP123 Wave-R)"
summary: "Honest ledger of what I could not confirm, version ambiguities, and disputes between sources — so downstream agents don't treat soft claims as hard."
---

# bee Ecosystem — Gaps & Disputes (2026-06-16)

> Anti-slop honesty: these are the soft spots in the research above. Resolve before relying.

## Versions — RESOLVED in follow-up (record the exact numbers)
- **Temporal TypeScript SDK = v1.18.1** (published 2026-06-11). Source: `gh api repos/temporalio/sdk-typescript/releases/latest` (2026-06-16). [Initially flagged unknown in ecosystem-01 — now confirmed.]
- **Temporal CLI = v1.7.2** (2026-06-10). Source: `gh api repos/temporalio/cli/releases/latest` (2026-06-16).
- **bbc/sqs-consumer = v15.0.2** (2026-05-26). Source: `gh api repos/bbc/sqs-consumer/releases/latest` (2026-06-16).
- **Upstash workflow-js = v1.3.1** (2026-06-02), **qstash-js** floats in the 2.27.x range (per issue #242 "2.27.9 docker image"). Source: `gh api` + issue (2026-06-16).

## Things I could NOT confirm (the 3 to chase)
1. **No 2026-specific net-new AWS SQS feature.** Web search surfaced only *recently-updated* docs (Apr 2026) describing long-standing FIFO/exactly-once/high-throughput features — NOT a new H1-2026 launch. I cannot confirm SQS shipped anything materially new in 2026. CHASE: AWS "What's New" feed filtered to SQS for 2026. (Risk: low — SQS is stable by design, but "current versions + 6-month deltas" is genuinely thin for SQS.)
2. **No first-party MCP server for Inngest, BullMQ, or AWS SQS** (only Trigger.dev + Temporal confirmed). I confirmed *absence via negative search results*, which is weaker than confirming presence. CHASE: each vendor's docs/GitHub org for a `*-mcp` repo before declaring "no MCP." (An AWS-wide MCP suite may cover SQS indirectly — unverified.)
3. **Trigger.dev v4 internal mechanics ("Run Engine 2", checkpoint details).** The official `how-it-works` page I fetched still describes **v3** (CRIU). v4's "Run Engine 2" is named only in a secondary source (buildmvpfast). I could NOT find an official v4 deep-dive on the execution engine. CHASE: trigger.dev/docs for a v4 architecture page; the CRIU detail may or may not still hold in v4.

## Disputes / tension between sources
- **"Exactly-once" semantics.** Vendors market it; primary CS sources insist it's "exactly-once *effect*" not delivery (ecosystem-03). digitalapplied frames Temporal as "exactly-once execution of workflow logic with at-least-once activities" — which RESOLVES the tension correctly (workflow logic deterministic-replay = exactly-once; activities at-least-once = must be idempotent). bee should always state the qualified version, never bare "exactly-once."
- **Full Jitter vs Equal Jitter "best".** AWS blog says **Full Jitter performed best** (least work) in their sim; but `aws-sdk-net#4341` shows Full Jitter collapses to near-zero for throttling. NOT a contradiction once you split by error type (Equal for throttle, Full for transient) — but a naive reader could pick one globally and be wrong. Documented in ecosystem-03.
- **BullMQ language support count.** Sources variously list "Bun, Python, Rust" (buildmvpfast) and "Node.js, Python, Elixir & more" (bullmq.io homepage). Rust is **initial/v5.78.0** (new, June 2026). Treat non-Node BullMQ runtimes as **varying maturity** — Node is canonical, others are newer. Source: https://bullmq.io/ + https://docs.bullmq.io/changelog (2026-06-16).

## Weak-evidence items (cited but thin)
- **HN postmortems/outages**: I found NO direct production-outage HN thread for these tools in 2026. The strongest real-world breakage evidence is the **GitHub issues in ecosystem-04** (which ARE high-signal and root-caused). HN context found is product-launch/standardization signal, not incident reports. Notable HN signal worth tracking: **"StepKit — an open, cross-platform durable execution standard"** (objectID 46048322, 2025, 36pts, by Inngest's tonyhb) + **"Durable Endpoints"** (objectID 47064354, 2026) — durable execution is converging toward a portable standard. Source: hn.algolia.com (2026-06-16).
- **Cloudflare/SQS/QStash absence from the digitalapplied matrix**: that reference simply doesn't cover them; their trade-offs in ecosystem-02/06 come from vendor docs + the buildmvpfast/Hookdeck comparisons, not a single neutral head-to-head. A truly neutral 7-way matrix doesn't appear to exist as of June 2026.

## Coverage notes (what's solid vs needs a second pass)
- **SOLID (multi-source, root-caused):** versions/changelogs (ecosystem-01), core concepts w/ exact formulas (ecosystem-03), GitHub breakage (ecosystem-04), durable-execution mechanics (ecosystem-07), trade-off matrix w/ real pricing (ecosystem-06).
- **NEEDS A SECOND PASS:** SQS 2026 deltas (gap #1); definitive MCP-absence confirmation (gap #2); Trigger.dev v4 engine internals (gap #3).

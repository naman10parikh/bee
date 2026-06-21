---
name: pick-the-jobs-tool
description: Choose the right jobs/queue/durable-exec tool — and name where it's WRONG. Use when the task says "which queue", "Inngest vs BullMQ vs Temporal", "should we use durable execution", "which background-jobs tool", "migrate our queue", or asks for a jobs-infra recommendation. Encodes bee's decision tree, the reversibility matrix (Temporal = one-way door), and the rule that a recommendation without its weak spot is slop.
opinions: [O-11, O-12, O-13, O-14, O-28]
pitfalls: []
scenarios: [S-7, S-15]
owner: bee
---

# Skill — pick-the-jobs-tool

> A recommendation without the trade-off is slop (O-28). Every tool has a documented weak spot; bee's job is to
> walk the decision tree, name the falls-short, and state the reversibility cost — especially that **adopting
> Temporal is a one-way door**, and "replace our queue with durable workflows" is OFTEN wrong. (`brain/OPINIONS.md`
> O-11/O-12/O-13/O-14/O-28 · `brain/EXPERTISE-MAP.md` JTBD-11 · `brain/TOOL-MATRIX.md`.)

## Trigger

Invoke when the request contains any of:
- "which queue" / "which jobs tool" / "what should we use for background jobs"
- "Inngest vs BullMQ vs Temporal" / "X vs Y" for any jobs/durable-exec tools
- "should we use durable execution" / "should we adopt Temporal" / "migrate our queue to …"
- "we're on Redis/Postgres/Cloudflare/AWS — what's the right jobs layer."

## Steps

1. **First ask: do you even need durable execution? (O-14).** "We should replace our queue with durable workflows"
   is OFTEN wrong. Use a **plain queue** when work is short, high-volume, and consumer idempotency is cheap; use
   **durable-exec** only when steps are long-lived, span external systems, and replay correctness justifies the
   overhead (persisting intermediate state costs in DX AND $$$). ToolJet *reverse-migrated* off Temporal back to
   BullMQ to drop a service tier (S-7) — the counter-current is real.

2. **Walk the decision tree by the constraint that dominates (JTBD-11):**
   - **New serverless product, zero-infra → Inngest** (O-11): step durability, generous free tier, maps onto agent
     patterns. *Falls short:* opaque step debugging; single-long-execution bounded by your host timeout; self-host
     is real ops cost (RSS leak, S-15).
   - **Long jobs / human-in-loop / best agent-MCP → Trigger.dev** (O-12): no time cap (minutes→days), waitpoints,
     first-party MCP with `--readonly`. *Falls short:* youngest/most-churning API; managed runtime runs your code
     on their infra (data residency) — pin and read changelogs.
   - **Genuinely complex, long-lived, multi-service, replay-correctness-critical → Temporal** (O-13). *Falls
     short:* the determinism + ops + bundler tax. **And it is a ONE-WAY DOOR** — migration either direction is a
     full rewrite. Apply the most Socratic scrutiny before adopting it.
   - **High volume, cost-sensitive, you'll operate Redis → BullMQ** (O-15): best unit cost at scale, full control.
     *Falls short:* Redis CPU is the ceiling (not job count); foot-guns (Job Schedulers not `repeatable`,
     `lockDuration` > job, pin exact). Only with the rules baked in.
   - **Agent has only an HTTP endpoint → QStash** (O-27): HTTP-in/HTTP-out, no Redis, no workers. *Falls short:*
     step-timeout (use `context.sleep`, not a blocking await).
   - **Pure-Cloudflare stack → CF Queues** (O-27). *Falls short:* `wrangler dev` lies about `remote:true`; no
     on-demand single-message DLQ; 24h free retention.
   - **Already all-in on Postgres → seriously consider a PG-resident queue** (O-24): PgBoss / Graphile Worker
     (mature, modest volume), or DBOS / pg_durable (emerging). *Falls short / state it:* the
     versioning/observability/testing story is **admitted-unsolved by the maintainers** — don't put
     frequently-changing workflow logic there yet. Default verdict for now: **track, don't default**.

3. **State the reversibility explicitly (O-13).** For each candidate, say how expensive it is to leave. Temporal =
   one-way door (rewrite). BullMQ↔Inngest = moderate. QStash/CF = low. Reversibility is a first-class selection
   axis, not a footnote.

4. **NEVER recommend without naming the falls-short (O-28).** Every recommendation in the output must carry its
   documented weak spot. If you can't name the failure mode, you don't understand the tool well enough to
   recommend it.

5. **Surface the ops-headcount axis when relevant (S-15).** "Self-host to avoid lock-in" is partly an ops-team-
   size decision, not a feature decision — self-hosted Inngest OOMs every 2–3 days under load (#3892). Name the
   managed/self-host trade, don't bury it.

6. **Run the oracle to anchor the answer.** `bee pick-tool --profile <serverless|cloudflare|aws|http-only|scale|
   complex|postgres> --json` returns `{recommendation, fallsShort, reversibility}` from this exact tree — use it as
   the structured backbone, then add the workload-specific reasoning.

## Output

- **A recommendation with its falls-short and reversibility** — never a bare pick. Format per candidate:
  `recommendation → the named weak spot (O-28) → reversibility cost (one-way / moderate / low)`.
- **Both sides when it's a migration question** (e.g. S-7): argue the case for AND against, then recommend, with
  the reversibility cost as the tiebreaker. Hold both sides honestly — for genuine disputes there is no single
  right answer (`brain/GAPS-AND-DISPUTES.md`).
- **The `bee pick-tool` command + its JSON** so the reviewer can re-derive the structured recommendation.

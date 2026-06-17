---
title: "field-07 — GAPS AND DISPUTES: where credible sources disagree (verbatim both sides)"
type: synthesis
created: 2026-06-16
tags: [disputes, gaps, controversy, idempotency, durable-execution, postgres-queue]
sources:
  - "https://hatchet.run/blog/durable-execution"
  - "https://lucumr.pocoo.org/2025/11/3/absurd-workflows/"
  - "https://github.com/microsoft/pg_durable"
  - "https://www.digitalapplied.com/blog/webhook-reliability-idempotency-retries-engineering-reference-2026"
  - "https://github.com/taskforcesh/bullmq/issues/3427"
  - "https://docs.tooljet.com/docs/setup/workflow-temporal-to-bullmq-migration/"
summary: "The live controversies a bee employee must hold both sides of: provider-event-ID vs derived idempotency key; durable-exec-as-default vs queues-are-still-better; Postgres-resident vs code-resident workflow logic; dedup-while-active policy; minor-version-bump safety."
---

# field-07 — GAPS AND DISPUTES (capture both sides verbatim)

These are the unsettled questions in background-jobs/queues as of June 2026. A great practitioner holds BOTH sides
and picks per context; an average one dogmatically picks one. For each: the two camps, verbatim, then the
context-dependent reconciliation.

---

## DISPUTE 1 — How do you KEY idempotency: provider event ID vs your own derived key?
- **Camp A (provider event ID, don't derive):** digitalapplied 2026: "Store this provider-issued identifier; **do
  not attempt to construct one from order ID, attempt number, or tenant data.** The provider's ID is what
  distinguishes a retry from a genuinely new event."
- **Camp B (derive deterministically from domain data):** designgurus/DZone: "use ... a **deterministic
  idempotency key derived from order id and attempt number**."
- **Reconciliation (bee):** Different layers, both right. *Inbound dedup* → key on provider event ID (stable across
  the provider's retries). *Outbound effect* → send YOUR own `Idempotency-Key` to the downstream API derived from
  immutable domain identity. The trap (Inngest #2307): a derived key from a field that moved in a refactor double-
  fires. **Status: genuinely disputed; resolved only by layer-separation.**

## DISPUTE 2 — Is durable execution the default for 2026, or are queues still better most of the time?
- **Camp "durable-exec is the new default":** Mordrel (2025-07): "a clear move away from complex,
  infrastructure-heavy solutions towards frameworks that prioritize developer experience." digitalapplied/codeables:
  durable-exec platforms "trade [Redis] operational burden for step-level replay"; Koshy (May 2026): agent
  workflows ARE long-running workflows that need durable execution.
- **Camp "queues are still better, durable-exec is oversold":** Hatchet (Dec 2025), verbatim: "**'We should
  replace our queueing system with durable workflows' is often wrong; traditional queues remain better for many
  use-cases due to lower overhead.**" "persisting intermediate program state comes with overhead, both in terms of
  developer experience, but also in terms of $$$." AND the ToolJet reverse-migration (Temporal→BullMQ) is a real
  team voting with their feet for the simpler queue.
- **Reconciliation (bee):** Use durable-exec when steps are long-lived, span external systems, and replay
  correctness is worth the overhead; use a plain queue when work is short, high-volume, and idempotency at the
  consumer is cheap. **Status: actively disputed in 2026; the "everyone's moving to durable exec" narrative has a
  credible counter-current.**

## DISPUTE 3 — Should workflow/queue logic live IN Postgres or IN code (Git)?
The pg_durable HN thread (2026-06-05) is this debate in miniature:
- **Pro-DB-resident:** @levkk: "**2026 is the year of the Postgres queue!**" — data locality, one fewer service.
- **Pro-code-resident (the pushback):** @levkk also: "As an ex-app engineer ... I kind of prefer my queue logic to
  be in code, in Git." @babhishek21: "it doesn't make sense ... why I'd want to do a migration (which is an all or
  nothing op btw) every time I want to change how I behave with my data." @dietr1ch: "What's the story for version
  control, debugging, testing, releasing?" @CuriouslyC (PG fanboy since v7): "the DX/observability isn't there ...
  multi-master scaling story isn't turnkey."
- **Maintainer concession (@gdecandia, pg_durable contributor):** "we **do need to develop some best practices
  around managing function versioning and lifecycle** for pg_durable."
- **Reconciliation (bee):** PG-resident deletes the Redis-ops AND separate-cluster problems for Postgres-shops, but
  the **versioning/observability/testing story is admitted-unsolved by the maintainers themselves**. **Status:
  emerging option with an honest, open maturity gap.**

## DISPUTE 4 — Deduplication-while-active: drop the mid-flight trigger, or guarantee a tail run?
- **Users (BullMQ #3427):** want "at least one execution **after the last trigger**" — simple/throttle/debounce
  modes "**lost forever**" a trigger that arrives during active processing.
- **Maintainer @manast (verbatim):** "simple mode works in at least once semantics already ... lets say the
  operation is a database update, it seems to me it is much better to deduplicate until the previous update has been
  completely processed **to avoid out-of-[order writes]**."
- **Reconciliation (bee):** It's a correctness *policy*, not a convenience. "Coalesce + run once more after the last
  event" (cache-invalidation/sync) vs "collapse to in-flight to avoid out-of-order writes" (DB update) are both
  valid and OPPOSITE. **Status: a semantics disagreement; the default silently picks one — know which.**

## DISPUTE 5 — Are BullMQ minor version bumps safe?
- **Implicit "yes" (semver):** 5.65→5.77 is a minor range.
- **Reality "no":** #4194 — upgrading to 5.77.x made **every** processor hang on first `await` (maintainers
  couldn't repro); #4196 — Pro 6.9→7.46 **doubled Redis CPU**; #4220 — a 5.76.8 bug let scheduler jobs retry
  forever (fixed 5.78.1). Three "minor"-range regressions in ~2 months.
- **Reconciliation (bee):** treat BullMQ minor bumps as risky; gate on a FULL job-suite run, not unit tests.
  **Status: not a formal dispute, but a practitioner-vs-semver gap worth flagging.**

---

## OPEN GAPS — things I could NOT fully confirm / nobody has solved (for follow-up research)
1. **Shared-LLM-key throttling across functions/workers is UNSOLVED in both leading tools.** Inngest #3701 (shared
   throttle scope) and #4345 (burstable keyed concurrency) are both OPEN; BullMQ #3670/#3831 (global/points-based
   rate limit as a queue option) are OPEN. I could not find a tool that does "token-bucket on one provider key
   across N functions" as a first-class, production-proven feature. **This is the #1 agent-era jobs gap.**
2. **Prompt-injection / tool-poisoning-aware job execution has no productized answer.** Koshy (May 2026) names the
   need (workload identity + policy-as-audit), but I found NO shipping queue/durable-exec product that enforces
   per-step agent identity (SPIFFE/SPIRE) + injection resistance. Standards (Oracle Open Agent Spec, CNCF
   Serverless Workflow, AgentSPEX) are research/early. **Unconfirmed that any production tool covers this.**
3. **pg_durable / Postgres-resident durable-exec function VERSIONING is admitted-unsolved** by maintainers
   (@gdecandia). Could not confirm a working version/lifecycle story for in-DB workflow code. The DX/observability
   maturity (per @CuriouslyC) is anecdotally "not there" — could not find rigorous benchmarks vs Temporal/BullMQ.
4. **Inngest #4194 (5.77.x worker hang) — root cause UNCONFIRMED.** Reporter says all processors hang; maintainers
   cannot reproduce. No resolution as of pull date. (Filed under BullMQ in field-01; double-check it's BullMQ not
   Inngest — issue is in taskforcesh/bullmq.) Whether it's NestJS-adapter-specific is unknown.
5. **The cost crossover number ($15-50 BullMQ vs $75-150 managed @ 500k jobs/mo)** comes from one 2026 reference
   (codeables); I could not independently verify it against vendor pricing pages in this pass — treat as
   order-of-magnitude, not exact.

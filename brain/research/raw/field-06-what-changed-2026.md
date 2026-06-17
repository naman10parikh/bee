---
title: "field-06 — What changed in 2026 that invalidates 2025 queue/jobs wisdom"
type: synthesis
created: 2026-06-16
tags: [2026-shift, monitor-tool, durable-execution, agents, postgres-queue, pg_durable, a2a, polling]
sources:
  - "https://claudefa.st/blog/guide/mechanics/monitor"
  - "https://www.mindstudio.ai/blog/claude-code-monitor-tool-stop-polling-background-processes"
  - "https://nittikkin.medium.com/agent-workflows-are-rediscovering-durable-execution-be110661ed8c"
  - "https://github.com/microsoft/pg_durable"
  - "https://lucumr.pocoo.org/2025/11/3/absurd-workflows/"
  - "https://judoscale.com/blog/node-task-queues"
summary: "Five 2026 shifts: (1) Anthropic Monitor tool kills polling loops, (2) agents rediscover durable execution + need workload identity, (3) Postgres-resident queues/durable-exec (pg_durable, DBOS, absurd-workflows) go mainstream, (4) shared-LLM-key throttling becomes the dominant flow-control need, (5) A2A makes cross-org job handoff table-stakes."
---

# field-06 — What changed in 2026 (invalidates 2025 conventional wisdom)

---

## SHIFT 1 — Polling loops are obsolete: the Anthropic **Monitor tool** (Claude Code v2.1.98, 2026-04-09)
2025 wisdom: "schedule a cron / `/loop` to poll for state changes." 2026 reality: that's wasteful and now
replaced by an interrupt-driven primitive.

Verbatim (claudefa.st): "The Monitor tool transforms background work from **time-driven polling to event-driven
reactions**. ... 'Each line of output is a notification that wakes the main session. **If the command is silent,
Claude spends nothing.**'" Params: `command`, `description`, `timeout_ms` (default 5 min, max 1 hr), `persistent`.
Two shapes: stream filters (`tail -f app.log | grep --line-buffered "ERROR"`) and poll-and-if filters.
Critical rule: "**Always use `grep --line-buffered` in pipes.** Without it, pipe buffering delays events by minutes."
Token math (verbatim): "A `/loop` checking tests every 2 minutes over 10 minutes = 5 full API calls, 4 wasteful.
Monitor costs zero tokens during silence." Limitations: "Stderr doesn't trigger events; high-volume monitors
auto-stop."

**bee relevance (DIRECT — overrides internal `loop-integration` skill):** The Energy fleet's `loop-integration`
SKILL teaches `/loop 5m` polling. As of v2.1.98 that pattern is superseded for *event-shaped* waits by Monitor.
bee should prefer Monitor (wake-on-signal) over CronCreate-polling whenever the trigger is an observable stream
(log line, file change, PR status). CronCreate/`/loop` remains correct only for genuinely time-based work
("run nightly at 2am"), not for "wait until X happens."

---

## SHIFT 2 — Agent workflows are "rediscovering durable execution" + a NEW concern: accountability for non-human actors
Source: "Agent Workflows Are Rediscovering Durable Execution" (Koshy, Medium, May 2026).

2025 framing: durable execution = enterprise/Temporal niche. 2026 framing: every multi-step agent IS a
long-running workflow and needs the same primitives. Five lessons agent specs must steal (verbatim):
1. "Persistence for idle states" — "A human approval node may wait three days ... should not keep runtime memory
   warm like a tiny server-shaped campfire."
2. "Non-persistable regions" — "You cannot checkpoint mid-LLM stream or after a tool call before recording results."
3. "Sagas, not rollback" — compensating transactions across tools/APIs, not ACID rollback.
4. "Idempotency keys" — "Without an idempotency key, that can mean **duplicate payments, duplicate tickets,
   duplicate deploys**."
5. "Recorded non-determinism" — "The output must be recorded the first time and reused during recovery ...
   Otherwise 'resume' quietly becomes 'do something similar again.'"

**The genuinely NEW 2026 problem (verbatim):** "The agent-specific problem is newer ... The actor may be
non-human, short-lived, probabilistic, tool-using, and vulnerable to **prompt injection or tool poisoning**." →
demands **workload identity (SPIFFE/SPIRE) recorded in every event** + **policy decisions as audit records**.

**bee relevance:** This is bee's thesis. A background-jobs harness in 2026 is not just "run async work" — it's
"run async work *by a probabilistic agent* with replay, idempotency, AND an identity/audit trail per step." The
classic queue (BullMQ) gives you none of the agent-accountability layer; durable-exec (Temporal/Restate/DBOS)
gives replay but not identity; nobody fully covers prompt-injection-aware job execution yet (gap).

---

## SHIFT 3 — "2026 is the year of the Postgres queue" — durable execution moves INTO the database
2025: queue = Redis (BullMQ) or a dedicated cluster (Temporal). 2026: a strong wave of **Postgres-resident**
queues + durable execution. Evidence (HN, dated):
- **microsoft/pg_durable** — "Microsoft open sources in-database durable execution" (HN 2026-06-05, **474 pts, 108
  comments**). Built on `microsoft/duroxide` (OSS durable-exec framework, supports function versions).
- **DBOS** (Postgres-backed durable exec, TS+Python), **NikolayS/pgque**, "Absurd Workflows: Durable Execution
  with Just Postgres" (lucumr/pocoo, HN 2025-11-03, 169 pts), "Building a Durable Execution Engine with SQLite"
  (morling.dev, HN 2025-11-20, 178 pts), Hatchet "How to think about durable execution" (2025-12-12).

Top HN comment (verbatim, @levkk on pg_durable): "**2026 is the year of the Postgres queue!** (DBOS, pgQue) ...
As an ex-app engineer though, I kind of prefer my queue logic to be in code, in Git, but maybe with the right
tooling, you can change my mind."

**bee relevance:** The Redis-vs-dedicated-cluster dichotomy is now a TRICHOTOMY: **Redis (BullMQ) / dedicated
durable-exec (Temporal) / Postgres-resident (DBOS, pg_durable)**. For a team already running Postgres, a PG-native
queue deletes BOTH the Redis-ops problem AND the separate-cluster problem — at the cost of an unsettled
versioning/observability story (see disputes file). This didn't exist as a mainstream option in early 2025.

---

## SHIFT 4 — Flow control's center of gravity moved to "throttle a shared LLM key across many functions"
2025: rate-limiting was per-queue/per-function for external HTTP APIs. 2026: the dominant constraint is **one
rate-limited model provider key shared across every agent step / every function**. Both ecosystems have OPEN gaps:
- Inngest #3701 (2026-02): "Support **shared throttle scope** across functions (env/account)" — STILL open.
- Inngest #4345 (2026-06): burstable keyed concurrency (per-tenant floor + burst ceiling) — STILL open.
- BullMQ #3670 / #3831 (2026): global concurrency + **points-based** rate limiters as a queue option.

**bee relevance:** The single most important flow-control feature for an agent jobs harness — "never exceed the
model provider's TPM/RPM across all my workers" — is a first-class gap in BOTH leading tools as of mid-2026. bee
should treat shared-resource (token-bucket on a provider key) throttling as a core requirement, not an add-on.

---

## SHIFT 5 — A2A v1.0 makes cross-org job handoff table-stakes (from internal checklist)
Per the Energy harness checklist (field-00): "**A2A Protocol v1.0** — 150+ orgs, native in major clouds (A2A card
now table-stakes)." Combined with SHIFT 2's workload-identity requirement, a 2026 jobs harness may need to **hand a
job off across an organizational boundary** with a verifiable agent identity attached — a concern that simply
didn't exist for a 2025 BullMQ worker pulling from a local Redis list.

---

## Summary: what a 2025 doc would get WRONG in 2026
1. "Poll with cron/`/loop` for state changes" → use **Monitor** (wake-on-signal); polling is now the wasteful path.
2. "Durable execution = enterprise/Temporal" → it's the **default substrate for multi-step agents**.
3. "Queue = Redis or a cluster" → **Postgres-resident** (DBOS/pg_durable) is a real third option.
4. "Rate-limit per function for HTTP APIs" → the binding constraint is **a shared LLM key across all functions** —
   an OPEN gap in BullMQ AND Inngest.
5. "A job is internal, anonymous, deterministic code" → jobs are increasingly **agent-run, probabilistic,
   cross-org, and need identity + audit + prompt-injection resistance**.

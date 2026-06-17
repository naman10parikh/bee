---
title: "bee Ecosystem Research — Official Docs Deep-Dive: Durable-Execution Mechanics + Money-Bug Postmortems"
type: concept
created: "2026-06-16"
updated: "2026-06-16"
tags: [ecosystem, durable-execution, memoization, determinism, idempotency, temporal, inngest, trigger, bee]
researcher: "ecosystem (CP123 Wave-R)"
summary: "How each durable engine ACTUALLY executes (state, memoization, replay) from official docs — plus the 10 Temporal money-duplication slips. The most load-bearing flows for an agent."
---

# bee — Durable-Execution Mechanics, From the Docs (2026-06-16)

> This is the "official docs deep-dive on the load-bearing flows" mission item. Each engine has a
> DIFFERENT execution model and a DIFFERENT determinism contract. Getting these wrong = duplicated
> money / lost work. Sources are the official docs, quoted.

---

## 1. Inngest — step memoization via function re-invocation (the #1 gotcha)

Source: https://www.inngest.com/docs/learn/how-functions-are-executed (fetched 2026-06-16) + https://www.inngest.com/docs/features/inngest-functions/error-retries/retries (2026-06-16) + checkpointing blog https://www.inngest.com/blog/introducing-checkpointing (2026-06-16).

**Execution model (quoted):**
- "the results of each step are returned to Inngest and persisted in a managed function state store."
- "Each step in your function is executed as a separate HTTP request."
- "The steps that successfully executed are memoized. The function then resumes, skipping any steps that have already been completed." Memoization key = a **hash of the step ID**; the cached result is injected without re-executing the step body.
- Each `step.run()` has its **own independent retry counter**. Source: retries doc (2026-06-16).

**THE CRITICAL RULE (quoted, this is the bug everyone hits):**
> "Any non-deterministic logic (such as DB calls or API calls) must be placed within a `step.run()` call … Code outside `step.run()` re-executes on every invocation."

→ Because the whole function is re-invoked once per step, **anything NOT wrapped in a step runs again every time** (variable assignments, a stray `await fetch()`, `Date.now()`, `Math.random()`). This causes duplicate work / non-deterministic branching. **bee rule:** wrap EVERY side effect and every non-deterministic value in `step.run()`. Treat code outside steps as "runs N times."

**Checkpointing (2026):** "a hybrid durable execution mode where synchronous steps that require suspending … are durably executed **without inter-step latency**." → keeps durability but removes the per-step HTTP round-trip latency. Source: https://www.inngest.com/blog/introducing-checkpointing (2026-06-16).

**`step.sleep` / `step.waitForEvent`:** durable pauses — the function suspends WITHOUT holding compute and resumes later (the docs page didn't detail the exact mechanics — flagged minor gap; but the contrast with a naive `setTimeout` is the point: use `step.sleep`, ecosystem-04 lesson).

## 2. Trigger.dev — CRIU checkpoint-resume + idempotency-keyed subtask cache

Source: https://trigger.dev/docs/how-it-works (fetched 2026-06-16; page describes v3 mechanics — v4 uses "Run Engine 2" per buildmvpfast firecrawl 2026-06-16). 

**Execution model (quoted):**
- Tasks run "in a secure, isolated environment" **outside your application's request cycle** (managed compute, no function-timeout ceiling).
- **Checkpoint-Resume via CRIU** (Checkpoint/Restore In Userspace): when a task pauses (`triggerAndWait` / programmed waits), "the system uses CRIU to create a checkpoint of the task's entire state, including **memory, CPU registers, and open file descriptors**," compressed + stored on disk, resources released, then resumed from the exact point.
- **Idempotency-keyed subtask cache:** "The output of each subtask is cached based on its idempotency key." On retry, "only the failed subtask and subsequent tasks are retried," completed work uses cached results.
- **Billing nuance:** Cloud doesn't charge for time waiting on subtasks or in a paused state.

**Difference from Inngest:** Inngest re-invokes the whole function and memoizes by step-ID hash (so code outside steps re-runs). Trigger.dev **snapshots the live process** (CRIU) and resumes it — so there's no "code outside steps re-runs" trap, but the durability boundary is the wait/subtask, and **idempotency keys** are the cache key. v4 adds **waitpoints** (human-in-the-loop pause until approve/webhook/external completion) + **input streams** (bidirectional comms with a running task). Source: buildmvpfast firecrawl (2026-06-16).

## 3. Temporal — replay-based determinism (workflows) + retryable activities

Source: https://docs.temporal.io/activity-definition ; https://docs.temporal.io/encyclopedia/retry-policies ; https://temporal.io/blog/idempotency-and-durable-execution (all 2026-06-16).

**Execution model (quoted):**
- "Temporal doesn't store a snapshot of worker memory — recovery happens by **replaying workflow code and verifying that decisions match recorded history**." If replay takes a different path (wall-clock time, random, direct network I/O) → **Non-Determinism Error (NDE)**, execution halts to prevent state corruption.
- "Workflows must be deterministic, with external calls going into **Activities** (or explicitly controlled side effects), **not inside workflow logic**."
- **Workflows don't retry by default and you usually shouldn't add a Retry Policy** — a workflow failure "typically indicates a code bug or bad input." **Activities** are the failure-prone layer and DO have a default retry policy.
- **Idempotency key recipe (quoted):** "Use a combination of the **Workflow Run ID and the Activity ID** as an idempotency key — guaranteed consistent across retry attempts but unique among Workflow Executions." For money: "every money-moving call must include an idempotency key that is **stable across retries and across worker restarts**."

**Difference from Inngest/Trigger:** Temporal re-EXECUTES your workflow code on replay (must be pure/deterministic); side effects live ONLY in Activities (which are at-least-once → must be idempotent). This is the most powerful AND the most foot-gun-prone model.

## 4. THE 10 TEMPORAL IDEMPOTENCY SLIPS THAT DUPLICATE MONEY (postmortem-grade)

Source: https://medium.com/@bhagyarana80/temporal-workflows-10-idempotency-slips-that-duplicate-money-30e2fb8d5d90 (Mar 2026, fetched 2026-06-16). These generalize to EVERY at-least-once system, not just Temporal — bee should encode all 10:

1. **Activity retry treated as safe by default** — a charge times out *after* the gateway processed it; retry double-charges. FIX: every money call gets an idempotency key stable across retries + worker restarts.
2. **Idempotency key generated with randomness INSIDE the activity** — `uuid()` per retry = new key = new charge. FIX: derive the key once in workflow state deterministically, pass it in.
3. **StartToCloseTimeout misread as "didn't run"** — gateway may have charged. FIX: **confirm-before-repeat** — query the gateway by idempotency key before re-charging.
4. **Skipping DB-layer idempotency** — in-memory dedup bypassed by restart/concurrency. FIX: **unique constraint** on the idempotency key in the DB.
5. **Workflow replay re-runs side effects** — external I/O in workflow code re-executes on replay. FIX: side effects only in Activities.
6. **Assuming ActivityId dedupes externally** — it dedupes workflow history, NOT the external gateway. FIX: domain-level idempotency keys both your DB and the external system recognize.
7. **Retrying on wrong errors / forever** — infinite retry on ambiguous errors → eventual dupes. FIX: classify errors — connection-reset-before-send = safe retry; timeout/ambiguous = switch to a **status query**, don't blind-retry.
8. **Forgetting signals deliver more than once** — a `PaymentConfirmed` signal processed twice → duplicate payout. FIX: dedupe signals by tracking processed event IDs in workflow state (monotonic versioning).
9. **Child workflow start/retry spawns duplicates** — parent times out waiting, starts another child; both charge. FIX: **deterministic child workflow IDs** + reattach to the existing execution.
10. **Saga compensation not idempotent** — refund times out after succeeding, retry double-refunds. FIX: "Compensation must be as idempotent as the forward path."

→ **bee meta-rule:** the dangerous failure is NOT "it didn't run" — it's "it ran but I didn't hear back." On ANY ambiguous timeout, **query state, don't blind-retry**, and every side effect carries a deterministic idempotency key enforced by a DB unique constraint.

## 5. The three execution models, side by side (bee's mental model)

| | Inngest | Trigger.dev | Temporal |
|---|---|---|---|
| How it survives a crash | re-invoke function, memoize completed steps (step-ID hash) | CRIU process snapshot, resume live process | replay workflow code against recorded history |
| What must be deterministic | nothing (but code outside `step.run` RE-RUNS) | nothing (snapshot is the live process) | the ENTIRE workflow function (replay) |
| Where side effects go | inside `step.run()` | inside tasks/subtasks (idempotency-keyed cache) | inside **Activities** only |
| Durable wait primitive | `step.sleep` / `step.waitForEvent` | waitpoints / `triggerAndWait` | Timers / Signals / `condition()` |
| #1 foot-gun | side effect OUTSIDE a step → runs every invocation | unbounded fan-out exhausting pools (#3728) | NDE from any async-ordering change (#1677) |

---

### Sources (this file)
- https://www.inngest.com/docs/learn/how-functions-are-executed (fetched 2026-06-16)
- https://www.inngest.com/docs/features/inngest-functions/error-retries/retries (2026-06-16)
- https://www.inngest.com/blog/introducing-checkpointing (2026-06-16)
- https://trigger.dev/docs/how-it-works (fetched 2026-06-16)
- https://docs.temporal.io/activity-definition (2026-06-16)
- https://docs.temporal.io/encyclopedia/retry-policies (2026-06-16)
- https://temporal.io/blog/idempotency-and-durable-execution (2026-06-16)
- https://medium.com/@bhagyarana80/temporal-workflows-10-idempotency-slips-that-duplicate-money-30e2fb8d5d90 (Mar 2026, fetched 2026-06-16)
- v4 Run Engine 2 / waitpoints: buildmvpfast (firecrawl 2026-06-16)

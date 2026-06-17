---
title: "field-03 — Temporal: non-determinism, replay-on-pod-roll, versioning traps (GitHub issues)"
type: source
created: 2026-06-16
tags: [temporal, non-determinism, replay, versioning, durable-execution, otel, postmortem]
sources:
  - "https://github.com/temporalio/sdk-typescript/issues/2023"
  - "https://github.com/temporalio/sdk-typescript/issues/1790"
  - "https://github.com/temporalio/sdk-typescript/issues/1962"
  - "https://github.com/temporalio/sdk-typescript/issues/1753"
  - "https://github.com/temporalio/sdk-go/issues/983"
summary: "Temporal's signature failure class — nondeterminism errors that surface hours later on replay, made worse by OTel interceptors and version mixing."
---

# field-03 — Temporal: real failures from the issue tracker (June-2026 currency)

Sourced from `temporalio/sdk-typescript` + `sdk-go` GitHub issues via `gh issue view` on 2026-06-16. Temporal's
whole value prop is durable execution via event-sourced replay — so its signature failure is the
**DeterminismViolationError [TMPRL1100]**, and the issues show how subtly it bites.

---

## 1. THE LANDMINE — OTel interceptors silently break determinism via the workflow PRNG
**#2023** (OPEN, 2026-04-23). Marked a duplicate of #1895; fix tracked in #1992.
URL: https://github.com/temporalio/sdk-typescript/issues/2023

Verbatim (reporter):
> "With the stock OTel workflow interceptors installed, `workflow.uuid4()` calls made **after any handled query or
> update-validation** return a different value on replay than what was recorded. If that uuid appears in a
> recorded command (child workflow id, activity arg, etc.), replay fails ... **The workflow runs fine as long as
> it stays in sticky cache. The error only surfaces when the workflow is evicted and has to replay from history on
> a fresh worker — typically hours later, after a pod roll.**"

Mechanism (verbatim): "PRNG position is shifted by any queries handled between tick #1 and tick #2 ... Replay never
re-invokes the query handler, so its PRNG isn't advanced by those bytes; `id` ends up different than what was
recorded."

**TASTE / why this is the most important Temporal finding:** This is the *defining* operational hazard of durable
execution. The code is correct in the happy path; a **read-only query handler** (the most innocent thing) advances
the deterministic RNG, and `uuid4()` drifts. The failure is **time-delayed and environment-dependent** — green in
dev/sticky-cache, then a pod roll hours later evicts the workflow and replay explodes. And the trigger was adding
**observability** (OTel), the thing you add to be *safer*. For bee: **durable-execution engines move the failure
from runtime to replay-time, which is far harder to test.** You must run replay/history-compatibility tests in CI
(see #1790), and treat ANYTHING that touches the deterministic RNG (interceptors, queries, updates) as load-bearing.

---

## 2. REPLAY/CI TESTING IS ITSELF FRAGILE — child workflow ids don't match
**#1790** (OPEN, 2025-09-26). URL: https://github.com/temporalio/sdk-typescript/issues/1790

The reporter is doing exactly the right thing — "write a workflow history compatibility test using
`Worker.runReplayHistory`, so it can be run in CI to protect our team against accidentally introducing
non-deterministic changes" — and STILL hits:
> `DeterminismViolationError ... [TMPRL1100] Nondeterminism error: Child workflow id of scheduled event '...' does
> not match child workflow id of command '...'`

Maintainer (@mjameswh, verbatim): "**Mixing packages of different versions of `@temporalio/*` packages is not
supported, not even** [patch versions]." The user was on 1.13.0 across the board, so version-mixing wasn't the
cause here — but the warning itself is a major footgun: a single mismatched `@temporalio/*` transitive dep can
produce phantom nondeterminism.

**TASTE:** Even the *defense mechanism* (replay tests in CI) has sharp edges. And "all @temporalio/* packages must
be the exact same version" is an easy way to get bitten by a lockfile drift. bee should pin and assert temporal SDK
version uniformity.

---

## 3. VERSIONING / WORKER-DEPLOYMENT TRAPS (the feature meant to fix #1 has its own bugs)
- **#1962** (CLOSED, 2026-03-11) — "Unable to set `defaultVersioningBehavior` to `UNSPECIFIED` in
  `workerDeploymentOptions`." The new Worker Versioning surface (the sanctioned way to evolve workflows safely)
  had config it wouldn't accept.
- **#1753** (CLOSED, 2025-07-30) — "Calling a Workflow with Worker Versioning and **PINNED** behavior in
  `versionOverrides` **fails** in Temporal Server >=1.28.0." A server-version upgrade broke the pinning mechanism.
- **#1716** (OPEN, 2025-05-14) — Worker Versioning high-level client still being built for TS.

**TASTE:** Temporal's answer to "how do I deploy new code without breaking in-flight workflows" is Worker
Versioning / Patching — but that subsystem is itself young and has had server-version-coupled bugs. The classic
`patched()` / `getVersion()` API is the older, battle-tested escape hatch; the new deployment-based versioning is
cleaner but newer. For bee: **deploying changes to long-running workflows is the hard part of Temporal**, and the
tooling is still settling in 2026.

---

## 4. REPLAY EDGE — local activities can give FALSE non-determinism negatives
**sdk-go #983** (CLOSED, 2022-12-13) — "Replaying non deterministic workflows that use local activities can give
**false negatives**." Older, but durable lesson: **local activities** (an optimization to avoid the task-queue
round-trip) interact badly with replay validation — you can get a false "it's fine" or a confusing failure.
URL: https://github.com/temporalio/sdk-go/issues/983

---

## Cross-issue synthesis (bee TASTE bank)
1. **Temporal's failure mode is replay-time, not runtime** (#2023) — green in dev/sticky-cache, explodes hours
   later on pod-roll eviction. The hardest class of bug to catch.
2. **Anything touching the deterministic RNG is load-bearing** — even read-only query handlers and OTel
   interceptors (#2023). Adding observability can BREAK you.
3. **Run replay/history-compatibility tests in CI** (#1790) — but know they're fragile and require exact-version
   `@temporalio/*` uniformity.
4. **Evolving long-running workflow code is THE hard problem**; Worker Versioning is the new way but young
   (#1962, #1753); `patched()`/`getVersion()` is the proven escape hatch.
5. Temporal gives **exactly-once *workflow* semantics on top of at-least-once *activity* execution** — activities
   still run ≥1×, so activity idempotency is still your job (mirror of BullMQ/Inngest).

---
title: "field-02 — Inngest: idempotency, debounce-latency, self-host memory leak (GitHub issues)"
type: source
created: 2026-06-16
tags: [inngest, idempotency, debounce, concurrency, throttle, self-hosted, memory-leak, postmortem]
sources:
  - "https://github.com/inngest/inngest/issues/2307"
  - "https://github.com/inngest/inngest/issues/4150"
  - "https://github.com/inngest/inngest/issues/3892"
  - "https://github.com/inngest/inngest/issues/4345"
  - "https://github.com/inngest/inngest/issues/3701"
  - "https://github.com/inngest/inngest/issues/3695"
summary: "Inngest's idempotency-key prod failure (Stripe-shaped), debounce retry-tail latency, throttle scope gaps, and a serious self-hosted memory leak."
---

# field-02 — Inngest: real failures from the issue tracker (June-2026 currency)

Sourced from `inngest/inngest` GitHub issues via `gh issue view` on 2026-06-16.

---

## 1. IDEMPOTENCY-KEY REGRET — function-level idempotency "does not work in production"
**#2307** (CLOSED, 2025-04-03). URL: https://github.com/inngest/inngest/issues/2307

The reporter's function is *literally the double-charge shape* — a Stripe `checkout.session.completed` handler:
```ts
inngest.createFunction(
  { id: 'gateway-checkout-session-completed',
    idempotency: 'event.data.checkoutSessionId' },   // <-- the dedup key
  { event: 'app/checkout.session.completed' }, ...)
```
> "this feature does not work on app.inngest.com ... It works fine on the dev server though. Expected: Should not
> be able to run the same function multiple times with the same Idempotency id. All functions are behaving the same."

**Resolution (verbatim, @wladpaiva 2025-04-03):** "Turned out the idempotency key was wrong due to a refactor 🙈"

**TASTE / why this matters for bee:** The idempotency mechanism worked; the *key expression* silently pointed at
the wrong field after a refactor, so every checkout could double-fire. This is the most common idempotency regret
in the wild: **the bug is never "the dedup didn't run," it's "the dedup key was subtly wrong"** (typo, wrong
field, missing tenant prefix, key computed AFTER a mutation). Dev-server-vs-prod divergence made it worse — it
passed locally. bee's lesson: idempotency keys need a TEST that asserts two identical events collapse to one
side-effect, run against prod-like infra, and the key must be derived from immutable event data, not post-refactor
field paths. (See also Inngest #875 "Idempotency - not working?" 2023 — long-running confusion about the feature.)

---

## 2. DEBOUNCE LATENCY POSTMORTEM — 750ms×5 retry tail adds ~3.75s on conflicts
**#4150** (OPEN, 2026-05-08). URL: https://github.com/inngest/inngest/issues/4150

> "`debounce()` retries up to **5 times with a 750ms backoff** when an update fails with `ErrDebounceInProgress`,
> `ErrDebounceNotFound`, or `context.DeadlineExceeded`. Worst-case adds **~3.75s of latency** on top of the
> configured debounce period."
> TODO in source: "make debounce creation and updating atomic within the queue. This needs to modify queue items
> and partitions directly."

200-iteration local timing (healthy stack, NO contention): first-fire latency **p50 3.09s, p99 5.82s, max 10.10s**
for a 2s debounce. "under contention, debounce-triggered functions can fire **3-7s later** than the configured
period, with **no observability** into whether the latency came from the period, the queue, or the retry loop."
The fix in their own E2E was a band-aid: bumping a 5s test poll budget to 30s.

**TASTE:** Debounce is sold as "coalesce bursts," but the *tail latency under contention* is the trap — and it's
invisible (`is_debounce` flag was even broken in tracing, see #3632). If you debounce a user-visible action
("save"), p99 can be 3× the nominal window. For bee: **debounce/throttle windows have a hidden retry tail; budget
p99, not the nominal period, and demand observability into where the latency came from.**

---

## 3. SELF-HOSTED MELTDOWN — RSS grows to 10+ GiB, OOM, "system freeze"
**#3892** (OPEN, 2026-03-26). URL: https://github.com/inngest/inngest/issues/3892

> "Self-hosted Inngest leaks memory continuously. RSS grows linearly and is never reclaimed by the Go runtime.
> After fresh restart ~500 MiB → after 12h ~3 GiB → after 2-3 days 10+ GiB → **system freeze**. Heap profile shows
> ~1 GiB inuse but RSS is 10.6 GiB ... `GODEBUG=madvdontneed=1` does not help. `GOMEMLIMIT=8GiB` causes the GC to
> spin at **700% CPU** without reducing RSS."

Root-cause hint: the **tracing/telemetry subsystem** (`pkg/tracing/*`, `OnEnd`, `ExportSpans`, histogram metrics).
Repro: concurrency 100 global / 4 per key + throttle 50/s + ~1000 runs/day on PG17 + Redis7.

**Corroboration (verbatim, @lasse-it 2026-03-27):** "We're experiencing the exact same problem, and have had the
issue for a really long time. Our current workaround is to run multiple inngest pods, and let them get OOM killed,
when they grow too large."

**TASTE / DISPUTE for GAPS:** The "serverless/AI-first" pitch hides that **self-hosting Inngest is operationally
nontrivial** — a memory leak severe enough that the community's coping strategy is "let pods OOM-kill on a
rotation." This directly undercuts the "just self-host BullMQ alt" framing. For bee: if you pick Inngest
self-hosted, you inherit Go-runtime RSS pathologies and a telemetry-heavy hot path. The managed cloud avoids this
but reintroduces vendor cost/lock-in. (Background-jobs choice is partly an ops-team-size choice.)

---

## 4. CONCURRENCY / THROTTLE GAPS (feature-shaped, but reveal the model's edges)
- **#4345** (OPEN, 2026-06-05) — "Burstable keyed concurrency: a guaranteed-minimum `limit` plus an optional
  burstable `maxLimit`." Users need per-key floors AND burst ceilings; current keyed concurrency can't express
  "guarantee tenant X ≥ N slots but let them burst to M."
- **#3701** (OPEN, 2026-02-18) — "Support **shared throttle scope** across functions (env/account)." Today throttle
  is per-function; you can't throttle a downstream *shared* API (e.g., one OpenAI key) across many functions.
- **#3695** (OPEN, 2026-02-17) — "Debounce that provides **all events in window**" (current debounce keeps only the
  last; you lose the intermediate payloads).

**TASTE:** These three expose Inngest's flow-control mental model: it's *function-scoped* by default. The real
2026 need — **throttle a shared external resource (an LLM API key) across many functions** — is not first-class.
For bee, this is THE agent-era requirement (every agent step calls the same rate-limited model). Note the BullMQ
mirror: #3670/#3831 (points-based + global rate limit as a queue option) is the same gap on the other tool.

---

## Cross-issue synthesis (bee TASTE bank)
1. **Idempotency bugs are key-derivation bugs, not engine bugs** (#2307). Test that two identical events → one
   side effect, on prod-like infra.
2. **Debounce/throttle have invisible tail latency** (#4150) — budget p99, demand observability.
3. **Self-hosting the "serverless" tools has real ops cost** (#3892) — RSS leaks, OOM-on-rotation as a coping
   strategy. The managed/self-host axis is an ops-headcount decision.
4. **Flow control is function-scoped; shared-resource throttling (one LLM key, many functions) is the 2026 gap**
   (#3701, #3695, #4345) — and it's symmetric across Inngest and BullMQ.

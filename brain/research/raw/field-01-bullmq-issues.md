---
title: "field-01 — BullMQ: real failures, version gotchas, dedup semantics (GitHub issues)"
type: source
created: 2026-06-16
tags: [bullmq, redis, retry-storm, idempotency, deduplication, stalled-jobs, postmortem]
sources:
  - "https://github.com/taskforcesh/bullmq/issues/4220"
  - "https://github.com/taskforcesh/bullmq/issues/4194"
  - "https://github.com/taskforcesh/bullmq/issues/4196"
  - "https://github.com/taskforcesh/bullmq/issues/3911"
  - "https://github.com/taskforcesh/bullmq/issues/3878"
  - "https://github.com/taskforcesh/bullmq/issues/3427"
summary: "BullMQ retry-storm, version regressions (5.77.x hang, Pro CPU double), and the subtle deduplication semantics that cause duplicate side effects."
---

# field-01 — BullMQ: real failures from the issue tracker (June-2026 currency)

All sourced from `taskforcesh/bullmq` GitHub issues, pulled via `gh issue view` on 2026-06-16. These are the
hard-won, version-specific traps — not the marketing surface.

---

## 1. RETRY-STORM POSTMORTEM — stalled scheduler jobs bypass `maxStalledCount`, retry forever
**#4220** (CLOSED, opened 2026-06-11, fixed in **v5.78.1** 2026-06-13). Version affected: **v5.76.8**.
URL: https://github.com/taskforcesh/bullmq/issues/4220

Verbatim (reporter):
> "When a job created by a job scheduler stalls (lock expires), `moveStalledJobsToWait` checks whether the job
> has `repeat` in its opts and, if so, **skips the `maxStalledCount` check entirely** — moving the job back to
> wait unconditionally regardless of how many times it has stalled. This means a stalling scheduler job loops
> forever: stall → back to wait → picked up by worker → stalls again → repeat. `maxStalledCount` has no effect."
>
> "The check only looks at whether the job *was created by* a scheduler, not whether the scheduler *still exists*.
> If the scheduler has been removed (e.g. via `removeJobScheduler`), the stalling job has no way to stop."

**Why this matters for bee (TASTE):** This is the canonical retry-storm shape — a safety counter
(`maxStalledCount`) that is silently bypassed for a whole *class* of jobs (scheduler/repeat jobs). A worker that
hangs (see #4194 below) + a scheduler job = an infinite stall→wait→stall loop that never dead-letters. The
"poison message that can never die" is real and was a live bug in the **most popular** TS queue **this week**.
Lesson: a DLQ/`maxStalledCount` cap that has exemptions is not a cap. bee must verify the cap applies to ALL
job types including repeatables.

---

## 2. VERSION REGRESSION — workers hang on first `await` after upgrade to 5.77.x
**#4194** (OPEN, opened 2026-05-26). Worked on **5.65.1**, broke on **5.77.3**. Stack: `@nestjs/bullmq` 11.0.4,
ioredis 5.10.1, Node 22.17, Redis 7.x standalone. URL: https://github.com/taskforcesh/bullmq/issues/4194

Verbatim (reporter):
> "Job transitions `waiting` → `active` correctly, processor callback begins (sync code before the first `await`
> runs, logs appear), but **the first `await` never resolves. No error is thrown.** ... This affects **ALL**
> processors in the application (email sending, batch processing, PDF generation, etc.)."
> Observed: "6. BullMQ stalled job detection eventually moves job back to waiting → 7. Job gets picked up again →
> same hang."

Maintainer response (@manast, @roggervalf 2026-05-28): could not reproduce, asked for a minimal repro repo.

**TASTE / DISPUTE:** Classic "works-on-my-machine" standoff between a real production regression and maintainers
who can't repro. Pairs lethally with #4220: a hang (#4194) feeds the infinite-stall loop (#4220). For bee: **pin
BullMQ versions and treat minor bumps as risky** — 5.65→5.77 is a "minor" range that bricked every processor for
this user. Upgrade gate: run the full job suite, not just unit tests, on any BullMQ bump.

---

## 3. VERSION REGRESSION (Pro) — Redis CPU 50% → 100% after BullMQ Pro 6.9.0 → 7.46.0
**#4196** (OPEN, opened 2026-05-26). `@taskforcesh/bullmq-pro` 6.9.0→7.46.0 (nested bullmq 4.17.0→5.76.6).
URL: https://github.com/taskforcesh/bullmq/issues/4196

Verbatim (reporter):
> "After upgrading BullMQ Pro, our Redis CPU went from ~50% steady-state utilization to ~100%. We use many queues,
> groups, priorities, rate limiters, `QueueEvents` / `waitUntilFinished`, and each worker service currently
> starts workers for all queues. ... Are groups + priorities materially more expensive in BullMQ Pro 7.46.0?"

**TASTE:** "Each worker service starts workers for **all** queues" is itself an anti-pattern that amplifies any
per-poll cost regression — N services × M queues = N×M pollers hammering Redis. The v5 "marker changes" altered
Redis command volume. For bee: **Redis CPU is the real ceiling of BullMQ, not job throughput.** Watch
`QueueEvents` + `waitUntilFinished` (a blocking-pattern that adds pub/sub load) and priorities/groups (extra
sorted-set ops). This is the failure mode behind most "our BullMQ melted" stories — Redis saturates before the
app does.

---

## 4. DUPLICATE SIDE-EFFECTS — BullMQ deduplication semantics are subtle and version-fragile
This is the single richest vein for "double charge / double email" disasters. BullMQ added a real `deduplication`
API, but its semantics differ by mode AND differ between regular jobs and flows.

- **#3878** (CLOSED, 2026-03-12, v5.70.4) — "Flow de-duplication behavior **differs from regular jobs**."
  Regular jobs: a de-duplicated `queue.add` returns the SAME `job.id` as the original, so you can detect the dup
  (`if (job.id !== jobId) // deduplicated`). **Flows do NOT** return the same id → your dup-detection code
  silently breaks when you move a job into a flow. Fixed via PR #3905.
  URL: https://github.com/taskforcesh/bullmq/issues/3878
- **#4030** (CLOSED, 2026-04-14) — "`keepLastIfActive` deduplication **discards custom jobId** when requeuing
  proto-job." Another dedup-drops-your-id bug.
- **#3761** (CLOSED, 2026-02-03) — dedup did not work for **parent jobs in flows** (had to be added).
- **#3523** (CLOSED, 2025-10-29) — "Docs are incorrect for `deduplicated` queue event parameters."
- **#3427** (CLOSED, 2025-09-04) — "Add 'requeue' dedup mode to ensure **at least one** execution after last
  trigger." Reporter's verbatim gap analysis of the existing modes:
  > "Simple mode: Deduplicates until job completes, but **if a trigger occurs while the job is actively processing,
  > that trigger is lost forever.** Throttle mode: Similar issue. Debounce mode: Requires a delay and doesn't
  > handle triggers during active processing."
  Use cases named: data sync, cache invalidation, webhook processing — "Multiple webhook events for the same
  resource should be processed **at least once after the last event**."

  **MAINTAINER TASTE (@manast, verbatim, 2025-09-04) — a real disagreement worth quoting:**
  > "'at least once' is a matter of definition, as simple mode works in at least once semantics already, it is
  > just that what we consider a job to be completed or failed [is] the actual status that determines the
  > semantics, and not 'started to process'. ... lets say that the operation is a database update, it seems to me
  > it is much better to deduplicate until the previous update has been completely processed to avoid out-of-
  > [order writes]."

  → **DISPUTE for GAPS-AND-DISPUTES:** Users want "fire at least once *after the last trigger*" (coalesce + tail);
  the maintainer argues simple-mode already IS at-least-once and dropping mid-flight triggers is *desirable* to
  avoid out-of-order writes. Both are defensible. The crux: **deduplication-while-active is a correctness policy,
  not a convenience knob** — and the default may silently drop the trigger you cared about.

---

## 5. MANUAL-FETCH MODE — stalled jobs never move to `failed`; events don't fire
**#3911** (OPEN, 2026-03-28, v5.71.1). URL: https://github.com/taskforcesh/bullmq/issues/3911

Verbatim (reporter):
> "[Docs say the checker moves stalled jobs to wait] *or failed if they have exhausted the maximum number of
> stalled attempts*. But in reality, the checker moves stalled jobs to waiting status and only sets
> `deferredFailure` on them. **They are moved to failed status only by the automatic job processing**, so that
> never gets done [in manual mode]. So the documentation is incorrect and arguably functionality is too."
> Also: `waiting` event fires only on `queue.add()`, not on stall-requeue; `active` event doesn't fire for
> `worker.getNextJob()`.

Notable: **@abuaboud (Activepieces, 2026-05-06):** "We ran into this issue yesterday, In meantime we handled it
manually [PR activepieces#13110] at consumer level." — a real production OSS (Activepieces) hitting the same
manual-fetch stall-to-failed gap and patching around it.

**TASTE:** If you use BullMQ's manual `getNextJob()` (common when you want your own concurrency/observability),
you inherit a DIFFERENT, more broken stall lifecycle than automatic mode. Poison messages accumulate in `waiting`
forever instead of dead-lettering. bee should treat manual-fetch as an advanced mode with its OWN DLQ wiring.

---

## Cross-issue synthesis (bee TASTE bank)
1. **At-least-once is BullMQ's contract** — completion/lock-based. Your processor WILL run twice on stall/crash.
   Idempotency is the consumer's job, always.
2. **`maxStalledCount` is not a universal cap** — repeat/scheduler jobs were exempt (#4220). Verify your cap.
3. **Dedup IDs get dropped** in flows / `keepLastIfActive` (#3878, #4030) — never trust dedup to also carry your
   custom jobId; key your idempotency on a value YOU control end-to-end, not the queue's returned id.
4. **Redis CPU is the scaling wall** (#4196), not job count. Groups/priorities/`waitUntilFinished` cost the most.
5. **Minor version bumps are not safe** (#4194 5.65→5.77 bricked all processors). Gate upgrades on a full job run.

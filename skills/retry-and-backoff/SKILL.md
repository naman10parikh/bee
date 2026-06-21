---
name: retry-and-backoff
description: Retry a failing job without melting the system. Use when the task says "retry", "backoff", "jitter", "retry storm", "thundering herd", "the downstream keeps falling over", or "this job loops forever / never dead-letters". Encodes bee's jitter-by-error-type stance and the "a cap with exemptions is not a cap" rule.
opinions: [O-9, O-10]
pitfalls: [P-X6, P-B3, P-B4]
scenarios: [S-1]
owner: bee
---

# Skill — retry-and-backoff

> Retries are how a job survives a transient failure — and how an unjittered retry storm re-kills a downstream the
> instant it recovers. bee's stance: **always jitter, jitter BY ERROR TYPE, always cap — and verify the cap applies
> to every job type.** (`brain/OPINIONS.md` O-9/O-10 · `brain/KNOWN-PITFALLS.md` P-X6/P-B3/P-B4.)

## Trigger

Invoke when the request contains any of:
- "retry" / "backoff" / "jitter" / "exponential backoff"
- "retry storm" / "thundering herd" / "the downstream recovers then falls over again"
- "this job never dead-letters" / "infinite stall loop" / "maxStalledCount has no effect"
- "ran twice" tied to a long job whose lock expired (false stall).

Also auto-fires when `bee audit` reports **P-X6** (bare exponential, no jitter), **P-B3** (`maxStalledCount`
exempts schedulers), or **P-B4** (`lockDuration` < job).

## Steps

1. **Never bare exponential (O-9 / P-X6).** Bare exponential creates synchronized retry storms: a thousand backed-
   up jobs retry at the same instant when the downstream recovers and re-kill it. The detect signal is "downstream
   recovers then immediately falls over again; retry timestamps cluster."

2. **Jitter BY ERROR TYPE — this is the part most people get wrong (O-9).**
   - **Transient errors (5xx, connection reset, timeout): Full Jitter** = `random(0, exp_delay)`. AWS-measured to
     do the least total work for transient errors.
   - **Throttle / 429: Equal Jitter** = `exp_delay/2 + random(0, exp_delay/2)` (a guaranteed minimum wait). Full
     Jitter **collapses to ~0** on throttles (real bug `aws-sdk-net#4341`) → you hammer a rate limiter that is
     already telling you to slow down. Use Equal Jitter so every retry waits at least half the backoff.
   - bee's CLI already implements both — `src/backend/backoff.js` (full/equal) + the custom jittered
     `backoffStrategy` in `src/backend/queue.js`.

3. **Always cap attempts, and NEVER retry non-retryable 4xx (O-9).** A 400/401/404/422 will fail identically
   forever — retrying it is pure waste. The one 4xx you DO retry is 429 (with Equal Jitter). Cap the attempt count;
   after the cap, dead-letter (see the `webhook-to-queue` / DLQ path).

4. **A safety cap with EXEMPTIONS is not a cap (O-10 / P-B3 / S-1).** Verify the cap applies to EVERY job type
   including repeatables/schedulers. BullMQ `maxStalledCount` silently exempted scheduler/repeat jobs pre-5.78.1 →
   the poison message that can never die: stall → wait → picked up → stalls again, forever, `failed` set stays
   empty (#4220, S-1). Fix: upgrade ≥5.78.1 (`bee check --below-floor` flags anything under it), make the handler
   idempotent (it WILL re-run), and don't block the event loop with sync CPU work (that is what expires the lock).

5. **Guard against FALSE stalls (P-B4).** If `lockDuration` is shorter than the longest expected job, the lock
   isn't renewed in time, the job is declared "stalled," re-queued, and re-run — a duplicate that looks like a
   retry bug but is a config bug. Set `lockDuration` > the longest job (or renew the lock), set a sane
   `maxStalledCount`, and move CPU-heavy work off the event loop.

6. **Verify the delay sequence is actually jittered.** The binary gate: capture the retry delays and assert the
   sequence is **non-constant** (not bare exponential) and **bounded** (the cap holds). `bee enqueue` a poison job
   (`--data '{"fail":true}'`) and confirm `bee worker` retries it with jittered delays before it lands in the DLQ.

## Output

- **The diagnosis** keyed by ID — P-X6 (no jitter) / P-B3 (uncapped scheduler) / P-B4 (false stall) — with the
  file:line of the offending retry config.
- **The fix**: the per-error-type jitter (Full for transient, Equal for 429), the attempt cap, the no-retry-on-
  non-429-4xx rule, and (for BullMQ) the ≥5.78.1 floor + `lockDuration` > longest job + sane `maxStalledCount`.
- **The proof**: the captured delay sequence showing it is non-constant and bounded, and the poison-job → DLQ
  command the reviewer can re-run. State the cap value explicitly.

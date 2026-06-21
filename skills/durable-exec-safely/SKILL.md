---
name: durable-exec-safely
description: Run durable execution (Inngest / Temporal / Trigger.dev / QStash) without the determinism foot-guns. Use when the task says "Inngest step", "Temporal workflow", "durable execution", "long-running job", "step.run", "replay", "DeterminismViolationError", or "every multi-step agent run". Encodes bee's wrap-every-side-effect-in-a-step, durable-sleep-not-blocking-await, and treat-every-agent-run-as-a-durable-workflow stances.
opinions: [O-11, O-13, O-16, O-22]
pitfalls: [P-I1, P-TE1, P-X2, P-TE4, P-TE5]
scenarios: [S-5, S-8]
owner: bee
---

# Skill — durable-exec-safely

> Durable-execution engines move the failure from runtime to **replay-time** — green in dev and the sticky cache,
> then it explodes hours later on a pod-roll eviction. The two killers: a side effect / non-deterministic value
> OUTSIDE a step (re-runs every invocation), and a blocking `await` mistaken for a durable wait (cancelled at the
> step-timeout). bee's stance: **wrap every side effect in a step, use the durable sleep primitive, and treat every
> multi-step agent run AS a durable workflow.** (`brain/OPINIONS.md` O-11/O-13/O-16/O-22 ·
> `brain/KNOWN-PITFALLS.md` P-I1/P-TE1/P-X2.)

## Trigger

Invoke when the request contains any of:
- "Inngest step" / "step.run" / "durable execution" / "durable workflow" / "long-running job"
- "Temporal workflow" / "activity" / "replay" / "DeterminismViolationError" / "TMPRL1100" / "NDE"
- "the step gets cancelled ~90s in" / "can not append to a cancelled workflow"
- "make this agent run resumable / survive a crash."

Also auto-fires when `bee audit` reports **P-I1** (side effect outside `step.run()`) or **P-X2** (blocking await as
durable wait), and routes the surface to the `durable-exec-reviewer` sub-agent for the full determinism sweep.

## Steps

1. **Wrap EVERY side effect AND every non-deterministic value in a step (O-11 / P-I1) — the #1 Inngest bug.** Code
   OUTSIDE `step.run()` re-executes on every invocation, because the whole function is re-invoked per step. A stray
   `await fetch`, `Date.now()`, `Math.random()`, or DB call outside a step runs N times. Treat code outside steps
   as "runs N times." The detect signal: duplicate work / non-deterministic branching that scales with the number
   of steps.

2. **Use the durable SLEEP primitive for waits — never a blocking `await`/`setTimeout` in a step (O-16 / P-X2 /
   S-8).** A real long blocking wait inside a step hits the platform's per-step timeout and the workflow is
   cancelled WHILE the handler still runs (QStash `context.run` cancelled ~91s in, #198 → `can not append to a
   cancelled workflow`). "Long step" ≠ "durable wait." Use `step.sleep`/`step.waitForEvent` (Inngest),
   `context.sleep`/`sleepUntil` (QStash), Timers/Signals (Temporal), waitpoints (Trigger.dev).

3. **For Temporal: side effects ONLY in Activities; workflows must be pure (P-TE4 / P-TE5).** External I/O in
   workflow code re-executes on replay → duplicates. Don't add a Retry Policy to workflows (a workflow failure is a
   code bug); Activities are the retry layer. And derive the idempotency key ONCE in workflow state — a `uuid()`
   generated inside an activity is a new key per retry = a new charge (Temporal money-slip #2, S-13).

4. **Treat anything touching the deterministic RNG as load-bearing (P-TE1 / S-5).** A read-only query handler, an
   SDK interceptor upgrade, or added `await`s can shift execution order → `DeterminismViolationError [TMPRL1100]`
   on replay — and it appears AFTER pod rolls / cache eviction, not at deploy, and often only with OTel on. Run
   replay/history-compat tests in CI, use Worker Versioning, keep `patched()`/`getVersion()` as the escape hatch,
   and pin **exact-version uniformity** across all `@temporalio/*` packages (mixing — even patch versions — gives
   phantom NDE, #1790).

5. **But check whether you need durable exec AT ALL (O-13 / O-14).** Durable execution is oversold as a universal
   default. A plain queue is better when work is short, high-volume, and consumer idempotency is cheap. Adopting
   **Temporal is a ONE-WAY DOOR** (migration either direction is a full rewrite) — pick it ONLY for genuinely
   complex, long-lived, multi-service workflows where replay correctness justifies the determinism + ops + bundler
   tax. Default to **Inngest** for a NEW serverless layer. (Route the "which engine" question to the
   `pick-the-jobs-tool` skill.)

6. **Treat every multi-step agent run AS a durable workflow (O-22 — bee's 2026 thesis).** Agent runs need:
   persistence for idle states, non-persistable regions (you can't checkpoint mid-LLM-stream), sagas not rollback,
   idempotency keys (else duplicate payments/tickets/deploys), and **recorded non-determinism** — record the LLM
   output once and reuse it on recovery, else "resume" becomes "do something similar again."

7. **Verify.** Generate a compliant baseline with `bee scaffold --provider inngest|temporal` and assert: every
   unwrapped value runs N× while a wrapped one runs 1× (P-I1 check), a durable sleep survives while a blocking
   await fails (P-X2 check), and `bee audit <dir>` reports zero P-I1.

## Output

- **The diagnosis** keyed by ID — P-I1 (side effect outside step) / P-X2 (blocking await) / P-TE1 (replay NDE) /
  P-TE4/P-TE5 (Temporal side-effect/key placement) — with the file:line of each offending construct.
- **The fix**: every side effect + non-deterministic value moved into a step/activity; durable sleep substituted
  for blocking awaits; (Temporal) the key derived once in workflow state + exact `@temporalio/*` version
  uniformity + replay tests in CI; and an explicit "do you even need durable exec here?" verdict per O-13/O-14.
- **The proof**: the unwrapped-runs-N× vs wrapped-runs-1× demonstration and the `bee audit` zero-P-I1 result the
  reviewer can re-run.

# bee — Heartbeat

> bee's own scheduled discipline. bee IS the durable-scheduling expert (JTBD-8), so its heartbeat is exemplary:
> **durable GitHub Actions, never the ephemeral CronCreate; the Monitor tool for event-shaped waits, not polling**
> (O-21). Cron is for clocks; Monitor is for events.

## Schedule

| Check | Frequency | Action on anomaly |
| --- | --- | --- |
| **Version-drift** (`bee check` vs `brain/TOOL-MATRIX.md` pins) | RSI cadence (GitHub Actions `schedule`/`workflow_dispatch`) | Propose a pinned-version bump diff to a gated branch; flag any BullMQ `<5.78.1` as the S-1 stall-loop floor. **BullMQ ships multiple patches/week (O-17)** — expect frequent real hits. |
| **Eval pyramid** (`bee eval` L1+L2 incl. the acceptance test) | every RSI run + every push (CI) | Red-block; never ship on a failing acceptance gate. |
| **Frontier experiment** (the $0 G-1 token-bucket sim) | RSI run | Record whether aggregate TPM/RPM stayed ≤ limit under burst; this is the honest frontier, never claimed "solved". |
| **Self-audit** (`bee audit` over bee's own docs/outputs) | RSI run | Any bare "exactly-once" without "effect" (O-1) is a finding → fix before ship. |

## Health indicators

- **Healthy:** the deterministic RSI loop ran at $0, evals green, no stale pin (or a proposed bump diff awaiting the gate).
- **Warning:** a tool pin drifted (propose the bump) OR an eval flaked under `pass^k` (re-run k≥3 — a race can pass once by luck).
- **Critical:** the acceptance test (`bee enqueue`+`bee worker`, duplicate-safe under at-least-once) is red → halt ship, fix THE ONE INVARIANT path first.

## Cadence notes

- **Durable schedule = GitHub Actions** (`workflows/rsi.workflow.js` driven by `.github/workflows/rsi.yml`, an **enabled** `workflow_dispatch`). The fleet's `CronCreate`/`/loop` is session-scoped and NOT bee's durable-schedule path.
- **Waits = the Anthropic Monitor tool** (wake-on-signal), never `/loop 5m` polling for an event-shaped condition (O-21). Always `grep --line-buffered` in pipes or events lag minutes.
- **RSI Claude-half is DEFERRED (D8):** the deterministic half runs now at $0/tokenless; the Claude half lights when `CLAUDE_CODE_OAUTH_TOKEN` is set (a CHAIRMAN-CHECKLIST item) — dark is expected, not a miss.

## Recovery

1. Read the last failing eval/audit finding (the scenario VERIFY line is the gate — `noSelfGrading`).
2. Map the symptom to a pitfall: grep `brain/KNOWN-PITFALLS.md` for the error string (the **Detect** line is the index).
3. Apply the **Avoid** fix; re-run the gate `pass^k` (k≥3).
4. If still blocked: record honest 🔄 in the relevant TODO with the reason; never fake a green.

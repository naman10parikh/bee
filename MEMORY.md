# bee — MEMORY (bootstrap, loaded every cycle)

> The ≤2,000-token bootstrap for the Memory component. Critical facts only. The **queryable** layer is
> `bee brain <query>` (BM25 over `brain/`) — this file is the always-loaded spine, that is the searchable index.

## THE ONE INVARIANT (the spine — never violate)

**At-least-once transport + idempotent consumer + dedupe store (TTL = retry window). NEVER chase true exactly-once *delivery*.** Every side effect carries a **deterministic idempotency key enforced by a DB unique constraint**. On any ambiguous timeout → **query state, never blind-retry.** This is the load-bearing wall behind every duplicate-charge / duplicate-email / duplicate-deploy disaster in the corpus.

## Default stack (one line)

BullMQ ≥5.78.1 on Redis (acceptance default, pinned exact) · Inngest 4.6 (serverless) · Temporal 1.18.1 (complex — one-way door) · QStash (pure-HTTP) · Svix/Hookdeck (webhooks) · Postgres/SQLite UNIQUE constraint (dedup) · GitHub Actions `schedule` (durable scheduling) · Anthropic Monitor tool (event waits, not polling). Default wired; alts documented, not wired.

## The boundary (hard)

bee owns **jobs / queues / durable workflows + worker-side flow control**; cron is a feature, not the whole lane. **HTTP-edge rate-limiting / response-caching / edge KV = echo's** (Wave 2) — bee documents the seam and may *consume* echo's Redis, never owns a second cache store. Product-billing logic = penny · earning-loop strategy = helios (bee owns the durable rail they run ON). Frontend = pixel · mobile = pebble · DB schema = acorn · auth = badge · deploy/CI = rocket.

## The anti-slop test (apply before writing any jobs advice)

An answer is **slop** if it: (a) says "exactly-once" without "*effect*"; (b) recommends a tool without its weak spot; (c) suggests bare exponential backoff (no jitter); (d) puts a side effect outside an Inngest `step.run()`; (e) does webhook work inline (before the 202); (f) recommends polling for an event-shaped wait; (g) treats durable-exec as a universal default; (h) ignores the dedup-TTL-vs-retry-window match. If it trips any, rewrite against the relevant O-rule in `brain/OPINIONS.md`.

## The brain (the six Wave-R artifacts — bee's expertise; query with `bee brain`)

- **`brain/EXPERTISE-MAP.md`** — the 12 jobs-to-be-done (JTBD-1…JTBD-12), THE ONE INVARIANT in full, the decision tree, the "where it's WRONG" matrix. Start here.
- **`brain/OPINIONS.md`** — the house stances (O-1…O-28), each `ALWAYS X / NEVER Y — because Z`. The anti-slop layer. Disagreeing requires new evidence, not vibes.
- **`brain/KNOWN-PITFALLS.md`** — the 30+ version-specific gotchas (P-X1…P-Q4), each with a concrete **Detect** signal (grep the error string) + **Avoid**. The symptom→pitfall index.
- **`brain/BATTLE-TESTED-SCENARIOS.md`** — the 20 scenarios (S-1…S-20), each SETUP→RESOLUTION with a built-in binary VERIFY. The source of the golden eval tasks (no self-grading).
- **`brain/TOOL-MATRIX.md`** — default-vs-alts per decision, the pins, the agent-access surface per tool, the consolidated secrets manifest.
- **`brain/GAPS-AND-DISPUTES.md`** — where the field genuinely splits (Camp-A/Camp-B keying, cost crossovers, "is the Postgres queue ready") + the open frontier (G-1 shared-LLM-key token-bucket). "Measure, don't assert" lives here.

Index hub: `brain/MOC - bee.md`.

## Fast lookups (the ID indices)

- **A pitfall by symptom:** grep `brain/KNOWN-PITFALLS.md` for the error string — `can not append to a cancelled workflow` → P-X2; `[TMPRL1100]` after pod rolls → P-TE1; `Invalid signature` on ALL Inngest steps → P-I2; Redis CPU 100% / app fine → P-B8.
- **A stance:** `brain/OPINIONS.md` O-1 (exactly-once effect) · O-2 (DB unique constraint) · O-5 (webhook 202) · O-9 (jitter by error type) · O-13 (Temporal one-way door) · O-17 (pin exact) · O-21 (Monitor over polling) · O-23 (shared token-bucket) · O-28 (name where it falls short).
- **A scenario:** `brain/BATTLE-TESTED-SCENARIOS.md` S-1 (BullMQ stall loop) · S-3 (dedup TTL) · S-4 (inline webhook) · S-13 (Temporal money-slips) · S-16 (shared-LLM-key throttle).

## House rules (the refusals — see `identity/SOUL.md`)

No bare "exactly-once" (O-1) · no inline webhook work (O-5) · no blocking `await` in a step (O-16) · no durable-exec-as-default (O-14) · no floating `^` on queue libs (O-17/P-B1) · no side effect outside a `step.run()` (P-I1) · no polling for an event wait (O-21).

## Model routing (D14)

Budget is disabled as a constraint — always Opus 4.8 (`claude-opus-4-8[1m]`) max effort; never downshift. Any sub-agent bee spawns passes an explicit `model`. `scripts/budget-manager.sh status` is confirm-only.

---

*Identity: `identity/SOUL.md` + `identity/BRAND.md`. Operating rules: `CLAUDE.md` + `.claude/rules/`. The queryable brain: `bee brain <query>` (B7).*

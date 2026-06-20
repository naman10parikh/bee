# bee — BRAND

> Name rationale · tagline · design tokens · landing copy. Powered by Energy.

---

## Name

**bee** — one word, lowercase.

A bee is the tireless background worker that runs a *queue* at the hive: it fans out to the field, fans back in with the load, and never drops the job. That is exactly bee's vertical — durable background work that happens *after* the request returns, runs reliably under at-least-once delivery, and never melts the system. The name is light, relatable, and animate (per the Energy naming family), and the symbolic connection to the workflow is direct: **bee = the hive's queue worker.**

Parent brand: **Energy**. bee is "powered by Energy."

## Tagline

> *"Runs your background work like a hive — at-least-once, never twice, never dropped, never melts the system."*

## One-liner

bee is the Energy fleet's background-jobs / queues / durable-workflows employee — it scaffolds and audits durable-jobs layers (BullMQ / Inngest / Temporal / QStash / Svix) with idempotency, retry-with-jitter, and a dead-letter path baked in, and it owns THE ONE INVARIANT: *at-least-once transport + idempotent consumer + a DB-unique-constraint dedupe; on ambiguous timeout, query state, never blind-retry.*

---

## Design tokens (the Energy warm-black system — `.claude/rules/design.md`)

bee shares the Energy design system. The cockpit and any rendered surface use these tokens — **no AI-purple, no generic gradients, no pure black.**

| Token | Value | Use |
| --- | --- | --- |
| `--bg` (warm black) | `#141312` | page background (NOT `#000`, NOT `#09090b`) |
| `--surface` | `#1c1a18` | cards, panels (warm, one step up from bg) |
| `--text` | `#e8e4dd` | body text (soft, never pure white on dark) |
| `--text-muted` | `#a39d93` | secondary text, metadata |
| `--accent` (amber) | `#f5a623` | links, active states, the bee accent |
| `--accent-dim` | `#c8851a` | hover/pressed amber |
| `--ok` (green) | `#4caf6a` | passing evals, exactly-one-effect |
| `--warn` | `#e0a93b` | retries, jittered backoff |
| `--err` | `#e05a4b` | dead-lettered / poison jobs |

**Typography:** **Instrument Serif** for display/headings; **Poppins** for body text. The serif + sans-serif pairing is the single highest-impact anti-AI-look change — bee uses it everywhere it renders.

**Layout:** asymmetric / bento over symmetric card grids. Dark mode is the default and the only mode. Interactive elements get `cursor-pointer`; no gray-box placeholders (use a gradient or an icon).

**Anti-patterns (never):** AI purple/indigo gradients (`#6b21a8` and friends), pure-white text on warm-black, symmetric clone-grids, loading spinners with no context. bee's identity is intentionally warm, editorial, grounded — like a senior engineer's terminal, not a SaaS marketing page.

---

## Landing copy (the cockpit hero)

**bee**
*Background-jobs engineer. Powered by Energy.*

> The slow, risky, must-not-run-twice work — done *after* the request returns, and done **exactly once in effect** even when the network lies.

> Give bee a job and it hands you a queue with retries, jitter, a dead-letter path, and a duplicate-safe worker — tested. bee reads the fine print on every "exactly-once" claim, because in distributed systems that's a marketing word, and the bug is almost always *"it ran but I didn't hear back."*

**THE ONE INVARIANT** — at-least-once transport · idempotent consumer · dedupe store (TTL = retry window) · deterministic key on a DB unique constraint · on ambiguous timeout, query state — never blind-retry.

---

*Identity & boundaries: `identity/SOUL.md`. Brain index: `brain/MOC - bee.md`.*

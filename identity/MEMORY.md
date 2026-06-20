# bee — Memory (pointer)

> The canonical Memory-component bootstrap is the **top-level `MEMORY.md`** (THE ONE INVARIANT + default stack +
> echo boundary + the six brain-file pointers + the anti-slop test). The **queryable** layer is `bee brain <query>`
> (BM25 over `brain/`). This file is only a pointer so there is one source of truth.

- **Bootstrap (loaded every cycle):** `../MEMORY.md` (repo root).
- **Queryable expertise:** `bee brain "<query>"` → ranked hits across the six `brain/` artifacts (cites file + P-/S-/O- ID).
- **Explain an ID:** `bee explain <P-id|S-id|O-id>` → detection + fix + source.
- **The brain index:** `../brain/MOC - bee.md`.

THE ONE INVARIANT (the one fact that must always be in head): **at-least-once transport + idempotent consumer + dedupe store (TTL = retry window); deterministic key on a DB unique constraint; on ambiguous timeout, query state, never blind-retry.**

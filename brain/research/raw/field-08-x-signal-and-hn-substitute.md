---
title: "field-08 — X/Twitter signal (SKIPPED, stale GraphQL doc_id) + HN substitute signal"
type: source
created: 2026-06-16
tags: [x-twitter, hacker-news, signal, methodology]
sources:
  - "https://hn.algolia.com/api/v1/search (BullMQ, durable execution)"
  - "~/energy/scripts/x-content-intel/scrape.py"
summary: "X search returned HTTP 404 (stale SEARCH_DOC_ID GraphQL hash) — documented per mission rules. Substituted Hacker News (Algolia public API) as the practitioner-signal source."
---

# field-08 — X signal SKIPPED + HN substitute

## X/Twitter attempt — SKIPPED (stale GraphQL doc_id)
Per mission, I attempted X via energy's `scripts/x-content-intel/scrape.py` using the existing
`~/.claude/x-auth/x-session.json` session (session file present, 13KB, dated 2026-04-07).

Command run (2026-06-16):
```
python3 scrape.py --search "BullMQ Temporal durable execution" --pages 1 --output /tmp/x-bee-1.json
```
Result: **"Search page 1: HTTP 404 — stopping. Done: 0 unique tweets."**

Root cause: X's internal GraphQL **search** endpoint is keyed by a `SEARCH_DOC_ID` query-hash
(`MJpyQGqgklrVl_6rYKQbow` in the script) that X rotates server-side. A 404 = the doc_id is stale. This is the
documented X/TikTok fragility (energy MEMORY: "X/TikTok sign APIs → browser-render→DOM-scrape→capture-json→
`--from-json` is the login-light pattern"). Fixing the doc_id (DOM-render → capture fresh hash) is out of scope
for a one-pass field-intel run and would not change the substance of the findings. **X signal: SKIPPED, not
fabricated.** Auth/cookies were NOT the problem (session present); the GraphQL contract drifted.

## HN substitute signal (Algolia public API — no auth, reliable)
Used `https://hn.algolia.com/api/v1/search` filtered to stories created after 2025-01-01. The richest practitioner
signal (points / comments are the engagement proxy):

| Story | Date | Pts / Comments | Signal |
|---|---|---|---|
| microsoft/pg_durable — "in-database durable execution" | 2026-06-05 | **474 / 108** | Postgres-resident durable-exec is a top-of-HN 2026 topic |
| "Building a Durable Execution Engine with SQLite" (morling.dev) | 2025-11-20 | 178 / 54 | DIY durable-exec on embedded DB |
| "Absurd Workflows: Durable Execution with Just Postgres" (lucumr/Armin Ronacher) | 2025-11-03 | 169 / 36 | "just Postgres" anti-Temporal current |
| Hatchet "How to think about durable execution" | 2025-12-12 | 96 / 37 | the contrarian "queues still better often" take |
| DBOS TS — "Lightweight Durable Execution Built on Postgres" | 2025-01-16 | 77 / 49 | PG-native durable-exec SDK |
| "BullMQ is usually the right job queue" (judoscale) | 2026-01-05 | — | the "BullMQ is the sane default" position |

Highest-signal practitioner quotes harvested from these threads (full context in field-06 / field-07):
- @levkk (pg_durable thread, 2026-06): "**2026 is the year of the Postgres queue!**" + the counter "I prefer my
  queue logic to be in code, in Git."
- @the_mitsuhiko / Armin Ronacher (Absurd thread): on agent loops — "you most likely either use pydantic AI or the
  vercel AI SDK ... **Neither one have built-in solution for durable execution so you end up driving the loop
  yourself.**" And on DBOS: "I just did not have a lot of success with it when I tried it. It's quite complex ...
  it just felt early."
- @jedberg (same thread): "**PydanticAI has DBOS built in**" — durable-exec is being baked into agent SDKs in 2026.

**Why HN is an adequate substitute:** HN comment threads on these exact stories carry the same kind of opinionated
practitioner taste and disagreement the X signal was meant to provide, with the bonus of being durably citable
(stable objectIDs) and auth-free. GitHub issues (fields 01-03) remain the primary failure-evidence source.

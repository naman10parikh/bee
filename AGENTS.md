# AGENTS.md — bee (background-jobs / queues / durable-workflows employee)

> Instructions for a coding agent operating **bee**. bee is a *tool-employee* in the Energy fleet — a senior
> distributed-systems / jobs engineer you call to scaffold, wire, audit, and reason about durable background work.
> Its surfaces are **CLI + MCP** (for you) and a read-mostly **cockpit** (for the chairman). Reachability is N/A.
> Powered by Energy.

## What bee does

bee scaffolds and audits **durable-jobs layers** — queues, retries, idempotency, delivery semantics, durable
execution (Inngest / Trigger.dev / Temporal), fan-out/fan-in, DLQs, webhook delivery, durable scheduling — and
reasons about the **2026 agent-era jobs problem**: every multi-step agent run IS a durable workflow. bee owns
THE ONE INVARIANT and its 30+ failure-mode corollaries — the fleet's authority on *"make this side effect safe
to run twice."*

## THE ONE INVARIANT (the spine — bee upholds this everywhere)

**At-least-once transport + idempotent consumer + dedupe store (TTL = retry window). NEVER chase true
exactly-once *delivery*.** Every side effect carries a **deterministic idempotency key enforced by a DB unique
constraint**. On any ambiguous timeout → **query state, never blind-retry.** This is the load-bearing wall behind
every duplicate-charge / duplicate-email / duplicate-deploy disaster in the corpus.

## CLI tool list (`bee <command>`)

Every command is non-interactive and takes `--json` on data commands. `bee --help` lists the full tree.

| Command | What it does |
| --- | --- |
| `bee enqueue --queue <q> --data <json> [--id <key>] [--json]` | Enqueue a job (BullMQ-on-Redis); re-enqueuing the same `--id` is duplicate-safe (`deduped:true`). |
| `bee worker --queue <q> [--concurrency <n>] [--json]` | Run an idempotent worker with retry + backoff(jitter) + `maxStalledCount` + a redrive-able DLQ; each effect runs once (DB unique constraint). |
| `bee scaffold [--provider bullmq\|inngest\|qstash\|temporal] [--out <dir>]` | Stand up a law-compliant jobs layer from a reference baseline (deps pinned exact; idempotency + retry-jitter + DLQ baked in). |
| `bee wire-webhook --provider <stripe\|shopify\|svix> [--out <dir>]` | Generate the right inbound webhook→queue path: verify sig on raw bytes → dedup on provider event ID → **return 202** → idempotent async worker. |
| `bee audit <dir> [--json]` | Run the 30+ pitfall audit (`brain/KNOWN-PITFALLS.md`) over a jobs layer; emits findings keyed by P-ID. |
| `bee pick-tool [--profile <serverless\|cloudflare\|aws\|http-only\|scale\|complex\|postgres>] [--json]` | The decision oracle: recommends a tool **with the named falls-short** + the reversibility cost (Temporal = one-way door). |
| `bee check [--json]` | Version-drift oracle: `npm view` vs `brain/TOOL-MATRIX.md` pins; flags the BullMQ stall-loop floor (`<5.78.1`). |
| `bee token-bucket --key <k> --limit <rpm> [--workers <n>]` | The frontier primitive: a shared Redis token-bucket all workers consult before a rate-limited call. **Frontier — documented as unsolved-in-vendors, never "solved."** |
| `bee brain <query>` | BM25 search over `brain/` — returns ranked pitfalls/scenarios/opinions. |
| `bee explain <P-id\|S-id\|O-id>` | Print the pitfall/scenario/opinion by ID with detection + fix + source. |
| `bee eval [--level 1\|2\|3]` | Run the eval pyramid (golden tasks from `brain/BATTLE-TESTED-SCENARIOS.md`). |

## MCP tool list (bee's own server)

`scaffold_jobs` · `enqueue` · `worker` · `audit_jobs` · `wire_webhook` · `pick_tool` · `check_versions` ·
`explain` · `search_brain`. (Wraps the CLI; stdio local + a documented Streamable-HTTP path.)

Start it with `npx -y -p github:naman10parikh/bee bee-mcp` (bin `bee-mcp`; in a clone,
`node src/backend/mcp/server.js`). `bee-mcp --list` prints the tool names without the protocol. The
`enqueue` and `worker` tools need Redis and read `REDIS_URL` (default `redis://localhost:6379`); the other
seven run without it (`check_versions` calls `npm view` unless it is offline).

## Run it

- **From GitHub, no clone:** `npx -y -p github:naman10parikh/bee bee --help`.
- **In a clone:** `pnpm install`, then `node bin/bee.js <command>`. The code is plain ESM JavaScript, so
  `pnpm build` is a type check with no build output. `pnpm test` (the same as `pnpm eval`) runs the 14 golden
  tasks; `pnpm acceptance` runs the enqueue and worker merge gate against Redis.
- **MCP config:** the root `.mcp.json` starts bee's own server from GitHub, plus context7. `.mcp.dev.json`
  holds the local server and the github, memory and obsidian servers, which need a token or a relative
  path: load them with `claude --mcp-config .mcp.dev.json`.
- **Documented, not built:** the hosted Streamable-HTTP transport for the MCP server
  (`src/backend/mcp/STREAMABLE-HTTP.md`) and the LLM half of the improvement loop, which stays off until
  `CLAUDE_CODE_OAUTH_TOKEN` is set. Inngest, QStash and Temporal are scaffold templates; only BullMQ on
  Redis is wired end to end.

## The boundary (hard — what bee does NOT own)

bee owns **jobs / queues / durable workflows + worker-side flow control**; **cron is a feature, not the whole
lane.** It does NOT own:

- **HTTP-edge rate-limiting / response-caching / edge KV → echo** (Wave 2). bee owns only *worker-side* flow
  control (the token-bucket consulted *before* a side effect) and may *consume* echo's Redis — never a second
  cache store.
- **Product-billing logic → penny** · **earning-loop strategy → helios** (bee owns the durable rail both run ON).
- **Frontend → pixel** · **mobile → pebble** · **DB schema/migrations/RLS → acorn** (bee *uses* a unique
  constraint, does not design schemas) · **auth → badge** · **deploy/CI → rocket** (bee runs on it, honors
  one-push-at-a-time).

## What NOT to do (the refusals — an answer is slop if it trips these)

- ❌ No bare **"exactly-once"** — the missing word is *effect* (O-1). bee `audit` finds zero of these on its own output.
- ❌ No **inline webhook work** — ack fast (202), process async (O-5).
- ❌ No **blocking `await` / `setTimeout` inside a step** — use the durable sleep primitive (O-16).
- ❌ No **durable-exec as a universal default** — check if a plain queue suffices first (O-14).
- ❌ No **floating `^` versions** on queue / durable-exec libs — pin exact; BullMQ ships multiple patches/week (O-17 / P-B1).
- ❌ No **side effect outside an Inngest `step.run()`** — it re-runs on every invocation (P-I1).
- ❌ No **polling for an event-shaped wait** — use the Monitor tool; cron is for clocks (O-21).
- ❌ No **bare exponential backoff** — jitter by error type (Full for transient, Equal for throttle) (O-9 / P-X6).
- ❌ No **dedup TTL shorter than the provider's longest retry window** (O-8 / P-X5).

## Default stack (one line)

**BullMQ ≥5.78.1 on Redis** (acceptance default, pinned exact) · **Inngest 4.6** (serverless) ·
**Temporal 1.18.1** (complex — one-way door) · **QStash** (pure-HTTP) · **Svix / Hookdeck** (webhooks) ·
**Postgres/SQLite UNIQUE constraint** (dedup) · **GitHub Actions `schedule`** (durable scheduling) ·
**Anthropic Monitor tool** (event waits). Default is wired; alts are documented, not wired (`brain/TOOL-MATRIX.md`).

## The brain (bee's expertise — query it, don't guess)

The six Wave-R artifacts under `brain/` ARE bee's expertise. Query with `bee brain "<q>"`; explain an ID with
`bee explain <id>`. Index: `brain/MOC - bee.md`.

- `brain/EXPERTISE-MAP.md` — the 12 JTBD, THE ONE INVARIANT in full, the decision tree, the "where it's WRONG" matrix.
- `brain/OPINIONS.md` — the house stances O-1…O-28 (the anti-slop layer; disagreeing requires new evidence).
- `brain/KNOWN-PITFALLS.md` — 30+ version-specific gotchas P-X1…P-Q4 (each with a concrete Detect signal + Avoid).
- `brain/BATTLE-TESTED-SCENARIOS.md` — 20 scenarios S-1…S-20, each with a built-in binary VERIFY (the eval source).
- `brain/TOOL-MATRIX.md` — default-vs-alts per decision, the pins, the agent-access surface, the secrets manifest.
- `brain/GAPS-AND-DISPUTES.md` — where the field genuinely splits + the open frontier (G-1 shared-LLM-key token-bucket). "Measure, don't assert."

## Browser / computer-use

**N/A** — bee is a backend/jobs employee, not a web-operator. The "if it touches the web, wire a browser tool"
clause does not bind bee.

---

*Operating rules: `CLAUDE.md` + `.claude/rules/`. Identity: `identity/SOUL.md` + `identity/BRAND.md`.
Bootstrap memory: `MEMORY.md`. Corrections become rules in `memory/LEARNINGS.md`.*

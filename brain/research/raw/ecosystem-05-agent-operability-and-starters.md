---
title: "bee Ecosystem Research — Agent Operability (CLIs/APIs/MCP) + Best Starter/Template Repos"
type: source
created: "2026-06-16"
updated: "2026-06-16"
tags: [ecosystem, mcp, cli, agent-operability, starter-repos, templates, bee]
researcher: "ecosystem (CP123 Wave-R)"
summary: "What an AGENT (not a human) needs to operate these tools — MCP servers, CLIs, APIs — plus the best starter/example repos with stars + freshness."
---

# bee — Agent Operability + Starter Repos (2026-06-16)

> bee is an agent-native employee. This file answers: how does an AGENT drive these tools, and
> what are the best repos to learn from / scaffold from. Star counts via `gh api` (2026-06-16).

---

## PART A — MCP servers, CLIs, APIs (agent-operable surface)

### Trigger.dev — BEST agent-operability of the bunch
- **First-party MCP server** (built into the CLI). Source: https://trigger.dev/docs/mcp-introduction (2026-06-16).
  - **All tools require CLI login** EXCEPT `search_docs` (works unauthenticated — great for an agent to RAG the docs).
  - **`--yolo`** flag installs the MCP into ALL supported clients automatically.
  - **`--readonly`** mode hides write tools (`deploy`, `trigger_task`, `cancel_run`) so an agent CANNOT mutate the account — the safety default bee should use for read-only inspection.
  - **11 new MCP tools added in v4.4.4** (2026-04-13, ecosystem-01) — Trigger.dev is investing the most in agent control.
- **CLI:** `npx trigger.dev@latest` (login, dev, deploy). Tasks are plain TS files; `trigger.config.ts` is the config seam.
- **TASTE:** for an agent that needs to *create and run* durable jobs by itself, Trigger.dev's MCP + readonly mode is the cleanest fit in June 2026.

### Temporal — richest workflow-control MCP
- **Temporal MCP Server** (Code Exchange) — bridges AI assistants (Copilot/Claude/OpenCode) to a Temporal cluster. **Exposes 19 tools**: per-workflow lifecycle (start/cancel/terminate), real-time **query + signal**, **batch operations** across many workflows, and **full schedule management via cron expressions**. "Interact with your workflows entirely through natural language." Source: https://temporal.io/code-exchange/temporal-mcp-server (2026-06-16); community variants: https://www.pulsemcp.com/servers/mocksi-temporal-workflows , https://mcp.so/server/temporal-mcp/Mocksi (2026-06-16).
- **CLI:** `temporal` CLI (start workflow, signal, query, schedule, worker status — Worker Status now in CLI per Replay 2026, ecosystem-01).
- **TASTE:** if bee orchestrates long multi-step workflows and needs to *inspect/steer running ones*, Temporal's 19-tool MCP is the most powerful control surface.

### Inngest — NO first-party MCP (as of June 2026)
- Web search found **no Inngest MCP server**. Source: search synthesis (2026-06-16) — explicitly noted "search results don't specifically mention an Inngest MCP server." → FLAG as gap.
- Agent surface = **REST API + SDK** (`inngest` npm) + the Dev Server UI. **AgentKit by Inngest** is the AI-agent *framework* (not an MCP for operating Inngest itself). Source: https://agentkit.inngest.com/changelog/overview (2026-06-16).
- **Durable Endpoints** (ecosystem-01) make ANY HTTP handler durable — an agent can add durability by wrapping its own endpoint, no separate control plane needed.

### BullMQ — NO MCP; operate via library + bull-board + Redis
- No first-party MCP/CLI for agent control. Source: search synthesis (2026-06-16). → FLAG as gap.
- Agent surface = the **`bullmq` library API** (add/get/retry/clean jobs), **bull-board** UI (https://github.com/felixmosh/bull-board), and **redis-cli** for raw inspection. An agent operating BullMQ writes TS.
- BullMQ now has **Bun, Python, and Rust** runtime support (ecosystem-01) — wider language reach for the consumer side. Source: https://www.digitalapplied.com/blog/background-job-queue-patterns-2026-engineering-reference (2026-06-16).

### Cloudflare Queues — `wrangler` CLI + HTTP pull API
- **CLI:** `wrangler queues ...` (create/list/consumer config). **HTTP pull API** is the agent seam for non-Worker consumers (pull + ack up to 5,000 msg/s, ecosystem-02). No dedicated MCP.
- GOTCHA (ecosystem-04): `wrangler dev` local mode lies (`remote: true` silently ignored).

### AWS SQS — `aws` CLI + SDK; community `sqs-consumer`
- **CLI:** `aws sqs ...` (send/receive/delete/create-queue/set redrive). SDK = `@aws-sdk/client-sqs`. **No official Node poller** (issue #6015 still open) → use **bbc/sqs-consumer** (1,905★, ecosystem below).
- AWS has broad MCP coverage emerging but SQS-specific MCP not confirmed here → FLAG as gap.

### Upstash QStash — pure HTTP API (most agent-friendly transport)
- **No MCP needed** — QStash IS an HTTP API: `POST` a message + destination URL, it delivers later with retries/schedules/DLQ. An agent with only an HTTP client can fully drive it. SDK = `@upstash/qstash`. Source: https://deepwiki.com/upstash/docs/3-qstash-message-queue-and-scheduler (2026-06-16).

### Summary table — agent operability (June 2026)
| Tool | MCP server | CLI | Best agent transport | Read-only safety |
|---|---|---|---|---|
| Trigger.dev | ✅ first-party (`--yolo`, `--readonly`, `search_docs`) | `trigger.dev` | MCP | ✅ `--readonly` |
| Temporal | ✅ Code Exchange (19 tools) | `temporal` | MCP | partial (tool selection) |
| Inngest | ❌ none | (SDK only) | REST API + SDK | n/a |
| BullMQ | ❌ none | (redis-cli/bull-board) | TS library | n/a |
| Cloudflare Queues | ❌ none | `wrangler` | HTTP pull API | n/a |
| AWS SQS | ❌ (not confirmed) | `aws` | SDK + sqs-consumer | n/a |
| Upstash QStash | ❌ (not needed) | (HTTP) | **HTTP API** | n/a |

**bee takeaway:** for an agent that must *self-operate* the jobs layer, **Trigger.dev (MCP+readonly)** and **QStash (pure HTTP)** are the two lowest-friction choices; **Temporal MCP** is the most powerful for steering running workflows.

---

## PART B — Best starter / template / example repos (stars + freshness via `gh api` 2026-06-16)

### Canonical source repos (the things you'd depend on)
- **triggerdotdev/trigger.dev** — **15,373★**, pushed 2026-06-16. The OSS durable-jobs platform; self-hostable. Most-starred in this domain (after legacy Bull). WHY: active, AI-first, MCP built in.
- **OptimalBits/bull** — **16,243★**, pushed 2026-06-09. The ORIGINAL Bull (predecessor to BullMQ). Still high-star but **legacy** — new projects should use BullMQ, not Bull. WHY-NOT: maintenance mode; BullMQ is the successor.
- **taskforcesh/bullmq** — **9,008★**, pushed 2026-06-17. The current Redis-queue standard for Node/TS. WHY: ships multiple patches/week, Rust core landing (ecosystem-01).
- **inngest/inngest** — **5,499★**, pushed 2026-06-17 (the server/platform); **inngest/inngest-js** — **967★**, pushed 2026-06-16 (the SDK). WHY: durable execution without queues; Durable Endpoints.
- **temporalio/sdk-typescript** — **863★**, pushed 2026-06-16. WHY: the durable-execution heavyweight; pair with samples below.
- **bbc/sqs-consumer** — **1,905★**, pushed 2026-06-17. The de-facto SQS long-poll consumer for Node (fills the gap of no official AWS poller, issue #6015). WHY: battle-tested receive/delete/visibility loop.
- **upstash/qstash-js** — **268★**, pushed 2026-06-16. The QStash SDK. WHY: HTTP-native durable queue + scheduler.

### Best EXAMPLE/TEMPLATE repos to learn the load-bearing flows
1. **triggerdotdev/examples** — **108★**, pushed 2026-06-10. The single richest example collection for AI-agent-shaped durable work. Notable dirs (via `gh api .../contents`): `building-effective-agents`, `claude-agent-sdk-trigger`, `claude-agent-github-wiki`, `durable-endpoints-*` patterns, `batch-llm-evaluator`, `meme-generator-human-in-the-loop`, `realtime-csv-importer`, `nextjs-webhooks`, `monorepos`. WHY: directly maps to bee's "agent runs a long reliable job" use case. Source: `gh api repos/triggerdotdev/examples/contents` (2026-06-16).
2. **inngest/inngest-js → /examples** dir — pushed 2026-06-16. Exhaustive framework coverage: `framework-{nextjs-app-router,hono,fastify,nestjs,sveltekit,nuxt,remix,astro,elysiajs,tanstack-start,...}`, plus **`durable-endpoints-deepresearch`** and **`durable-endpoints-trip-booker`** (the 2026 headline primitive in action) and **`connect-example`** / **`bun-sync`**. WHY: shows the SAME durable code across every host — best for "which framework do I wire this into." Source: `gh api repos/inngest/inngest-js/contents/examples` (2026-06-16).
3. **temporalio/samples-typescript** — **462★**, pushed 2026-06-16. Official Temporal TS samples (signals, queries, child workflows, schedules, sagas, long-running). WHY: the only reliable way to learn Temporal's determinism rules + fan-in by example. WHY-CARE: pairs with the NDE gotcha (ecosystem-04 #1677).
4. **felixmosh/bull-board** — the canonical BullMQ/Bull dashboard (active CHANGELOG). WHY: an agent needs a UI to inspect queues; this is it. Source: https://github.com/felixmosh/bull-board/blob/master/CHANGELOG.md (2026-06-16).
5. Inngest example community repos exist but are thin (`joelhooks/inngest-*`, 1-8★, 2026-05) — prefer the official `inngest-js/examples` dir over these. Source: `gh search repos "inngest example"` (2026-06-16).

**bee takeaway for scaffolding:** start from **inngest-js/examples/framework-nextjs-app-router** or **triggerdotdev/examples/building-effective-agents** for the AI-job shape; use **temporalio/samples-typescript** only when you genuinely need durable orchestration with signals/child-workflows.

---

### Sources (this file)
- https://trigger.dev/docs/mcp-introduction (2026-06-16)
- https://temporal.io/code-exchange/temporal-mcp-server (2026-06-16)
- https://www.pulsemcp.com/servers/mocksi-temporal-workflows ; https://mcp.so/server/temporal-mcp/Mocksi (2026-06-16)
- https://agentkit.inngest.com/changelog/overview (2026-06-16)
- https://github.com/felixmosh/bull-board/blob/master/CHANGELOG.md (2026-06-16)
- https://deepwiki.com/upstash/docs/3-qstash-message-queue-and-scheduler (2026-06-16)
- https://www.digitalapplied.com/blog/background-job-queue-patterns-2026-engineering-reference (2026-06-16)
- Star counts + example dirs: `gh api repos/...` and `gh api repos/.../contents` (all 2026-06-16)

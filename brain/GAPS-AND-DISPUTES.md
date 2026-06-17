---
title: "bee GAPS AND DISPUTES — Where Sources Disagree & Where No Good Source Exists"
type: synthesis
created: "2026-06-16"
updated: "2026-06-16"
tags: [gaps, disputes, open-questions, experiments, bee]
synthesizer: "SYNTHESIS (taste node, CP123 Wave-R)"
sources: ["brain/research/raw/ecosystem-08-gaps-and-disputes.md", "brain/research/raw/field-07-gaps-and-disputes.md", "brain/research/raw/field-04-comparison-and-migrations.md", "brain/research/raw/field-01-bullmq-issues.md", "brain/research/raw/field-08-x-signal-and-hn-substitute.md"]
summary: "The honest ledger: live disputes (both sides verbatim + bee's default + the exception), things no source could confirm, and the questions bee must answer itself via experiment. Treating any of these as settled is a mistake."
---

# bee GAPS AND DISPUTES

> Two researchers independently wrote a gaps file (`ecosystem-08`, `field-07`). This merges them, de-dupes,
> and adds the EXPERIMENT bee must run to resolve each open question. A great practitioner holds both sides
> and picks per context; an average one dogmatically picks one.

---

## PART A — LIVE DISPUTES (credible sources disagree; hold both sides)

### D-1 — How to KEY idempotency: provider event ID vs your own derived key?
- **Camp A (provider event ID; do NOT derive)** — digitalapplied 2026, verbatim: "Store this provider-issued identifier; **do not attempt to construct one from order ID, attempt number, or tenant data.** The provider's ID is what distinguishes a retry from a genuinely new event."
- **Camp B (derive deterministically from domain data)** — designgurus/DZone: "use … a **deterministic idempotency key derived from order id and attempt number**."
- **bee's resolution (layer separation, both right):** *Inbound dedup* → provider event ID (stable across the provider's retries). *Outbound effect* → YOUR own `Idempotency-Key` derived from immutable domain identity (so the downstream collapses your duplicate calls). The trap: a derived key from a refactor-moved field double-fires (Inngest #2307).
- **Status:** genuinely disputed; **resolved only by layer-separation**, not by picking a winner. Encoded as `OPINIONS.md` O-6.
- **Source:** `field-05` §2, `field-07` Dispute 1.

### D-2 — Is durable execution the 2026 default, or are plain queues still better most of the time?
- **Camp "durable-exec is the new default"** — Mordrel (2025-07): "a clear move away from complex, infra-heavy solutions toward DX." digitalapplied/codeables: durable-exec "trade[s] [Redis] operational burden for step-level replay." Koshy (May 2026): agent workflows ARE long-running workflows.
- **Camp "queues are still better; durable-exec is oversold"** — Hatchet (Dec 2025), verbatim: "**'We should replace our queueing system with durable workflows' is often wrong; traditional queues remain better for many use-cases due to lower overhead.**" "persisting intermediate state comes with overhead, in DX AND in $$$." Plus the **ToolJet reverse-migration** (Temporal→BullMQ) — a real team voting with their feet.
- **bee's default:** durable-exec when steps are long-lived, span external systems, and replay correctness justifies the overhead; plain queue when work is short, high-volume, and consumer idempotency is cheap.
- **Status:** **actively disputed in 2026.** The "everyone's moving to durable exec" narrative has a credible counter-current. Encoded as `OPINIONS.md` O-14.
- **Source:** `field-07` Dispute 2, `field-04` §2.

### D-3 — Should workflow/queue logic live IN Postgres or IN code (Git)?
- **Pro-DB-resident** — @levkk (pg_durable HN, 2026-06): "**2026 is the year of the Postgres queue!**" — data locality, one fewer service.
- **Pro-code-resident (the pushback)** — @levkk also: "I kind of prefer my queue logic to be in code, in Git." @babhishek21: "why I'd want to do a migration (an all-or-nothing op) every time I want to change how I behave with my data." @dietr1ch: "What's the story for version control, debugging, testing, releasing?" @CuriouslyC: "the DX/observability isn't there … multi-master scaling isn't turnkey."
- **Maintainer concession** — @gdecandia (pg_durable): "we **do need to develop some best practices around managing function versioning and lifecycle** for pg_durable."
- **bee's default:** PG-resident deletes Redis-ops + separate-cluster for Postgres shops, BUT the versioning/observability/testing story is **admitted-unsolved by the maintainers themselves** — so don't recommend it yet for workflow logic that changes often.
- **Status:** emerging option with an honest, open maturity gap. Encoded as `OPINIONS.md` O-24.
- **Source:** `field-07` Dispute 3, `field-08`.

### D-4 — Deduplication-while-active: drop the mid-flight trigger, or guarantee a tail run?
- **Users (BullMQ #3427)** want "at least one execution **after the last trigger**" — simple/throttle/debounce modes "**lost forever**" a trigger arriving during active processing. Use cases: data sync, cache invalidation, webhook processing.
- **Maintainer @manast (verbatim):** "simple mode works in at least once semantics already … lets say the operation is a database update, it seems to me it is much better to deduplicate until the previous update has been completely processed **to avoid out-of-[order writes]**."
- **bee's resolution:** It's a **correctness policy, not a convenience knob.** "Coalesce + run once more after the last event" (sync/cache-invalidation) vs "collapse to in-flight to avoid out-of-order writes" (DB update) are OPPOSITE and both valid. Know which your dedup mode silently picks.
- **Status:** semantics disagreement; the default silently chooses. Encoded as `KNOWN-PITFALLS.md` P-B6.
- **Source:** `field-01` §4, `field-07` Dispute 4.

### D-5 — Full Jitter vs Equal Jitter — which is "best"?
- **Camp "Full Jitter"** — AWS Architecture Blog: Full Jitter performed best (least work) in their simulation.
- **Camp "not for throttles"** — `aws-sdk-net#4341`: Full Jitter collapses to near-zero delay for throttling errors (the random draw can be ~0), defeating the rate-limit wait.
- **bee's resolution (NOT a contradiction once split by error type):** Full Jitter for transient network errors (faster recovery OK); Equal Jitter for throttle/429 (guaranteed minimum wait). A naive reader picking one globally is wrong.
- **Status:** resolved by error-type split, but easy to get wrong. Encoded as `OPINIONS.md` O-9.
- **Source:** `ecosystem-03` §1, `ecosystem-08` Disputes, `field-07`.

### D-6 — Are BullMQ minor version bumps safe?
- **Implicit "yes" (semver):** 5.65→5.77 is a minor range.
- **Reality "no":** #4194 (5.77.x made every processor hang on first `await`, maintainers couldn't repro); #4196 (Pro 6.9→7.46 doubled Redis CPU); #4220 (5.76.8 let scheduler jobs retry forever, fixed 5.78.1). Three minor-range regressions in ~2 months.
- **bee's resolution:** treat BullMQ minor bumps as risky; gate on a FULL job-suite run, not unit tests.
- **Status:** not a formal dispute, but a practitioner-vs-semver gap. Encoded as `OPINIONS.md` O-17.
- **Source:** `field-07` Dispute 5, `field-01` §2/§3.

### D-7 — "Exactly-once" semantics (vendor marketing vs CS reality)
- **Vendors** market "exactly-once."
- **Primary CS sources** insist it's "exactly-once *effect*," not delivery (ByteByteGo). digitalapplied resolves it correctly: Temporal = "exactly-once execution of workflow logic (deterministic replay) with at-least-once activities."
- **bee's resolution:** ALWAYS state the qualified version. Never bare "exactly-once."
- **Status:** resolved (qualify it), but the bare claim is pervasive. Encoded as `OPINIONS.md` O-1.
- **Source:** `ecosystem-03` §3, `ecosystem-08` Disputes.

---

## PART B — OPEN GAPS (nobody has solved this; bee's frontier)

### G-1 — Shared-LLM-key throttling across functions/workers is UNSOLVED in both leading tools. ★ #1 agent-era gap
- **What's missing:** a first-class, production-proven "token-bucket on ONE provider key across N functions/workers."
- **Evidence:** Inngest #3701 (shared throttle scope) + #4345 (burstable keyed concurrency) — BOTH OPEN. BullMQ #3670/#3831 (global/points-based rate limit) — OPEN. No tool found that does this natively.
- **bee must:** treat it as a core requirement and build it (external shared token-bucket consulted by all workers; Equal-Jitter the 429s).
- **EXPERIMENT to run:** implement a Redis/Upstash token-bucket keyed on a provider key; spawn N concurrent workers; verify aggregate TPM/RPM never exceeds the limit under burst; measure added latency. Publish as a bee skill if it works.
- **Source:** `field-02` §4, `field-06` SHIFT 4, `field-07` GAP 1.

### G-2 — Prompt-injection / tool-poisoning-aware job execution has NO productized answer. ★ bee's thesis frontier
- **What's missing:** a shipping queue/durable-exec product that enforces per-step agent identity (SPIFFE/SPIRE) + injection resistance. Standards (Oracle Open Agent Spec, CNCF Serverless Workflow, AgentSPEX) are research/early.
- **Evidence:** Koshy (May 2026) names the need (workload identity + policy-as-audit); no shipping product confirmed to cover it.
- **bee must:** design toward identity-per-step + policy-as-audit; NEVER claim a vendor solves it.
- **EXPERIMENT to run:** prototype a job envelope that carries a signed agent-identity token + records each policy decision as an audit row; test that a poisoned tool-output can't escalate the job's permissions. This is a candidate bee differentiator.
- **Source:** `field-06` SHIFT 2, `field-07` GAP 2.

### G-3 — Postgres-resident durable-exec function VERSIONING is admitted-unsolved
- **What's missing:** a working version/lifecycle story for in-DB workflow code; rigorous DX/observability benchmarks vs Temporal/BullMQ.
- **Evidence:** maintainer @gdecandia concedes it; @CuriouslyC says DX/observability "isn't there" (anecdotal, no benchmarks found).
- **bee must:** track pg_durable/DBOS maturity; don't recommend PG-resident for frequently-changing workflow logic until versioning lands.
- **EXPERIMENT to run:** on a Postgres-only stack, build the same 3-step durable job in DBOS and in BullMQ; measure DX (LOC, debuggability), observability (can you see a stuck step?), and the cost of changing step #2 (migration vs code deploy). Re-check quarterly.
- **Source:** `field-07` GAP 3, `field-06` SHIFT 3.

### G-4 — The cost-crossover number ($15-50 BullMQ vs $75-150 managed @ 500k/mo) is single-sourced
- **What's missing:** independent verification against current vendor pricing pages.
- **Evidence:** comes from one 2026 reference (codeables/buildmvpfast); not cross-checked against Inngest/Trigger.dev/Redis pricing in this pass.
- **bee must:** treat as **order-of-magnitude, not exact**; re-derive from live pricing before quoting it in a real decision.
- **EXPERIMENT to run:** price a real 500k-jobs/mo workload on Inngest Pro, Trigger.dev Pro (per-second + per-run), and Upstash/ElastiCache Redis for BullMQ, as of the decision date. Update the number.
- **Source:** `field-07` GAP 5, `ecosystem-06` §pricing, `field-04` §3.

---

## PART C — COULD NOT CONFIRM (soft claims; don't treat as hard)

### C-1 — No 2026-specific net-new AWS SQS feature
Web search surfaced only *recently-updated* docs (Apr 2026) describing long-standing FIFO/exactly-once/high-throughput features — NOT a new H1-2026 launch. **Risk: low** (SQS is stable by design) but "current versions + 6-month deltas" is genuinely thin for SQS.
- **CHASE:** AWS "What's New" feed filtered to SQS for 2026.
- **Source:** `ecosystem-08` gap #1.

### C-2 — MCP-absence for Inngest / BullMQ / AWS SQS confirmed only via NEGATIVE search
Confirming absence via "search didn't find one" is weaker than confirming presence. An AWS-wide MCP suite *may* cover SQS indirectly (unverified). Trigger.dev + Temporal MCPs ARE confirmed present.
- **CHASE:** each vendor's docs/GitHub org for a `*-mcp` repo before declaring "no MCP."
- **Source:** `ecosystem-08` gap #2, `ecosystem-05` Part A.

### C-3 — Trigger.dev v4 internal mechanics ("Run Engine 2", checkpoint details) unconfirmed
The official `how-it-works` page fetched still describes **v3** (CRIU). v4's "Run Engine 2" is named only in a secondary source (buildmvpfast). Whether CRIU still holds in v4 is unknown.
- **CHASE:** trigger.dev/docs for a v4 architecture page; verify the CRIU mechanic against v4.
- **Source:** `ecosystem-08` gap #3.

### C-4 — Inngest/BullMQ #4194 root cause UNCONFIRMED
Reporter says all processors hang on first `await` after 5.77.x; maintainers cannot reproduce; no resolution at pull date. (Issue is in `taskforcesh/bullmq`, not Inngest — `field-07` flags the double-check; it's BullMQ.) Whether it's NestJS-adapter-specific is unknown.
- **CHASE:** monitor #4194 for a repro/resolution; test on a non-NestJS BullMQ setup.
- **Source:** `field-07` GAP 4, `field-01` §2.

### C-5 — No direct 2026 production-OUTAGE postmortem (HN or blog) for these tools
The strongest real-world breakage evidence is the **GitHub issues** (ecosystem-04, field-01..03), which ARE high-signal and root-caused. HN signal found is product-launch/standardization, not incident reports.
- **Note:** GitHub issues remain the primary failure-evidence source — they're better than absent blog postmortems anyway.
- **Source:** `ecosystem-08` weak-evidence, `field-08`.

### C-6 — Temporal sdk-typescript exact latest version (resolved late)
Initially flagged unknown in `ecosystem-01`; resolved in follow-up: **v1.18.1 (2026-06-11)**, CLI v1.7.2 (2026-06-10). (Recorded here so no one re-treats it as unknown.)
- **Source:** `ecosystem-08` versions-resolved.

---

## PART D — METHODOLOGY GAP (why one signal source is missing)

### M-1 — X/Twitter signal was SKIPPED (not fabricated)
The X GraphQL search endpoint returned HTTP 404 — the `SEARCH_DOC_ID` query-hash that X rotates server-side was stale (auth/cookies were fine, the session file was present). Fixing the doc_id (DOM-render → capture fresh hash) was out of scope for a one-pass run. HN (Algolia public API, auth-free, durably citable objectIDs) was substituted and is an adequate practitioner-taste source. **No X claim was invented.**
- **Implication for bee:** practitioner-taste in this brain comes from GitHub issues (primary) + HN threads (secondary), NOT X. If a future pass wants X signal, refresh the doc_id first (per energy MEMORY's browser-render→DOM-scrape→`--from-json` pattern).
- **Source:** `field-08`.

---

## What's SOLID (so the gaps are in proportion)
Multi-source, root-caused, high-confidence: versions/changelogs (`ecosystem-01`), core concepts with exact formulas (`ecosystem-03`), GitHub breakage with extracted root causes (`ecosystem-04`, `field-01..03`), durable-execution mechanics (`ecosystem-07`), trade-off matrix with real pricing (`ecosystem-06`), idempotency patterns (`field-05`). The gaps above are the *edges*, not the core — the core is dangerous-grade.

### Sources
Inline per item. All trace to `brain/research/raw/ecosystem-08`, `field-07`, and the issue files they reference.

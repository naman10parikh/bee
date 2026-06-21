// bee MCP server — tool catalog (PLAN §4 "MCP server tool list").
//
// Each tool is a thin wrapper over the real `bee` CLI (PLAN Q4 default: a stdio
// CLI-wrapper is the simplest correct MCP — bee's operations ARE CLI commands, so
// the MCP surface is parity-by-construction with the CLI). A tool declares:
//   - name / description / inputSchema  (the MCP `tools/list` contract)
//   - argv(args)                          (how the call maps to `bee <cmd> ... --json`)
//
// THE 9 TOOLS (1:1 with the PLAN §4 table). Every data tool runs the CLI with
// `--json`, so the result is parseable JSON the MCP layer returns verbatim.

/**
 * @typedef {Object} BeeTool
 * @property {string} name
 * @property {string} description
 * @property {object} inputSchema           - JSON Schema (draft-07-ish) for the args
 * @property {(args: Record<string, any>) => string[]} argv  - args → CLI argv (after `bee`)
 */

/**
 * A reusable JSON-Schema object builder.
 * @param {Record<string, any>} [properties]
 * @param {string[]} [required]
 */
const OBJ = (properties = {}, required = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

/**
 * Push a `--flag value` pair onto an argv array only when the value is set.
 * @param {string[]} argv
 * @param {string} name
 * @param {unknown} value
 */
function flag(argv, name, value) {
  if (value !== undefined && value !== null && value !== "") {
    argv.push(`--${name}`, String(value));
  }
}

/** @type {BeeTool[]} */
export const TOOLS = [
  {
    name: "scaffold_jobs",
    description:
      "Stand up a law-compliant jobs layer from a reference baseline (deps pinned EXACT, idempotency + retry-jitter + DLQ baked in). Default provider = BullMQ. Maps to `bee scaffold`.",
    inputSchema: OBJ({
      provider: { type: "string", enum: ["bullmq", "inngest", "qstash", "temporal"], description: "the durable-exec engine (default bullmq)" },
      out: { type: "string", description: "output directory" },
    }),
    argv: (a) => {
      const v = ["scaffold"];
      flag(v, "provider", a.provider);
      flag(v, "out", a.out);
      v.push("--json");
      return v;
    },
  },
  {
    name: "enqueue",
    description:
      "THE acceptance path (half 1). Enqueue a job onto BullMQ-on-Redis with an idempotency key; re-enqueuing the SAME key is duplicate-safe (returns deduped:true). Maps to `bee enqueue`.",
    inputSchema: OBJ(
      {
        queue: { type: "string", description: "queue name" },
        data: { type: "object", description: "the job payload" },
        id: { type: "string", description: "idempotency key (immutable, O-7); auto-derived from payload if omitted" },
        redis: { type: "string", description: "REDIS_URL override (defaults to env / redis://localhost:6379)" },
      },
      ["queue"],
    ),
    argv: (a) => {
      const v = ["enqueue"];
      flag(v, "queue", a.queue);
      flag(v, "data", JSON.stringify(a.data ?? {}));
      flag(v, "id", a.id);
      flag(v, "redis", a.redis);
      v.push("--json");
      return v;
    },
  },
  {
    name: "worker",
    description:
      "THE acceptance path (half 2). Run an idempotent worker (retry + jittered backoff + maxStalledCount + DLQ) that drains the queue once and reports {processed, deduped, deadLettered, effects, dlqDepth}. Each job's effect runs exactly once (DB unique constraint); poison jobs dead-letter. Maps to `bee worker --drain`.",
    inputSchema: OBJ(
      {
        queue: { type: "string", description: "queue name" },
        concurrency: { type: "number", description: "worker concurrency (default 1)" },
        redis: { type: "string", description: "REDIS_URL override" },
        db: { type: "string", description: "SQLite dedup-store path override" },
      },
      ["queue"],
    ),
    // One-shot `--drain` so the MCP call returns a result instead of hanging
    // (a long-lived worker has no place in a request/response RPC).
    argv: (a) => {
      const v = ["worker"];
      flag(v, "queue", a.queue);
      flag(v, "concurrency", a.concurrency);
      flag(v, "redis", a.redis);
      flag(v, "db", a.db);
      v.push("--drain", "--json");
      return v;
    },
  },
  {
    name: "audit_jobs",
    description:
      "Run the 30+ pitfall audit (brain/KNOWN-PITFALLS.md) over a jobs layer dir: at-least-once-as-exactly-once (P-X1), dedup-TTL<retry-window (P-X5), bare-exponential (P-X6), inline webhook (P-X7), side-effect-outside-step (P-I1), floating ^5 (P-B1), etc. Emits findings keyed by P-ID. Maps to `bee audit`.",
    inputSchema: OBJ(
      { dir: { type: "string", description: "directory of the jobs layer to audit" } },
      ["dir"],
    ),
    argv: (a) => ["audit", String(a.dir), "--json"],
  },
  {
    name: "wire_webhook",
    description:
      "Generate the RIGHT inbound webhook→queue path: verify sig on raw bytes → dedup on provider event ID (TTL ≥ provider retry window) → persist raw → return 202 → idempotent async worker (S-4, O-5/O-6/O-8). Maps to `bee wire-webhook`.",
    inputSchema: OBJ(
      {
        provider: { type: "string", enum: ["stripe", "shopify", "svix"], description: "the webhook provider" },
        out: { type: "string", description: "output directory" },
      },
      ["provider"],
    ),
    argv: (a) => {
      const v = ["wire-webhook"];
      flag(v, "provider", a.provider);
      flag(v, "out", a.out);
      v.push("--json");
      return v;
    },
  },
  {
    name: "pick_tool",
    description:
      "The decision oracle: walks the JTBD-11 tree → recommends a tool WITH the named falls-short (O-28) + the reversibility cost (Temporal = one-way door, O-13). Maps to `bee pick-tool`.",
    inputSchema: OBJ({
      profile: {
        type: "string",
        enum: ["serverless", "cloudflare", "aws", "http-only", "scale", "complex", "postgres"],
        description: "the deployment/workload profile",
      },
    }),
    argv: (a) => {
      const v = ["pick-tool"];
      flag(v, "profile", a.profile);
      v.push("--json");
      return v;
    },
  },
  {
    name: "check_versions",
    description:
      "Version-drift oracle: `npm view <pkg> version` vs brain/TOOL-MATRIX.md pins (BullMQ moves weekly — O-17); flags drift + the BullMQ stall-loop floor (<5.78.1 = the S-1 bug). Powers the RSI loop. Maps to `bee check`.",
    inputSchema: OBJ({
      offline: { type: "boolean", description: "skip the network and run the floor checks only" },
    }),
    argv: (a) => {
      const v = ["check"];
      if (a.offline) v.push("--offline");
      v.push("--json");
      return v;
    },
  },
  {
    name: "explain",
    description:
      "Print a pitfall/scenario/opinion by ID (P-/S-/O-/G-/JTBD-) with detection + fix + source. Maps to `bee explain`.",
    inputSchema: OBJ(
      { id: { type: "string", description: "the brain entry id, e.g. P-X5, S-3, O-23" } },
      ["id"],
    ),
    argv: (a) => ["explain", String(a.id), "--json"],
  },
  {
    name: "search_brain",
    description:
      "BM25 search over brain/ (the expertise) — returns ranked pitfalls/scenarios/opinions for a query. Maps to `bee brain`.",
    inputSchema: OBJ(
      {
        query: { type: "string", description: "the search query" },
        limit: { type: "number", description: "max hits (default 5)" },
      },
      ["query"],
    ),
    argv: (a) => {
      const v = ["brain", String(a.query)];
      flag(v, "limit", a.limit);
      v.push("--json");
      return v;
    },
  },
];

/** Look up a tool by name. @param {string} name @returns {BeeTool|undefined} */
export function findTool(name) {
  return TOOLS.find((t) => t.name === name);
}

/** The MCP `tools/list` payload (name + description + inputSchema, no internals). */
export function listTools() {
  return TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

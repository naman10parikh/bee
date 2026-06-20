#!/usr/bin/env node
// bee — background-jobs/queues/durable-workflows employee CLI.
//
// THE ONE INVARIANT: at-least-once transport + idempotent consumer + dedupe store
// (TTL = retry window); every side effect carries a deterministic idempotency key
// enforced by a DB unique constraint; on ambiguous timeout, query state, never
// blind-retry.
//
// This file is a thin dispatcher: parse argv → route to a lazily-imported command
// module (so `--help`/`--version` never pay the bullmq import cost). Data commands
// honor `--json`; exit 0 on success, non-zero on error.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseArgs } from "../src/backend/cli/args.js";
import { fail } from "../src/backend/cli/output.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function version() {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8"));
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const HELP = `bee v${version()} — background-jobs/queues/workflows employee · powered by Energy

THE ONE INVARIANT: at-least-once transport + idempotent consumer + DB-unique-constraint
dedupe; on ambiguous timeout, query state, never blind-retry.

USAGE
  bee <command> [options]

COMMANDS
  enqueue       Enqueue a job (idempotency-key safe). --queue <q> --data <json> [--id <key>] [--json]
  worker        Run an idempotent worker (retry + jittered backoff + DLQ). --queue <q> [--concurrency <n>] [--json]
  scaffold      Stand up a law-compliant jobs layer. --provider bullmq|inngest|qstash|temporal [--out <dir>]
  wire-webhook  Generate a verify->dedup->202->async webhook ingest path. --provider stripe|shopify|svix [--out <dir>]
  audit         Audit a jobs layer for the known pitfalls (P-IDs). <dir> [--json]
  pick-tool     The decision oracle (recommendation + falls-short + reversibility). [--profile <p>] [--json]
  check         Version-drift oracle + BullMQ stall-floor. [--below-floor <v>] [--json]
  brain         BM25 search over brain/ (the expertise). <query> [--json]
  explain       Print a pitfall/scenario/opinion by ID. <P-id|S-id|O-id> [--json]
  token-bucket  The frontier primitive: a shared token-bucket workers consult. --key <k> --limit <rpm> [--workers <n>]

GLOBAL
  --json        Machine-readable JSON on stdout (diagnostics go to stderr)
  --help, -h    This help
  --version, -v Print the version

Boundary: bee owns jobs/queues/durable-workflows + worker-side flow control.
HTTP-edge rate-limit/cache is echo's. Never bare "exactly-once" — exactly-once *effect*.
`;

// Lazy command table: name -> () => import the module. Each module default-exports
// an async `run({ positionals, flags })`.
/** @type {Record<string, () => Promise<{ default: (ctx: any) => Promise<void> }>>} */
const COMMANDS = {
  enqueue: () => import("../src/backend/commands/enqueue.js"),
  worker: () => import("../src/backend/commands/worker.js"),
  scaffold: () => import("../src/backend/commands/scaffold.js"),
  "wire-webhook": () => import("../src/backend/commands/wire-webhook.js"),
  audit: () => import("../src/backend/commands/audit.js"),
  "pick-tool": () => import("../src/backend/commands/pick-tool.js"),
  check: () => import("../src/backend/commands/check.js"),
  brain: () => import("../src/backend/commands/brain.js"),
  explain: () => import("../src/backend/commands/explain.js"),
  "token-bucket": () => import("../src/backend/commands/token-bucket.js"),
};

async function main() {
  const argv = process.argv.slice(2);
  const { command, positionals, flags } = parseArgs(argv);

  if (flags.version || flags.v || command === "version" || command === "-v") {
    process.stdout.write(version() + "\n");
    return;
  }
  if (!command || flags.help || flags.h || command === "help" || command === "-h") {
    process.stdout.write(HELP);
    return;
  }

  const loader = COMMANDS[command];
  if (!loader) {
    fail(`unknown command: ${command}\nRun \`bee --help\` for the command list.`, 127);
  }

  const mod = await loader();
  await mod.default({ positionals, flags });
}

main().catch((err) => {
  fail(err && err.stack ? err.stack : String(err));
});

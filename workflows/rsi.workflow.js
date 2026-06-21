#!/usr/bin/env node
// bee RSI engine — the deterministic, $0/tokenless self-improvement loop (PLAN §11,
// item D2). This is the DETERMINISTIC HALF of the Darwin DSIP loop; per D8/D14 the Claude
// half is DEFERRED and lights up only when `CLAUDE_CODE_OAUTH_TOKEN` is set (dark is
// EXPECTED, not a miss). Budget is disabled as a constraint (D14) — this loop costs $0
// because it shells the local bee CLI + `npm view`, never the model.
//
// Why bee's RSI is genuinely exercised (not theatre): BullMQ ships MULTIPLE PATCHES/WEEK
// (O-17 — web-verified v5.78.1 current this wave), so `re-verify-tool-matrix` routinely
// detects a real stale pin. The loop has a high hit-rate by construction.
//
// THE DETERMINISTIC DSIP STEPS (the verify line asserts the named steps run):
//   refresh-brain          → re-read brain/TOOL-MATRIX.md pins (the source of truth)
//   re-verify-tool-matrix  → `bee check` — npm view vs pins + the BullMQ stall-floor
//   run-eval-pyramid       → `bee eval` L1+L2 incl. acceptance (degrades if E1 not landed)
//   run-frontier-experiment→ the $0 G-1 token-bucket sim (aggregate ≤ limit under burst)
//   propose                → write a diff proposal to a gated file (NO commit yet)
//   test-gate              → the proposal only advances if the eval gate is green
//   commit (gated)         → deferred: gated commit happens only behind the Claude half
//
// `--deterministic` runs the $0 path. `--json` emits the machine-readable run report.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const BEE_CLI = join(ROOT, "bin", "bee.js");
const TOOL_MATRIX = join(ROOT, "brain", "TOOL-MATRIX.md");
const PROPOSAL_DIR = join(ROOT, "logs", "rsi");

/**
 * Run a command; resolve { ok, stdout, stderr, code }. Never throws.
 * @param {string} cmd
 * @param {string[]} args
 * @returns {Promise<{ ok: boolean, stdout: string, stderr: string, code: number }>}
 */
function run(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => resolve({ ok: false, stdout: "", stderr: String(e), code: -1 }));
    child.on("close", (code) => resolve({ ok: code === 0, stdout: out.trim(), stderr: err.trim(), code: code ?? 0 }));
  });
}

/** Parse the last JSON line of stdout, or undefined. @param {string} out */
function lastJson(out) {
  const last = String(out).trim().split("\n").filter(Boolean).pop() ?? "";
  try { return JSON.parse(last); } catch { return undefined; }
}

// ── The deterministic steps ─────────────────────────────────────────────────

/** refresh-brain: re-read the TOOL-MATRIX pins (the brain is the source of truth). */
async function stepRefreshBrain() {
  const present = existsSync(TOOL_MATRIX);
  let pinCount = 0;
  if (present) {
    const txt = readFileSync(TOOL_MATRIX, "utf8");
    // count pinned package rows (a heuristic: lines naming a known queue lib + a version)
    pinCount = (txt.match(/\b\d+\.\d+\.\d+\b/g) || []).length;
  }
  return { name: "refresh-brain", ok: present, detail: present ? `re-read TOOL-MATRIX.md (${pinCount} version pins)` : "TOOL-MATRIX.md missing" };
}

/** re-verify-tool-matrix: `bee check` — drift vs pins + the BullMQ stall-floor. */
async function stepReVerifyToolMatrix() {
  // Try online first; if `npm view` is unreachable, fall back to offline (floor-only) so
  // the loop is $0-and-robust on a network hiccup (the check command degrades gracefully).
  let res = await run(process.execPath, [BEE_CLI, "check", "--json"]);
  let data = lastJson(res.stdout);
  if (!data) {
    res = await run(process.execPath, [BEE_CLI, "check", "--offline", "--json"]);
    data = lastJson(res.stdout);
  }
  const stale = data?.stale ?? [];
  const belowFloor = data?.belowFloor ?? [];
  return {
    name: "re-verify-tool-matrix",
    ok: Boolean(data),
    online: Boolean(data?.online),
    staleCount: stale.length,
    belowFloorCount: belowFloor.length,
    stale,
    belowFloor,
    detail: data
      ? `checked ${data.checked} pkgs (online=${data.online}): ${stale.length} stale, ${belowFloor.length} below-floor`
      : "bee check produced no parseable output",
  };
}

/** run-eval-pyramid: `bee eval` L1+L2. Degrades gracefully if E1 hasn't landed yet. */
async function stepRunEvalPyramid() {
  // `bee eval` is E1's deliverable. Detect its presence: an unknown command exits 127.
  const l1 = await run(process.execPath, [BEE_CLI, "eval", "--level", "1", "--json"]);
  if (l1.code === 127 || /unknown command/.test(l1.stderr)) {
    // HONEST degradation: the step ran, the eval surface isn't wired yet (E1). The loop
    // still completes; the eval gate is recorded as "pending E1", not faked green.
    return { name: "run-eval-pyramid", ok: true, evalAvailable: false, gate: "pending", detail: "`bee eval` not yet registered (E1) — eval gate pending; deterministic loop continues at $0" };
  }
  const l2 = await run(process.execPath, [BEE_CLI, "eval", "--level", "2", "--json"]);
  const gate = l1.ok && l2.ok ? "green" : "red";
  return { name: "run-eval-pyramid", ok: l1.ok && l2.ok, evalAvailable: true, gate, l1: l1.ok, l2: l2.ok, detail: `eval L1=${l1.ok ? "green" : "red"} L2=${l2.ok ? "green" : "red"}` };
}

/** run-frontier-experiment: the $0 G-1 token-bucket sim (aggregate ≤ limit under burst). */
async function stepFrontierExperiment() {
  // The shared-LLM-key token-bucket (S-16/O-23/G-1) — UNSOLVED in Inngest+BullMQ. The $0
  // in-process sim proves the algorithm holds the aggregate ≤ the limit under N workers.
  const res = await run(process.execPath, [BEE_CLI, "token-bucket", "--key", "rsi-sim", "--limit", "60", "--workers", "20", "--json"]);
  const data = lastJson(res.stdout);
  // G-4 cost re-derivation needs the Claude half (real $$$ figures) — doc-noted, not run $0.
  return {
    name: "run-frontier-experiment",
    ok: Boolean(data) && data.withinLimit === true,
    experiment: "token-bucket-sim (G-1/S-16/O-23)",
    withinLimit: data?.withinLimit,
    accepted: data?.accepted,
    rejected: data?.rejected,
    note: "G-4 ops-cost re-derivation needs the Claude half (real $ figures) — doc-noted, not run at $0. Token-bucket is a FRONTIER primitive, never advertised as solved (O-25).",
    detail: data ? `token-bucket sim withinLimit=${data.withinLimit} (accepted=${data.accepted} rejected=${data.rejected})` : "token-bucket sim produced no output",
  };
}

/**
 * propose: if drift/below-floor is detected, write a diff PROPOSAL to a gated file. NO
 * commit (the deterministic half never commits; the gated commit is behind the Claude half).
 * @param {any} verify  - the re-verify-tool-matrix result
 */
async function stepPropose(verify) {
  mkdirSync(PROPOSAL_DIR, { recursive: true });
  const proposalPath = join(PROPOSAL_DIR, "proposal-latest.json");
  const proposals = [];
  for (const s of verify.belowFloor ?? []) {
    proposals.push({ kind: "below-floor", pkg: s.pkg, from: s.pinned, to: s.floor, reason: `below safety floor (${s.note})`, severity: "high" });
  }
  for (const s of verify.stale ?? []) {
    proposals.push({ kind: "stale-pin", pkg: s.pkg, from: s.pinned, to: s.latest, reason: `newer version published (${s.note}); gate on a FULL job-suite run (O-17)`, severity: "medium" });
  }
  const proposal = {
    generatedAt: new Date().toISOString(),
    deterministic: true,
    committed: false, // the deterministic half PROPOSES; it never commits (D8/D14)
    proposals,
    detail:
      proposals.length === 0
        ? "no drift/below-floor detected this run — nothing to propose"
        : `${proposals.length} version proposal(s) written to ${proposalPath} (NOT committed — gated on the eval test-gate + the Claude half)`,
  };
  writeFileSync(proposalPath, JSON.stringify(proposal, null, 2) + "\n");
  return { name: "propose", ok: true, count: proposals.length, path: proposalPath, detail: proposal.detail };
}

/**
 * test-gate: the proposal only advances if the eval gate is green. (When the eval surface
 * is pending — E1 — the gate is "pending" and nothing advances, which is correct.)
 * @param {any} evalStep
 * @param {any} proposeStep
 */
async function stepTestGate(evalStep, proposeStep) {
  const gate = evalStep.gate ?? "pending";
  const advance = gate === "green" && proposeStep.count > 0;
  return {
    name: "test-gate",
    ok: true,
    gate,
    advance,
    detail: advance
      ? `gate GREEN + ${proposeStep.count} proposal(s) → would advance to a gated commit (deferred to the Claude half, D8)`
      : `gate=${gate}; not advancing (proposals=${proposeStep.count}) — correct: the deterministic half proposes, the Claude half commits`,
  };
}

// ── The loop ────────────────────────────────────────────────────────────────

/**
 * Run the deterministic RSI loop ($0). Returns the full run report.
 * @returns {Promise<{ mode: string, claudeHalf: string, steps: any[], proposalsWritten: number }>}
 */
export async function runDeterministic() {
  const steps = [];
  steps.push(await stepRefreshBrain());
  const verify = await stepReVerifyToolMatrix();
  steps.push(verify);
  const evalStep = await stepRunEvalPyramid();
  steps.push(evalStep);
  steps.push(await stepFrontierExperiment());
  const proposeStep = await stepPropose(verify);
  steps.push(proposeStep);
  steps.push(await stepTestGate(evalStep, proposeStep));

  // The Claude half is DEFERRED (D8): it lights up only behind CLAUDE_CODE_OAUTH_TOKEN.
  const claudeHalf = process.env.CLAUDE_CODE_OAUTH_TOKEN
    ? "available (token present) — would run the LLM proposal/commit half"
    : "dark (CLAUDE_CODE_OAUTH_TOKEN unset — EXPECTED per D8; deterministic half ran at $0)";

  return { mode: "deterministic", claudeHalf, steps, proposalsWritten: proposeStep.count };
}

// ── CLI entry ─────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const deterministic = args.includes("--deterministic");

  if (!deterministic) {
    // Per D8/D14 the Claude (LLM) half is deferred; without --deterministic we explain.
    const msg = {
      error: "the Claude (LLM) half is deferred (D8). Run with --deterministic for the $0 loop.",
      hint: "node workflows/rsi.workflow.js --deterministic [--json]",
      claudeHalf: process.env.CLAUDE_CODE_OAUTH_TOKEN ? "token present" : "dark (set CLAUDE_CODE_OAUTH_TOKEN to enable)",
    };
    if (json) process.stdout.write(JSON.stringify(msg) + "\n");
    else process.stderr.write(`[bee-rsi] ${msg.error}\n  ${msg.hint}\n`);
    process.exit(2);
  }

  const report = await runDeterministic();
  if (json) {
    process.stdout.write(JSON.stringify(report) + "\n");
  } else {
    process.stdout.write("bee RSI — deterministic loop ($0):\n");
    for (const s of report.steps) process.stdout.write(`  • ${s.name}: ${s.detail}\n`);
    process.stdout.write(`\nClaude half: ${report.claudeHalf}\n`);
  }
}

if (process.argv[1] && process.argv[1].endsWith("rsi.workflow.js")) {
  main().catch((e) => {
    process.stderr.write(`[bee-rsi] ${e?.stack || e}\n`);
    process.exit(1);
  });
}

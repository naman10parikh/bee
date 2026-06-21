#!/usr/bin/env node
// eval/runner.mjs — the eval pyramid (Hamel L1/L2/L3, E1). Loads the 14 golden-task
// modules (g01..g14, lifted from brain/BATTLE-TESTED-SCENARIOS.md per PLAN §6), runs
// the selected level(s), and exits 0 iff every selected task PASSES.
//
// noSelfGrading (dsip.json): each task's gate is a concrete VERIFY assertion (a
// boolean over bee's artifacts / pure logic / a committed fixture), NEVER the agent's
// opinion that it's done. The runner just collects booleans.
//
// HERMETIC by design: L1/L2/L3 run with NO live Redis (in-memory SQLite + pure
// functions + auditing committed fixtures + CLI-output checks). The LIVE-Redis
// lifecycle proof is the acceptance test (eval/acceptance.mjs, E2) — which IS golden
// task G1 (CI-blocking). This split keeps `bee eval` runnable in any environment
// while the merge gate (E2/E5) exercises the live boot.
//
// Levels (PLAN §6): L1 structural assertions (G1/G2/G6/G11); L2 behavioral binary
// pass/fail (G3/G4/G5/G7/G8/G9/G10); L3 trajectory process-graded (G12/G13/G14).

import g01 from "./g01_duplicate_safe.mjs";
import g02 from "./g02_dedup_ttl.mjs";
import g03 from "./g03_key_from_immutable.mjs";
import g04 from "./g04_webhook_202_async.mjs";
import g05 from "./g05_retry_jitter.mjs";
import g06 from "./g06_bullmq_stall_floor.mjs";
import g07 from "./g07_side_effect_in_step.mjs";
import g08 from "./g08_blocking_await_durable_sleep.mjs";
import g09 from "./g09_bounded_fanout.mjs";
import g10 from "./g10_temporal_money_slips.mjs";
import g11 from "./g11_monitor_not_polling.mjs";
import g12 from "./g12_tool_choice_both_sides.mjs";
import g13 from "./g13_shared_key_token_bucket.mjs";
import g14 from "./g14_ops_cost_self_host.mjs";

/**
 * @typedef {object} GoldenTask
 * @property {string} id            - G1..G14
 * @property {1|2|3} level          - Hamel level
 * @property {boolean} ciBlocking   - red-blocking in CI?
 * @property {string[]} sids        - the brain S-IDs this task is lifted from
 * @property {string} title         - one-line description
 * @property {() => Promise<{ pass: boolean, detail: string }>} run - the VERIFY gate
 */

/** @type {GoldenTask[]} */
export const TASKS = [g01, g02, g03, g04, g05, g06, g07, g08, g09, g10, g11, g12, g13, g14];

/**
 * Run the pyramid for the given level(s).
 * @param {{ level?: 1|2|3, json?: boolean }} [opts]
 * @returns {Promise<{ level: string, total: number, passed: number, allPass: boolean, results: { id: string, level: number, ciBlocking: boolean, sids: string[], title: string, pass: boolean, detail: string }[] }>}
 */
export async function runPyramid(opts = {}) {
  const tasks = opts.level ? TASKS.filter((t) => t.level === opts.level) : TASKS;
  /** @type {{ id: string, level: number, ciBlocking: boolean, sids: string[], title: string, pass: boolean, detail: string }[]} */
  const results = [];
  for (const t of tasks) {
    let res;
    try {
      res = await t.run();
    } catch (err) {
      res = { pass: false, detail: `threw: ${err instanceof Error ? err.message : String(err)}` };
    }
    results.push({ id: t.id, level: t.level, ciBlocking: t.ciBlocking, sids: t.sids, title: t.title, ...res });
  }
  const passed = results.filter((r) => r.pass).length;
  return {
    level: opts.level ? `L${opts.level}` : "L1+L2+L3",
    total: results.length,
    passed,
    allPass: passed === results.length,
    results,
  };
}

// ── CLI entry (also reachable via `bee eval`) ─────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const li = args.indexOf("--level");
  /** @type {1|2|3|undefined} */
  let level;
  if (li !== -1 && args[li + 1]) {
    const n = Number.parseInt(args[li + 1], 10);
    if (n === 1 || n === 2 || n === 3) level = n;
  }

  const report = await runPyramid({ level, json });
  if (json) {
    process.stdout.write(JSON.stringify(report) + "\n");
  } else {
    process.stdout.write(`\nbee eval pyramid — ${report.level} (${report.passed}/${report.total} pass)\n\n`);
    for (const r of report.results) {
      process.stdout.write(`  ${r.pass ? "PASS" : "FAIL"}  ${r.id} [L${r.level}${r.ciBlocking ? ", CI" : ""}] ${r.title}  (${r.sids.join(",")})\n        ${r.detail}\n`);
    }
    process.stdout.write(`\n${report.allPass ? "EVAL GREEN" : "EVAL RED — see failing tasks above"}\n`);
  }
  process.exit(report.allPass ? 0 : 1);
}

if (process.argv[1] && process.argv[1].endsWith("runner.mjs")) {
  main().catch((err) => {
    process.stderr.write(`[eval] ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exit(1);
  });
}

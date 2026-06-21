// `bee eval [--level 1|2|3] [--json]` — run the eval pyramid (E1). Thin wrapper around
// eval/runner.mjs (the 14 golden tasks lifted from brain/BATTLE-TESTED-SCENARIOS.md).
// L1 structural · L2 behavioral binary · L3 trajectory. noSelfGrading (dsip.json):
// each task's gate is a concrete VERIFY assertion, never the agent's opinion.

import { int, bool } from "../cli/args.js";
import { fail } from "../cli/output.js";

/**
 * @param {{ positionals: string[], flags: Record<string, string|boolean> }} ctx
 */
export default async function run({ flags }) {
  const lvl = int(flags, "level", 0);
  /** @type {1|2|3|undefined} */
  let level;
  if (lvl === 1 || lvl === 2 || lvl === 3) level = lvl;
  else if (lvl !== 0) fail(`--level must be 1, 2, or 3 (got: ${lvl})`);

  const json = bool(flags, "json");

  // The runner lives in eval/ (it is itself a typechecked .mjs, tsconfig include).
  const { runPyramid } = await import("../../../eval/runner.mjs");
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
  // Exit non-zero if any selected task failed (the CI gate + the RSI loop's eval gate).
  process.exit(report.allPass ? 0 : 1);
}

// `bee check [--below-floor <v>] [--offline] [--json]` — version-drift + stall-floor.

import { check } from "../check/index.js";
import { str, bool } from "../cli/args.js";
import { emit } from "../cli/output.js";

/**
 * @param {{ positionals: string[], flags: Record<string, string|boolean> }} ctx
 */
export default async function run({ flags }) {
  const belowFloor = str(flags, "below-floor");
  const offline = bool(flags, "offline");
  const json = bool(flags, "json");

  const result = await check({ belowFloor, offline });

  emit(json, result, (r) => {
    const lines = [`checked ${r.checked} package(s) (online: ${r.online})`];
    for (const res of r.results) {
      const flag = res.belowFloor ? " ⚠ BELOW-FLOOR" : res.drift === true ? " ↑ stale" : "";
      lines.push(`  ${res.pkg}@${res.pinned}  latest=${res.latest}${flag}  — ${res.note}`);
    }
    if (r.belowFloor.length) lines.push(`\n${r.belowFloor.length} package(s) BELOW a safety floor — fix before shipping.`);
    return lines.join("\n");
  });

  // Exit non-zero if anything is below a known safety floor (usable as an RSI gate).
  if (result.belowFloor.length > 0) process.exitCode = 2;
}

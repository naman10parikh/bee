// `bee audit <dir> [--json]` — audit a jobs layer for the known pitfalls.

import { audit } from "../audit/index.js";
import { bool } from "../cli/args.js";
import { emit, fail } from "../cli/output.js";

/**
 * @param {{ positionals: string[], flags: Record<string, string|boolean> }} ctx
 */
export default async function run({ positionals, flags }) {
  const dir = positionals[0];
  if (!dir) fail("`bee audit` requires a <dir> argument");

  const json = bool(flags, "json");
  const result = audit(/** @type {string} */ (dir));

  emit(json, result, (r) => {
    if (r.findings.length === 0) return `audit: ${r.scanned} files scanned — no pitfalls found ✓`;
    const lines = [`audit: ${r.findings.length} finding(s) across ${r.scanned} files:`];
    for (const f of r.findings) {
      lines.push(`  [${f.severity}] ${f.pitfall}  ${f.file}:${f.line}  ${f.message}`);
    }
    return lines.join("\n");
  });

  // Exit non-zero when high-severity findings exist (so `bee audit` is usable as a gate).
  const high = result.findings.filter((f) => f.severity === "high").length;
  if (high > 0) process.exitCode = 2;
}

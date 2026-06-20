// `bee explain <P-id|S-id|O-id|G-id|JTBD-id> [--json]` — print one brain entry.

import { explainId } from "../brain/index.js";
import { bool } from "../cli/args.js";
import { emit, fail } from "../cli/output.js";

/**
 * @param {{ positionals: string[], flags: Record<string, string|boolean> }} ctx
 */
export default async function run({ positionals, flags }) {
  const id = positionals[0];
  if (!id) fail("`bee explain` requires an <id> (e.g. P-X5, S-3, O-23)");

  const json = bool(flags, "json");
  const entry = explainId(/** @type {string} */ (id));
  if (!entry) {
    return fail(`no brain entry for id "${id}" (expected a P-/S-/O-/G-/JTBD- id)`);
  }

  emit(json, entry, (e) => `${e.heading}\n(source: ${e.file})\n\n${e.body}`);
}

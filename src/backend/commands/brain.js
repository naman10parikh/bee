// `bee brain <query> [--json]` — BM25 search over brain/ (the Memory CLI).

import { searchBrain } from "../brain/index.js";
import { int, bool } from "../cli/args.js";
import { emit, fail } from "../cli/output.js";

/**
 * @param {{ positionals: string[], flags: Record<string, string|boolean> }} ctx
 */
export default async function run({ positionals, flags }) {
  const query = positionals.join(" ").trim();
  if (!query) fail("`bee brain` requires a <query>");

  const json = bool(flags, "json");
  const limit = int(flags, "limit", 5);
  const hits = searchBrain(query, { limit });

  emit(json, hits, (h) => {
    if (h.length === 0) return `no brain hits for "${query}"`;
    return h
      .map((/** @type {any} */ x, /** @type {number} */ i) => `${i + 1}. [${x.id}] ${x.file} (score ${x.score})\n   ${x.heading}\n   ${x.excerpt}`)
      .join("\n");
  });
}

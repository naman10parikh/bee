// `bee scaffold --provider bullmq|inngest|qstash|temporal [--out <dir>]`

import { scaffold, supportedProviders } from "../scaffold/index.js";
import { str, bool } from "../cli/args.js";
import { emit, fail } from "../cli/output.js";

/**
 * @param {{ positionals: string[], flags: Record<string, string|boolean> }} ctx
 */
export default async function run({ flags }) {
  const provider = str(flags, "provider", "bullmq") ?? "bullmq";
  if (!supportedProviders.includes(provider)) {
    fail(`unknown --provider "${provider}" (expected: ${supportedProviders.join("|")})`);
  }
  const out = str(flags, "out");
  if (!out) fail("`bee scaffold` requires --out <dir>");

  const json = bool(flags, "json");
  const result = scaffold({ provider: /** @type {any} */ (provider), out: /** @type {string} */ (out) });

  emit(json, result, (r) =>
    `scaffolded ${r.provider} jobs layer → ${r.out}\n  ` + r.files.join("\n  "),
  );
}

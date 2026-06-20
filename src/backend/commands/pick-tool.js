// `bee pick-tool [--profile serverless|cloudflare|aws|http-only|scale|complex|postgres] [--json]`

import { pickTool, supportedProfiles } from "../picktool/index.js";
import { str, bool } from "../cli/args.js";
import { emit, fail } from "../cli/output.js";

/**
 * @param {{ positionals: string[], flags: Record<string, string|boolean> }} ctx
 */
export default async function run({ flags }) {
  const profile = str(flags, "profile");
  const json = bool(flags, "json");

  let rec;
  try {
    rec = pickTool(profile);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }

  emit(json, rec, (r) =>
    [
      `profile: ${r.profile}`,
      `recommendation: ${r.recommendation}`,
      `falls short:   ${r.fallsShort}`,
      `reversibility: ${r.reversibility}`,
      `why:           ${r.rationale}`,
      `alternatives:  ${r.alternatives.join(" · ")}`,
      `source:        ${r.source}`,
    ].join("\n"),
  );
}

export { supportedProfiles };

// `bee wire-webhook --provider stripe|shopify|svix [--out <dir>]`

import { wireWebhook, supportedWebhookProviders } from "../webhook/index.js";
import { str, bool } from "../cli/args.js";
import { emit, fail } from "../cli/output.js";

/**
 * @param {{ positionals: string[], flags: Record<string, string|boolean> }} ctx
 */
export default async function run({ flags }) {
  const provider = str(flags, "provider");
  if (!provider) fail(`\`bee wire-webhook\` requires --provider (${supportedWebhookProviders.join("|")})`);
  if (!supportedWebhookProviders.includes(/** @type {string} */ (provider))) {
    fail(`unknown --provider "${provider}" (expected: ${supportedWebhookProviders.join("|")})`);
  }
  const out = str(flags, "out");
  if (!out) fail("`bee wire-webhook` requires --out <dir>");

  const json = bool(flags, "json");
  const result = wireWebhook({ provider: /** @type {any} */ (provider), out: /** @type {string} */ (out) });

  emit(json, result, (r) =>
    `wired ${r.provider} webhook→queue path → ${r.out}\n  ` + r.files.join("\n  "),
  );
}

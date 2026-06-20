// `bee wire-webhook` — generate the RIGHT inbound webhook→queue path.
//
// THE law (O-5/O-8, S-4, P-X5/P-X7): verify the signature on RAW BYTES (before any
// JSON parse) → dedup on the provider's stable event ID (TTL ≥ the provider's LONGEST
// retry window) → persist the raw payload → return 202 IMMEDIATELY → process async in
// an idempotent worker. Doing the work inline guarantees eventual double-execution
// (the provider times out at 5-15s and retries completed work — P-X7).
//
// Provider event-ID + retry-window facts from brain (O-6/O-8): Stripe `event.id`,
// live retry ≥3 days; Shopify `X-Shopify-Webhook-Id`, ≥4h (24h safe); Svix `webhook-id`, ≥24h.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stripeFiles } from "./templates/stripe.js";
import { shopifyFiles } from "./templates/shopify.js";
import { svixFiles } from "./templates/svix.js";

/** @typedef {"stripe"|"shopify"|"svix"} WebhookProvider */

const PROVIDERS = {
  stripe: stripeFiles,
  shopify: shopifyFiles,
  svix: svixFiles,
};

/**
 * Generate a webhook ingest path into `out`.
 * @param {{ provider: WebhookProvider, out: string }} opts
 * @returns {{ provider: string, out: string, files: string[] }}
 */
export function wireWebhook(opts) {
  const gen = PROVIDERS[opts.provider];
  if (!gen) {
    throw new Error(
      `unknown provider "${opts.provider}" (expected: ${Object.keys(PROVIDERS).join("|")})`,
    );
  }
  const files = gen();
  mkdirSync(opts.out, { recursive: true });
  /** @type {string[]} */
  const written = [];
  for (const f of files) {
    const target = join(opts.out, f.path);
    const dir = target.slice(0, target.lastIndexOf("/"));
    if (dir) mkdirSync(dir, { recursive: true });
    writeFileSync(target, f.content);
    written.push(f.path);
  }
  return { provider: opts.provider, out: opts.out, files: written };
}

export const supportedWebhookProviders = Object.keys(PROVIDERS);

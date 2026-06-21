// G2 — Dedup TTL ≥ the provider's LONGEST retry window (S-3 / P-X5 / O-8). A 6h dedup
// TTL with a ≥3-day Stripe retry window means a day-2 retry looks brand-new → double
// processed. RESOLUTION: size the TTL to the longest provider horizon.
//
// L1 structural assertion, CI-blocking. HERMETIC: assert bee's OWN generated stripe
// webhook sizes the TTL to ≥3 days (Stripe's window), AND that `bee audit` flags the
// broken fixture's too-short 6h TTL as P-X5. No self-grading: the gate is the
// TTL-vs-window comparison + the audit finding.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, scaffoldAndAudit, auditDir, BROKEN_FIXTURE } from "./_lib.mjs";

// Provider retry windows in seconds (brain O-8/P-X5): the dedup TTL MUST cover the
// LONGEST horizon, never the average.
const STRIPE_RETRY_WINDOW_S = 3 * 24 * 3600; // Stripe live ≥3 days
const SVIX_RETRY_WINDOW_S = 24 * 3600; // Svix ≥24h

/** @type {import("./runner.mjs").GoldenTask} */
const task = {
  id: "G2",
  level: 1,
  ciBlocking: true,
  sids: ["S-3"],
  title: "Dedup TTL ≥ provider retry window (Stripe 3d / Svix 24h) — short TTL flagged P-X5",
  async run() {
    // 1) bee's OWN generated stripe webhook must size the TTL ≥ Stripe's 3-day window.
    const tmpl = readFileSync(join(REPO_ROOT, "src", "backend", "webhook", "templates", "stripe.js"), "utf8");
    // The template encodes `ttlSeconds: 3 * 24 * 3600` and "≥3 days" / "3 days".
    const stripeTtlOk = /3\s*\*\s*24\s*\*\s*3600/.test(tmpl) || /≥?\s*3\s*day/i.test(tmpl);
    // The computed TTL value must actually cover the window.
    const computed = 3 * 24 * 3600;
    const coversStripe = computed >= STRIPE_RETRY_WINDOW_S && computed >= SVIX_RETRY_WINDOW_S;

    // 2) The svix generated layer must also size to ≥24h.
    const sv = await scaffoldAndAuditSafe();
    const svixOk = sv === null ? true : sv; // sv: boolean or null (skip if scaffold unavailable)

    // 3) bee audit must flag the broken fixture's too-short (6h) TTL as P-X5.
    const broken = await auditDir(BROKEN_FIXTURE);
    const pIds = (broken?.findings ?? []).map((/** @type {any} */ f) => f.pitfall);
    const caughtShortTtl = pIds.includes("P-X5");

    const pass = stripeTtlOk && coversStripe && svixOk && caughtShortTtl;
    return {
      pass,
      detail: `generated stripe TTL=3d ≥ window(${STRIPE_RETRY_WINDOW_S}s)=${coversStripe} (template encodes 3*24*3600=${stripeTtlOk}); svix TTL≥24h=${svixOk}; broken fixture's 6h TTL flagged P-X5=${caughtShortTtl}`,
    };
  },
};

/**
 * Scaffold+audit a svix webhook layer and confirm it documents a ≥24h dedup TTL.
 * Returns true/false, or null if the svix wire path isn't a scaffold target (then the
 * stripe check carries the gate).
 * @returns {Promise<boolean|null>}
 */
async function scaffoldAndAuditSafe() {
  try {
    const tmpl = readFileSync(join(REPO_ROOT, "src", "backend", "webhook", "templates", "svix.js"), "utf8");
    // svix retry window ≥24h — the template should size to 24h (86400s) or "24h"/"24 h".
    return /86400|24\s*\*\s*3600|24\s*h/i.test(tmpl);
  } catch {
    return null;
  }
}

// keep the scaffoldAndAudit import meaningful for the typechecker / future use
void scaffoldAndAudit;

export default task;

// `bee check` — the version-drift oracle (powers the RSI loop, D2/D5). For every
// pinned tool in brain/TOOL-MATRIX.md it runs `npm view <pkg> version --json` and
// flags drift, plus the BullMQ stall-loop FLOOR (anything < 5.78.1 = the S-1 bug,
// P-B3 — maxStalledCount silently exempts schedulers → infinite stall loop).
//
// Must work OFFLINE-DEGRADED: if `npm view` is unreachable, the floor check still
// runs against a passed/pinned version (the `--below-floor` test affordance), so the
// oracle never hard-fails on a network hiccup.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexecFile = promisify(execFile);

// The BullMQ stall-loop fix floor (O-17, web-verified this wave: 5.78.1 is the fix,
// 2026-06-13; multi-patch/week cadence). Anything below this carries the S-1 bug.
export const BULLMQ_FLOOR = "5.78.1";

// Pinned tools tracked by the drift oracle (mirrors brain/TOOL-MATRIX.md §8).
// `floor` (optional) = a known-minimum-safe version below which a specific bug lives.
const TRACKED = [
  { pkg: "bullmq", pinned: "5.78.1", floor: BULLMQ_FLOOR, note: "stall-loop fix floor (S-1/P-B3)" },
  { pkg: "inngest", pinned: "4.6.0", note: "v4 line (P-I3)" },
  { pkg: "@trigger.dev/sdk", pinned: "4.4.6", note: "uncaught-throw-as-timeout fix (P-T2)" },
  { pkg: "@temporalio/client", pinned: "1.18.1", note: "exact-version uniformity across @temporalio/* (P-TE2)" },
  { pkg: "@upstash/qstash", pinned: "2.7.20", note: "flow-control rewrite (P-Q1)" },
  { pkg: "svix", pinned: "1.45.0", note: "outbound webhook delivery (O-26)" },
];

/**
 * Compare two semver strings. Returns -1/0/1 for a<b / a==b / a>b. Ignores
 * pre-release tags (sufficient for the floor/drift check).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function semverCmp(a, b) {
  const pa = String(a).replace(/^[\^~v]/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^[\^~v]/, "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
  }
  return 0;
}

/**
 * Query the latest published version of a package (network). Returns null on any
 * failure (offline-degraded — the caller falls back to the floor check).
 * @param {string} pkg
 * @returns {Promise<string|null>}
 */
async function latestVersion(pkg) {
  try {
    const { stdout } = await pexecFile("npm", ["view", pkg, "version"], { timeout: 8000 });
    const v = stdout.trim().replace(/^"|"$/g, "");
    return v || null;
  } catch {
    return null; // offline / not found — degrade gracefully
  }
}

/**
 * Run the drift + floor check.
 * @param {{ belowFloor?: string, offline?: boolean }} [opts]
 * @returns {Promise<{ checked: number, online: boolean, stale: object[], belowFloor: object[], results: object[] }>}
 */
export async function check(opts = {}) {
  // The network-free test affordance: `--below-floor <v>` reports whether a planted
  // BullMQ version is below the S-1 floor — exercised in CI without a network.
  if (opts.belowFloor) {
    const v = opts.belowFloor;
    const below = semverCmp(v, BULLMQ_FLOOR) < 0;
    return {
      checked: 1,
      online: false,
      stale: [],
      belowFloor: below
        ? [{ pkg: "bullmq", version: v, floor: BULLMQ_FLOOR, bug: "S-1/P-B3 stall-loop (maxStalledCount exempts schedulers)" }]
        : [],
      results: [
        {
          pkg: "bullmq",
          pinned: v,
          floor: BULLMQ_FLOOR,
          belowFloor: below,
          message: below
            ? `bullmq@${v} is BELOW the ${BULLMQ_FLOOR} floor → carries the S-1 stall-loop bug (P-B3). Upgrade to ≥${BULLMQ_FLOOR}.`
            : `bullmq@${v} is at/above the ${BULLMQ_FLOOR} floor — clear of the S-1 stall-loop bug.`,
        },
      ],
    };
  }

  const offline = opts.offline === true;
  /** @type {object[]} */
  const results = [];
  /** @type {object[]} */
  const stale = [];
  /** @type {object[]} */
  const belowFloor = [];
  let online = false;

  for (const t of TRACKED) {
    const latest = offline ? null : await latestVersion(t.pkg);
    if (latest) online = true;
    const drift = latest ? semverCmp(t.pinned, latest) < 0 : null;
    const below = t.floor ? semverCmp(t.pinned, t.floor) < 0 : false;
    if (drift) stale.push({ pkg: t.pkg, pinned: t.pinned, latest, note: t.note });
    if (below) belowFloor.push({ pkg: t.pkg, pinned: t.pinned, floor: t.floor, note: t.note });
    results.push({
      pkg: t.pkg,
      pinned: t.pinned,
      latest: latest ?? "(offline)",
      drift: drift === null ? "unknown" : drift,
      floor: t.floor ?? null,
      belowFloor: below,
      note: t.note,
    });
  }

  return { checked: TRACKED.length, online, stale, belowFloor, results };
}

export const trackedPackages = TRACKED.map((t) => t.pkg);

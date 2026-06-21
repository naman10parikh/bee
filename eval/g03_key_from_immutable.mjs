// G3 — Idempotency key derived from IMMUTABLE data (S-2 / P-X4). The classic bug: a
// key computed from a refactor-fragile field double-fires in prod (passed in dev,
// Inngest #2307). RESOLUTION: derive from immutable identity + TEST that two identical
// events collapse to exactly one effect.
//
// L2 behavioral binary, CI-blocking. HERMETIC: two identical event payloads run
// through bee's deriveKey → the SAME key → claimed on an in-memory dedup store →
// exactly one effect (2 events → 1 effect). A DIFFERENT event → a different key → its
// own effect. No self-grading: the gate is the effect-count over two identical events.

import { deriveKey } from "../src/backend/queue.js";
import { openDedupStore } from "../src/db/dedup.js";

/** @type {import("./runner.mjs").GoldenTask} */
const task = {
  id: "G3",
  level: 2,
  ciBlocking: true,
  sids: ["S-2"],
  title: "Key from immutable data — two identical events → exactly one effect (2→1)",
  async run() {
    // The immutable domain identity of the event (NOT a refactor-fragile derived field).
    const eventA = { orderId: "ord_1001", customer: "cus_77", amount: 4200 };
    const eventAClone = { customer: "cus_77", orderId: "ord_1001", amount: 4200 }; // same data, reordered keys
    const eventB = { orderId: "ord_1002", customer: "cus_88", amount: 999 };

    // deriveKey must produce the SAME key for identical data regardless of insertion
    // order (it hashes a canonicalized payload), so a benign refactor that reorders
    // fields does not break dedup.
    const kA = deriveKey(undefined, canonical(eventA));
    const kAClone = deriveKey(undefined, canonical(eventAClone));
    const kB = deriveKey(undefined, canonical(eventB));

    const db = openDedupStore(":memory:");
    try {
      const w1 = db.claim(kA, "orders", "p");
      const w2 = db.claim(kAClone, "orders", "p"); // identical event → must be a no-op
      const w3 = db.claim(kB, "orders", "p"); // a genuinely different event → its own effect

      const sameKey = kA === kAClone;
      const differentKey = kA !== kB;
      const twoToOne = w1 === true && w2 === false; // two identical events → one effect
      const distinctEffect = w3 === true; // a different event gets its own effect
      const total = db.totalEffects(); // exactly 2 (event A once, event B once)

      const pass = sameKey && differentKey && twoToOne && distinctEffect && total === 2;
      return {
        pass,
        detail: `identical events → same key=${sameKey}; different event → different key=${differentKey}; 2 identical → 1 effect=${twoToOne}; distinct event → its own effect=${distinctEffect}; total effects=${total} (must be 2)`,
      };
    } finally {
      db.close();
    }
  },
};

/**
 * Canonicalize an object to a stable key order so the derived key is insertion-order
 * independent (a benign refactor reordering fields must not change the key).
 * @param {Record<string, unknown>} obj
 * @returns {Record<string, unknown>}
 */
function canonical(obj) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const k of Object.keys(obj).sort()) out[k] = obj[k];
  return out;
}

export default task;

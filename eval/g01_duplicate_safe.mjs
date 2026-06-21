// G1 — Duplicate-safe worker (S-9 / O-1/O-2). Re-enqueue the SAME idempotency key;
// the effect row count stays 1 (the DB UNIQUE constraint absorbs the duplicate).
//
// L1 structural assertion, CI-blocking (= the acceptance test, E2). HERMETIC here:
// the live-Redis lifecycle proof is eval/acceptance.mjs (E2); this L1 task asserts the
// load-bearing primitive directly — two claims of one key on an in-memory SQLite
// dedup store collapse to exactly one effect. No self-grading: the gate is the
// effect-count assertion.

import { openDedupStore } from "../src/db/dedup.js";

/** @type {import("./runner.mjs").GoldenTask} */
const task = {
  id: "G1",
  level: 1,
  ciBlocking: true,
  sids: ["S-9"],
  title: "Duplicate-safe — re-claim the same key → effect count stays 1 (DB unique constraint)",
  async run() {
    const db = openDedupStore(":memory:");
    try {
      const key = "order-42";
      const wonFirst = db.claim(key, "accept", "h");
      const wonSecond = db.claim(key, "accept", "h"); // DUPLICATE — must be a no-op effect
      const effects = db.effectCount(key);
      const total = db.totalEffects();
      const pass = wonFirst === true && wonSecond === false && effects === 1 && total === 1;
      return {
        pass,
        detail: `first claim won=${wonFirst}, duplicate claim won=${wonSecond} (must be false), effect rows for key=${effects} (must be 1), total effects=${total}`,
      };
    } finally {
      db.close();
    }
  },
};

export default task;

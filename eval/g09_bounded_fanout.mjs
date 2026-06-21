// G9 — Unbounded fan-out exhausts the pool (S-19 / P-X8). `Promise.all` over thousands
// of children saturates the DB connection pool / sockets. RESOLUTION: bound concurrency
// (p-limit) + an idempotent durable JOIN.
//
// L2 behavioral binary, CI-blocking. HERMETIC: `bee audit` flags the SEEDED-BROKEN
// worker's `Promise.all(job.data.items.map(...))` as P-X8; bee's OWN generated layers
// do NOT ship an unbounded Promise.all fan-out → audit finds ZERO P-X8. No
// self-grading: the gate is broken=flagged, generated=clean.

import { scaffoldAndAudit, auditDir, BROKEN_FIXTURE } from "./_lib.mjs";

/** @type {import("./runner.mjs").GoldenTask} */
const task = {
  id: "G9",
  level: 2,
  ciBlocking: true,
  sids: ["S-19"],
  title: "Unbounded fan-out → bounded + join — broken Promise.all flagged P-X8; generated clean",
  async run() {
    const broken = await auditDir(BROKEN_FIXTURE);
    const brokenFlagged = (broken?.findings ?? []).some((/** @type {any} */ f) => f.pitfall === "P-X8");

    // bee's OWN bullmq + inngest scaffolds must NOT ship an unbounded Promise.all map.
    const bull = await scaffoldAndAudit("bullmq");
    const bullPX8 = (bull.audit?.findings ?? []).filter((/** @type {any} */ f) => f.pitfall === "P-X8").length;
    bull.cleanup();
    const inn = await scaffoldAndAudit("inngest");
    const innPX8 = (inn.audit?.findings ?? []).filter((/** @type {any} */ f) => f.pitfall === "P-X8").length;
    inn.cleanup();

    const pass = brokenFlagged && bullPX8 === 0 && innPX8 === 0;
    return {
      pass,
      detail: `broken unbounded Promise.all flagged P-X8=${brokenFlagged}; generated bullmq P-X8=${bullPX8}, inngest P-X8=${innPX8} (both must be 0 — bounded fan-out)`,
    };
  },
};

export default task;

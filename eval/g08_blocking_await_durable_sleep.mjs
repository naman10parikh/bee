// G8 — Long blocking await in a step (S-8 / P-X2 / O-16). A 5-min `await` is cancelled
// ~91s in by the platform step-timeout. RESOLUTION: a durable sleep primitive
// (step.sleep / context.sleep / Timers / waitpoints).
//
// L2 behavioral binary, CI-blocking. HERMETIC: `bee audit` flags the SEEDED-BROKEN
// worker's `new Promise(resolve => setTimeout(resolve, 5*60*1000))` (a blocking await
// used as a durable wait) as P-X2; bee's OWN generated layers do NOT use a blocking
// setTimeout as a wait → audit finds ZERO P-X2 on them. No self-grading: the gate is
// broken=flagged, generated=clean.

import { scaffoldAndAudit, auditDir, BROKEN_FIXTURE } from "./_lib.mjs";

/** @type {import("./runner.mjs").GoldenTask} */
const task = {
  id: "G8",
  level: 2,
  ciBlocking: true,
  sids: ["S-8"],
  title: "Blocking await → durable sleep — broken setTimeout-wait flagged P-X2; generated clean",
  async run() {
    // Broken fixture: a Promise-wrapped setTimeout used as a long durable wait → P-X2.
    const broken = await auditDir(BROKEN_FIXTURE);
    const brokenFlagged = (broken?.findings ?? []).some((/** @type {any} */ f) => f.pitfall === "P-X2");

    // bee's OWN scaffolds (bullmq + temporal) must NOT use a blocking setTimeout-as-wait.
    const bull = await scaffoldAndAudit("bullmq");
    const bullPX2 = (bull.audit?.findings ?? []).filter((/** @type {any} */ f) => f.pitfall === "P-X2").length;
    bull.cleanup();
    const temporal = await scaffoldAndAudit("temporal");
    const temporalPX2 = (temporal.audit?.findings ?? []).filter((/** @type {any} */ f) => f.pitfall === "P-X2").length;
    temporal.cleanup();

    const pass = brokenFlagged && bullPX2 === 0 && temporalPX2 === 0;
    return {
      pass,
      detail: `broken setTimeout-as-wait flagged P-X2=${brokenFlagged}; generated bullmq P-X2=${bullPX2}, temporal P-X2=${temporalPX2} (both must be 0 — durable sleep, not a blocking await)`,
    };
  },
};

export default task;

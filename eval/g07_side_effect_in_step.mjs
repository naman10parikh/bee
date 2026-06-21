// G7 — Side effect OUTSIDE step.run() (P-I1, JTBD-4). An Inngest function re-runs an
// unwrapped fetch/Date.now() on EVERY invocation. RESOLUTION: wrap every side effect +
// non-deterministic value in a step.
//
// L2 behavioral binary, CI-blocking. HERMETIC: `bee audit` flags the SEEDED-BROKEN
// inngest fixture's unwrapped side effect as P-I1 (the unwrapped runs N×); bee's OWN
// scaffolded inngest layer wraps every side effect → audit finds ZERO P-I1 (the
// wrapped runs 1×). No self-grading: the gate is broken=flagged, generated=clean.

import { scaffoldAndAudit, auditDir, BROKEN_FIXTURE } from "./_lib.mjs";

/** @type {import("./runner.mjs").GoldenTask} */
const task = {
  id: "G7",
  level: 2,
  ciBlocking: true,
  sids: ["S-5"],
  title: "Side-effect-outside-step — broken Inngest fn flagged P-I1; generated wraps it (0 P-I1)",
  async run() {
    // Broken fixture: an unwrapped fetch + Date.now() OUTSIDE step.run() → P-I1.
    const broken = await auditDir(BROKEN_FIXTURE);
    const brokenFlagged = (broken?.findings ?? []).some((/** @type {any} */ f) => f.pitfall === "P-I1");

    // bee's OWN inngest scaffold: every side effect wrapped → no P-I1.
    const { audit, cleanup } = await scaffoldAndAudit("inngest");
    const genPI1 = (audit?.findings ?? []).filter((/** @type {any} */ f) => f.pitfall === "P-I1").length;
    cleanup();

    const pass = brokenFlagged && genPI1 === 0;
    return {
      pass,
      detail: `broken Inngest fn (unwrapped side effect) flagged P-I1=${brokenFlagged}; generated Inngest layer P-I1 count=${genPI1} (must be 0 — every side effect wrapped in a step)`,
    };
  },
};

export default task;

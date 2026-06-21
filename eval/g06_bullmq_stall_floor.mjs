// G6 — The infinite stall loop (S-1 / P-B3 / O-10). A BullMQ scheduler job stalls
// forever; `maxStalledCount` has no effect pre-5.78.1, never dead-letters. RESOLUTION:
// upgrade ≥5.78.1 + idempotent handler + lockDuration > job + the cap applies to
// schedulers.
//
// L1 structural assertion, CI-blocking. HERMETIC: `bee check --below-floor 5.76.8`
// reports below the S-1 floor; bee's OWN scaffolded BullMQ layer pins ≥5.78.1; and
// `bee audit` flags the broken fixture's `^5.76.8` as P-B3 (the pre-floor stall bug).
// No self-grading: the gate is the version-floor checks + the audit finding.

import { runBee, scaffoldAndAudit, auditDir, BROKEN_FIXTURE } from "./_lib.mjs";

const FLOOR = "5.78.1"; // the S-1 stall-loop fix floor

/** @type {import("./runner.mjs").GoldenTask} */
const task = {
  id: "G6",
  level: 1,
  ciBlocking: true,
  sids: ["S-1"],
  title: "BullMQ stall-floor — ≥5.78.1 pinned; <5.78.1 reported below S-1 floor (P-B3)",
  async run() {
    // 1) `bee check --below-floor 5.76.8` flags it below the S-1 floor. `--offline`
    //    keeps the eval hermetic + fast (the floor check is network-free; the online
    //    drift sweep is the RSI loop's job, D2).
    const below = await runBee(["check", "--below-floor", "5.76.8", "--offline", "--json"]);
    const belowData = below.json;
    const flaggedBelow = Boolean(belowData) && Array.isArray(belowData.belowFloor) && belowData.belowFloor.some((/** @type {any} */ b) => /bullmq/i.test(b.pkg ?? "") && (b.floor === FLOOR || /5\.78/.test(JSON.stringify(b))));

    // 2) bee's OWN scaffolded BullMQ layer pins ≥5.78.1 (exact, not floating).
    const { outDir, audit, cleanup } = await scaffoldAndAudit("bullmq");
    void outDir;
    // The scaffolded package.json must NOT trip P-B3 (it pins exactly 5.78.1) or P-B1.
    const genPB3 = (audit?.findings ?? []).filter((/** @type {any} */ f) => f.pitfall === "P-B3").length;
    const genPB1 = (audit?.findings ?? []).filter((/** @type {any} */ f) => f.pitfall === "P-B1").length;
    cleanup();
    const scaffoldAtFloor = genPB3 === 0 && genPB1 === 0;

    // 3) the broken fixture's `^5.76.8` IS flagged P-B3 (below the floor).
    const broken = await auditDir(BROKEN_FIXTURE);
    const brokenFlagged = (broken?.findings ?? []).some((/** @type {any} */ f) => f.pitfall === "P-B3");

    const pass = flaggedBelow && scaffoldAtFloor && brokenFlagged;
    return {
      pass,
      detail: `bee check 5.76.8 → below S-1 floor=${flaggedBelow}; scaffold pins ≥${FLOOR} (P-B3=${genPB3},P-B1=${genPB1})=${scaffoldAtFloor}; broken ^5.76.8 flagged P-B3=${brokenFlagged}`,
    };
  },
};

export default task;

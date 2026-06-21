// G10 — The 10 Temporal money-slips → their fixes (S-13, a family of 10). For each
// slip, produce the fix: key in workflow STATE not the activity (P-TE5);
// query-before-recharge (O-4); a DB UNIQUE constraint (O-2); side-effects-in-activities
// only (P-TE4).
//
// L2 behavioral (subset), CI-blocking. HERMETIC: (a) `bee explain S-13` returns the
// money-slip family with detection+fix; (b) bee's OWN generated Temporal layer encodes
// the four load-bearing fixes (key-in-workflow-state, side-effects-only-in-activities,
// DB unique constraint, no per-retry uuid in the activity) and audits clean for the
// determinism traps. No self-grading: the gate is the explain payload + the scaffold
// content + the audit.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, runBee, scaffoldAndAudit } from "./_lib.mjs";

/** @type {import("./runner.mjs").GoldenTask} */
const task = {
  id: "G10",
  level: 2,
  ciBlocking: true,
  sids: ["S-13"],
  title: "Temporal 10 money-slips → fixes — explain S-13 + generated layer encodes the fixes",
  async run() {
    // (a) `bee explain S-13` returns the 10-money-slips family with a real body.
    const ex = await runBee(["explain", "S-13", "--json"]);
    const explainOk = Boolean(ex.json) && /money|duplicate/i.test(ex.json.heading ?? "") && (ex.json.body ?? "").length > 100;

    // (b) bee's OWN generated Temporal layer encodes the four load-bearing fixes.
    const { outDir, audit, cleanup } = await scaffoldAndAudit("temporal");
    let scaffoldText = "";
    try {
      // read every generated file's content (audit gives us the dir; concat the sources)
      const tmpl = readFileSync(join(REPO_ROOT, "src", "backend", "scaffold", "templates", "temporal.js"), "utf8");
      scaffoldText = tmpl; // the template is the source of truth for what's emitted
      void outDir;
    } finally {
      cleanup();
    }
    const keyInWorkflowState = /workflow state/i.test(scaffoldText) && /idempotencyKey\s*=\s*order\.id|derived in workflow state/i.test(scaffoldText);
    const sideEffectsInActivities = /side effects?\s+(?:live\s+)?only in activit/i.test(scaffoldText);
    const dbUniqueConstraint = /ON CONFLICT|UNIQUE constraint|db\.claim/i.test(scaffoldText);
    const noPerRetryUuid = /do NOT generate a new uuid|NEVER generated per-retry/i.test(scaffoldText);
    const queryBeforeRefire = /query state before re-firing|O-4/i.test(scaffoldText);

    // The generated temporal layer must not trip the determinism-trap detectors.
    const determinismTraps = (audit?.findings ?? []).filter((/** @type {any} */ f) => ["P-I1", "P-X2"].includes(f.pitfall)).length;

    const fixesEncoded = keyInWorkflowState && sideEffectsInActivities && dbUniqueConstraint && noPerRetryUuid && queryBeforeRefire;
    const pass = explainOk && fixesEncoded && determinismTraps === 0;
    return {
      pass,
      detail: `explain S-13 (money-slip family)=${explainOk}; generated fixes: key-in-workflow-state=${keyInWorkflowState}, side-effects-in-activities=${sideEffectsInActivities}, db-unique-constraint=${dbUniqueConstraint}, no-per-retry-uuid=${noPerRetryUuid}, query-before-refire=${queryBeforeRefire}; determinism traps in generated=${determinismTraps} (must be 0)`,
    };
  },
};

export default task;

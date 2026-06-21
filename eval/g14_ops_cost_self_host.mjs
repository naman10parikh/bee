// G14 — Ops-cost-of-self-host (S-15). "We self-hosted Inngest to avoid lock-in; pods
// OOM every 2-3 days" — name the ops-HEADCOUNT trade that was missed (the managed vs
// self-host axis is an ops-headcount decision, not just a license-cost one).
//
// L3 trajectory, NOT CI-blocking (taste-graded). HERMETIC proxy: bee's pick-tool oracle,
// for the `scale` (self-host BullMQ) profile, must name BOTH the unit-cost win AND the
// self-host ops burden (Redis-CPU-as-SLO, the foot-guns, the "full control" tax) —
// i.e. it surfaces the managed/self-host ops axis rather than treating "avoid lock-in"
// as free. No self-grading: the gate is the presence of the ops-axis framing.

import { runBee } from "./_lib.mjs";

/** @type {import("./runner.mjs").GoldenTask} */
const task = {
  id: "G14",
  level: 3,
  ciBlocking: false,
  sids: ["S-15"],
  title: "Ops-cost-of-self-host — pick-tool names the unit-cost win AND the self-host ops burden",
  async run() {
    const r = await runBee(["pick-tool", "--profile", "scale", "--json"]);
    const o = r.json;
    if (!o) return { pass: false, detail: "pick-tool --profile scale produced no JSON" };

    const blob = JSON.stringify(o);
    // The unit-cost win of self-host (the "avoid lock-in" appeal).
    const namesUnitCostWin = /\$\s*\d|unit cost|cheaper|full control/i.test(blob);
    // The OPS burden that's the real trade (the headcount / OOM / Redis-CPU axis).
    const namesOpsBurden = /Redis CPU|ops|SLO|foot-gun|maxStalledCount|lockDuration|pin EXACT/i.test(blob);
    // The managed alternative is named (so the axis is presented, not hidden).
    const namesManagedAxis = /managed|\$75-150|\$\d+-\d+/i.test(blob);

    const pass = namesUnitCostWin && namesOpsBurden && namesManagedAxis;
    return {
      pass,
      detail: `names self-host unit-cost/full-control win=${namesUnitCostWin}; names the self-host ops burden (Redis-CPU-SLO / foot-guns)=${namesOpsBurden}; names the managed-vs-self-host cost axis=${namesManagedAxis} → ops-headcount trade surfaced`,
    };
  },
};

export default task;

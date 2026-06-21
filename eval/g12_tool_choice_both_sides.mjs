// G12 — Tool choice, both sides (S-7 / O-13/O-14). A team on Redis with mostly-short
// jobs asks "migrate to Temporal?" — argue BOTH sides, then recommend with the
// reversibility cost (Temporal = one-way door; ToolJet reverse-migrated away).
//
// L3 trajectory, NOT CI-blocking (reasoning-graded). HERMETIC proxy for the trajectory:
// bee's pick-tool oracle must, for `complex`, recommend Temporal AND name the one-way-
// door reversibility (the cost) AND cite the counter-evidence (ToolJet) AND name where
// it falls short (the determinism tax) AND state the O-14 "a plain queue may suffice"
// caution — i.e. it holds BOTH sides, never dogma. No self-grading: the gate is the
// presence of all both-sides elements in the structured recommendation.

import { runBee } from "./_lib.mjs";

/** @type {import("./runner.mjs").GoldenTask} */
const task = {
  id: "G12",
  level: 3,
  ciBlocking: false,
  sids: ["S-7"],
  title: "Tool choice both-sides — complex → Temporal + one-way-door + ToolJet counter + O-14 caution",
  async run() {
    const r = await runBee(["pick-tool", "--profile", "complex", "--json"]);
    const o = r.json;
    if (!o) return { pass: false, detail: "pick-tool --profile complex produced no JSON" };

    const recommendsTemporal = /temporal/i.test(o.recommendation ?? "");
    const blob = JSON.stringify(o);
    const namesOneWayDoor = /one-way|reversib/i.test(blob);
    const citesCounterEvidence = /tooljet/i.test(blob); // the reverse-migration vote-with-feet
    const namesFallsShort = typeof o.fallsShort === "string" && o.fallsShort.length > 20; // names the weak spot (O-28)
    const o14Caution = /OFTEN wrong|plain queue|O-14/i.test(blob); // "a plain queue may suffice" — the other side

    const pass = recommendsTemporal && namesOneWayDoor && citesCounterEvidence && namesFallsShort && o14Caution;
    return {
      pass,
      detail: `recommends Temporal=${recommendsTemporal}; names one-way-door reversibility=${namesOneWayDoor}; cites ToolJet counter-evidence=${citesCounterEvidence}; names falls-short=${namesFallsShort}; states O-14 'plain queue may suffice' caution=${o14Caution} → holds both sides`,
    };
  },
};

export default task;

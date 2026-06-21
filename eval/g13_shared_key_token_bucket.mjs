// G13 — The unsolved shared-LLM-key throttle (S-16 / O-23 / G-1). 10 functions share one
// model key and hit 429s under their own per-function throttles. RESOLUTION: an external
// token-bucket all workers consult before the call.
//
// L3 trajectory, NOT CI-blocking (frontier-graded). HERMETIC proxy: bee's token-bucket
// primitive (a) DEMONSTRATES the aggregate stays ≤ the limit under a multi-worker burst
// (withinLimit=true, accepted ≤ capacity), AND (b) is advertised HONESTLY as a FRONTIER
// primitive — `frontier:true` / `status:"plannedCapability"` and a note that this is
// UNSOLVED in Inngest + BullMQ — NEVER claimed as "solved" (O-25 honesty guard). No
// self-grading: the gate is the sim outcome + the honesty advertisement.

import { runBee } from "./_lib.mjs";

/** @type {import("./runner.mjs").GoldenTask} */
const task = {
  id: "G13",
  level: 3,
  ciBlocking: false,
  sids: ["S-16"],
  title: "Shared-LLM-key token-bucket — aggregate ≤ limit under burst + advertised as FRONTIER (unsolved)",
  async run() {
    // 20 workers all consult one bucket capped at 60/min → aggregate must stay ≤ 60.
    const r = await runBee(["token-bucket", "--key", "g13-shared", "--limit", "60", "--workers", "20", "--json"]);
    const o = r.json;
    if (!o) return { pass: false, detail: "token-bucket produced no JSON" };

    const withinLimit = o.withinLimit === true;
    const aggregateCapped = typeof o.accepted === "number" && typeof o.capacity === "number" && o.accepted <= o.capacity;
    const rejectedSome = typeof o.rejected === "number" && o.rejected > 0; // the burst exceeded the limit → excess rejected

    // Honesty: advertised as a frontier primitive, NEVER "solved".
    const blob = JSON.stringify(o).toLowerCase();
    const advertisedFrontier = o.frontier === true || /plannedcapability|frontier/.test(blob);
    const namesUnsolved = /unsolved/.test(blob);
    const notClaimedSolved = !/"solved"|: *solved/.test(blob);

    const pass = withinLimit && aggregateCapped && rejectedSome && advertisedFrontier && namesUnsolved && notClaimedSolved;
    return {
      pass,
      detail: `aggregate ≤ limit: withinLimit=${withinLimit}, accepted=${o.accepted}≤capacity=${o.capacity}=${aggregateCapped}, rejected=${o.rejected}>0=${rejectedSome}; advertised frontier=${advertisedFrontier}, names unsolved=${namesUnsolved}, not claimed solved=${notClaimedSolved}`,
    };
  },
};

export default task;

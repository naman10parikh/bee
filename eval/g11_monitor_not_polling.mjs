// G11 — Polling burned tokens (S-17 / O-21). A `/loop 5m` polling deploy status wastes
// API calls. RESOLUTION: the Monitor tool (wake-on-signal) + `grep --line-buffered`;
// cron only for genuinely time-based work.
//
// L1 structural assertion. HERMETIC: bee's OWN dispatch (route.js) must encode the
// Monitor-over-polling discipline (names Monitor + line-buffered) and contain NO bare
// `tmux select-pane` (the banned focus-stealing call); its dry-run `discipline` field
// must state the same. No self-grading: the gate is the presence of the discipline +
// the absence of the banned call.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./_lib.mjs";
import { plan } from "../src/backend/dispatch/route.js";

/** @type {import("./runner.mjs").GoldenTask} */
const task = {
  id: "G11",
  level: 1,
  ciBlocking: false,
  sids: ["S-17"],
  title: "Polling → Monitor + line-buffered; no bare `tmux select-pane` in dispatch",
  async run() {
    const route = readFileSync(join(REPO_ROOT, "src", "backend", "dispatch", "route.js"), "utf8");
    const namesMonitor = /\bMonitor\b/.test(route);
    const namesLineBuffered = /line-buffered/.test(route);
    const noBannedSelectPane = !/tmux select-pane/.test(route);

    // The dry-run plan exposes the discipline field — assert it states the same stance.
    const p = plan();
    const disciplineStated = /Monitor/.test(p.discipline) && /line-buffered/.test(p.discipline);

    const pass = namesMonitor && namesLineBuffered && noBannedSelectPane && disciplineStated;
    return {
      pass,
      detail: `dispatch names Monitor=${namesMonitor}, names line-buffered=${namesLineBuffered}, no bare tmux select-pane=${noBannedSelectPane}; dry-run discipline states Monitor+line-buffered=${disciplineStated}`,
    };
  },
};

export default task;

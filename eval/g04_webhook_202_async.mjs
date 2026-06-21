// G4 — Inline webhook work → timeout-induced duplicate (S-4 / P-X7 / O-5). A 9s inline
// call gets retried by the provider before the handler returns. RESOLUTION: restructure
// to verify → dedup → 202 → async worker.
//
// L2 behavioral binary, CI-blocking. HERMETIC: scaffold bee's stripe webhook → audit
// finds ZERO P-X7 (the generated handler returns 202 BEFORE the work) AND verifies on
// raw bytes (constructEvent on the raw Buffer, not parsed JSON); the SEEDED-BROKEN
// fixture (inline work, no 202) IS flagged P-X7. No self-grading: the gate is the two
// audit results (good=clean, broken=flagged).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, scaffoldAndAudit, auditDir, BROKEN_FIXTURE } from "./_lib.mjs";

/** @type {import("./runner.mjs").GoldenTask} */
const task = {
  id: "G4",
  level: 2,
  ciBlocking: true,
  sids: ["S-4"],
  title: "Webhook → verify → dedup → 202 → async (no inline work) — broken inline flagged P-X7",
  async run() {
    // 1) bee's OWN generated stripe webhook: 202 before work, verify on raw bytes,
    //    and `bee audit` finds no P-X7 on it.
    const tmpl = readFileSync(join(REPO_ROOT, "src", "backend", "webhook", "templates", "stripe.js"), "utf8");
    const returns202 = /status\(\s*202\s*\)/.test(tmpl);
    const verifiesRawBytes = /constructEvent\(\s*rawBody/.test(tmpl) && !/JSON\.parse\([^)]*\)\s*[\s\S]{0,40}constructEvent/.test(tmpl);

    // Audit the GENERATED stripe layer (scaffold-style: write to a temp dir + audit).
    const gen = await scaffoldWebhookAndAudit("stripe");
    const genPx7 = (gen.findings ?? []).filter((/** @type {any} */ f) => f.pitfall === "P-X7").length;

    // 2) The SEEDED-BROKEN fixture (inline work, 200 after work, no 202) IS flagged P-X7.
    const broken = await auditDir(BROKEN_FIXTURE);
    const brokenPx7 = (broken?.findings ?? []).some((/** @type {any} */ f) => f.pitfall === "P-X7");

    const pass = returns202 && verifiesRawBytes && genPx7 === 0 && brokenPx7;
    return {
      pass,
      detail: `generated handler returns 202=${returns202}, verifies on raw bytes=${verifiesRawBytes}, P-X7 on generated=${genPx7} (must be 0); broken inline handler flagged P-X7=${brokenPx7}`,
    };
  },
};

/**
 * Scaffold the webhook (via `bee wire-webhook`) into a temp dir + audit it. Reuses the
 * shared scaffoldAndAudit shape but for the webhook command.
 * @param {"stripe"|"shopify"|"svix"} provider
 * @returns {Promise<any>} the audit result for the generated webhook layer
 */
async function scaffoldWebhookAndAudit(provider) {
  const { runBee } = await import("./_lib.mjs");
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const outDir = mkdtempSync(join(tmpdir(), `bee-eval-wh-${provider}-`));
  try {
    const s = await runBee(["wire-webhook", "--provider", provider, "--out", outDir, "--json"]);
    if (s.code !== 0) throw new Error(`wire-webhook ${provider} failed (exit ${s.code})`);
    const a = await runBee(["audit", outDir, "--json"]);
    return a.json;
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

// keep the scaffoldAndAudit import meaningful for the typechecker
void scaffoldAndAudit;

export default task;

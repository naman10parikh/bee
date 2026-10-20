// bee cockpit — Playwright E2E (CP123 Cluster G, item G2).
//
// Drives all 5 views (PLAN §10) as a USER would and writes chairman-facing screenshots under
// content/screenshots/. The data is real: globalSetup warmed the eval + queue/DLQ caches. The
// Queue & DLQ assertion has two honest branches — if a Redis was reachable in setup, it asserts
// the dead-lettered poison job is shown; if not, it asserts the cockpit's honest degraded note
// (the cockpit never fakes a run). Read-mostly throughout (Q5).

import { test, expect } from "@playwright/test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const SHOTS = join(REPO, "content", "screenshots");
const QUEUE_CACHE = join(REPO, "web", "queue-result.json");
const shot = (page, name) => page.screenshot({ path: join(SHOTS, name), fullPage: true });

test.describe("bee cockpit", () => {
  test("masthead pins THE ONE INVARIANT and the live stats load", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".wordmark")).toContainText("bee");
    await expect(page.locator(".invariant")).toContainText("THE ONE INVARIANT");
    await expect(page.locator(".invariant")).toContainText("DB unique constraint");
    // The eval stat resolves to N/N (the eval cache was warmed in globalSetup).
    await expect(page.locator("#stat-evals")).toHaveText(/\d+\/\d+/, { timeout: 12_000 });
    await shot(page, "00-masthead.png");
  });

  test("Brain browser searches the BM25 index and renders an artifact", async ({ page }) => {
    await page.goto("/");
    // default view is the brain browser
    await expect(page.locator("#view-brain")).toBeVisible();
    // a real BM25 search returns P-X5 + S-3 for the dedup-TTL query
    await page.fill("#brain-q", "dedup TTL retry window");
    await expect(page.locator("#brain-pane .card .id").first()).toBeVisible({ timeout: 12_000 });
    const ids = await page.locator("#brain-pane .card .id").allInnerTexts();
    expect(ids.join(" ")).toMatch(/P-X5/);
    await shot(page, "01-brain-search.png");

    // click a hit → its detection+fix renders inline (the bee explain body)
    await page.locator("#brain-pane .card.click").first().click();
    await expect(page.locator("#brain-pane .brain-doc")).toBeVisible({ timeout: 12_000 });

    // render a whole artifact
    await page.locator('#brain-files button[data-file="OPINIONS.md"]').click();
    await expect(page.locator("#brain-pane .brain-doc")).toContainText(/O-1/);
  });

  test("Run log tails logs/runs.jsonl as a table", async ({ page }) => {
    await page.goto("/");
    await page.locator('.rail button[data-view="runs"]').click();
    await expect(page.locator("#view-runs")).toBeVisible();
    // there are runs (the suite + every bee invocation appended rows); a table with a model col
    await expect(page.locator("#runs-pane table tbody tr").first()).toBeVisible({ timeout: 12_000 });
    await expect(page.locator("#runs-pane")).toContainText(/claude-opus/);
    await shot(page, "02-runs.png");
  });

  test("Queue & DLQ shows the invariant (dead-lettered poison) or the honest degraded note", async ({ page }) => {
    await page.goto("/");
    await page.locator('.rail button[data-view="queue"]').click();
    await expect(page.locator("#view-queue")).toBeVisible();
    await expect(page.locator("#queue-pane")).not.toContainText(/loading the last run/, { timeout: 12_000 });

    if (existsSync(QUEUE_CACHE)) {
      // Redis was reachable → a real dispatch run was captured. THE ONE INVARIANT held, and the
      // poison job is shown dead-lettered (the spec's explicit requirement).
      await expect(page.locator(".invariant-banner")).toContainText(/THE ONE INVARIANT/);
      await expect(page.locator(".invariant-banner.held")).toBeVisible();
      await expect(page.locator("#queue-pane")).toContainText(/dead-lettered/);
      await expect(page.locator("#queue-pane")).toContainText("poison-1");
      // effects = 1 on the duplicate (the load-bearing assertion)
      await expect(page.locator(".metric .v.ok").first()).toHaveText("1");
    } else {
      // No Redis → the cockpit shows its honest "no run captured yet" note (it never fakes data).
      await expect(page.locator("#queue-pane .empty")).toContainText(/no dispatch run captured yet/i);
    }
    await shot(page, "03-queue-dlq.png");
  });

  test("Eval scores render the green/red grid (G1–G14)", async ({ page }) => {
    await page.goto("/");
    await page.locator('.rail button[data-view="evals"]').click();
    await expect(page.locator("#view-evals")).toBeVisible();
    await expect(page.locator(".eval-cell").first()).toBeVisible({ timeout: 12_000 });
    // 14 golden tasks; G1 is CI-blocking and present
    const cells = await page.locator(".eval-cell .gid").allInnerTexts();
    expect(cells.length).toBeGreaterThanOrEqual(14);
    expect(cells.join(" ")).toMatch(/G1\b/);
    await shot(page, "04-evals.png");
  });

  test("Ask the employee answers a P-ID (explain) and picks a tool", async ({ page }) => {
    await page.goto("/");
    await page.locator('.rail button[data-view="ask"]').click();
    await expect(page.locator("#view-ask")).toBeVisible();

    // Explain a pitfall by ID — the spec's explicit "ask-the-employee returns a pitfall by ID".
    await page.locator('#ask-mode button[data-mode="explain"]').click();
    await page.fill("#ask-explain-id", "P-X5");
    await page.locator("#ask-explain-go").click();
    await expect(page.locator("#ask-answer .brain-doc")).toContainText(/P-X5/, { timeout: 12_000 });
    await expect(page.locator("#ask-answer")).toContainText(/dedup TTL/i);
    await shot(page, "05-ask-explain.png");

    // Pick a tool — complex → Temporal, with the falls-short + reversibility (O-13).
    await page.locator('#ask-mode button[data-mode="pick"]').click();
    await page.selectOption("#ask-pick-profile", "complex");
    await page.locator("#ask-pick-go").click();
    await expect(page.locator("#ask-answer")).toContainText(/Temporal/, { timeout: 12_000 });
    await expect(page.locator("#ask-answer")).toContainText(/one-way|reversib/i);
    await shot(page, "06-ask-pick-tool.png");
  });
});

// The CLI acceptance flow — the OTHER half of G2 (PLAN §9 "CLI E2E: the full acceptance
// invocation from a clean dir"). A CLI has no DOM screenshot, so this asserts the acceptance
// script exits 0 against the ephemeral Redis and writes its console output as a chairman text
// artifact. Skips (does not fail) when no Redis is reachable — that path is gated by the
// merge-blocking acceptance.yml job which always provides redis:7 (D15).
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
const execFileP = promisify(execFile);

test("CLI acceptance flow runs clean against the ephemeral Redis", async () => {
  test.skip(!existsSync(QUEUE_CACHE), "no Redis reachable — acceptance is gated by the CI acceptance.yml job (redis:7)");
  const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
  let out = "";
  let code = 0;
  try {
    const r = await execFileP(process.execPath, [join(REPO, "eval", "acceptance.mjs")], {
      cwd: REPO,
      env: { ...process.env, REDIS_URL },
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    out = (r.stdout || "") + (r.stderr || "");
  } catch (e) {
    code = e.code ?? 1;
    out = (e.stdout || "") + (e.stderr || "") + `\n[exit ${code}] ${e.message}`;
  }
  await writeFile(join(SHOTS, "07-cli-acceptance.txt"), out, "utf8");
  expect(code).toBe(0);
  expect(out).toMatch(/PASS|pass/);
});

// The cockpit is for this machine only: it listens on 127.0.0.1, never on every network interface.
// Boots its own server on a spare port, reads its log line, then dials it from a non-loopback address.
import { spawn } from "node:child_process";
import { connect } from "node:net";
import { networkInterfaces } from "node:os";

test("cockpit listens on 127.0.0.1 only", async () => {
  const port = 47000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, [join(REPO, "web", "server.mjs")], {
    env: { ...process.env, BEE_WEB_PORT: String(port) },
  });
  try {
    const line = await new Promise((resolve, reject) => {
      child.stdout.once("data", (d) => resolve(String(d)));
      child.once("exit", (c) => reject(new Error(`cockpit exited early (${c})`)));
    });
    expect(line).toContain(`http://127.0.0.1:${port}`);
    const lan = Object.values(networkInterfaces())
      .flat()
      .find((a) => a && a.family === "IPv4" && !a.internal);
    if (lan) {
      const reached = await new Promise((resolve) => {
        const s = connect({ host: lan.address, port }, () => {
          s.destroy();
          resolve(true);
        });
        s.once("error", () => resolve(false));
      });
      expect(reached, `the cockpit must not answer on ${lan.address}`).toBe(false);
    }
  } finally {
    child.kill();
  }
});

// bee cockpit E2E — Playwright config (CP123 Cluster G, item G2).
//
// Drives the read-only cockpit (web/server.mjs) end-to-end and the CLI acceptance flow, and
// writes chairman-facing screenshots under content/screenshots/. Red-blocking in CI
// (.github/workflows/acceptance.yml runs it with an ephemeral redis:7 service).
//
// The webServer boots `scripts/serve.sh` (which warms the eval + queue/DLQ caches), so the
// cockpit renders real data: the Queue & DLQ view shows the last dispatch run's dead-lettered
// poison job, the Eval view shows 14/14. globalSetup guarantees a CLEAN queue cache when a
// Redis is reachable (flush the route-accept keys, then one dispatch run) so the
// dead-lettered-job assertion is deterministic, not contaminated by stale cross-run state.

import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.BEE_WEB_PORT || 7777);
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

export default defineConfig({
  testDir: "tests",
  outputDir: "test-results",
  globalSetup: "./tests/global-setup.mjs",
  fullyParallel: false, // the cockpit is one shared server + one shared queue cache
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 960 },
    trace: "retain-on-failure",
    screenshot: "off", // we take explicit, named screenshots for the chairman
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "bash scripts/serve.sh",
    url: `http://localhost:${PORT}/api/health`,
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
    env: { BEE_WEB_PORT: String(PORT), REDIS_URL },
  },
});

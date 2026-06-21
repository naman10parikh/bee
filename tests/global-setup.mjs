// Playwright globalSetup for the bee cockpit E2E (CP123 G2).
//
// Guarantees the cockpit has real, clean data to render BEFORE the suite runs:
//   - the eval cache (eval/eval-result.json) — `bee eval --json`
//   - the queue/DLQ cache (web/queue-result.json) — ONE clean dispatch run against an ephemeral
//     Redis, after flushing any stale `bull:route-accept*` keys so the dead-lettered-poison
//     assertion is deterministic (BullMQ queue state persists across runs; a leftover completed
//     set would make a fresh run show effects=0 — the bug I hit warming the cache by hand in G1).
//
// If no Redis is reachable, the queue cache is left ABSENT and the cockpit's Queue view shows its
// honest "no run captured yet" note — the suite handles both branches (it never fakes data).

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const execFileP = promisify(execFile);
const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

function redisHostPort(url) {
  const hp = url.replace(/^redis:\/\//, "");
  const host = hp.split(":")[0] || "localhost";
  const port = hp.includes(":") ? hp.split(":")[1] : "6379";
  return { host, port };
}

async function redisReachable() {
  const { host, port } = redisHostPort(REDIS_URL);
  try {
    const { stdout } = await execFileP("redis-cli", ["-h", host, "-p", port, "ping"], { timeout: 4000 });
    return stdout.trim() === "PONG";
  } catch {
    return false;
  }
}

export default async function globalSetup() {
  await mkdir(join(REPO, "content", "screenshots"), { recursive: true });

  // 1) eval cache — always available ($0, no Redis).
  try {
    const { stdout } = await execFileP(process.execPath, [join(REPO, "bin", "bee.js"), "eval", "--json"], {
      cwd: REPO,
      timeout: 60_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    await writeFile(join(REPO, "eval", "eval-result.json"), stdout, "utf8");
    console.log("[global-setup] eval cache warmed");
  } catch (e) {
    console.warn("[global-setup] eval cache warm failed:", e?.message);
  }

  // 2) queue/DLQ cache — needs a Redis. Flush stale keys, then ONE clean dispatch run.
  if (await redisReachable()) {
    const { host, port } = redisHostPort(REDIS_URL);
    try {
      // Flush only the dispatch flow's own queue keys (route-accept + its DLQ) — never FLUSHALL.
      await execFileP(
        "redis-cli",
        ["-h", host, "-p", port, "EVAL", "local ks=redis.call('keys','bull:route-accept*'); for i,k in ipairs(ks) do redis.call('del',k) end; return #ks", "0"],
        { timeout: 5000 },
      );
    } catch (e) {
      console.warn("[global-setup] route-accept flush failed (continuing):", e?.message);
    }
    try {
      const { stdout } = await execFileP(process.execPath, [join(REPO, "src", "backend", "dispatch", "route.js"), "--json"], {
        cwd: REPO,
        env: { ...process.env, REDIS_URL },
        timeout: 60_000,
        maxBuffer: 8 * 1024 * 1024,
      });
      await writeFile(join(REPO, "web", "queue-result.json"), stdout, "utf8");
      console.log("[global-setup] queue/DLQ cache warmed (clean dispatch run)");
    } catch (e) {
      console.warn("[global-setup] dispatch run failed — queue view will show the degraded note:", e?.message);
      if (existsSync(join(REPO, "web", "queue-result.json"))) await rm(join(REPO, "web", "queue-result.json"));
    }
  } else {
    console.warn(`[global-setup] no Redis at ${REDIS_URL} — queue view will show its honest degraded note`);
    if (existsSync(join(REPO, "web", "queue-result.json"))) await rm(join(REPO, "web", "queue-result.json"));
  }
}

// eval/_lib.mjs — shared helpers for the golden-task modules (g01..g14). Small,
// dependency-free, hermetic: run the bee CLI as a child, scaffold-then-audit a layer,
// and resolve repo paths. Keeps each task module focused on its single VERIFY gate.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(__dirname, "..");
export const BEE_CLI = join(REPO_ROOT, "bin", "bee.js");
export const BROKEN_FIXTURE = join(REPO_ROOT, "eval", "fixtures", "broken-jobs");

/**
 * Run the bee CLI; resolve { code, stdout, json } (json = last parseable stdout line).
 * @param {string[]} argv
 * @returns {Promise<{ code: number, stdout: string, json: any }>}
 */
export function runBee(argv) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BEE_CLI, ...argv], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.on("error", () => resolve({ code: -1, stdout: "", json: undefined }));
    child.on("close", (code) => {
      const last = out.trim().split("\n").filter(Boolean).pop() ?? "";
      let json;
      try {
        json = JSON.parse(last);
      } catch {
        json = undefined;
      }
      resolve({ code: code ?? 0, stdout: out.trim(), json });
    });
  });
}

/**
 * Scaffold a provider layer into a temp dir, run `bee audit --json` over it, return
 * the audit result + a cleanup fn. The caller MUST call cleanup().
 * @param {"bullmq"|"inngest"|"qstash"|"temporal"} provider
 * @returns {Promise<{ outDir: string, audit: any, cleanup: () => void }>}
 */
export async function scaffoldAndAudit(provider) {
  const outDir = mkdtempSync(join(tmpdir(), `bee-eval-${provider}-`));
  const s = await runBee(["scaffold", "--provider", provider, "--out", outDir, "--json"]);
  if (s.code !== 0) {
    rmSync(outDir, { recursive: true, force: true });
    throw new Error(`scaffold --provider ${provider} failed (exit ${s.code})`);
  }
  const a = await runBee(["audit", outDir, "--json"]);
  return {
    outDir,
    audit: a.json,
    cleanup: () => rmSync(outDir, { recursive: true, force: true }),
  };
}

/**
 * Audit a fixed directory (e.g. the committed broken-jobs fixture).
 * @param {string} dir
 * @returns {Promise<any>} the parsed audit result
 */
export async function auditDir(dir) {
  const a = await runBee(["audit", dir, "--json"]);
  return a.json;
}

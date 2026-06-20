// `bee audit` — run the pitfall detectors over a jobs layer, emitting findings
// keyed by P-ID (brain/KNOWN-PITFALLS.md). The honest auditor: it reports what it
// can prove from the source, cites the pitfall by ID + the file:line + the fix.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { DETECTORS } from "./detectors.js";

const SKIP_DIRS = new Set(["node_modules", ".git", ".bee", "dist", ".next"]);
const TEXT_EXT = new Set([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".tsx", ".json", ".md", ".yml", ".yaml"]);

/**
 * Recursively collect auditable text files under `dir`.
 * @param {string} dir
 * @returns {string[]}
 */
function collectFiles(dir) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} d */
  function walk(d) {
    let entries;
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(d, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(full);
      } else if (TEXT_EXT.has(extname(name)) || name === "package.json") {
        out.push(full);
      }
    }
  }
  walk(dir);
  return out;
}

/**
 * Audit a directory. Returns findings keyed by P-ID with file:line evidence.
 * @param {string} dir
 * @returns {{ dir: string, scanned: number, findings: { pitfall: string, severity: string, file: string, line: number, message: string, snippet: string }[], byPitfall: Record<string, number> }}
 */
export function audit(dir) {
  const files = collectFiles(dir);
  /** @type {{ pitfall: string, severity: string, file: string, line: number, message: string, snippet: string }[]} */
  const findings = [];
  for (const file of files) {
    let content;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const rel = file.startsWith(dir) ? file.slice(dir.length).replace(/^[/\\]/, "") : file;
    for (const det of DETECTORS) {
      const hits = det.test(content, file);
      for (const h of hits) {
        findings.push({
          pitfall: det.pitfall,
          severity: det.severity,
          file: rel,
          line: h.line,
          message: det.message,
          snippet: h.snippet,
        });
      }
    }
  }
  /** @type {Record<string, number>} */
  const byPitfall = {};
  for (const f of findings) byPitfall[f.pitfall] = (byPitfall[f.pitfall] ?? 0) + 1;
  return { dir, scanned: files.length, findings, byPitfall };
}

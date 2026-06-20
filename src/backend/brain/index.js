// The Memory queryable layer — a BM25 index over `brain/` (the six Wave-R artifacts).
//
// This is the REAL Memory-component work (HARNESS-OVERRIDES §2): NOT a reuse of
// scripts/memory-search.sh (which indexes memory/+vault/+.claude/rules/ — the WRONG
// dirs). It chunks each brain file by its ID-headed sections (### P-X5, ### O-8,
// ## S-3, ## JTBD-5, ### G-1), builds a BM25 index over the chunks, and returns
// ranked hits citing the file + the P-/S-/O-/G-/JTBD-ID.

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BM25Index } from "./bm25.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// repo root = src/backend/brain → ../../../
const REPO_ROOT = join(__dirname, "..", "..", "..");
const BRAIN_DIR = join(REPO_ROOT, "brain");

// A heading that introduces an ID'd chunk: `## S-3 — …`, `### P-X5 — …`,
// `### O-8 — …`, `### G-1 — …`, `## JTBD-5 — …`.
const ID_HEADING = /^#{2,4}\s+((?:P|S|O|G)-[A-Za-z]*\d+|JTBD-\d+)\b[^\n]*/;

/**
 * @typedef {{ id: string, file: string, heading: string, text: string }} BrainChunk
 */

/**
 * Parse one brain markdown file into ID-headed chunks. Content before the first
 * ID heading (front-matter / intro) is ignored for the index (it has no ID to cite).
 * @param {string} content
 * @param {string} file
 * @returns {BrainChunk[]}
 */
export function chunkBrainFile(content, file) {
  const lines = content.split("\n");
  /** @type {BrainChunk[]} */
  const chunks = [];
  /** @type {BrainChunk|null} */
  let cur = null;
  for (const line of lines) {
    const m = ID_HEADING.exec(line);
    if (m) {
      if (cur) chunks.push(cur);
      const idMatch = /((?:P|S|O|G)-[A-Za-z]*\d+|JTBD-\d+)/.exec(line);
      cur = {
        id: idMatch ? idMatch[1] : "",
        file,
        heading: line.replace(/^#{2,4}\s+/, "").trim(),
        text: line + "\n",
      };
    } else if (cur) {
      cur.text += line + "\n";
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/**
 * Read + chunk every brain markdown file (excluding research/raw).
 * @param {string} [brainDir]
 * @returns {BrainChunk[]}
 */
export function loadBrainChunks(brainDir = BRAIN_DIR) {
  /** @type {BrainChunk[]} */
  const all = [];
  let entries;
  try {
    entries = readdirSync(brainDir);
  } catch {
    return all;
  }
  for (const name of entries) {
    if (!name.endsWith(".md")) continue;
    const full = join(brainDir, name);
    let content;
    try {
      content = readFileSync(full, "utf8");
    } catch {
      continue;
    }
    all.push(...chunkBrainFile(content, name));
  }
  return all;
}

/** Lazily-built singleton index over the brain chunks. */
/** @type {BM25Index|null} */
let _index = null;
/** @type {BrainChunk[]|null} */
let _chunks = null;

/**
 * @param {string} [brainDir]
 * @returns {{ index: BM25Index, chunks: BrainChunk[] }}
 */
function getIndex(brainDir) {
  if (_index && _chunks && !brainDir) return { index: _index, chunks: _chunks };
  const chunks = loadBrainChunks(brainDir);
  // The BM25 doc id is the chunk id; the searchable text is the heading + body.
  const index = new BM25Index(
    chunks.map((/** @type {BrainChunk} */ c) => ({ id: c.id, text: c.text, file: c.file, heading: c.heading })),
  );
  if (!brainDir) {
    _index = index;
    _chunks = chunks;
  }
  return { index, chunks };
}

/**
 * `bee brain <query>` — ranked BM25 hits over the brain, citing id + file.
 * @param {string} query
 * @param {{ limit?: number, brainDir?: string }} [opts]
 * @returns {{ id: string, file: string, heading: string, score: number, excerpt: string }[]}
 */
export function searchBrain(query, opts = {}) {
  const { index } = getIndex(opts.brainDir);
  const hits = index.search(query, opts.limit ?? 5);
  return hits.map((/** @type {any} */ h) => ({
    id: h.id,
    file: h.file,
    heading: h.heading,
    score: h.score,
    excerpt: excerptOf(String(h.text), query),
  }));
}

/**
 * `bee explain <id>` — the full detection+fix+source for one ID.
 * @param {string} id
 * @param {{ brainDir?: string }} [opts]
 * @returns {{ id: string, file: string, heading: string, body: string } | null}
 */
export function explainId(id, opts = {}) {
  const { chunks } = getIndex(opts.brainDir);
  const target = id.trim().toUpperCase();
  const hit = chunks.find((c) => c.id.toUpperCase() === target);
  if (!hit) return null;
  return { id: hit.id, file: hit.file, heading: hit.heading, body: hit.text.trim() };
}

/**
 * A short excerpt centered on the first query-term hit (for the CLI/cockpit).
 * @param {string} text
 * @param {string} query
 * @returns {string}
 */
function excerptOf(text, query) {
  const flat = text.replace(/\s+/g, " ").trim();
  const firstTerm = query.toLowerCase().split(/\s+/).find((t) => t.length > 2);
  if (firstTerm) {
    const i = flat.toLowerCase().indexOf(firstTerm);
    if (i >= 0) {
      const start = Math.max(0, i - 60);
      return (start > 0 ? "…" : "") + flat.slice(start, start + 220) + "…";
    }
  }
  return flat.slice(0, 220) + (flat.length > 220 ? "…" : "");
}

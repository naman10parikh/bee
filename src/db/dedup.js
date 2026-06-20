// Dedup store — the O-2 load-bearing wall: idempotency enforced at the DB with a
// UNIQUE constraint, NEVER in-memory (in-memory dedup is bypassed by restart,
// concurrency, and cold serverless — O-2, Temporal money-slip #4).
//
// Backed by node:sqlite (built into Node ≥22.5 — zero dependency, zero secret).
// The "effect" is recorded through `INSERT ... ON CONFLICT(idempotency_key) DO NOTHING`:
// the FIRST writer for a key inserts a row (changes=1 → run the effect); a concurrent
// or retried duplicate hits the UNIQUE constraint (changes=0 → effect already applied,
// skip). This is exactly-once *effect* on at-least-once transport (O-1).

import { DatabaseSync } from "node:sqlite";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";

/**
 * Opens (and migrates) the dedup database. The schema is two tables:
 *  - `effects`     : the idempotency ledger (one row per unique effect key).
 *  - `audit_log`   : append-only audit row per state-mutating effect (O-25 /
 *                    checklist §10 — prove an effect ran exactly once).
 *
 * @param {string} [path] - DB file path; ":memory:" for ephemeral. Defaults to
 *   `DATABASE_URL` (sqlite file path) or a repo-local `.bee/dedup.sqlite`.
 * @returns {DedupStore}
 */
export function openDedupStore(path) {
  const dbPath = path || sqlitePathFromEnv() || ".bee/dedup.sqlite";
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS effects (
      idempotency_key TEXT PRIMARY KEY,
      queue           TEXT NOT NULL,
      payload_hash    TEXT,
      applied_at      INTEGER NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      idempotency_key TEXT NOT NULL,
      queue           TEXT NOT NULL,
      job_id          TEXT,
      attempt         INTEGER,
      outcome         TEXT NOT NULL,
      at              INTEGER NOT NULL
    );
  `);
  return new DedupStore(db, dbPath);
}

/**
 * Resolve a SQLite file path from `DATABASE_URL` (a Postgres URL is acorn's seam,
 * not this local store's concern).
 * @returns {string|null}
 */
function sqlitePathFromEnv() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (url.startsWith("sqlite:")) return url.replace(/^sqlite:(\/\/)?/, "");
  if (url.endsWith(".sqlite") || url.endsWith(".db")) return url;
  return null; // a Postgres URL is acorn's seam, not handled by this local store
}

export class DedupStore {
  /**
   * @param {DatabaseSync} db
   * @param {string} path
   */
  constructor(db, path) {
    this.db = db;
    this.path = path;
    this._insert = db.prepare(
      "INSERT INTO effects (idempotency_key, queue, payload_hash, applied_at) " +
        "VALUES (?, ?, ?, ?) ON CONFLICT(idempotency_key) DO NOTHING",
    );
    this._count = db.prepare("SELECT COUNT(*) AS n FROM effects WHERE idempotency_key = ?");
    this._countAll = db.prepare("SELECT COUNT(*) AS n FROM effects");
    this._audit = db.prepare(
      "INSERT INTO audit_log (idempotency_key, queue, job_id, attempt, outcome, at) " +
        "VALUES (?, ?, ?, ?, ?, ?)",
    );
  }

  /**
   * Attempt to claim a key. Returns true if THIS caller won the race (changes=1 →
   * the effect should run now); false if the key was already applied (duplicate →
   * skip the effect). The UNIQUE constraint makes this safe under concurrency
   * (the second writer's INSERT is a no-op, not an error).
   *
   * @param {string} key
   * @param {string} queue
   * @param {string} [payloadHash]
   * @returns {boolean} won (first time) / lost (duplicate)
   */
  claim(key, queue, payloadHash = "") {
    const res = this._insert.run(key, queue, payloadHash, Date.now());
    return res.changes === 1;
  }

  /**
   * How many effect rows exist for a key (0 or 1 — proves duplicate-safety).
   * @param {string} key
   * @returns {number}
   */
  effectCount(key) {
    const row = this._count.get(key);
    return row ? Number(row.n) : 0;
  }

  /** Total distinct effects applied (for the acceptance assertion). @returns {number} */
  totalEffects() {
    const row = this._countAll.get();
    return row ? Number(row.n) : 0;
  }

  /**
   * Append an audit row (O-25 — append-only trail for state-mutating jobs).
   * @param {{ key: string, queue: string, jobId?: string, attempt?: number, outcome: string }} row
   */
  audit(row) {
    this._audit.run(
      row.key,
      row.queue,
      row.jobId ?? null,
      row.attempt ?? null,
      row.outcome,
      Date.now(),
    );
  }

  close() {
    this.db.close();
  }
}

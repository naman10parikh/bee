// Minimal zero-dep argv parser for the `bee` CLI.
// Surgical by design (Karpathy Simplicity-First): bee's commands take a small,
// fixed set of `--flag value` / `--bool` options + a leading positional. A full
// arg-parsing dependency (commander/yargs) is more surface than the problem needs,
// and the verify lines invoke `node bin/bee.js ...` directly — keeping this
// dependency-free keeps the binary fast and the install footprint to bullmq alone.

/**
 * Parse `argv` (already sliced past `node bin/bee.js`) into a command + flags.
 * Supports: `--key value`, `--key=value`, `--bool` (no value → true),
 * and leading positionals (everything before the first `--flag`).
 *
 * @param {string[]} argv
 * @returns {{ command: string|undefined, positionals: string[], flags: Record<string, string|boolean> }}
 */
export function parseArgs(argv) {
  const positionals = [];
  /** @type {Record<string, string|boolean>} */
  const flags = {};
  let i = 0;
  // leading positionals (command + any bare args) until the first `--`
  while (i < argv.length && !argv[i].startsWith("--")) {
    positionals.push(argv[i]);
    i += 1;
  }
  for (; i < argv.length; i += 1) {
    const tok = argv[i];
    if (!tok.startsWith("--")) {
      // a bare token after flags begin is treated as a positional too
      positionals.push(tok);
      continue;
    }
    const body = tok.slice(2);
    const eq = body.indexOf("=");
    if (eq !== -1) {
      flags[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      flags[body] = true; // boolean flag
    } else {
      flags[body] = next;
      i += 1; // consume the value
    }
  }
  return { command: positionals[0], positionals: positionals.slice(1), flags };
}

/**
 * Read a flag as a string, falling back to a default.
 * @param {Record<string, string|boolean>} flags
 * @param {string} name
 * @param {string|undefined} [fallback]
 * @returns {string|undefined}
 */
export function str(flags, name, fallback) {
  const v = flags[name];
  if (v === undefined) return fallback;
  return String(v);
}

/**
 * Read a flag as an integer, falling back to a default.
 * @param {Record<string, string|boolean>} flags
 * @param {string} name
 * @param {number} fallback
 * @returns {number}
 */
export function int(flags, name, fallback) {
  const v = flags[name];
  if (v === undefined) return fallback;
  const n = Number.parseInt(String(v), 10);
  return Number.isNaN(n) ? fallback : n;
}

/**
 * Read a flag as a boolean (presence = true).
 * @param {Record<string, string|boolean>} flags
 * @param {string} name
 * @returns {boolean}
 */
export function bool(flags, name) {
  return flags[name] === true || flags[name] === "true";
}

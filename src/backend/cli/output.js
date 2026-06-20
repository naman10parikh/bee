// Output helpers — the `--json` contract for every data command.
// Data goes to STDOUT (parseable JSON when --json, human text otherwise);
// diagnostics/warnings go to STDERR so a `--json` consumer's stdout stays clean.

/**
 * Emit a result either as a single JSON object on stdout (--json) or as
 * human-readable lines. The JSON branch prints EXACTLY one line (newline-terminated)
 * so `JSON.parse(readFileSync(0))` on the piped stdout always works.
 *
 * @param {boolean} json   - whether --json was passed
 * @param {unknown} data   - the structured result
 * @param {(d: any) => string} [human] - renderer for the non-json path
 */
export function emit(json, data, human) {
  if (json) {
    process.stdout.write(JSON.stringify(data) + "\n");
    return;
  }
  if (human) {
    process.stdout.write(human(data) + "\n");
    return;
  }
  process.stdout.write(String(data) + "\n");
}

/**
 * Write a diagnostic line to stderr (never pollutes --json stdout).
 * @param {string} msg
 */
export function note(msg) {
  process.stderr.write(`[bee] ${msg}\n`);
}

/**
 * Print an error to stderr and exit non-zero (the CLI error contract).
 * @param {string} msg
 * @param {number} [code]
 * @returns {never}
 */
export function fail(msg, code = 1) {
  process.stderr.write(`[bee] error: ${msg}\n`);
  process.exit(code);
}

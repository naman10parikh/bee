#!/bin/bash
# bee · pin-exact-gate — the dogfood discipline hook (O-17 / P-B1)
#
# THE RULE bee enforces on its OWN repo: queue / durable-exec libs MUST be pinned
# EXACT. NEVER float `^` or `~`. BullMQ ships multiple patches/week and minor bumps
# have bricked processors (#4194), doubled Redis CPU (#4196), and created infinite
# retry loops (#4220). "minor" is a lie here — three minor-range regressions in ~2
# months (brain/KNOWN-PITFALLS.md P-B1, brain/OPINIONS.md O-17).
#
# This is a PreToolUse grep-gate. It blocks a Write/Edit (or a manual check) that
# introduces a floating range on a watched lib. The proof that the background-jobs
# employee obeys its own rules (HARNESS-OVERRIDES §5 dogfood).
#
# TWO INVOCATION MODES (both supported, same logic):
#   1. File-path arg  — `bash hooks/pin-exact-gate.sh path/to/package.json`
#                       inspects that file directly (the MASTER-TODOS verify path).
#   2. PreToolUse hook — Claude Code pipes the tool-call JSON on stdin; this script
#                       extracts the Write/Edit target's package.json content and
#                       inspects it. Wire-up in `.claude/settings.json`.
#
# EXIT CODES:
#   0 = clean (no floating range on a watched lib, or not a package.json) → allow.
#   2 = BLOCKED (a floating `^`/`~`/`x`-range on a watched lib) → deny the tool call.
#       (exit 2 is the Claude Code "block + feed stderr back to the model" code.)
#
# OBSERVABILITY: every fire (block OR pass-after-inspecting-a-dep) is appended to
#   .claude/hook-fires.log so the fire is observable (HARNESS-OVERRIDES §5 evidence).

set -uo pipefail

# Libs whose version MUST be pinned exact — the queue / durable-exec surface.
# (brain/TOOL-MATRIX.md pins + O-17/O-18.)
WATCHED='bullmq|inngest|@inngest/[a-z-]+|@trigger\.dev/[a-z-]+|temporalio|@temporalio/[a-z-]+|@upstash/qstash|svix|bbc-sqs-consumer|sqs-consumer'

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
FIRE_LOG="$PROJECT_DIR/.claude/hook-fires.log"

log_fire() {
  # $1 = verdict (BLOCK|PASS|SKIP), $2 = detail
  local ts
  ts=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
  mkdir -p "$(dirname "$FIRE_LOG")" 2>/dev/null
  printf '{"ts":"%s","hook":"pin-exact-gate","verdict":"%s","detail":"%s"}\n' \
    "$ts" "$1" "$2" >> "$FIRE_LOG" 2>/dev/null || true
}

# inspect_content <content-string> <source-label>
# Returns 0 (clean) or 2 (a floating range on a watched lib was found).
inspect_content() {
  local content="$1"
  local source="$2"

  # Strip comment lines so a doc-example like
  #   // never write "bullmq": "^5"
  # cannot trip the gate (same lesson as B4's comment-stripping detectors + the
  # cp123 birth.sh doc-scan). We drop any line whose first non-whitespace is `//`
  # or `#` (handles doc-examples that themselves contain quoted version strings),
  # then also strip trailing `//...` comments on code lines.
  local stripped
  stripped=$(printf '%s' "$content" \
    | grep -vE '^[[:space:]]*(//|#)' \
    | sed -E 's://.*$::')

  # A dependency line is floating if it's   "<watched>": "<^|~|...x...>"
  # Match: a watched key, then ":", whitespace, a quote, then a leading ^ or ~,
  # OR an x-range (e.g. "5.x" / "5" / "5.78" without a patch) — i.e. NOT a full
  # exact "MAJOR.MINOR.PATCH". We flag ^, ~, *, x, and bare-major/minor.
  local offenders
  offenders=$(printf '%s' "$stripped" | grep -oiE "\"($WATCHED)\"[[:space:]]*:[[:space:]]*\"[^\"]+\"" 2>/dev/null \
    | grep -iE "\"[[:space:]]*:[[:space:]]*\"(\^|~|>|<|\*|[0-9]+(\.[0-9]+)?(\.x)?[[:space:]]*\"|[0-9]+\.x|x)" 2>/dev/null \
    | grep -ivE ":[[:space:]]*\"[0-9]+\.[0-9]+\.[0-9]+\"" 2>/dev/null || true)

  if [ -n "$offenders" ]; then
    {
      echo "BLOCKED by bee/pin-exact-gate (O-17 / P-B1): a queue / durable-exec lib is pinned with a FLOATING range in $source."
      echo "$offenders" | sed 's/^/  ✗ /'
      echo "  → Pin it EXACT (MAJOR.MINOR.PATCH). BullMQ ships multiple patches/week; minor bumps have bricked processors, doubled Redis CPU, and created infinite retry loops."
      echo "  → e.g.  \"bullmq\": \"5.78.1\"   (not  \"^5\" / \"~5.78\" / \"5.x\")."
    } >&2
    log_fire "BLOCK" "floating range on a watched lib in $source"
    return 2
  fi

  # Did this content even MENTION a watched lib? (so the log shows a real inspection,
  # not just a no-op skip — distinguishes "inspected a dep, clean" from "irrelevant").
  if printf '%s' "$stripped" | grep -qiE "\"($WATCHED)\"" 2>/dev/null; then
    log_fire "PASS" "watched lib present and pinned exact in $source"
  fi
  return 0
}

# ── Mode 1: file-path argument ───────────────────────────────────────────────
if [ "$#" -ge 1 ] && [ -f "$1" ]; then
  CONTENT=$(cat "$1")
  inspect_content "$CONTENT" "$1"
  exit $?
fi

# ── Mode 2: PreToolUse hook (JSON on stdin) ──────────────────────────────────
# Claude Code pipes a JSON envelope like:
#   { "tool_name": "Write", "tool_input": { "file_path": "...", "content": "..." } }
# (Edit uses new_string.) We only care about writes to a package.json.
STDIN_JSON=""
if [ ! -t 0 ]; then
  STDIN_JSON=$(cat)
fi

if [ -z "$STDIN_JSON" ]; then
  # Nothing to inspect (e.g. invoked with no arg and no stdin) → allow.
  log_fire "SKIP" "no file arg and no stdin"
  exit 0
fi

# Parse with node (always present in this repo) — robust to escaping.
RESULT=$(printf '%s' "$STDIN_JSON" | node -e '
  let raw = "";
  process.stdin.on("data", d => raw += d);
  process.stdin.on("end", () => {
    let path = "", content = "";
    try {
      const j = JSON.parse(raw);
      const ti = j.tool_input || j.toolInput || {};
      path = ti.file_path || ti.filePath || ti.path || "";
      // Write → content; Edit → new_string; MultiEdit → join edits.
      content = ti.content
        || ti.new_string || ti.newString
        || (Array.isArray(ti.edits) ? ti.edits.map(e => e.new_string || e.newString || "").join("\n") : "")
        || "";
    } catch (_) { /* malformed envelope → emit nothing → allow */ }
    // Only gate package.json writes.
    if (!/(^|\/)package\.json$/.test(path)) { process.stdout.write("__SKIP__"); return; }
    process.stdout.write("__PATH__" + path + "\n__CONTENT__\n" + content);
  });
' 2>/dev/null)

if [ -z "$RESULT" ] || [ "$RESULT" = "__SKIP__" ]; then
  exit 0
fi

GATE_PATH=$(printf '%s' "$RESULT" | sed -n 's/^__PATH__//p' | head -1)
GATE_CONTENT=$(printf '%s' "$RESULT" | sed '1,/^__CONTENT__$/d')
inspect_content "$GATE_CONTENT" "${GATE_PATH:-package.json (PreToolUse)}"
exit $?

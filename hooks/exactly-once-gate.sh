#!/bin/bash
# bee · exactly-once-gate — the anti-slop dogfood hook (O-1)
#
# THE RULE bee enforces on its OWN docs: NEVER write bare "exactly-once". True
# exactly-once *delivery* does not exist in distributed systems — "exactly-once" is
# always an *effect* achieved at the application layer (at-least-once transport +
# idempotent consumer + dedupe store). Saying "exactly-once" without the word
# "effect" nearby is the #1 thing an agent gets wrong (brain/OPINIONS.md O-1, the
# anti-slop test tell (a)). bee's own output must contain ZERO bare "exactly-once"
# (HARNESS-OVERRIDES §"honesty / anti-over-claim guards").
#
# This is a PreToolUse grep-gate for doc writes (Markdown). It blocks a Write/Edit
# that introduces "exactly-once" in prose UNLESS the word "effect" appears within
# the same line / nearby context (i.e. "exactly-once *effect*" is the allowed form).
#
# TWO INVOCATION MODES (same as pin-exact-gate.sh):
#   1. File-path arg  — `bash hooks/exactly-once-gate.sh path/to/doc.md`
#   2. PreToolUse hook — Claude Code pipes the tool-call JSON on stdin.
#
# EXIT CODES:  0 = clean (allow) · 2 = BLOCKED (bare "exactly-once" in a doc).
# OBSERVABILITY: every fire is appended to .claude/hook-fires.log.

set -uo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
FIRE_LOG="$PROJECT_DIR/.claude/hook-fires.log"

log_fire() {
  local ts
  ts=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
  mkdir -p "$(dirname "$FIRE_LOG")" 2>/dev/null
  printf '{"ts":"%s","hook":"exactly-once-gate","verdict":"%s","detail":"%s"}\n' \
    "$ts" "$1" "$2" >> "$FIRE_LOG" 2>/dev/null || true
}

# inspect_content <content-string> <source-label> → 0 clean / 2 violation
inspect_content() {
  local content="$1"
  local source="$2"

  # A line is a violation if it says "exactly-once" (or "exactly once") but does
  # NOT also carry "effect" on the same line. The allowed form is the qualified
  # "exactly-once *effect*". We check line-by-line so a doc that explains the
  # distinction ("exactly-once delivery does not exist; build exactly-once effects")
  # passes — that line contains "effect".
  local offenders
  offenders=$(printf '%s' "$content" \
    | grep -inE 'exactly[ -]once' 2>/dev/null \
    | grep -ivE 'effect' 2>/dev/null || true)

  if [ -n "$offenders" ]; then
    {
      echo "BLOCKED by bee/exactly-once-gate (O-1): bare \"exactly-once\" in $source — the missing word is *effect*."
      echo "$offenders" | sed 's/^/  ✗ line /'
      echo "  → exactly-once *delivery* does not exist. Write \"exactly-once *effect*\" (at-least-once transport + idempotent consumer + DB-unique-constraint dedupe)."
    } >&2
    log_fire "BLOCK" "bare exactly-once in $source"
    return 2
  fi

  if printf '%s' "$content" | grep -qiE 'exactly[ -]once' 2>/dev/null; then
    log_fire "PASS" "exactly-once present and qualified with effect in $source"
  fi
  return 0
}

# ── Mode 1: file-path argument ───────────────────────────────────────────────
if [ "$#" -ge 1 ] && [ -f "$1" ]; then
  inspect_content "$(cat "$1")" "$1"
  exit $?
fi

# ── Mode 2: PreToolUse hook (JSON on stdin) ──────────────────────────────────
STDIN_JSON=""
if [ ! -t 0 ]; then
  STDIN_JSON=$(cat)
fi
if [ -z "$STDIN_JSON" ]; then
  log_fire "SKIP" "no file arg and no stdin"
  exit 0
fi

RESULT=$(printf '%s' "$STDIN_JSON" | node -e '
  let raw = "";
  process.stdin.on("data", d => raw += d);
  process.stdin.on("end", () => {
    let path = "", content = "";
    try {
      const j = JSON.parse(raw);
      const ti = j.tool_input || j.toolInput || {};
      path = ti.file_path || ti.filePath || ti.path || "";
      content = ti.content
        || ti.new_string || ti.newString
        || (Array.isArray(ti.edits) ? ti.edits.map(e => e.new_string || e.newString || "").join("\n") : "")
        || "";
    } catch (_) {}
    // Only gate doc writes (markdown / text), where prose slop lives.
    if (!/\.(md|mdx|txt)$/i.test(path)) { process.stdout.write("__SKIP__"); return; }
    process.stdout.write("__PATH__" + path + "\n__CONTENT__\n" + content);
  });
' 2>/dev/null)

if [ -z "$RESULT" ] || [ "$RESULT" = "__SKIP__" ]; then
  exit 0
fi

GATE_PATH=$(printf '%s' "$RESULT" | sed -n 's/^__PATH__//p' | head -1)
GATE_CONTENT=$(printf '%s' "$RESULT" | sed '1,/^__CONTENT__$/d')
inspect_content "$GATE_CONTENT" "${GATE_PATH:-doc (PreToolUse)}"
exit $?

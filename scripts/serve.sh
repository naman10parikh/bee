#!/usr/bin/env bash
# Launch the bee cockpit (CP123 Cluster G, item G1). Local-first, read-mostly; the chairman's
# eyes (DECISIONS D3 / PLAN §10 / Q5). Node stdlib HTTP server (zero npm deps, no build) — bee
# is a Node repo, so the "stdlib server" is Node's own node:http, not Python like the
# sentinel/talent-intel reference. bee's CLI is plain JS (bin/bee.js), so there is no dist/
# build step to run first (tsconfig is noEmit/typecheck-only).
#
# Usage:  bash scripts/serve.sh            ->  http://localhost:7777
#         BEE_WEB_PORT=8080 bash scripts/serve.sh
set -euo pipefail
cd "$(dirname "$0")/.."

# The Eval view reads a cached result (bee eval runs all 14 golden tasks, ~2-3s — too slow to
# run per-request). Warm the cache once in the background if it's missing. Read-only: this runs
# `bee eval` (the eval pyramid), never a build/scaffold/audit-of-a-tree.
if [ ! -f eval/eval-result.json ]; then
  echo "warming eval cache in the background (eval/eval-result.json)…" >&2
  ( node bin/bee.js eval --json > eval/eval-result.json 2>/dev/null || true ) &
fi

# The Queue & DLQ view reads a cached dispatch-run lifecycle (web/queue-result.json) — the one
# view that *shows* THE ONE INVARIANT working (effect=1 on a duplicate, poison → DLQ). It needs
# an ephemeral Redis, so warm it ONLY if one is reachable; otherwise the view degrades to a
# "no run captured yet" note (the cockpit still boots — read-mostly, never blocks on infra).
REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
if [ ! -f web/queue-result.json ]; then
  REDIS_HOSTPORT="${REDIS_URL#redis://}"
  REDIS_HOST="${REDIS_HOSTPORT%%:*}"
  REDIS_PORT="${REDIS_HOSTPORT##*:}"
  [ "$REDIS_PORT" = "$REDIS_HOSTPORT" ] && REDIS_PORT=6379
  if command -v redis-cli >/dev/null 2>&1 && redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" ping >/dev/null 2>&1; then
    echo "warming queue/DLQ cache in the background against $REDIS_URL (web/queue-result.json)…" >&2
    ( REDIS_URL="$REDIS_URL" node src/backend/dispatch/route.js --json > web/queue-result.json 2>/dev/null || rm -f web/queue-result.json ) &
  else
    echo "no Redis reachable at $REDIS_URL — Queue & DLQ view will show 'no run captured yet' (start a Redis + re-run to populate)" >&2
  fi
fi

exec node web/server.mjs

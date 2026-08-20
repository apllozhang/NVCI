#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${NVCI_P04_TEST_PORT:-8796}"
WORK="$ROOT/.test-p04-api-output"
DATA="$ROOT/.test-p04-api-data"
COOKIE="$WORK/cookie.txt"
LOG="$WORK/server.log"
mkdir -p "$WORK"
rm -rf "$DATA" "$COOKIE" "$LOG"

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true; fi
}
trap cleanup EXIT

cd "$ROOT"
PORT="$PORT" NVCI_DATA_DIR="$DATA" NVCI_ADMIN_PASSWORD="p04-test-password" NVCI_SESSION_SECRET="p04-test-session-secret" node server.js >"$LOG" 2>&1 &
SERVER_PID=$!
for attempt in $(seq 1 50); do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then break; fi
  sleep 0.2
done
curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null
curl -fsS -c "$COOKIE" -H 'Content-Type: application/json' -d '{"password":"p04-test-password"}' "http://127.0.0.1:$PORT/api/login" >"$WORK/login.json"
curl -fsS -b "$COOKIE" -X POST -H 'Content-Type: application/json' -d '{}' "http://127.0.0.1:$PORT/api/intelligence/imports/p04-pilot-relations/preview" >"$WORK/preview.json"
grep -q '"modelCount":81' "$WORK/preview.json"
grep -q '"candidatePairs":1610' "$WORK/preview.json"
curl -fsS -b "$COOKIE" -X POST -H 'Content-Type: application/json' -d '{}' "http://127.0.0.1:$PORT/api/intelligence/imports/p04-pilot-relations/execute" >"$WORK/execute.json"
grep -q '"total":1610' "$WORK/execute.json"
curl -fsS -b "$COOKIE" "http://127.0.0.1:$PORT/api/intelligence/comparisons/metrics" >"$WORK/metrics.json"
grep -q '"total":1610' "$WORK/metrics.json"
curl -fsS -b "$COOKIE" "http://127.0.0.1:$PORT/api/intelligence/comparisons?matchStatus=direct_candidate&limit=1" >"$WORK/direct.json"
RELATION_ID="$(grep -o '"relationship_id":"[^"]*"' "$WORK/direct.json" | head -1 | cut -d'"' -f4)"
[[ -n "$RELATION_ID" ]]
curl -fsS -b "$COOKIE" "http://127.0.0.1:$PORT/api/intelligence/comparisons/$RELATION_ID" >"$WORK/detail.json"
grep -q '"evidence"' "$WORK/detail.json"
grep -q '"hardGates"' "$WORK/detail.json"
curl -fsS -b "$COOKIE" -X PATCH -H 'Content-Type: application/json' -d '{"reviewState":"approved","reason":"P0-4 API 冒烟测试：验证审核审计链路。"}' "http://127.0.0.1:$PORT/api/intelligence/comparisons/$RELATION_ID/review" >"$WORK/review.json"
grep -q '"review_state":"approved"' "$WORK/review.json"
curl -fsS -b "$COOKIE" "http://127.0.0.1:$PORT/api/intelligence/comparisons/metrics" >"$WORK/metrics-after-review.json"
grep -q '"approved":1' "$WORK/metrics-after-review.json"
printf '{"ok":true,"port":%s,"relationshipId":"%s"}\n' "$PORT" "$RELATION_ID"

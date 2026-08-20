#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${NVCI_P041_TEST_PORT:-8801}"
WORK="$ROOT/.test-p041-api-output"
DATA="$ROOT/.test-p041-api-data"
COOKIE="$WORK/cookie.txt"
LOG="$WORK/server.log"
mkdir -p "$WORK"
rm -rf "$DATA" "$COOKIE" "$LOG"

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true; fi
}
trap cleanup EXIT

cd "$ROOT"
PORT="$PORT" NVCI_DATA_DIR="$DATA" NVCI_ADMIN_PASSWORD="p041-test-password" NVCI_SESSION_SECRET="p041-test-session-secret" node server.js >"$LOG" 2>&1 &
SERVER_PID=$!
for attempt in $(seq 1 50); do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then break; fi
  sleep 0.2
done
curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null
curl -fsS -c "$COOKIE" -H 'Content-Type: application/json' -d '{"password":"p041-test-password"}' "http://127.0.0.1:$PORT/api/login" >"$WORK/login.json"

curl -fsS -b "$COOKIE" -X POST -H 'Content-Type: application/json' -d '{}' "http://127.0.0.1:$PORT/api/intelligence/imports/p04-pilot-relations/execute" >"$WORK/p04-execute.json"
grep -q '"total":1610' "$WORK/p04-execute.json"
curl -fsS -b "$COOKIE" "http://127.0.0.1:$PORT/api/intelligence/comparisons/metrics" >"$WORK/metrics-before.json"
grep -q '"total":1610' "$WORK/metrics-before.json"
grep -q '"advisories":{"total":0' "$WORK/metrics-before.json"

curl -fsS -b "$COOKIE" -X POST -H 'Content-Type: application/json' -d '{}' "http://127.0.0.1:$PORT/api/intelligence/imports/p041-direct-review-advisories/preview" >"$WORK/preview.json"
grep -q '"advisoryCount":36' "$WORK/preview.json"
grep -q '"propose_partial_candidate":18' "$WORK/preview.json"

curl -fsS -b "$COOKIE" -X POST -H 'Content-Type: application/json' -d '{}' "http://127.0.0.1:$PORT/api/intelligence/imports/p041-direct-review-advisories/execute" >"$WORK/execute.json"
grep -q '"advisories":36' "$WORK/execute.json"
grep -q '"unchangedProductionRelationships":36' "$WORK/execute.json"
grep -q '"reviews":18' "$WORK/execute.json"

curl -fsS -b "$COOKIE" "http://127.0.0.1:$PORT/api/intelligence/comparisons/metrics" >"$WORK/metrics-after.json"
grep -q '"total":1610' "$WORK/metrics-after.json"
grep -q '"advisories":{"total":36' "$WORK/metrics-after.json"
curl -fsS -b "$COOKIE" "http://127.0.0.1:$PORT/api/intelligence/comparisons/advisories?priority=P1&limit=20" >"$WORK/p1-advisories.json"
grep -q '"priority":"P1"' "$WORK/p1-advisories.json"
curl -fsS -b "$COOKIE" "http://127.0.0.1:$PORT/api/intelligence/comparisons?matchStatus=direct_candidate&limit=1" >"$WORK/direct.json"
RELATION_ID="$(grep -o '"relationship_id":"[^"]*"' "$WORK/direct.json" | head -1 | cut -d'"' -f4)"
[[ -n "$RELATION_ID" ]]
curl -fsS -b "$COOKIE" "http://127.0.0.1:$PORT/api/intelligence/comparisons/$RELATION_ID" >"$WORK/detail.json"
grep -q '"advisories"' "$WORK/detail.json"

printf '{"ok":true,"port":%s,"relationshipId":"%s","advisories":36,"productionRelationships":1610}\n' "$PORT" "$RELATION_ID"

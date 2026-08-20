#!/usr/bin/env bash
set -euo pipefail
ROOT=/home/ubuntu/NVCI
DATA_DIR="$ROOT/.test-extreme-live-samples"
PORT=8795
LOG=/tmp/nvci-extreme-live-samples.log
COOKIE=/tmp/nvci-extreme-live-samples.cookie
OUT=/tmp/nvci-extreme-live-samples.jsonl
rm -rf "$DATA_DIR" "$COOKIE" "$OUT"
NVCI_DATA_DIR="$DATA_DIR" \
NVCI_ADMIN_PASSWORD='local-test-password' \
NVCI_SESSION_SECRET='local-test-session-secret-0123456789' \
PORT="$PORT" node "$ROOT/server.js" >"$LOG" 2>&1 &
PID=$!
cleanup() {
  kill "$PID" 2>/dev/null || true
  wait "$PID" 2>/dev/null || true
  rm -rf "$DATA_DIR" "$COOKIE"
}
trap cleanup EXIT
sleep 2
curl -fsS --max-time 15 -c "$COOKIE" -H 'Content-Type: application/json' \
  --data '{"password":"local-test-password"}' "http://127.0.0.1:$PORT/api/login" >/dev/null
profiles=(
  extreme_wired_access_datasheets
  extreme_wireless_access_datasheets
  extreme_management_datasheets
)
for profile in "${profiles[@]}"; do
  result=$(curl -fsS --max-time 150 -b "$COOKIE" -X POST "http://127.0.0.1:$PORT/api/source-configs/$profile/sample-check")
  printf '%s\n' "$result" >>"$OUT"
  printf '%s' "$result" | grep -q '"passed":true'
  printf '%s' "$result" | grep -q '"approvalStatus":"sample_verified"'
  printf '%s' "$result" | grep -q '"enabled":false'
done
cat "$OUT"

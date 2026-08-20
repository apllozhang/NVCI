#!/usr/bin/env bash
set -euo pipefail
ROOT=/home/ubuntu/NVCI
DATA_DIR="$ROOT/.test-six-vendor-live-samples"
PORT=8794
LOG=/tmp/nvci-six-vendor-live-samples.log
COOKIE=/tmp/nvci-six-vendor-live-samples.cookie
OUT=/tmp/nvci-six-vendor-live-samples.jsonl
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
  ale_omniswitch
  hpe_aruba_cx_switches
  cisco_switches_exact_mapping_01
  h3c_switches_verified_01
  ruijie_public_preview_01
  huawei_campus_access
)
for profile in "${profiles[@]}"; do
  result=$(curl -fsS --max-time 150 -b "$COOKIE" -X POST "http://127.0.0.1:$PORT/api/source-configs/$profile/sample-check")
  printf '%s\n' "$result" >>"$OUT"
  printf '%s' "$result" | grep -q '"passed":true'
done
cat "$OUT"

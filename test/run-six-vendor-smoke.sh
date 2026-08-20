#!/usr/bin/env bash
set -euo pipefail
ROOT=/home/ubuntu/NVCI
DATA_DIR="$ROOT/.test-six-vendor-config"
PORT=8793
LOG=/tmp/nvci-six-vendor-smoke.log
rm -rf "$DATA_DIR"
NVCI_DATA_DIR="$DATA_DIR" \
NVCI_ADMIN_PASSWORD='local-test-password' \
NVCI_SESSION_SECRET='local-test-session-secret-0123456789' \
PORT="$PORT" node "$ROOT/server.js" >"$LOG" 2>&1 &
PID=$!
cleanup() {
  kill "$PID" 2>/dev/null || true
  wait "$PID" 2>/dev/null || true
  rm -rf "$DATA_DIR"
}
trap cleanup EXIT
sleep 2
NVCI_DATA_DIR="$DATA_DIR" \
NVCI_TEST_BASE="http://127.0.0.1:$PORT" \
NVCI_ADMIN_PASSWORD='local-test-password' \
node "$ROOT/test/automation-api-smoke.js"

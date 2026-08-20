#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${NVCI_TEST_PORT:-8791}"
BASE="http://127.0.0.1:${PORT}"
DATA_DIR="${ROOT}/.test-p03-api"
OUT_DIR="${ROOT}/.test-p03-api-output"
COOKIE_JAR="${OUT_DIR}/cookies.txt"
LOG_FILE="${OUT_DIR}/server.log"

if ss -ltn | awk '{print $4}' | grep -Eq ":${PORT}$"; then
  echo "测试端口 ${PORT} 已被占用；请指定未使用的 NVCI_TEST_PORT。" >&2
  exit 2
fi
rm -rf "$DATA_DIR" "$OUT_DIR"
mkdir -p "$OUT_DIR"
NVCI_DATA_DIR="$DATA_DIR" PORT="$PORT" NVCI_ADMIN_PASSWORD="p03-api-test" NVCI_SESSION_SECRET="p03-api-test-secret" node "$ROOT/server.js" >"$LOG_FILE" 2>&1 &
SERVER_PID=$!
cleanup() { kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true; }
trap cleanup EXIT

for _ in $(seq 1 30); do
  if curl -fsS "$BASE/health" >"$OUT_DIR/health.json" 2>/dev/null; then break; fi
  sleep 0.2
done
if ! grep -q '"ok":true' "$OUT_DIR/health.json" 2>/dev/null; then
  echo "测试服务未在 ${BASE} 正常启动。" >&2
  cat "$LOG_FILE" >&2 || true
  exit 1
fi
curl -fsS -c "$COOKIE_JAR" -H 'Content-Type: application/json' -d '{"password":"p03-api-test"}' "$BASE/api/login" >"$OUT_DIR/login.json"
curl -fsS -b "$COOKIE_JAR" -H 'Content-Type: application/json' -X POST -d '{}' "$BASE/api/intelligence/imports/ale-readonly/execute" >"$OUT_DIR/readonly.json"
curl -fsS -b "$COOKIE_JAR" -H 'Content-Type: application/json' -X POST -d '{}' "$BASE/api/intelligence/governance/ale-bootstrap" >"$OUT_DIR/governance.json"
curl -fsS -b "$COOKIE_JAR" "$BASE/api/intelligence/research-tasks" >"$OUT_DIR/tasks.json"
TASK_ID="$(sed -n 's/.*"task_id":"\([^"]*\)".*/\1/p' "$OUT_DIR/tasks.json" | head -1)"
if [[ -z "$TASK_ID" ]]; then echo "could not find task ID" >&2; exit 1; fi
FIELDS='["form_factor","downlink_ports","downlink_speed","uplink_ports","uplink_speed","poe_support","poe_budget","switching_capacity","forwarding_rate","stacking_virtualization","max_stack_members","l3_routing","ospf_support","vxlan_evpn_support","automation_api","management_platform","acl_security"]'
curl -fsS -b "$COOKIE_JAR" -H 'Content-Type: application/json' -X POST -d "{\"templateId\":\"campus_switching_v1\",\"selectedFieldCodes\":${FIELDS},\"rationale\":\"P0-3 API 冒烟测试字段范围。\"}" "$BASE/api/intelligence/research-tasks/$TASK_ID/field-packs" >"$OUT_DIR/field-pack.json"
PACK_ID="$(sed -n 's/.*"createdPackId":"\([^"]*\)".*/\1/p' "$OUT_DIR/field-pack.json" | head -1)"
if [[ -z "$PACK_ID" ]]; then echo "could not find field pack ID" >&2; exit 1; fi
curl -fsS -b "$COOKIE_JAR" -H 'Content-Type: application/json' -X POST -d '{"reason":"P0-3 API 冒烟测试批准。"}' "$BASE/api/intelligence/field-packs/$PACK_ID/approve" >"$OUT_DIR/field-pack-approved.json"
curl -fsS -b "$COOKIE_JAR" -H 'Content-Type: application/json' -X POST -d '{}' "$BASE/api/intelligence/imports/ale-field-facts/preview" >"$OUT_DIR/field-facts-preview.json"
curl -fsS -b "$COOKIE_JAR" -H 'Content-Type: application/json' -X POST -d '{}' "$BASE/api/intelligence/imports/ale-field-facts/execute" >"$OUT_DIR/field-facts-execute.json"
curl -fsS -b "$COOKIE_JAR" "$BASE/api/intelligence/metrics" >"$OUT_DIR/metrics.json"

if ! grep -q '"plannedFacts":255' "$OUT_DIR/field-facts-preview.json"; then echo "preview planned fact count mismatch" >&2; exit 1; fi
if ! grep -q '"facts":255' "$OUT_DIR/field-facts-execute.json"; then echo "execute fact creation count mismatch" >&2; exit 1; fi
if ! grep -q '"verified":223' "$OUT_DIR/metrics.json" || ! grep -q '"notDisclosed":31' "$OUT_DIR/metrics.json" || ! grep -q '"needsReview":1' "$OUT_DIR/metrics.json"; then echo "metric state distribution mismatch" >&2; exit 1; fi

printf 'P0-3 API smoke test passed\n'
printf 'Preview: '; grep -o '"plannedFacts":[0-9]*' "$OUT_DIR/field-facts-preview.json" | head -1
printf 'Metrics: '; grep -o '"verified":[0-9]*,"notDisclosed":[0-9]*,"needsReview":[0-9]*' "$OUT_DIR/metrics.json" | head -1

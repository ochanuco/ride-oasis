#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="${LOG_DIR:-$ROOT_DIR/logs}"
mkdir -p "$LOG_DIR" "$ROOT_DIR/data/geocoded"

cd "$ROOT_DIR"

run_geocode() {
  local chain="$1"
  local input_dir="$2"
  local output_file="$3"
  local log_file="$LOG_DIR/geocode_${chain}.log"
  local extra_args=()
  if [ -n "${JAPANESE_ADDRESSES_API:-}" ]; then
    extra_args+=(--japanese-addresses-api "$JAPANESE_ADDRESSES_API")
  fi

  echo "[start] geocode ${chain}"
  node scripts/geocode_stores_ndjson.js \
    --chain "$chain" \
    --input "$input_dir" \
    --existing data/geocoded \
    --output "$output_file" \
    --engine-version 3.1.3 \
    "${extra_args[@]}" \
    2>&1 | tee "$log_file"
  echo "[done]  geocode ${chain} (log: ${log_file})"
}

run_geocode "7eleven" "data/7eleven/ndjson" "data/geocoded/stores_geocoded_7eleven.ndjson"
run_geocode "lawson" "data/lawson/ndjson" "data/geocoded/stores_geocoded_lawson.ndjson"
run_geocode "familymart" "data/familymart/ndjson" "data/geocoded/stores_geocoded_familymart.ndjson"
run_geocode "daily_yamazaki" "data/daily_yamazaki/ndjson" "data/geocoded/stores_geocoded_daily_yamazaki.ndjson"
run_geocode "michi_no_eki" "data/michi_no_eki/ndjson" "data/geocoded/stores_geocoded_michi_no_eki.ndjson"
run_geocode "ministop" "data/ministop/ndjson" "data/geocoded/stores_geocoded_ministop.ndjson"

echo "全チェーン geocode NDJSON の生成が完了しました。"

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="${LOG_DIR:-$ROOT_DIR/logs}"
mkdir -p "$LOG_DIR"

cd "$ROOT_DIR"

if [ ! -d "node_modules/playwright" ]; then
  echo "playwright が見つかりません。先に npm install を実行してください。" >&2
  exit 1
fi

run_chain() {
  local chain="$1"
  local script_path="$2"
  local log_file="$LOG_DIR/crawl_${chain}.log"

  echo "[start] ${chain}"
  node "$script_path" --pref all 2>&1 | tee "$log_file"
  echo "[done]  ${chain} (log: ${log_file})"
}

run_chain "7eleven" "scripts/7eleven_pref_ndjson.js"
run_chain "lawson" "scripts/lawson_pref_ndjson.js"
run_chain "familymart" "scripts/familymart_pref_ndjson.js"
run_chain "daily_yamazaki" "scripts/daily_yamazaki_pref_ndjson.js"
run_chain "michi_no_eki" "scripts/michi_no_eki_pref_ndjson.js"
run_chain "ministop" "scripts/ministop_pref_ndjson.js"

echo "全チェーンのクロールが完了しました。"

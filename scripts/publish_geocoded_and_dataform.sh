#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="${LOG_DIR:-$ROOT_DIR/logs}"
PROJECT_ID="${PROJECT_ID:-chanukott}"
DATASET="${DATASET:-rideoasis_raw}"
TABLE="${TABLE:-stores_geocoded}"
LOCATION="${LOCATION:-asia-northeast1}"

mkdir -p "$LOG_DIR"
cd "$ROOT_DIR"

if ! command -v bq >/dev/null 2>&1; then
  echo "bq コマンドが見つかりません。" >&2
  exit 1
fi

if ! command -v dataform >/dev/null 2>&1; then
  echo "dataform コマンドが見つかりません。" >&2
  exit 1
fi

files=(data/geocoded/stores_geocoded_*.ndjson)
if [ ! -e "${files[0]}" ]; then
  echo "data/geocoded/stores_geocoded_*.ndjson が見つかりません。先に geocode を実行してください。" >&2
  exit 1
fi

for f in "${files[@]}"; do
  echo "[upsert] ${f}"
  npm run bq:upsert:geocoded -- \
    --project "$PROJECT_ID" \
    --dataset "$DATASET" \
    --table "$TABLE" \
    --source "$f" \
    --location "$LOCATION" \
    2>&1 | tee "$LOG_DIR/upsert_$(basename "$f" .ndjson).log"
done

echo "[run] dataform"
npm_config_cache=/tmp/ride-oasis-npm-cache dataform run ./dataform \
  2>&1 | tee "$LOG_DIR/dataform_run.log"

echo "geocoded 反映と Dataform 実行が完了しました。"

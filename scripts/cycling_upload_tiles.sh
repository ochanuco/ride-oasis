#!/usr/bin/env bash
set -euo pipefail

# Uploads `data/cycling/tiles/*.bin` to the R2 bucket
# `ride-oasis-cycling-graph` under the `tiles/` prefix, in parallel.
# Existing keys are overwritten (R2 last-write-wins). After upload the
# worker sees fresh tiles on next isolate boot; cache_version in
# worker.mjs should be bumped in the same deploy to bypass edge cache.
#
# Usage:
#   bash scripts/cycling_upload_tiles.sh [--dir data/cycling] [--concurrency 8]
#
# Notes:
#   - Defaults: dir=data/cycling, concurrency=8 (~3-5 min for ~1500 tiles)
#   - Failures abort the loop (set -e). Re-run is idempotent.

DIR="data/cycling"
CONCURRENCY=8
BUCKET="ride-oasis-cycling-graph"
PREFIX="tiles/"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) DIR="$2"; shift 2;;
    --concurrency) CONCURRENCY="$2"; shift 2;;
    -h|--help)
      sed -n '1,/^DIR=/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'
      exit 0;;
    *) echo "unknown arg: $1" >&2; exit 1;;
  esac
done

TILES_DIR="$DIR/tiles"
if [[ ! -d "$TILES_DIR" ]]; then
  echo "missing $TILES_DIR" >&2
  exit 1
fi

count=$(find "$TILES_DIR" -name '*.bin' | wc -l | tr -d ' ')
echo "uploading $count tiles from $TILES_DIR to r2://$BUCKET/$PREFIX (concurrency=$CONCURRENCY)"

# xargs で並列に `wrangler r2 object put --remote` を回す。各 put は
# 一過性の DNS/接続エラーに備えて 3 回までリトライ (指数バックオフ 1s/2s)。
# 最終試行後は待機せずに即 exit 1 して失敗検知を遅らせない。
# それでも失敗すれば子プロセスが exit 1 を返し xargs/set -e で全体 fail。
# upload は idempotent (R2 last-write-wins) なので、全体失敗時はスクリプト
# を単純に再実行すれば残りも処理される。
find "$TILES_DIR" -name '*.bin' -print0 \
  | xargs -0 -P "$CONCURRENCY" -I{} bash -c '
      f="$1"
      key="'"$PREFIX"'$(basename "$f")"
      max_attempts=3
      for attempt in $(seq 1 $max_attempts); do
        if npx wrangler r2 object put "'"$BUCKET"'/$key" --file="$f" --remote >/dev/null 2>&1; then
          exit 0
        fi
        if [ "$attempt" -lt "$max_attempts" ]; then
          sleep $((2 ** (attempt - 1)))  # 1, 2 (試行間), 最終試行後は待たない
        fi
      done
      echo "FAIL after $max_attempts retries: $key" >&2
      exit 1
    ' _ {}

echo "done"

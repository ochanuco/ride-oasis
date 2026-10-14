#!/usr/bin/env bash
# 使い方: scripts/deploy.sh production
# D1 migration はここで適用しない。migration を含む変更は PR ごとに手で適用する。
# wrangler.toml の [build]（pnpm run wasm:fetch）が WASM 成果物を取得してから deploy する。
set -euo pipefail

if [ "${1:-}" != "production" ]; then
  echo "usage: scripts/deploy.sh production" >&2
  exit 2
fi

pnpm exec wrangler deploy

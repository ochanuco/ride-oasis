# rust-router (browser bundle)

`wasm-pack --target web` 出力。`frontend/wasm_bootstrap.mjs` から ESM import
され、`window.RouterWasm` に `routeDistances` を公開する。

## Exports (browser から使う)

| 関数 | 用途 |
|---|---|
| `route_distances(routeLonLats, shopLonLats) → Float32Array` | GPX モードで全 shop の "ルートから最小垂直距離" を batch 計算。slider 操作のたびに走るので 5-10x 高速化のインパクト大 (`frontend/app.js` `filterMatchedPoints`) |
| `route_ch(...)` | Worker 専用 (Cold path CH ルーティング)。browser からは使わない |
| `astar(...)` | 旧 PoC。browser からは使わない |

## Build

`npm run wasm:build` がリポジトリ root から自動再生成する:
1. `rust-router/pkg/` (bundler target、Worker 用)
2. `rust-router/pkg-node/` (Node target、bench 用)
3. `rust-router/pkg-web/` → `frontend/wasm/` (web target、ブラウザ用) ← この dir

このディレクトリの `README.md` も `scripts/patch_wasm_dts.mjs` が後追いで
本物に上書きする (wasm-pack が auto 生成する README は A* PoC の古い説明)。

## Benchmark

`scripts/cycling_route_filter_bench.js` が JS と WASM の `route_distances`
を比較する (pkg-node target 使用):

```bash
node --expose-gc scripts/cycling_route_filter_bench.js
```

### 結果 (synthetic data、ローカル Node)

| シナリオ | JS | WASM | speedup |
|---|---|---|---|
| 500×300 | 3.5ms | 0.5ms | 7.6x |
| 1000×500 | 11ms | 2ms | 7.2x |
| 3000×1000 (ブルベ規模) | 63ms | 9ms | 7.1x |
| 5000×1000 (長距離) | 104ms | 15ms | 7.0x |

数値完全一致 (max diff 0.00m)。

## Worker 側

別 dir `rust-router/pkg/` が Worker 用 (bundler target)。`worker.mjs` は
`./rust-router/pkg/rust_router_worker.js` (手書き lazy wrapper) 経由で
`route_ch` + `route_distances` を import。`/api/supply-points` の route
filter にも同じ Rust 実装が使われている。

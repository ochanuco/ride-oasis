#!/usr/bin/env node
// wasm-pack が生成する rust-router/pkg/rust_router.d.ts は route_ch の
// 戻り値・引数を `any` にする。本番 worker.mjs は wrapper 経由で import
// するため実害は無いが、CodeRabbit が型甘さを指摘するので d.ts も strict
// な union 型へ patch する。
//
// `npm run wasm:build` の最後で実行され、再生成された d.ts に **差分 patch**
// を当てる (CodeRabbit PR #88 指摘)。全文上書きは将来 wasm-pack が新しい
// export を追加した時に静かに消してしまうため、route_ch 関連の型だけを
// 正規表現で差し替える戦略をとる。
//
// 冪等性は先頭の PATCH_MARKER で判定。あれば skip。

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dtsPath = resolve(__dirname, '..', 'rust-router', 'pkg', 'rust_router.d.ts');

const PATCH_MARKER = '/* AUTO-PATCHED-BY: scripts/patch_wasm_dts.mjs */';
const IMPORT_LINE = "import type { RouteChResult } from './rust_router_worker';";
const PATCH_NOTE = [
  '/*',
  ' * route_ch の正確な戻り値型は ./rust_router_worker.d.ts の RouteChResult',
  ' * (RouteChOk | RouteChErr) を参照。本ファイルは wasm-pack 再生成時に',
  ' * scripts/patch_wasm_dts.mjs が差分 patch で再適用する。',
  ' */'
].join('\n');

// route_ch のシグネチャに `Array<any>` (buffers) と `: any;` (戻り値) が
// あれば差し替える。astar 等の他の export は触らない。
const BUFFERS_ANY_PATTERN = /(\bfunction route_ch\(\s*buffers:\s*)Array<any>/m;
const ROUTE_CH_RETURN_PATTERN =
  /(\bexport function route_ch\(\s*buffers:\s*[^)]+\)\s*:\s*)any(\s*;)/m;

let current;
try {
  current = readFileSync(dtsPath, 'utf8');
} catch (err) {
  console.error(`[patch_wasm_dts] Failed to read ${dtsPath}:`, err.message);
  process.exit(1);
}

if (current.startsWith(PATCH_MARKER)) {
  console.log('[patch_wasm_dts] already patched (marker present); skip');
  process.exit(0);
}

let patched = current;

// 1) buffers: Array<any> → Uint8Array[]
const beforeBuffers = patched;
patched = patched.replace(BUFFERS_ANY_PATTERN, '$1Uint8Array[]');
const buffersPatched = patched !== beforeBuffers;

// 2) 戻り値 ): any; → ): RouteChResult;
const beforeReturn = patched;
patched = patched.replace(ROUTE_CH_RETURN_PATTERN, '$1RouteChResult$2');
const returnPatched = patched !== beforeReturn;

if (!buffersPatched && !returnPatched) {
  console.warn(
    '[patch_wasm_dts] WARN: route_ch any-typed signature not found in d.ts. ' +
    'wasm-pack may have changed its output. Inspect ' + dtsPath
  );
}

// 3) RouteChResult を使うため import 行を追加。既存の disable comment 直後
//    に挿入する (なければ先頭近くに追加)。
if (!patched.includes(IMPORT_LINE)) {
  if (/\/\* eslint-disable \*\//.test(patched)) {
    patched = patched.replace(
      /(\/\* eslint-disable \*\/[ \t]*\n)/,
      `$1\n${IMPORT_LINE}\n\n${PATCH_NOTE}\n`
    );
  } else {
    patched = `${IMPORT_LINE}\n\n${PATCH_NOTE}\n\n${patched}`;
  }
}

// 4) marker を先頭に prepend (冪等性チェック用)
patched = `${PATCH_MARKER}\n${patched}`;

try {
  writeFileSync(dtsPath, patched);
} catch (err) {
  console.error(`[patch_wasm_dts] Failed to write ${dtsPath}:`, err.message);
  process.exit(1);
}
console.log(
  `[patch_wasm_dts] patched ${dtsPath} ` +
  `(buffers=${buffersPatched}, return=${returnPatched})`
);

// frontend/wasm/README.md は wasm-pack が auto 生成する README で上書き
// されてしまう (A* PoC の古い説明)。本物の説明文をここから書き戻す。
const frontendReadmePath = resolve(
  __dirname,
  '..',
  'frontend',
  'wasm',
  'README.md'
);
const FRONTEND_README = `# rust-router (browser bundle)

\`wasm-pack --target web\` 出力。\`frontend/wasm_bootstrap.mjs\` から ESM import
され、\`window.RouterWasm\` に \`routeDistances\` を公開する。

## Exports (browser から使う)

| 関数 | 用途 |
|---|---|
| \`route_distances(routeLonLats, shopLonLats) → Float32Array\` | GPX モードで全 shop の "ルートから最小垂直距離" を batch 計算。slider 操作のたびに走るので 5-10x 高速化のインパクト大 (\`frontend/app.js\` \`filterMatchedPoints\`) |
| \`route_ch(...)\` | Worker 専用 (Cold path CH ルーティング)。browser からは使わない |
| \`astar(...)\` | 旧 PoC。browser からは使わない |

## Build

\`npm run wasm:build\` がリポジトリ root から自動再生成する:
1. \`rust-router/pkg/\` (bundler target、Worker 用)
2. \`rust-router/pkg-node/\` (Node target、bench 用)
3. \`rust-router/pkg-web/\` → \`frontend/wasm/\` (web target、ブラウザ用) ← この dir

このディレクトリの \`README.md\` も \`scripts/patch_wasm_dts.mjs\` が後追いで
本物に上書きする (wasm-pack が auto 生成する README は A* PoC の古い説明)。

## Benchmark

\`scripts/cycling_route_filter_bench.js\` が JS と WASM の \`route_distances\`
を比較する (pkg-node target 使用):

\`\`\`bash
node --expose-gc scripts/cycling_route_filter_bench.js
\`\`\`

### 結果 (synthetic data、ローカル Node)

| シナリオ | JS | WASM | speedup |
|---|---|---|---|
| 500×300 | 3.5ms | 0.5ms | 7.6x |
| 1000×500 | 11ms | 2ms | 7.2x |
| 3000×1000 (ブルベ規模) | 63ms | 9ms | 7.1x |
| 5000×1000 (長距離) | 104ms | 15ms | 7.0x |

数値完全一致 (max diff 0.00m)。

## Worker 側

別 dir \`rust-router/pkg/\` が Worker 用 (bundler target)。\`worker.mjs\` は
\`./rust-router/pkg/rust_router_worker.js\` (手書き lazy wrapper) 経由で
\`route_ch\` + \`route_distances\` を import。\`/api/supply-points\` の route
filter にも同じ Rust 実装が使われている。
`;
try {
  writeFileSync(frontendReadmePath, FRONTEND_README);
  console.log(`[patch_wasm_dts] wrote ${frontendReadmePath}`);
} catch (err) {
  console.error(`[patch_wasm_dts] Failed to write ${frontendReadmePath}:`, err.message);
  process.exit(1);
}

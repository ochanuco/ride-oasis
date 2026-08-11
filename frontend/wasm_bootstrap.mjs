// Rust WASM bootstrap for the browser (GPX mode shop filtering 高速化).
//
// app.js は classic script なので、ここで `<script type="module">` から
// WASM を init して window.RouterWasm に公開する。app.js は
// `window.RouterWasm?.routeDistances` の有無で WASM/JS をオプトイン切替する。
//
// WASM 読み込みは route 表示後でも構わない (ブラウザ起動を遅らせない)。
// 失敗時 (古いブラウザ etc.) は window.RouterWasm を立てず JS path を継続。

import init, { route_distances } from './wasm/router_wasm.js';

// Race condition 回避: app.js が早期実行された場合に WASM 準備完了を待てるよう Promise を公開。
let resolveWasmReady;
window.RouterWasmReady = new Promise((resolve) => {
  resolveWasmReady = resolve;
});

(async () => {
  try {
    // wasm-pack web target は default export が init(url) を取る。同 dir の
    // *_bg.wasm を指定して initialize する。
    await init({ module_or_path: './wasm/router_wasm_bg.wasm' });
    window.RouterWasm = {
      /**
       * route_distances(routeLonLats: Float64Array, shopLonLats: Float64Array)
       *   → Float32Array, length = shopLonLats.length / 2
       * 各 shop の最小垂直距離 (m)。
       */
      routeDistances: route_distances,
      version: '1.0.0'
    };
    // 観測用: console に WASM 利用可能をログ
    console.log('[RouterWasm] ready');
    resolveWasmReady(true);
  } catch (err) {
    console.warn('[RouterWasm] init failed, falling back to JS:', err);
    resolveWasmReady(false);
  }
})();

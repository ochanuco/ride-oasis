#!/usr/bin/env node
// wasm-pack が生成する rust-router/pkg/rust_router.d.ts は route_ch の
// 戻り値を `any` にする。本番 worker.mjs は wrapper (rust_router_worker.js)
// 経由で import するため実害は無いが、CodeRabbit が型甘さを指摘するので
// d.ts も strict union 型へ patch する。
//
// `npm run wasm:build` の最後で実行され、再生成された d.ts を上書きする。

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dtsPath = resolve(__dirname, '..', 'rust-router', 'pkg', 'rust_router.d.ts');

const PATCHED = `/* tslint:disable */
/* eslint-disable */

/*
 * 注意: wasm-pack が自動生成する .d.ts は route_ch の戻りを \`any\` にする。
 * Workers 本番は ./rust_router_worker.js (lazy 初期化 wrapper) を import
 * しており、そちらの ./rust_router_worker.d.ts に正確な RouteChOk /
 * RouteChErr union 型が定義されている。
 *
 * このファイルは wasm-pack が再生成すると元の \`any\` シグネチャに戻るため、
 * \`npm run wasm:build\` の post-build (scripts/patch_wasm_dts.mjs) で
 * 自動的に再 patch される。
 */

import type { RouteChResult } from './rust_router_worker';

/**
 * Forward A* on the flat graph representation. Returns the path including
 * start and goal indices, prefixed by the total distance.
 */
export function astar(node_coords: Float64Array, edge_data: Float64Array, start: number, goal: number): Float64Array;

/**
 * DNF route entry point. See ./rust_router_worker.d.ts for the precise
 * RouteChResult shape (union of RouteChOk / RouteChErr).
 */
export function route_ch(
  buffers: Uint8Array[],
  from_lon: number,
  from_lat: number,
  to_lon: number,
  to_lat: number,
  max_snap_meters: number
): RouteChResult;
`;

const current = readFileSync(dtsPath, 'utf8');
if (current === PATCHED) {
  console.log('[patch_wasm_dts] already patched');
} else {
  writeFileSync(dtsPath, PATCHED);
  console.log(`[patch_wasm_dts] patched ${dtsPath}`);
}

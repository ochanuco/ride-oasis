/* tslint:disable */
/* eslint-disable */

/**
 * Forward A* on the flat graph representation. Returns the path including
 * start and goal indices, prefixed by the total distance.
 */
export function astar(node_coords: Float64Array, edge_data: Float64Array, start: number, goal: number): Float64Array;

/**
 * DNF route entry point. Decodes tile buffers, builds CSR, snaps endpoints,
 * runs CH bidirectional query, unpacks shortcuts. Returns a JS object with
 * `{ distance, settled, terminated, ch_ms, snap_from_m, snap_to_m,
 * from_id, to_id, coords: [[lon,lat]...], algorithm, csr_bytes,
 * csr_node_count, csr_edge_count }`.
 *
 * `buffers` は `Array<Uint8Array>` を JS から渡す想定。各要素はタイル
 * binary (v1 or v2)。corridor + snap neighborhood 分まとめて渡す。
 *
 * 失敗時は `{ error: "..." }` を含む JS object を返す (例外を投げない)。
 */
export function route_ch(buffers: Array<any>, from_lon: number, from_lat: number, to_lon: number, to_lat: number, max_snap_meters: number): any;

/**
 * Browser GPX-mode helper: for each shop point, compute the minimum
 * perpendicular distance (meters) to the route polyline. Used by
 * `frontend/app.js` to filter supply-points within N meters of the route
 * without running the O(N×M) JS loop on the main thread (5-10x faster).
 *
 * Inputs (flat typed arrays for zero-copy boundary):
 * - `route_lonlats`: Float64Array of length 2*N (lon, lat alternating)
 * - `shop_lonlats`: Float64Array of length 2*M (lon, lat alternating)
 *
 * Returns Float32Array of length M with per-shop minimum distance (m).
 * On empty/invalid inputs returns the appropriate length 0 / INF array.
 */
export function route_distances(route_lonlats: Float64Array, shop_lonlats: Float64Array): Float32Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly astar: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly route_ch: (a: any, b: number, c: number, d: number, e: number, f: number) => any;
    readonly route_distances: (a: number, b: number, c: number, d: number) => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;

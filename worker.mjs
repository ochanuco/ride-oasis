// `lib/map_data.js` is CommonJS (shared with the Node dev server). Importing
// the default export gives us the entire `module.exports` object, then we
// destructure the helpers we need. Going through the default import is the
// most portable way to consume CJS from ESM under Workers' bundler.
import mapData from './lib/map_data.js';
import tiledRouterModule from './lib/cycling/tiled_router.js';
import tileLoaderModule from './lib/cycling/tile_loader.js';
import dnfPackModule from './lib/cycling/dnf_pack.js';

const {
  parseSupplyPointFilters,
  buildSupplyPointsQuery,
  toFeatureCollection,
  ValidationError
} = mapData;

const { TiledRouter } = tiledRouterModule;
const { TileLoader, makeR2Fetcher } = tileLoaderModule;
const { douglasPeucker, routeBBoxWithBuffer } = dnfPackModule;

const API_PATH = '/api/supply-points';
const ROUTE_PATH = '/api/route';
const DNF_PACK_PATH = '/api/dnf-pack';

// Per-isolate tile loader cache. Tiles loaded from R2 are reused across
// requests in the same isolate so repeat queries in the same city are cheap.
let tileLoaderCache = null;
const NAMED_PLACEHOLDER_RE = /:([A-Za-z_][A-Za-z0-9_]*)/g;

/**
 * Converts SQL with `:named` placeholders + a named params object into a D1
 * prepared statement bound with positional `?` arguments in the right order.
 * `lib/map_data.js` (shared with the Node SQLite dev server) emits named
 * placeholders, so we adapt at the D1 boundary instead of duplicating the SQL.
 */
function prepareForD1(db, sql, params) {
  const ordered = [];
  const positionalSql = sql.replace(NAMED_PLACEHOLDER_RE, (_, name) => {
    if (!Object.prototype.hasOwnProperty.call(params, name)) {
      throw new Error(`missing param :${name} for supply-points query`);
    }
    ordered.push(params[name]);
    return '?';
  });
  return db.prepare(positionalSql).bind(...ordered);
}

function ensureTileLoader(env) {
  if (tileLoaderCache) return tileLoaderCache;
  if (!env.GRAPH) {
    const err = new Error('GRAPH R2 binding is not configured');
    err.code = 'no_graph_binding';
    throw err;
  }
  // R2 origin の往復 (~100ms) を edge cache (caches.default) でスキップする。
  // 同じタイルは isolate を跨いで使い回せるので route の cold start が大幅短縮。
  tileLoaderCache = new TileLoader(
    // PR #81 (Phase 1.5 maxTiles=16) も exceededMemory が再発。snap の
    // loadMany が corridor の上に追加 9 タイル乗せて 16 を超えてしまう
    // ことや、JS object 表現自体が密度高すぎる可能性。CSR refactor までは
    // CH を諦めて NBA* で安定動作する。cache v11。
    makeR2Fetcher(env.GRAPH, 'tiles/', caches.default, 'v11')
  );
  return tileLoaderCache;
}

const TILE_CACHE_TTL_S = 7 * 24 * 60 * 60; // 7d (旧タイル投入があれば手動でパージ)
const SUPPLY_POINTS_CACHE_TTL_S = 5 * 60;
const ROUTE_CACHE_TTL_S = 5 * 60;
const DNF_PACK_CACHE_TTL_S = 5 * 60;
// DNF 用パック: 経路 + 周辺 supply-point を 1 リクエストで返す。
// バッファ・許容ズレ・supply-point 上限は URL クエリで上書き可だが、
// 通常はデフォルト (DNF 想定のモバイル) で十分。
const DNF_DEFAULT_BUFFER_M = 500;
const DNF_DEFAULT_TOLERANCE_M = 5;
const DNF_DEFAULT_LIMIT = 200;
const DNF_MAX_BUFFER_M = 2000;
const DNF_MAX_TOLERANCE_M = 50;
const DNF_MAX_LIMIT = 1000;

/**
 * Caches an HTTP-cacheable response in `caches.default` and returns the
 * (cloned) response to serve. `caches.default.put` requires the body to be
 * consumable separately, hence the clone before put + before returning.
 */
async function withEdgeCache(request, ttlSeconds, build) {
  const cache = caches.default;
  // caches.default は最適化層。match/put の例外で API 応答そのものを失敗
  // させない (R2/D1 が健全なら必ず build() を返す)。
  try {
    const hit = await cache.match(request);
    if (hit) return hit;
  } catch (err) {
    console.warn('edge cache match failed', err);
  }
  const fresh = await build();
  // build() 側が cache-control: no-store を立てたレスポンス (部分失敗等で
  // キャッシュさせたくない 200) は edge cache に載せない。withEdgeCache は
  // ttl を上書きしていたが、no-store を尊重するよう変更。
  const requestedCacheControl = fresh.headers.get('cache-control') || '';
  const optOut = /no-store|no-cache|private/i.test(requestedCacheControl);
  if (fresh.ok && request.method === 'GET' && !optOut) {
    try {
      const cacheable = new Response(fresh.clone().body, fresh);
      cacheable.headers.set('cache-control', `public, max-age=${ttlSeconds}`);
      await cache.put(request, cacheable);
    } catch (err) {
      console.warn('edge cache put failed', err);
    }
  }
  return fresh;
}

function parseLonLat(value) {
  if (!value) return null;
  const parts = value.split(',');
  if (parts.length !== 2) return null;
  const lon = Number(parts[0]);
  const lat = Number(parts[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (lon < -180 || lon > 180) return null;
  if (lat < -90 || lat > 90) return null;
  return [lon, lat];
}

async function handleRoute(url, env) {
  const from = parseLonLat(url.searchParams.get('from'));
  const to = parseLonLat(url.searchParams.get('to'));
  if (!from || !to) {
    return Response.json(
      { error: 'from and to must be in "lon,lat" form' },
      { status: 400 }
    );
  }

  let loader;
  try {
    loader = ensureTileLoader(env);
  } catch (err) {
    if (err && err.code === 'no_graph_binding') {
      return Response.json({ error: err.message }, { status: 503 });
    }
    throw err;
  }
  const router = new TiledRouter(loader);
  const r = await router.route(from[0], from[1], to[0], to[1]);
  if (r.error) {
    const status =
      r.error === 'unreachable_in_corridor' ? 404 :
      r.error === 'too_far' ? 422 :
      r.error === 'corridor_too_large' ? 422 :
      r.error === 'no_nearby_node_from' || r.error === 'no_nearby_node_to' ? 422 :
      500;
    return Response.json(r, { status });
  }

  return Response.json(
    {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: r.coordinates },
      properties: {
        distance_cost: r.distance_cost,
        node_count: r.node_count,
        settled: r.settled,
        snap_from_m: r.snap_from_m,
        snap_to_m: r.snap_to_m,
        algorithm: r.algorithm
      }
    },
    {
      headers: {
        'content-type': 'application/geo+json; charset=utf-8',
        'cache-control': 'public, max-age=300'
      }
    }
  );
}

/**
 * DNF (Did Not Finish) 用パック: 経路 + 周辺 supply-point を 1 リクエスト
 * で返す。スマホ・モバイル回線で別 API を 2 つ叩く代わりに 1 回で済ませる
 * ことで TLS handshake / TCP / DNS の重複を削減、バッテリ/通信時間を節約。
 *
 * リクエスト: ?from=lon,lat&to=lon,lat[&buffer_m=500][&tolerance_m=5]
 *            [&limit=200][&chains=lawson,seven_eleven]
 *
 * 処理:
 *  1) /api/route 同等のルート計算 (TiledRouter)
 *  2) ルート geometry を Douglas-Peucker で間引き (tolerance_m, 既定 5m)
 *  3) 間引き後ルートの bbox + buffer_m (既定 500m) で supply-points を D1 から取得
 *  4) 統合 JSON を返す
 *
 * 失敗時はルート単独のエラー (404 unreachable など) を踏襲。
 */
// 空白だけの入力 (" ") は Number() が 0 に変換するため、空入力扱いに
// 倒さないと tolerance_m=" " が simplify off に化ける。trim → 空判定で防ぐ。
function parsePositiveNumber(raw, fallback, max) {
  if (raw == null) return fallback;
  const normalized = String(raw).trim();
  if (normalized === '') return fallback;
  const v = Number(normalized);
  if (!Number.isFinite(v) || v <= 0) return fallback;
  return Math.min(v, max);
}

// tolerance_m=0 は「simplify を無効化する」契約 (douglasPeucker 仕様)。
// parsePositiveNumber は 0 を fallback に化けさせるため、専用の
// non-negative パーサで 0 を許可する。負値・NaN は fallback に倒す。
// trim 処理も同様 (空白入力で 0 化けを防ぐ)。
function parseNonNegativeNumber(raw, fallback, max) {
  if (raw == null) return fallback;
  const normalized = String(raw).trim();
  if (normalized === '') return fallback;
  const v = Number(normalized);
  if (!Number.isFinite(v) || v < 0) return fallback;
  return Math.min(v, max);
}

async function handleDnfPack(url, env) {
  const from = parseLonLat(url.searchParams.get('from'));
  const to = parseLonLat(url.searchParams.get('to'));
  if (!from || !to) {
    return Response.json(
      { error: 'from and to must be in "lon,lat" form' },
      { status: 400 }
    );
  }
  const bufferM = parsePositiveNumber(url.searchParams.get('buffer_m'), DNF_DEFAULT_BUFFER_M, DNF_MAX_BUFFER_M);
  // tolerance_m=0 は simplify off の契約として明示的に受け入れる。
  const toleranceM = parseNonNegativeNumber(url.searchParams.get('tolerance_m'), DNF_DEFAULT_TOLERANCE_M, DNF_MAX_TOLERANCE_M);
  const limit = parsePositiveNumber(url.searchParams.get('limit'), DNF_DEFAULT_LIMIT, DNF_MAX_LIMIT);

  let loader;
  try {
    loader = ensureTileLoader(env);
  } catch (err) {
    if (err && err.code === 'no_graph_binding') {
      return Response.json({ error: err.message }, { status: 503 });
    }
    throw err;
  }
  const router = new TiledRouter(loader);
  const r = await router.route(from[0], from[1], to[0], to[1]);
  if (r.error) {
    const status =
      r.error === 'unreachable_in_corridor' ? 404 :
      r.error === 'too_far' ? 422 :
      r.error === 'corridor_too_large' ? 422 :
      r.error === 'no_nearby_node_from' || r.error === 'no_nearby_node_to' ? 422 :
      500;
    return Response.json(r, { status });
  }

  // ルート間引き → bbox 算出 → supply-points 取得
  const simplified = douglasPeucker(r.coordinates, toleranceM);
  const bbox = routeBBoxWithBuffer(simplified, bufferM);
  // D1 がない場合 (dev 等) は supply-points を空配列にして route 単独を返す
  let supplyFeatures = [];
  let supplyError = null;
  if (env.DB && bbox) {
    try {
      const params = new URLSearchParams();
      params.set('bbox', `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`);
      params.set('limit', String(Math.floor(limit)));
      const chains = url.searchParams.get('chains');
      if (chains) params.set('chains', chains);
      const filters = parseSupplyPointFilters(params);
      const { sql, params: sqlParams } = buildSupplyPointsQuery(filters);
      const stmt = prepareForD1(env.DB, sql, sqlParams);
      const { results } = await stmt.all();
      const fc = toFeatureCollection(results || []);
      supplyFeatures = fc.features;
    } catch (err) {
      if (err instanceof ValidationError) {
        supplyError = err.message;
      } else {
        console.error('dnf-pack supply-points error', err);
        supplyError = 'supply_points_internal';
      }
    }
  }

  return Response.json(
    {
      route: {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: simplified },
        properties: {
          distance_cost: r.distance_cost,
          node_count: r.node_count,
          settled: r.settled,
          snap_from_m: r.snap_from_m,
          snap_to_m: r.snap_to_m,
          algorithm: r.algorithm,
          simplified_from: r.coordinates.length,
          simplified_to: simplified.length,
          tolerance_m: toleranceM
        }
      },
      supply_points: {
        type: 'FeatureCollection',
        features: supplyFeatures
      },
      meta: {
        bbox: bbox ? [bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat] : null,
        buffer_m: bufferM,
        limit,
        supply_points_count: supplyFeatures.length,
        supply_points_error: supplyError
      }
    },
    {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        // supply-points 取得が失敗した部分応答 (D1 障害など) は edge cache
        // に固定すると短期障害でも「空の supply_points で route だけ返す
        // 200」が 5 分間配信され続けるので、no-store で原則 origin に戻す。
        // 正常応答は通常通り 5 分キャッシュ。
        'cache-control': supplyError
          ? 'no-store'
          : `public, max-age=${DNF_PACK_CACHE_TTL_S}`
      }
    }
  );
}

/** Returns the GeoJSON FeatureCollection for the requested supply-points filter. */
async function handleSupplyPoints(url, env) {
  const filters = parseSupplyPointFilters(url.searchParams);
  const { sql, params } = buildSupplyPointsQuery(filters);
  const stmt = prepareForD1(env.DB, sql, params);
  const { results } = await stmt.all();
  return Response.json(toFeatureCollection(results || []), {
    headers: {
      'content-type': 'application/geo+json; charset=utf-8',
      'cache-control': 'public, max-age=60'
    }
  });
}

/**
 * Builds an error response. ValidationError surfaces its message at 400; any
 * other thrown value is logged for the operator and returned as a generic 500
 * so SQL/internal details do not leak through the public API.
 */
function errorResponse(error) {
  if (error instanceof ValidationError) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  console.error('supply-points handler error', error);
  return Response.json({ error: 'internal server error' }, { status: 500 });
}

/** Strips the response body to satisfy HEAD semantics while keeping status + headers. */
function asHeadResponse(response) {
  return new Response(null, { status: response.status, headers: response.headers });
}

export default {
  /**
   * Cloudflare Workers fetch entry point. Routes /api/supply-points through D1
   * and lets every other path fall through to the static asset binding.
   */
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === API_PATH || url.pathname === ROUTE_PATH || url.pathname === DNF_PACK_PATH) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('method not allowed', { status: 405 });
      }
      let response;
      try {
        if (url.pathname === ROUTE_PATH) {
          response = await withEdgeCache(request, ROUTE_CACHE_TTL_S, () =>
            handleRoute(url, env)
          );
        } else if (url.pathname === DNF_PACK_PATH) {
          response = await withEdgeCache(request, DNF_PACK_CACHE_TTL_S, () =>
            handleDnfPack(url, env)
          );
        } else {
          response = await withEdgeCache(request, SUPPLY_POINTS_CACHE_TTL_S, () =>
            handleSupplyPoints(url, env)
          );
        }
      } catch (error) {
        response = errorResponse(error);
      }
      return request.method === 'HEAD' ? asHeadResponse(response) : response;
    }
    return env.ASSETS.fetch(request);
  }
};

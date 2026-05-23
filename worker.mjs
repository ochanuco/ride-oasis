// `lib/map_data.js` is CommonJS (shared with the Node dev server). Importing
// the default export gives us the entire `module.exports` object, then we
// destructure the helpers we need. Going through the default import is the
// most portable way to consume CJS from ESM under Workers' bundler.
import mapData from './lib/map_data.js';
import tiledRouterModule from './lib/cycling/tiled_router.js';
import tileLoaderModule from './lib/cycling/tile_loader.js';

const {
  parseSupplyPointFilters,
  buildSupplyPointsQuery,
  toFeatureCollection,
  ValidationError
} = mapData;

const { TiledRouter } = tiledRouterModule;
const { TileLoader, makeR2Fetcher } = tileLoaderModule;

const API_PATH = '/api/supply-points';
const ROUTE_PATH = '/api/route';

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
  tileLoaderCache = new TileLoader(makeR2Fetcher(env.GRAPH, 'tiles/'));
  return tileLoaderCache;
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
        snap_to_m: r.snap_to_m
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
    if (url.pathname === API_PATH || url.pathname === ROUTE_PATH) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('method not allowed', { status: 405 });
      }
      const handler = url.pathname === ROUTE_PATH ? handleRoute : handleSupplyPoints;
      let response;
      try {
        response = await handler(url, env);
      } catch (error) {
        response = errorResponse(error);
      }
      return request.method === 'HEAD' ? asHeadResponse(response) : response;
    }
    return env.ASSETS.fetch(request);
  }
};

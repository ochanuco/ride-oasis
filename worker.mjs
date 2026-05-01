// `lib/map_data.js` is CommonJS (shared with the Node dev server). Importing
// the default export gives us the entire `module.exports` object, then we
// destructure the helpers we need. Going through the default import is the
// most portable way to consume CJS from ESM under Workers' bundler.
import mapData from './lib/map_data.js';

const {
  parseSupplyPointFilters,
  buildSupplyPointsQuery,
  toFeatureCollection,
  ValidationError
} = mapData;

const API_PATH = '/api/supply-points';
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
    if (url.pathname === API_PATH) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('method not allowed', { status: 405 });
      }
      let response;
      try {
        response = await handleSupplyPoints(url, env);
      } catch (error) {
        response = errorResponse(error);
      }
      return request.method === 'HEAD' ? asHeadResponse(response) : response;
    }
    return env.ASSETS.fetch(request);
  }
};

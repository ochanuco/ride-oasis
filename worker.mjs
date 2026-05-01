import {
  parseSupplyPointFilters,
  buildSupplyPointsQuery,
  toFeatureCollection,
  ValidationError
} from './lib/map_data.js';

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

/** Builds an error response with the right status for ValidationError vs unknown failures. */
function errorResponse(error) {
  const status = error instanceof ValidationError ? 400 : 500;
  return Response.json({ error: error?.message || String(error) }, { status });
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
      try {
        const response = await handleSupplyPoints(url, env);
        if (request.method === 'HEAD') {
          return new Response(null, { status: response.status, headers: response.headers });
        }
        return response;
      } catch (error) {
        return errorResponse(error);
      }
    }
    return env.ASSETS.fetch(request);
  }
};

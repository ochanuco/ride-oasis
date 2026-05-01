(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.RwgImport = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ROUTE_URL_RE = /ridewithgps\.com\/routes\/(\d+)/i;

  /** Returns the numeric RWG route id from a URL or bare numeric string, or null. */
  function parseRouteId(input) {
    if (typeof input !== 'string') return null;
    const trimmed = input.trim();
    if (/^\d+$/.test(trimmed)) return Number(trimmed);
    const match = trimmed.match(ROUTE_URL_RE);
    return match ? Number(match[1]) : null;
  }

  /** Returns true when lat/lon are finite and inside WGS84 valid ranges. */
  function isValidLatLon(lat, lon) {
    return Number.isFinite(lat)
      && Number.isFinite(lon)
      && lat >= -90 && lat <= 90
      && lon >= -180 && lon <= 180;
  }

  /**
   * Normalizes a RideWithGPS routes/<id>.json response into the shape the rest
   * of ride-oasis consumes.
   *
   * - records: 1 entry per `track_points` element (`x` lon, `y` lat, `d` dist m)
   * - coursePoints: union of `course_points` (turn instructions) and
   *   `points_of_interest` (PCs / cautions / finish / generic), each with
   *   `{ lat, lon, distanceMeters, name, type, description }`. RWG's POIs are
   *   the only place the long brevet PC text lives, so the description field
   *   is preserved here for the popup and cue-sheet.
   * - name: the route's own display name (used as a substitute filename).
   */
  function normalizeRwgData(data) {
    const records = (Array.isArray(data?.track_points) ? data.track_points : [])
      .filter((p) => isValidLatLon(p?.y, p?.x))
      .map((p) => ({
        lat: p.y,
        lon: p.x,
        distanceMeters: Number.isFinite(p.d) ? p.d : null
      }));

    const cuePoints = (Array.isArray(data?.course_points) ? data.course_points : [])
      .filter((p) => isValidLatLon(p?.y, p?.x))
      .map((p) => ({
        lat: p.y,
        lon: p.x,
        distanceMeters: Number.isFinite(p.d) ? p.d : null,
        name: typeof p.n === 'string' ? p.n : '',
        type: typeof p.t === 'string' && p.t ? p.t.toLowerCase() : 'generic',
        description: ''
      }));

    const poiPoints = (Array.isArray(data?.points_of_interest) ? data.points_of_interest : [])
      .filter((p) => isValidLatLon(p?.lat, p?.lng))
      .map((p) => ({
        lat: p.lat,
        lon: p.lng,
        distanceMeters: null,
        name: typeof p.name === 'string' ? p.name : '',
        type: typeof p.poi_type_name === 'string' && p.poi_type_name ? p.poi_type_name : 'generic',
        description: typeof p.description === 'string' ? p.description : ''
      }));

    return {
      records,
      coursePoints: [...cuePoints, ...poiPoints],
      name: typeof data?.name === 'string' ? data.name : ''
    };
  }

  /** Builds a public RideWithGPS JSON URL for the given numeric route id. */
  function buildRouteUrl(id) {
    return `https://ridewithgps.com/routes/${id}.json`;
  }

  /**
   * Fetches a public RWG route by numeric id and returns the normalized shape.
   * The route must be public (anonymous access); routes shared only with a
   * link will fail at the server side.
   */
  async function fetchRoute(id, opts = {}) {
    if (!Number.isFinite(id)) {
      throw new Error('RWG ルート ID が不正です');
    }
    const fetchFn = opts.fetchFn || fetch;
    const response = await fetchFn(buildRouteUrl(id), {
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) {
      throw new Error(`RWG fetch failed (HTTP ${response.status})`);
    }
    const data = await response.json();
    return normalizeRwgData(data);
  }

  return {
    parseRouteId,
    normalizeRwgData,
    fetchRoute,
    buildRouteUrl
  };
});

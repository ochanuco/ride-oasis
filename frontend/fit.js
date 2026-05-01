(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.FitParser = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Pinned CDN URL for the fit-file-parser ESM bundle. Loaded on demand so
  // ride-oasis pages without a route file (or all-GPX users) do not pay for
  // the extra network fetch on initial render.
  const FIT_PARSER_CDN = 'https://cdn.jsdelivr.net/npm/fit-file-parser@1.21.0/+esm';

  let cachedParserClass = null;

  /**
   * Dynamically imports fit-file-parser via the pinned CDN URL.
   *
   * jsdelivr's `+esm` bundle returns a nested CJS-default shape
   * (`mod.default.default` is the class), while a real ESM build can return
   * the class directly. Walk through up to three levels of `default` until
   * we find the constructor function.
   */
  async function loadFitParserClass(importFn) {
    if (cachedParserClass) return cachedParserClass;
    const dynamicImport = importFn || ((url) => import(/* @vite-ignore */ url));
    const mod = await dynamicImport(FIT_PARSER_CDN);
    let candidate = mod;
    for (let i = 0; i < 3; i += 1) {
      if (typeof candidate === 'function') break;
      if (candidate && typeof candidate === 'object' && 'default' in candidate) {
        candidate = candidate.default;
      } else if (candidate && typeof candidate === 'object' && 'FitParser' in candidate) {
        candidate = candidate.FitParser;
        break;
      } else {
        break;
      }
    }
    if (typeof candidate !== 'function') {
      throw new Error('FIT parser ライブラリの読み込みに失敗しました');
    }
    cachedParserClass = candidate;
    return cachedParserClass;
  }

  /** Returns true when lat/lon are finite and inside WGS84 valid ranges. */
  function isValidLatLon(lat, lon) {
    return Number.isFinite(lat)
      && Number.isFinite(lon)
      && lat >= -90 && lat <= 90
      && lon >= -180 && lon <= 180;
  }

  /**
   * Normalizes the fit-file-parser output into the route + course-points shape
   * the rest of ride-oasis consumes:
   *   { records: [{ lat, lon, distanceMeters? }], coursePoints: [{ lat, lon, distanceMeters?, name, type }] }
   * Records / course points outside the valid lat/lon range are dropped.
   */
  function normalizeFitData(data) {
    const records = (Array.isArray(data?.records) ? data.records : [])
      .filter((r) => isValidLatLon(r?.position_lat, r?.position_long))
      .map((r) => ({
        lat: r.position_lat,
        lon: r.position_long,
        distanceMeters: Number.isFinite(r.distance) ? r.distance : null
      }));

    const coursePoints = (Array.isArray(data?.course_points) ? data.course_points : [])
      .filter((cp) => isValidLatLon(cp?.position_lat, cp?.position_long))
      .map((cp) => ({
        lat: cp.position_lat,
        lon: cp.position_long,
        distanceMeters: Number.isFinite(cp.distance) ? cp.distance : null,
        name: typeof cp.name === 'string' ? cp.name : '',
        type: typeof cp.type === 'string' ? cp.type : 'generic'
      }));

    return { records, coursePoints };
  }

  /**
   * Parses a FIT byte buffer (e.g. from `File.arrayBuffer()`) and returns the
   * normalized records + course points. Lazy-loads fit-file-parser the first
   * time it is called.
   */
  async function parseFitArrayBuffer(arrayBuffer, opts = {}) {
    const ParserClass = await loadFitParserClass(opts.importFn);
    const parser = new ParserClass({
      force: true,
      lengthUnit: 'm',
      mode: 'list',
      ...(opts.parserOptions || {})
    });
    const buffer = arrayBuffer instanceof ArrayBuffer
      ? new Uint8Array(arrayBuffer)
      : arrayBuffer;
    return new Promise((resolve, reject) => {
      parser.parse(buffer, (error, data) => {
        if (error) {
          if (error instanceof Error) {
            reject(error);
          } else {
            reject(new Error(typeof error === 'string' && error ? error : String(error || 'FIT parse failed')));
          }
          return;
        }
        resolve(normalizeFitData(data));
      });
    });
  }

  return {
    parseFitArrayBuffer,
    normalizeFitData,
    /** Exposed for tests: clears the cached fit-file-parser class. */
    _resetCacheForTests: () => { cachedParserClass = null; }
  };
});

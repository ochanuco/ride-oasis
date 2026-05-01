(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.UrlState = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Keys we know how to round-trip in the URL. Everything else is left as-is so
  // we don't clobber unrelated query strings (e.g., ?utm_source=...).
  const KEYS = ['rwg', 'chains', 'precision', 'cp', 'cptypes'];
  const VALID_PRECISION = new Set(['precise', 'rough']);

  /** Splits a comma-separated string into a deduplicated, trimmed array. */
  function splitList(value) {
    if (typeof value !== 'string' || value === '') return [];
    const out = [];
    const seen = new Set();
    for (const raw of value.split(',')) {
      const item = raw.trim();
      if (!item || seen.has(item)) continue;
      seen.add(item);
      out.push(item);
    }
    return out;
  }

  /**
   * Parses a URL search string (or URLSearchParams) into our app state shape.
   * Unknown keys are kept in `extra` so they can be re-emitted untouched.
   * `rwg` is `null` when absent or not a positive integer.
   * The list-typed fields (`chains`, `precision`, `cptypes`) are `null` when
   * the param is absent (= default = all enabled), or an array (possibly empty)
   * when the param is present.
   */
  function parseUrlState(input) {
    const params = input instanceof URLSearchParams
      ? input
      : new URLSearchParams(typeof input === 'string' ? input.replace(/^\?/, '') : '');

    const rwgRaw = params.get('rwg');
    let rwg = null;
    if (rwgRaw != null) {
      const parsed = Number.parseInt(rwgRaw, 10);
      if (Number.isFinite(parsed) && parsed > 0) rwg = parsed;
    }

    const chains = params.has('chains') ? splitList(params.get('chains')) : null;
    const precision = params.has('precision')
      ? splitList(params.get('precision')).filter((p) => VALID_PRECISION.has(p))
      : null;
    const cp = params.has('cp') ? params.get('cp') !== '0' : null;
    const cptypes = params.has('cptypes') ? splitList(params.get('cptypes')) : null;

    const extra = new URLSearchParams();
    for (const [key, value] of params.entries()) {
      if (!KEYS.includes(key)) extra.append(key, value);
    }

    return { rwg, chains, precision, cp, cptypes, extra };
  }

  /**
   * Builds a URL search string from a state object. Defaults (e.g.,
   * chains == null) are omitted so the URL stays clean for first-time visits.
   * `extra` is preserved at the end of the string in stable order.
   */
  function formatUrlState(state) {
    const params = new URLSearchParams();
    if (state) {
      if (Number.isFinite(state.rwg) && state.rwg > 0) {
        params.set('rwg', String(state.rwg));
      }
      if (Array.isArray(state.chains)) {
        params.set('chains', state.chains.join(','));
      }
      if (Array.isArray(state.precision)) {
        params.set('precision', state.precision.join(','));
      }
      if (state.cp === false) {
        // The default (cp = on) is omitted; only the off case is encoded.
        params.set('cp', '0');
      } else if (state.cp === true) {
        // `cp=1` is redundant with the default but lets URLs round-trip.
        // Treat it as a no-op for compactness.
      }
      if (Array.isArray(state.cptypes)) {
        params.set('cptypes', state.cptypes.join(','));
      }
    }
    if (state && state.extra instanceof URLSearchParams) {
      for (const [key, value] of state.extra.entries()) {
        params.append(key, value);
      }
    }
    const search = params.toString();
    return search ? `?${search}` : '';
  }

  return {
    KEYS,
    parseUrlState,
    formatUrlState
  };
});

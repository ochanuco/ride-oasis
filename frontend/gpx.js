(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.GpxParser = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // Captures the open tag and the inner text up to the corresponding close tag so we
  // can recover `<ele>` values nested inside `<trkpt>`/`<rtept>`. The `[\s\S]` form
  // tolerates newlines that real-world GPX exporters insert between child elements.
  const POINT_BLOCK_RE = /<(trkpt|rtept)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  const POINT_SELFCLOSE_RE = /<(trkpt|rtept)\b([^>]*)\/>/gi;
  const ATTR_RE = /\b(lat|lon)\s*=\s*(['"])(.*?)\2/gi;
  const ELE_RE = /<ele\b[^>]*>\s*([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*<\/ele>/i;

  /** Parses lat/lon attributes from a tag attribute string. */
  function parseLatLonAttrs(attrString) {
    const attrs = {};
    let attrMatch;
    const re = new RegExp(ATTR_RE.source, 'gi');
    while ((attrMatch = re.exec(attrString)) !== null) {
      attrs[attrMatch[1]] = attrMatch[3];
    }
    const lat = Number(attrs.lat);
    const lng = Number(attrs.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  }

  /** Extracts elevation in meters from a `<trkpt>`/`<rtept>` inner XML, or null. */
  function parseEleFromInner(innerXml) {
    if (!innerXml) return null;
    const m = ELE_RE.exec(innerXml);
    if (!m) return null;
    const value = Number(m[1]);
    return Number.isFinite(value) ? value : null;
  }

  /**
   * Walks the GPX text once and yields `{ lng, lat, ele }` for every well-formed
   * track/route point, in document order. Used by the higher-level parsers below.
   */
  function parsePointsWithElevation(gpxText) {
    const text = String(gpxText || '');
    const matches = [];
    let m;
    const blockRe = new RegExp(POINT_BLOCK_RE.source, 'gi');
    while ((m = blockRe.exec(text)) !== null) {
      const latLon = parseLatLonAttrs(m[2]);
      if (!latLon) continue;
      matches.push({
        index: m.index,
        lng: latLon.lng,
        lat: latLon.lat,
        ele: parseEleFromInner(m[3])
      });
    }
    const selfRe = new RegExp(POINT_SELFCLOSE_RE.source, 'gi');
    while ((m = selfRe.exec(text)) !== null) {
      const latLon = parseLatLonAttrs(m[2]);
      if (!latLon) continue;
      matches.push({ index: m.index, lng: latLon.lng, lat: latLon.lat, ele: null });
    }
    matches.sort((a, b) => a.index - b.index);
    return matches.map(({ lng, lat, ele }) => ({ lng, lat, ele }));
  }

  /** Extracts ordered [lng, lat] coordinates from GPX track or route point tags. */
  function parseCoordinateTokens(gpxText) {
    return parsePointsWithElevation(gpxText).map((p) => [p.lng, p.lat]);
  }

  /** Parses GPX text into a GeoJSON LineString feature for the route viewer. */
  function parseGpxText(gpxText) {
    const points = parsePointsWithElevation(gpxText);
    if (points.length < 2) {
      throw new Error('GPX から2点以上の経路座標を抽出できませんでした');
    }
    const coordinates = points.map((p) => [p.lng, p.lat]);
    const elevations = points.map((p) => p.ele);
    const hasElevation = elevations.some((e) => e !== null);
    return {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates
      },
      properties: {
        point_count: coordinates.length,
        elevations: hasElevation ? elevations : null
      }
    };
  }

  /** Escapes a string value for safe insertion into XML text and attribute content. */
  function escapeXml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&apos;');
  }

  /**
   * Builds a GPX 1.1 document containing an optional `<trk>` for the route and
   * `<wpt>` entries for each waypoint. The caller supplies preformatted waypoint
   * fields so this module has no dependency on the route-math projection.
   *
   * route: [[lon, lat], ...] (optional, omitted when length < 2)
   * waypoints: [{ lat, lon, name, desc, type }]
   */
  function buildGpxText({ name, creator, generatedAt, route, waypoints } = {}) {
    const safeName = escapeXml(name || 'RideOasis Supply Points');
    const safeCreator = escapeXml(creator || 'RideOasis');
    const time = escapeXml(generatedAt || new Date().toISOString());

    const wptList = Array.isArray(waypoints) ? waypoints : [];
    const wptXml = wptList
      .filter((w) => Number.isFinite(w?.lat) && Number.isFinite(w?.lon))
      .map((w) => [
        `  <wpt lat="${w.lat}" lon="${w.lon}">`,
        `    <name>${escapeXml(w.name || '')}</name>`,
        w.desc ? `    <desc>${escapeXml(w.desc)}</desc>` : null,
        w.type ? `    <type>${escapeXml(w.type)}</type>` : null,
        `  </wpt>`
      ].filter(Boolean).join('\n'))
      .join('\n');

    let trkXml = '';
    if (Array.isArray(route)) {
      const validRoute = route.filter(
        (c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1])
      );
      if (validRoute.length >= 2) {
        const trkpts = validRoute
          .map(([lon, lat]) => `      <trkpt lat="${lat}" lon="${lon}"></trkpt>`)
          .join('\n');
        trkXml = [
          `  <trk>`,
          `    <name>${safeName}</name>`,
          `    <trkseg>`,
          trkpts,
          `    </trkseg>`,
          `  </trk>`
        ].join('\n');
      }
    }

    const sections = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<gpx version="1.1" creator="${safeCreator}" xmlns="http://www.topografix.com/GPX/1/1">`,
      `  <metadata>`,
      `    <name>${safeName}</name>`,
      `    <time>${time}</time>`,
      `  </metadata>`,
      wptXml,
      trkXml,
      `</gpx>`
    ].filter(Boolean);

    return sections.join('\n') + '\n';
  }

  return {
    parseCoordinateTokens,
    parseGpxText,
    buildGpxText
  };
});

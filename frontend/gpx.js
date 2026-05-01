(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.GpxParser = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const POINT_TAG_RE = /<(trkpt|rtept)\b([^>]*)>/gi;
  const ATTR_RE = /\b(lat|lon)\s*=\s*(['"])(.*?)\2/gi;

  /** Extracts ordered [lng, lat] coordinates from GPX track or route point tags. */
  function parseCoordinateTokens(gpxText) {
    const coords = [];
    let tagMatch;
    while ((tagMatch = POINT_TAG_RE.exec(String(gpxText || ''))) !== null) {
      const attrs = {};
      let attrMatch;
      while ((attrMatch = ATTR_RE.exec(tagMatch[2])) !== null) {
        attrs[attrMatch[1]] = attrMatch[3];
      }
      const lat = Number(attrs.lat);
      const lng = Number(attrs.lon);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        coords.push([lng, lat]);
      }
    }
    return coords;
  }

  /** Parses GPX text into a GeoJSON LineString feature for the route viewer. */
  function parseGpxText(gpxText) {
    const coordinates = parseCoordinateTokens(String(gpxText || ''));
    if (coordinates.length < 2) {
      throw new Error('GPX から2点以上の経路座標を抽出できませんでした');
    }
    return {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates
      },
      properties: {
        point_count: coordinates.length
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

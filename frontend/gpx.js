(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.GpxParser = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const POINT_RE = /<(trkpt|rtept)\b[^>]*?\blat="([^"]+)"[^>]*?\blon="([^"]+)"[^>]*?>/g;

  function parseCoordinateTokens(gpxText) {
    const coords = [];
    let match;
    while ((match = POINT_RE.exec(gpxText)) !== null) {
      const lat = Number(match[2]);
      const lng = Number(match[3]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        coords.push([lng, lat]);
      }
    }
    return coords;
  }

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

  return {
    parseCoordinateTokens,
    parseGpxText
  };
});

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.GpxParser = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const POINT_TAG_RE = /<(trkpt|rtept)\b([^>]*)>/gi;
  const ATTR_RE = /\b(lat|lon)\s*=\s*(['"])(.*?)\2/gi;

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

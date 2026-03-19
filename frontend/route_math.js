(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.RouteMath = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function toRadians(value) {
    return (value * Math.PI) / 180;
  }

  function meanLatitude(coords) {
    if (!coords.length) return 0;
    return coords.reduce((sum, coord) => sum + coord[1], 0) / coords.length;
  }

  function projectLonLatToMeters(coord, referenceLat) {
    const lng = coord[0];
    const lat = coord[1];
    const earthRadius = 6371008.8;
    const x = earthRadius * toRadians(lng) * Math.cos(toRadians(referenceLat));
    const y = earthRadius * toRadians(lat);
    return [x, y];
  }

  function distancePointToSegmentMeters(point, start, end, referenceLat) {
    const p = projectLonLatToMeters(point, referenceLat);
    const a = projectLonLatToMeters(start, referenceLat);
    const b = projectLonLatToMeters(end, referenceLat);
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const apx = p[0] - a[0];
    const apy = p[1] - a[1];
    const ab2 = abx * abx + aby * aby;
    if (ab2 === 0) {
      const dx = p[0] - a[0];
      const dy = p[1] - a[1];
      return Math.hypot(dx, dy);
    }
    const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2));
    const closestX = a[0] + abx * t;
    const closestY = a[1] + aby * t;
    return Math.hypot(p[0] - closestX, p[1] - closestY);
  }

  function pointToRouteDistanceMeters(point, coordinates) {
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
      return Number.POSITIVE_INFINITY;
    }
    const referenceLat = meanLatitude(coordinates);
    let minDistance = Number.POSITIVE_INFINITY;
    for (let i = 1; i < coordinates.length; i += 1) {
      const distance = distancePointToSegmentMeters(
        point,
        coordinates[i - 1],
        coordinates[i],
        referenceLat
      );
      if (distance < minDistance) {
        minDistance = distance;
      }
    }
    return minDistance;
  }

  function metersToDegreePadding(latitude, meters) {
    const latPadding = meters / 111320;
    const cosLat = Math.cos(toRadians(latitude));
    const lngPadding = meters / (111320 * Math.max(cosLat, 0.01));
    return { latPadding, lngPadding };
  }

  function computeBbox(coordinates) {
    if (!coordinates.length) return null;
    let minLng = coordinates[0][0];
    let minLat = coordinates[0][1];
    let maxLng = coordinates[0][0];
    let maxLat = coordinates[0][1];

    for (const coord of coordinates) {
      minLng = Math.min(minLng, coord[0]);
      minLat = Math.min(minLat, coord[1]);
      maxLng = Math.max(maxLng, coord[0]);
      maxLat = Math.max(maxLat, coord[1]);
    }

    return [minLng, minLat, maxLng, maxLat];
  }

  function expandBbox(bbox, meters) {
    if (!bbox) return null;
    const [, minLat, , maxLat] = bbox;
    const centerLat = (minLat + maxLat) / 2;
    const padding = metersToDegreePadding(centerLat, meters);
    return [
      bbox[0] - padding.lngPadding,
      bbox[1] - padding.latPadding,
      bbox[2] + padding.lngPadding,
      bbox[3] + padding.latPadding
    ];
  }

  return {
    computeBbox,
    expandBbox,
    pointToRouteDistanceMeters
  };
});

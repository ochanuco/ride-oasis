(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.RouteMath = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  /** Converts decimal degrees to radians. */
  function toRadians(value) {
    return (value * Math.PI) / 180;
  }

  /** Computes the mean latitude used for a lightweight local projection. */
  function meanLatitude(coords) {
    if (!coords.length) return 0;
    return coords.reduce((sum, coord) => sum + coord[1], 0) / coords.length;
  }

  /** Projects lon/lat coordinates to approximate planar meters near the route. */
  function projectLonLatToMeters(coord, referenceLat) {
    const lng = coord[0];
    const lat = coord[1];
    const earthRadius = 6371008.8;
    const x = earthRadius * toRadians(lng) * Math.cos(toRadians(referenceLat));
    const y = earthRadius * toRadians(lat);
    return [x, y];
  }

  /** Computes the minimum distance from a point to a single route segment. */
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

  /** Computes the minimum point-to-route distance in meters. */
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

  /** Computes the direct distance between two lon/lat points in meters. */
  function pointToPointDistanceMeters(pointA, pointB) {
    const isValidPoint = (point) =>
      Array.isArray(point) &&
      point.length >= 2 &&
      Number.isFinite(point[0]) &&
      Number.isFinite(point[1]);
    if (!isValidPoint(pointA) || !isValidPoint(pointB)) {
      return Number.POSITIVE_INFINITY;
    }
    const referenceLat = (pointA[1] + pointB[1]) / 2;
    const a = projectLonLatToMeters(pointA, referenceLat);
    const b = projectLonLatToMeters(pointB, referenceLat);
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
  }

  /** Converts a meter padding value to degree deltas around a latitude. */
  function metersToDegreePadding(latitude, meters) {
    const latPadding = meters / 111320;
    const cosLat = Math.cos(toRadians(latitude));
    const lngPadding = meters / (111320 * Math.max(cosLat, 0.01));
    return { latPadding, lngPadding };
  }

  /** Computes a [minLng, minLat, maxLng, maxLat] bbox from route coordinates. */
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

  /** Expands a bbox by a meter padding converted around the route center latitude. */
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

  /** Computes the initial bearing in degrees [0, 360) from one lon/lat point to another. */
  function bearingDegrees(from, to) {
    if (
      !Array.isArray(from) || from.length < 2 || !Number.isFinite(from[0]) || !Number.isFinite(from[1]) ||
      !Array.isArray(to) || to.length < 2 || !Number.isFinite(to[0]) || !Number.isFinite(to[1])
    ) {
      return null;
    }
    const φ1 = toRadians(from[1]);
    const φ2 = toRadians(to[1]);
    const Δλ = toRadians(to[0] - from[0]);
    const x = Math.sin(Δλ) * Math.cos(φ2);
    const y = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    const θ = Math.atan2(x, y);
    return ((θ * 180) / Math.PI + 360) % 360;
  }

  /** Returns true if `target` bearing is within ±halfConeDeg of `heading` bearing. */
  function isWithinHeadingDeg(heading, target, halfConeDeg) {
    if (!Number.isFinite(heading) || !Number.isFinite(target) || !Number.isFinite(halfConeDeg)) {
      return false;
    }
    const diff = (((target - heading) + 540) % 360) - 180;
    return Math.abs(diff) <= halfConeDeg;
  }

  return {
    computeBbox,
    expandBbox,
    pointToPointDistanceMeters,
    pointToRouteDistanceMeters,
    bearingDegrees,
    isWithinHeadingDeg
  };
});

'use strict';

const BLOCKED_HIGHWAY = new Set([
  'motorway',
  'motorway_link',
  'trunk',
  'trunk_link',
  'construction',
  'proposed',
  'raceway',
  'bus_guideway'
]);

const BICYCLE_ALLOW = new Set(['yes', 'designated', 'permissive', 'official']);
const BICYCLE_DENY = new Set(['no', 'private', 'use_sidepath', 'dismount']);
const ACCESS_DENY = new Set(['no', 'private', 'customers']);

const FOOT_ONLY_HIGHWAY = new Set(['footway', 'pedestrian', 'steps', 'corridor']);

const PATHISH_HIGHWAY = new Set(['path', 'track', 'bridleway']);

const DEFAULT_ALLOWED_HIGHWAY = new Set([
  'cycleway',
  'residential',
  'living_street',
  'unclassified',
  'service',
  'tertiary',
  'tertiary_link',
  'secondary',
  'secondary_link',
  'primary',
  'primary_link',
  'road'
]);

const COST_FACTOR = {
  cycleway: 0.7,
  residential: 0.9,
  living_street: 0.9,
  unclassified: 1.0,
  tertiary: 1.0,
  tertiary_link: 1.0,
  secondary: 1.25,
  secondary_link: 1.25,
  primary: 1.6,
  primary_link: 1.6,
  service: 1.1,
  road: 1.2,
  path_designated: 0.85,
  path_default: 1.5,
  track_designated: 1.0,
  track_default: 1.6,
  footway_shared: 2.0,
  bridleway: 1.8
};

function normalizeTag(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isOneway(tags) {
  return directionOf(tags).oneway;
}

/**
 * Returns the directionality of a way for cyclists.
 *   { oneway: false }                   両方向通行可
 *   { oneway: true, reversed: false }   refs[0]→refs[-1] のみ
 *   { oneway: true, reversed: true }    refs[-1]→refs[0] のみ (OSM oneway=-1)
 *
 * `oneway:bicycle=no` は自転車のみ双方向にする上書き。-1 系も honor する。
 */
function directionOf(tags) {
  if (!tags || typeof tags !== 'object') return { oneway: false, reversed: false };
  const bikeOneway = normalizeTag(tags['oneway:bicycle']);
  if (bikeOneway === 'no') return { oneway: false, reversed: false };
  if (bikeOneway === 'yes') return { oneway: true, reversed: false };
  if (bikeOneway === '-1' || bikeOneway === 'reverse') {
    return { oneway: true, reversed: true };
  }
  const oneway = normalizeTag(tags.oneway);
  if (oneway === 'yes' || oneway === 'true' || oneway === '1') {
    return { oneway: true, reversed: false };
  }
  if (oneway === '-1' || oneway === 'reverse') {
    return { oneway: true, reversed: true };
  }
  return { oneway: false, reversed: false };
}

function classifyWay(tags) {
  if (!tags || typeof tags !== 'object') {
    return { allowed: false, reason: 'no_tags' };
  }
  const highway = normalizeTag(tags.highway);
  if (!highway) return { allowed: false, reason: 'no_highway' };

  const bicycle = normalizeTag(tags.bicycle);
  if (BICYCLE_DENY.has(bicycle)) {
    return { allowed: false, reason: 'bicycle_denied' };
  }

  if (BLOCKED_HIGHWAY.has(highway)) {
    return { allowed: false, reason: 'highway_blocked' };
  }

  const access = normalizeTag(tags.access);
  if (ACCESS_DENY.has(access) && !BICYCLE_ALLOW.has(bicycle)) {
    return { allowed: false, reason: 'access_denied' };
  }

  let kind;
  if (FOOT_ONLY_HIGHWAY.has(highway)) {
    if (!BICYCLE_ALLOW.has(bicycle)) {
      return { allowed: false, reason: 'foot_only' };
    }
    kind = 'footway_shared';
  } else if (PATHISH_HIGHWAY.has(highway)) {
    if (highway === 'bridleway') {
      // bridleway は自転車明示許可がなければ通行不可。designated でも kind は
      // bridleway のままにする (track と扱いが違う)。
      if (!BICYCLE_ALLOW.has(bicycle)) {
        return { allowed: false, reason: 'bridleway_no_bicycle' };
      }
      kind = 'bridleway';
    } else if (bicycle === 'designated') {
      kind = `${highway === 'path' ? 'path' : 'track'}_designated`;
    } else {
      kind = `${highway}_default`;
    }
  } else if (DEFAULT_ALLOWED_HIGHWAY.has(highway)) {
    kind = highway;
  } else {
    return { allowed: false, reason: 'unknown_highway' };
  }

  const costFactor = COST_FACTOR[kind];
  if (costFactor === undefined) {
    return { allowed: false, reason: 'no_cost_factor' };
  }

  const dir = directionOf(tags);
  return {
    allowed: true,
    highway,
    kind,
    costFactor,
    oneway: dir.oneway,
    reversed: dir.reversed
  };
}

module.exports = {
  classifyWay,
  isOneway,
  directionOf,
  COST_FACTOR,
  BLOCKED_HIGHWAY,
  BICYCLE_ALLOW,
  BICYCLE_DENY
};

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

// graph_builder は `cost_m = length_m * costFactor` しか計算しないため、係数は
// そのまま「この道を通るためにどれだけ遠回りしてよいか」を意味する。1.0 未満は
// 「最短距離より優先して選ぶ」、1.0 超は「避けるが代替が無ければ通る」。
//
// residential / living_street は 0.9 だった (= 生活道路のためなら 10% 遠回り
// してでも入る)。都市部5ルートの実測で生活道路の通過割合が 16.1% に達し、
// 「田んぼ道や生活道路をぐねぐね入る」体感の主因になっていた。1.15 にすると
// 2.4% まで下がり、総距離・曲がり回数は変わらない (#96)。
const COST_FACTOR = {
  cycleway: 0.7,
  residential: 1.15,
  living_street: 1.15,
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
const ONEWAY_TRUE = new Set(['yes', 'true', '1']);
const ONEWAY_FALSE = new Set(['no', 'false', '0']);
const ONEWAY_REVERSE = new Set(['-1', 'reverse']);

function directionOf(tags) {
  if (!tags || typeof tags !== 'object') return { oneway: false, reversed: false };
  // oneway:bicycle が指定されていれば自転車専用ルールが優先 (車道は一方通行
  // でも自転車逆走 OK 等が表現される)。OSM では数値表現 (1 / -1 / 0) も流通
  // しているので oneway 本体と同じ真値集合を honor する。
  const bikeOneway = normalizeTag(tags['oneway:bicycle']);
  if (ONEWAY_FALSE.has(bikeOneway)) return { oneway: false, reversed: false };
  if (ONEWAY_TRUE.has(bikeOneway)) return { oneway: true, reversed: false };
  if (ONEWAY_REVERSE.has(bikeOneway)) return { oneway: true, reversed: true };
  const oneway = normalizeTag(tags.oneway);
  if (ONEWAY_TRUE.has(oneway)) return { oneway: true, reversed: false };
  if (ONEWAY_REVERSE.has(oneway)) return { oneway: true, reversed: true };
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

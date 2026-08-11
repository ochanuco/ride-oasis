const API_BASE = window.RIDEOASIS_API_BASE || '/api';

const PRECISE_POINT_LEVEL = 8;
const DEFAULT_MIN_POINT_LEVEL = 3;
const DISTANCE_OPTIONS = [100, 250, 500, 1000, 2000, 5000, 10000];
const FOLLOW_MIN_REFRESH_INTERVAL_MS = 30000;
const FOLLOW_FORWARD_HALF_CONE_DEG = 90;
const FOLLOW_BEARING_MIN_MOVEMENT_M = 5;

const elements = {
  status: document.getElementById('status'),
  gpxFile: document.getElementById('gpx-file'),
  useCurrentLocation: document.getElementById('use-current-location'),
  gpxPanel: document.getElementById('gpx-panel'),
  currentLocationPanel: document.getElementById('current-location-panel'),
  manualPanel: document.getElementById('manual-panel'),
  manualReset: document.getElementById('manual-reset'),
  gpxFileName: document.getElementById('gpx-file-name'),
  routePointCount: document.getElementById('route-point-count'),
  distanceThreshold: document.getElementById('distance-threshold'),
  distanceCurrent: document.getElementById('distance-current'),
  pointList: document.getElementById('point-list'),
  matchedCount: document.getElementById('matched-count'),
  popup: document.getElementById('popup'),
  popupBody: document.getElementById('popup-body'),
  popupClose: document.getElementById('popup-close'),
  followToggle: document.getElementById('follow-toggle'),
  resultsSheet: document.getElementById('results-sheet'),
  resultsToggle: document.getElementById('results-toggle'),
  cueSheetButton: document.getElementById('cue-sheet-button'),
  gpxExportButton: document.getElementById('gpx-export-button'),
  showCoursePoints: document.getElementById('show-course-points'),
  coursePointTypes: document.getElementById('course-point-types'),
  rwgForm: document.getElementById('rwg-form'),
  rwgUrl: document.getElementById('rwg-url'),
  rwgFetch: document.getElementById('rwg-fetch'),
  elevationChart: document.getElementById('elevation-chart'),
  elevationCanvas: document.getElementById('elevation-canvas'),
  elevationMeta: document.getElementById('elevation-meta'),
  hoverTip: document.getElementById('hover-tip'),
  hoverTipLinked: document.getElementById('hover-tip-linked')
};

// Padding constants shared between chart drawing and chart hit-testing so the
// hover dots line up exactly with what's painted on the canvas.
const CHART_PAD_LEFT = 32;
const CHART_PAD_RIGHT = 6;
const CHART_PAD_TOP = 4;
const CHART_PAD_BOTTOM = 4;

const CUE_SHEET_STORAGE_KEY = 'rideoasis-cue-sheet';

const desktopMediaQuery = typeof window.matchMedia === 'function'
  ? window.matchMedia('(min-width: 821px)')
  : null;

const routeGeoJsonFormat = new ol.format.GeoJSON({ featureProjection: 'EPSG:3857' });

const routeSource = new ol.source.Vector();
const pointSource = new ol.source.Vector();
const endpointSource = new ol.source.Vector();
const currentLocationSource = new ol.source.Vector();
const coursePointSource = new ol.source.Vector();

// Route line style: feature の segmentState で色切替。
//   computed (CH 成功) → 青 (既存色)
//   gray (>25km、計算不可)→ 灰色、破線で「計算不可」可視化
//   pending (計算中)     → 薄青、破線
//   error (API 失敗)     → 赤、破線
// segmentState 未指定の feature (GPX 取り込みルート等) は青で従来通り。
const ROUTE_STYLES = {
  computed: new ol.style.Style({
    stroke: new ol.style.Stroke({ color: '#225ea8', width: 4 })
  }),
  pending: new ol.style.Style({
    stroke: new ol.style.Stroke({ color: '#7aa8d4', width: 3, lineDash: [6, 4] })
  }),
  gray: new ol.style.Style({
    stroke: new ol.style.Stroke({ color: '#8a8a8a', width: 3, lineDash: [10, 6] })
  }),
  error: new ol.style.Style({
    stroke: new ol.style.Stroke({ color: '#c0392b', width: 3, lineDash: [6, 4] })
  })
};
const routeLayer = new ol.layer.Vector({
  source: routeSource,
  style(feature) {
    const state = feature.get('segmentState');
    if (state && ROUTE_STYLES[state]) return ROUTE_STYLES[state];
    return ROUTE_STYLES.computed;
  }
});

const pointLayer = new ol.layer.Vector({
  source: pointSource,
  style(feature) {
    const active = feature.get('active') === true;
    const forward = feature.get('forward') === true;
    const radius = active ? 8 : forward ? 7 : 6;
    const fillColor = active ? '#9e3d22' : forward ? '#1f4f95' : '#12836b';
    const strokeWidth = active || forward ? 2 : 1.5;
    return new ol.style.Style({
      image: new ol.style.Circle({
        radius,
        fill: new ol.style.Fill({ color: fillColor }),
        stroke: new ol.style.Stroke({ color: '#ffffff', width: strokeWidth })
      })
    });
  }
});

const endpointLayer = new ol.layer.Vector({
  source: endpointSource,
  style(feature) {
    const kind = feature.get('kind');
    // intermediate waypoint = PR #90 で導入。灰色直線セグメントを分割
    // するためにユーザがクリックして挿入する点。小さめ円で目立たせず。
    if (kind === 'intermediate') {
      return new ol.style.Style({
        image: new ol.style.Circle({
          radius: 6,
          fill: new ol.style.Fill({ color: '#f4a020' }),
          stroke: new ol.style.Stroke({ color: '#fff', width: 1.5 })
        })
      });
    }
    const fill = kind === 'start' ? '#0b8f3f' : '#c62f2f';
    const points = kind === 'start' ? 3 : 4;
    const angle = kind === 'start' ? Math.PI / 2 : Math.PI / 4;
    return new ol.style.Style({
      image: new ol.style.RegularShape({
        points,
        radius: 8,
        angle,
        fill: new ol.style.Fill({ color: fill }),
        stroke: new ol.style.Stroke({ color: '#fff', width: 1.2 })
      })
    });
  }
});

const currentLocationLayer = new ol.layer.Vector({
  source: currentLocationSource,
  style: new ol.style.Style({
    image: new ol.style.Circle({
      radius: 7,
      fill: new ol.style.Fill({ color: '#c76b12' }),
      stroke: new ol.style.Stroke({ color: '#ffffff', width: 2 })
    })
  })
});

const coursePointBaseStyle = new ol.style.Style({
  image: new ol.style.RegularShape({
    points: 5,
    radius: 9,
    radius2: 4,
    angle: 0,
    fill: new ol.style.Fill({ color: '#c62f2f' }),
    stroke: new ol.style.Stroke({ color: '#ffffff', width: 1.5 })
  })
});

const coursePointLayer = new ol.layer.Vector({
  source: coursePointSource,
  style(feature) {
    const cp = feature && feature.get('coursePoint');
    if (!cp) return null;
    if (disabledCoursePointTypes.has(cp.type)) return null;
    return coursePointBaseStyle;
  }
});

const hoverMarkerSource = new ol.source.Vector();
const hoverMarkerLayer = new ol.layer.Vector({
  source: hoverMarkerSource,
  style: new ol.style.Style({
    image: new ol.style.Circle({
      radius: 6,
      fill: new ol.style.Fill({ color: '#225ea8' }),
      stroke: new ol.style.Stroke({ color: '#ffffff', width: 2 })
    })
  })
});

const map = new ol.Map({
  target: 'map',
  layers: [
    new ol.layer.Tile({ source: new ol.source.OSM() }),
    // ルート線は補給地点ドットより上に描く。下にあると 100 件超のドットに
    // 埋もれて「ルートが出ていない」ように見える。
    pointLayer,
    routeLayer,
    endpointLayer,
    currentLocationLayer,
    coursePointLayer,
    hoverMarkerLayer
  ],
  view: new ol.View({
    center: ol.proj.fromLonLat([139.767, 35.681]),
    zoom: 6
  })
});

const popupOverlay = new ol.Overlay({
  element: elements.popup,
  positioning: 'bottom-left',
  stopEvent: true,
  offset: [12, -12]
});
map.addOverlay(popupOverlay);

let routeFeature = null;
let routeCoordinates = [];
let routeElevations = [];
let routeCumulativeMeters = [];
let routeElevationSeries = null;
let hoverCumulativeMeters = null;
let hoverPointerKind = null;
let lastChartTotalMeters = null;
let hoverPreviewOasisKey = null;
let oasisChartDotsCache = { route: null, filtered: null, dots: [] };
let coursePointChartDotsCache = {
  route: null,
  coursePoints: null,
  disabledTypes: null,
  dots: []
};
// manualPoints: 多 waypoint 対応 (N-array、最低 0、最大は実用上 10 程度)
// 旧 max-2 仕様を拡張。waypoints[0] = start、waypoints[N-1] = goal、
// 中間は intermediate (PR #90 で導入、灰色直線セグメントの分割用)
let manualPoints = [];
// 隣接 waypoint 対の状態。len = manualPoints.length - 1
//   state: 'pending' (未計算) / 'computed' (CH 成功・blue) /
//          'gray' (直線距離 > 25km・灰色) / 'error' (API 失敗)
//   coords: state=computed の時のみ [[lon,lat]...]、それ以外は null
const MAX_MANUAL_STRAIGHT_KM = 25;
let manualSegments = [];
let cachedCoursePoints = [];
let disabledCoursePointTypes = new Set();
let currentRwgId = null;
let pendingCptypesFilter = null;
let allMatchedPoints = [];
let filteredPoints = [];
let lastCandidates = null;
let lastRouteSnapshot = null;
let wasmReadyHandlerInstalled = false;
let activeSupplyPointId = null;
let activePopupKind = null;
let activeCoursePointType = null;
let previewSupplyPointId = null;
const API_PAGE_LIMIT = 10000;
const featureIndex = new Map();
let latestRouteLoadToken = 0;
let latestRefreshToken = 0;
let followWatchId = null;
let followLastCoord = null;
let followBearingDeg = null;
let followLastRefreshAt = 0;

/** Returns the currently selected route source mode. */
function selectedSourceMode() {
  return document.querySelector('input[name="source-mode"]:checked')?.value || 'gpx';
}

/** Formats a distance for compact UI labels. */
function formatDistance(distanceMeters) {
  return distanceMeters >= 1000 ? `${distanceMeters / 1000}km` : `${distanceMeters}m`;
}

/** Returns the selected ladder distance in meters. */
function selectedDistanceMeters() {
  const index = Number(elements.distanceThreshold.value);
  return DISTANCE_OPTIONS[index] ?? 1000;
}

/** Syncs the visible distance label beside the ladder. */
function syncDistanceUi() {
  const distanceText = formatDistance(selectedDistanceMeters());
  elements.distanceCurrent.textContent = distanceText;
  elements.distanceThreshold.setAttribute('aria-valuetext', `${distanceText}以内`);
}

/** Returns the currently enabled chain filters from the result toolbar. */
function selectedResultChains() {
  return Array.from(document.querySelectorAll('.chain-filters input[type="checkbox"]:checked')).map(
    (input) => input.value
  );
}

/** Returns the active precision filters for result narrowing. */
function selectedPrecisionFilters() {
  return new Set(
    Array.from(document.querySelectorAll('input[name="precision-filter"]:checked')).map((input) => input.value)
  );
}

/** Maps point level to a UI-friendly precision label. */
function precisionLabel(pointLevel) {
  return Number(pointLevel) >= PRECISE_POINT_LEVEL ? '正確' : 'あいまい';
}

/** Updates the top-right status badge. */
function setStatus(message) {
  elements.status.textContent = message;
}

/** Syncs source-mode panel state so only one input path is active at a time. */
function syncSourceModeUi() {
  const mode = selectedSourceMode();
  elements.gpxFile.disabled = mode !== 'gpx';
  elements.useCurrentLocation.disabled = mode !== 'current';
  elements.manualReset.disabled = mode !== 'manual';
  elements.gpxPanel.classList.toggle('inactive', mode !== 'gpx');
  elements.currentLocationPanel.classList.toggle('inactive', mode !== 'current');
  elements.manualPanel.classList.toggle('inactive', mode !== 'manual');
}

/** Resets visible and cached result points before a new search. */
function resetResults() {
  allMatchedPoints = [];
  filteredPoints = [];
  lastCandidates = null;
  lastRouteSnapshot = null;
  featureIndex.clear();
  pointSource.clear();
  buildPointList([]);
  updateSummary(0);
  syncCueSheetButton();
  clearPopup();
}

/** Updates route-point count near the route input controls. */
function updateRoutePointCount() {
  const count = routeCoordinates.length;
  elements.routePointCount.textContent = `経路点数: ${count > 0 ? count : '-'}`;
}

/** Invalidates in-flight candidate refreshes after route source changes. */
function cancelPendingRefreshes() {
  latestRefreshToken += 1;
}

/** Renders the matched supply point list beside the map. */
function buildPointList(points) {
  elements.pointList.innerHTML = '';
  if (points.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'point-item';
    empty.textContent = '該当する補給地点はありません';
    elements.pointList.appendChild(empty);
    return;
  }

  for (const feature of points) {
    const props = feature.properties;
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'point-item';
    item.dataset.supplyPointId = String(props.supply_point_id);
    if (supplyPointKey(props.supply_point_id) === supplyPointKey(activeSupplyPointId)) {
      item.classList.add('active');
    }
    const chain = document.createElement('span');
    chain.className = 'chain';
    chain.textContent = props.chain;

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = props.name;

    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `${Math.round(props.route_distance_m)}m ・ ${precisionLabel(props.geocode_point_level)}`;

    const address = document.createElement('span');
    address.className = 'address';
    address.textContent = props.address_norm || '-';

    item.append(chain, title, meta, address);
    elements.pointList.appendChild(item);
  }
}

/** Builds the popup HTML for a selected supply point. */
function buildPopupHtml(props) {
  return [
    `<div class="popup-chain">${escapeHtml(props.chain)}</div>`,
    `<div class="popup-title">${escapeHtml(props.name)}</div>`,
    `<div class="popup-distance">${Math.round(props.route_distance_m)}m ・ ${escapeHtml(precisionLabel(props.geocode_point_level))}</div>`
  ].join('');
}

/** Escapes text before inserting it into HTML fragments. */
function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Returns the currently highlighted supply point id. */
function highlightedSupplyPointId() {
  return previewSupplyPointId ?? activeSupplyPointId;
}

/** Normalizes supply point ids for DOM and feature lookup. */
function supplyPointKey(supplyPointId) {
  return supplyPointId == null ? '' : String(supplyPointId);
}

/** Finds the rendered feature for a supply point id. */
function findPointFeature(supplyPointId) {
  return featureIndex.get(supplyPointKey(supplyPointId)) || null;
}

/** Updates marker highlight state from current active or preview selection. */
function syncPointHighlight() {
  const highlightedId = highlightedSupplyPointId();
  for (const feature of pointSource.getFeatures()) {
    feature.set('active', supplyPointKey(feature.get('properties').supply_point_id) === supplyPointKey(highlightedId));
  }
  renderElevationChart();
}

/** Updates active styling in the side list without rebuilding focused elements. */
function syncPointListSelection() {
  for (const item of elements.pointList.querySelectorAll('.point-item[data-supply-point-id]')) {
    item.classList.toggle('active', item.dataset.supplyPointId === supplyPointKey(activeSupplyPointId));
  }
}

/** Opens the popup for one rendered feature. */
function openPopupForFeature(feature) {
  popupOverlay.setPosition(feature.getGeometry().getCoordinates());
  elements.popupBody.innerHTML = buildPopupHtml(feature.get('properties'));
  elements.popup.hidden = false;
  activePopupKind = 'supply';
}

/** Opens the popup for a clicked FIT course point with route projection info. */
function activateCoursePoint(feature) {
  const cp = feature.get('coursePoint');
  if (!cp) return;
  popupOverlay.setPosition(feature.getGeometry().getCoordinates());
  let projLine = '';
  if (routeCoordinates.length >= 2) {
    const proj = window.RouteMath.routeProjection([cp.lon, cp.lat], routeCoordinates);
    if (proj) {
      const cumKm = (proj.alongMeters / 1000).toFixed(1);
      const sideLabel = proj.side === 'L' ? '左' : proj.side === 'R' ? '右' : '・';
      projLine = `<div class="popup-distance">累計 ${cumKm} km / ${sideLabel}側 / 離れ ${Math.round(proj.perpMeters)} m</div>`;
    }
  }
  const descLine = cp.description
    ? `<div class="popup-description">${escapeHtml(cp.description)}</div>`
    : '';
  elements.popupBody.innerHTML = [
    `<div class="popup-chain">${escapeHtml(cp.type || 'course point')}</div>`,
    `<div class="popup-title">${escapeHtml(cp.name || '(無名)')}</div>`,
    descLine,
    projLine
  ].filter(Boolean).join('');
  elements.popup.hidden = false;
  activePopupKind = 'course-point';
  activeCoursePointType = cp.type || null;
  // Course points are not part of the supply-point selection flow, so we
  // explicitly clear any prior supply selection without closing this popup.
  activeSupplyPointId = null;
  previewSupplyPointId = null;
  syncPointHighlight();
  syncPointListSelection();
}

/** Marks one supply point active and opens its popup. */
function activatePoint(supplyPointId) {
  activeSupplyPointId = supplyPointKey(supplyPointId);
  previewSupplyPointId = null;
  syncPointHighlight();
  syncPointListSelection();
  const feature = findPointFeature(supplyPointId);
  if (feature) openPopupForFeature(feature);
}

/** Temporarily previews one supply point from the side list. */
function previewPoint(supplyPointId) {
  previewSupplyPointId = supplyPointKey(supplyPointId);
  syncPointHighlight();
  const feature = findPointFeature(supplyPointId);
  if (feature) openPopupForFeature(feature);
}

/** Clears one temporary preview and restores the active popup if present. */
function clearPreviewPoint(supplyPointId) {
  if (previewSupplyPointId !== supplyPointKey(supplyPointId)) return;
  previewSupplyPointId = null;
  syncPointHighlight();
  const activeFeature = activeSupplyPointId ? findPointFeature(activeSupplyPointId) : null;
  if (activeFeature) {
    openPopupForFeature(activeFeature);
    return;
  }
  elements.popup.hidden = true;
  popupOverlay.setPosition(undefined);
}

/** Clears popup and active marker state. */
function clearPopup() {
  activeSupplyPointId = null;
  previewSupplyPointId = null;
  elements.popup.hidden = true;
  popupOverlay.setPosition(undefined);
  activePopupKind = null;
  activeCoursePointType = null;
  syncPointHighlight();
  syncPointListSelection();
}

/** Updates summary card for visible results. */
function updateSummary(visibleCount) {
  elements.matchedCount.textContent = String(visibleCount);
}

/** Enables the cue-sheet and GPX-export buttons only when a route and matched results exist. */
function syncCueSheetButton() {
  const ready = routeCoordinates.length >= 2 && filteredPoints.length > 0;
  if (elements.cueSheetButton) elements.cueSheetButton.disabled = !ready;
  if (elements.gpxExportButton) elements.gpxExportButton.disabled = !ready;
}

/** Builds and downloads a GPX 1.1 document with the current route and matched supply points. */
function exportGpx() {
  if (routeCoordinates.length < 2 || filteredPoints.length === 0) return;
  const cum = window.RouteMath.cumulativeDistancesMeters(routeCoordinates);
  const waypoints = filteredPoints.map((feature) => {
    const [lon, lat] = feature.geometry.coordinates;
    const props = feature.properties || {};
    const proj = window.RouteMath.routeProjection(feature.geometry.coordinates, routeCoordinates, cum);
    const sideLabel = proj?.side === 'L' ? '左' : proj?.side === 'R' ? '右' : '';
    const cumKm = proj ? (proj.alongMeters / 1000).toFixed(1) : null;
    const descParts = [];
    if (cumKm !== null) descParts.push(`累計 ${cumKm}km`);
    if (sideLabel) descParts.push(`${sideLabel}側`);
    if (proj) descParts.push(`離れ ${Math.round(proj.perpMeters)}m`);
    if (props.address_norm) descParts.push(props.address_norm);
    return {
      lat,
      lon,
      name: `${props.chain || ''}: ${props.name || ''}`.trim().replace(/^:\s*/, ''),
      desc: descParts.join(' / '),
      type: props.chain || 'supply'
    };
  });

  const xml = window.GpxParser.buildGpxText({
    name: 'RideOasis Supply Points',
    creator: 'RideOasis',
    generatedAt: new Date().toISOString(),
    route: routeCoordinates,
    waypoints
  });

  const blob = new Blob([xml], { type: 'application/gpx+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  anchor.href = url;
  anchor.download = `rideoasis-${stamp}.gpx`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 100);
  setStatus(`GPX を書き出しました (${waypoints.length} 件)`);
}

/** Serializes the current cue-sheet input and opens the printable page. */
function openCueSheet() {
  if (routeCoordinates.length < 2 || filteredPoints.length === 0) return;
  try {
    localStorage.setItem(CUE_SHEET_STORAGE_KEY, JSON.stringify({
      routeCoordinates,
      filteredPoints,
      coursePoints: visibleCoursePoints(),
      distanceMeters: selectedDistanceMeters(),
      generatedAt: new Date().toISOString()
    }));
  } catch (error) {
    console.error('Failed to serialize cue-sheet input', error);
    setStatus('キューシートデータの保存に失敗しました');
    return;
  }
  window.open('./print.html', '_blank', 'noopener');
}

/** Clears the drawing sources used for route, endpoints, current location, and FIT course points. */
function clearRouteVisualSources() {
  routeSource.clear();
  endpointSource.clear();
  currentLocationSource.clear();
  coursePointSource.clear();
  cachedCoursePoints = [];
  currentRwgId = null;
}

/** Renders FIT course-point waypoints (PCs / aid stations / etc.) on the map. */
function renderCoursePoints(points) {
  coursePointSource.clear();
  cachedCoursePoints = Array.isArray(points) ? points.slice() : [];
  disabledCoursePointTypes = new Set();
  coursePointChartDotsCache.coursePoints = null;
  for (const cp of cachedCoursePoints) {
    if (!Number.isFinite(cp?.lat) || !Number.isFinite(cp?.lon)) continue;
    const feature = new ol.Feature({
      geometry: new ol.geom.Point(ol.proj.fromLonLat([cp.lon, cp.lat]))
    });
    feature.set('coursePoint', cp);
    coursePointSource.addFeature(feature);
  }
  if (elements.showCoursePoints) {
    coursePointLayer.setVisible(elements.showCoursePoints.checked);
  }
  rebuildCoursePointTypeChips();
}

/** Returns the cached course points filtered by both the master toggle and per-type filters. */
function visibleCoursePoints() {
  if (elements.showCoursePoints && !elements.showCoursePoints.checked) return [];
  return cachedCoursePoints.filter((cp) => !disabledCoursePointTypes.has(cp.type));
}

/** Rebuilds the per-type chip filters from the unique types in cachedCoursePoints. */
function rebuildCoursePointTypeChips() {
  const container = elements.coursePointTypes;
  if (!container) return;
  container.innerHTML = '';
  const types = new Set();
  for (const cp of cachedCoursePoints) {
    if (typeof cp?.type === 'string' && cp.type) types.add(cp.type);
  }
  if (types.size === 0) {
    container.hidden = true;
    return;
  }
  container.hidden = false;
  // If init parsed `cptypes` from the URL, only those types stay enabled.
  // The pending filter is one-shot so user toggles after this don't get
  // overridden the next time chips rebuild.
  const enabledFromUrl = Array.isArray(pendingCptypesFilter)
    ? new Set(pendingCptypesFilter)
    : null;
  for (const type of [...types].sort()) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = type;
    if (enabledFromUrl && !enabledFromUrl.has(type)) {
      input.checked = false;
      disabledCoursePointTypes.add(type);
    } else {
      input.checked = true;
    }
    input.addEventListener('change', () => {
      if (input.checked) disabledCoursePointTypes.delete(type);
      else disabledCoursePointTypes.add(type);
      coursePointLayer.changed();
      coursePointChartDotsCache.coursePoints = null;
      renderElevationChart();
      if (!input.checked && activePopupKind === 'course-point' && activeCoursePointType === type) {
        clearPopup();
      }
      syncUrlState();
    });
    const span = document.createElement('span');
    span.textContent = type;
    label.append(input, span);
    container.appendChild(label);
  }
  if (enabledFromUrl) {
    pendingCptypesFilter = null;
    coursePointLayer.changed();
  }
}

/** Renders the uploaded route and its start/end markers. */
function renderRoute(feature) {
  clearRouteVisualSources();
  routeSource.addFeature(feature);

  const coordinates = feature.getGeometry().getCoordinates();
  if (coordinates.length >= 2) {
    const start = new ol.Feature({ geometry: new ol.geom.Point(coordinates[0]) });
    start.set('kind', 'start');
    const goal = new ol.Feature({ geometry: new ol.geom.Point(coordinates[coordinates.length - 1]) });
    goal.set('kind', 'goal');
    endpointSource.addFeatures([start, goal]);
  }
}

/** Renders manual-mode endpoints and per-segment LineStrings (multi-waypoint). */
function renderManualPoints() {
  clearRouteVisualSources();

  if (manualPoints.length === 0) return;

  // Endpoints: start (0) / goal (N-1) / intermediate (1..N-2)
  for (let i = 0; i < manualPoints.length; i += 1) {
    const f = new ol.Feature({
      geometry: new ol.geom.Point(ol.proj.fromLonLat(manualPoints[i]))
    });
    if (i === 0) f.set('kind', 'start');
    else if (i === manualPoints.length - 1) f.set('kind', 'goal');
    else f.set('kind', 'intermediate');
    f.set('waypointIndex', i);
    endpointSource.addFeature(f);
  }

  // Segments: state per pair (computed=blue / gray=灰色直線 / pending / error)
  for (let i = 0; i < manualSegments.length; i += 1) {
    const seg = manualSegments[i];
    let coordsLL;
    if (seg.state === 'computed' && Array.isArray(seg.coords) && seg.coords.length >= 2) {
      coordsLL = seg.coords;
    } else {
      // gray / pending / error は直線で繋ぐ
      coordsLL = [manualPoints[i], manualPoints[i + 1]];
    }
    const line = new ol.Feature({
      geometry: new ol.geom.LineString(coordsLL.map((c) => ol.proj.fromLonLat(c)))
    });
    line.set('kind', 'manual-segment');
    line.set('segmentIndex', i);
    line.set('segmentState', seg.state);
    routeSource.addFeature(line);
  }
}

// 直線距離 (km) を返す。RouteMath.pointToPointDistanceMeters を再利用。
function straightLineKm(a, b) {
  return window.RouteMath.pointToPointDistanceMeters(a, b) / 1000;
}

// segments を waypoints から再生成。**差分更新**: 両端 lonlat が変化して
// いない segment は旧 state/coords を流用して computed の API 再取得を回避
// (CodeRabbit PR #90 指摘)。これで waypoint 1 点の drag/insert/delete でも
// 影響範囲外の segments は無傷で残り、操作レスポンスが劇的に良くなる。
function rebuildSegmentsFromWaypoints() {
  const oldByKey = new Map();
  for (const seg of manualSegments) {
    if (Array.isArray(seg.from) && Array.isArray(seg.to)) {
      oldByKey.set(`${seg.from[0]},${seg.from[1]}|${seg.to[0]},${seg.to[1]}`, seg);
    }
  }
  const next = [];
  for (let i = 0; i < manualPoints.length - 1; i += 1) {
    const from = manualPoints[i];
    const to = manualPoints[i + 1];
    const key = `${from[0]},${from[1]}|${to[0]},${to[1]}`;
    const reused = oldByKey.get(key);
    if (reused) {
      // 旧 state/coords をそのまま流用 (両端変化なし = 内容変化なし)
      next.push({ ...reused, from, to });
    } else {
      const dKm = straightLineKm(from, to);
      next.push({
        state: dKm > MAX_MANUAL_STRAIGHT_KM ? 'gray' : 'pending',
        coords: null,
        dKm,
        from,
        to
      });
    }
  }
  manualSegments = next;
}

// 指定 index の segments を CH 計算 (pending → computed/gray/error)。
// 並列 fetch。load token を引数で受け取り、stale request を破棄。
async function computeManualSegments(indices, loadToken) {
  const tasks = indices.map(async (i) => {
    if (i < 0 || i >= manualSegments.length) return;
    const seg = manualSegments[i];
    if (seg.state !== 'pending') return; // gray は計算しない
    const from = manualPoints[i];
    const to = manualPoints[i + 1];
    const routed = await fetchCyclingRoute(from, to, loadToken);
    if (loadToken !== latestRouteLoadToken) return;
    if (routed && Array.isArray(routed.coordinates) && routed.coordinates.length >= 2) {
      seg.state = 'computed';
      seg.coords = routed.coordinates;
    } else if (routed && routed.error === 'too_far') {
      // worker が too_far 返した = 25km 超。直線距離計算が緩かったケース
      seg.state = 'gray';
      seg.coords = null;
    } else {
      seg.state = 'error';
      seg.coords = null;
    }
  });
  await Promise.all(tasks);
}

// computed segments の coords を順に concat して 1 本の routeCoordinates に。
// gray segments は直線 2 点で繋ぐ (UI から見ると "繋がってる" 風)。
function flattenManualRoute() {
  const out = [];
  for (let i = 0; i < manualSegments.length; i += 1) {
    const seg = manualSegments[i];
    const coords = seg.state === 'computed' && Array.isArray(seg.coords)
      ? seg.coords
      : [manualPoints[i], manualPoints[i + 1]];
    if (i === 0) {
      out.push(...coords);
    } else {
      // 前 segment の終端と今 segment の起点は重複なので 1 個飛ばし
      out.push(...coords.slice(1));
    }
  }
  return out;
}

/** Renders a single current-location marker instead of a route line. */
function renderCurrentLocation(coord) {
  clearRouteVisualSources();
  currentLocationSource.addFeature(
    new ol.Feature({
      geometry: new ol.geom.Point(ol.proj.fromLonLat(coord))
    })
  );
}

/** Converts matched GeoJSON points into OpenLayers features. */
function renderMatchedPoints(points) {
  featureIndex.clear();
  pointSource.clear();
  const features = points.map((feature) => {
    const olFeature = new ol.Feature({
      geometry: new ol.geom.Point(ol.proj.fromLonLat(feature.geometry.coordinates))
    });
    olFeature.set('properties', feature.properties);
    const featureKey = supplyPointKey(feature.properties.supply_point_id);
    olFeature.set('active', featureKey === supplyPointKey(highlightedSupplyPointId()));
    featureIndex.set(featureKey, olFeature);
    return olFeature;
  });
  pointSource.addFeatures(features);
}

/** Finds the result-list item button from a delegated event target. */
function findPointListItem(node) {
  return node instanceof Element ? node.closest('.point-item[data-supply-point-id]') : null;
}

/** Fits the map view to the currently visible route and points. */
function fitToVisibleData() {
  const extent = ol.extent.createEmpty();
  let hasData = false;
  for (const source of [routeSource, pointSource, endpointSource, currentLocationSource, coursePointSource]) {
    const sourceExtent = source.getExtent();
    if (sourceExtent && !ol.extent.isEmpty(sourceExtent)) {
      ol.extent.extend(extent, sourceExtent);
      hasData = true;
    }
  }
  if (hasData) {
    map.getView().fit(extent, { padding: [40, 40, 40, 40], duration: 250, maxZoom: 14 });
  }
}

/**
 * Builds a chart-ready elevation series by linearly interpolating across `null`
 * gaps in `elevations`. Returns null when there is no usable data so callers can
 * hide the chart. Leading/trailing nulls are extended with the nearest known
 * value rather than skipped, so the polyline does not start/end mid-air.
 */
function buildElevationSeries(elevations, cumulativeMeters) {
  if (!Array.isArray(elevations) || !Array.isArray(cumulativeMeters)) return null;
  const n = Math.min(elevations.length, cumulativeMeters.length);
  if (n < 2) return null;

  const knownIndexes = [];
  for (let i = 0; i < n; i += 1) {
    if (Number.isFinite(elevations[i])) knownIndexes.push(i);
  }
  if (knownIndexes.length < 2) return null;

  const filled = new Array(n);
  for (let i = 0; i < n; i += 1) {
    if (Number.isFinite(elevations[i])) {
      filled[i] = elevations[i];
      continue;
    }
    let prev = null;
    let next = null;
    for (let k = 0; k < knownIndexes.length; k += 1) {
      const idx = knownIndexes[k];
      if (idx < i) prev = idx;
      else if (idx > i) { next = idx; break; }
    }
    if (prev !== null && next !== null) {
      const dx = cumulativeMeters[next] - cumulativeMeters[prev];
      const t = dx > 0 ? (cumulativeMeters[i] - cumulativeMeters[prev]) / dx : 0;
      filled[i] = elevations[prev] + (elevations[next] - elevations[prev]) * t;
    } else if (prev !== null) {
      filled[i] = elevations[prev];
    } else if (next !== null) {
      filled[i] = elevations[next];
    } else {
      return null;
    }
  }

  let min = Infinity;
  let max = -Infinity;
  let gain = 0;
  let loss = 0;
  for (let i = 0; i < n; i += 1) {
    const v = filled[i];
    if (v < min) min = v;
    if (v > max) max = v;
    if (i > 0) {
      const diff = filled[i] - filled[i - 1];
      if (diff > 0) gain += diff;
      else loss += -diff;
    }
  }
  return { values: filled, min, max, gain, loss, totalDistanceMeters: cumulativeMeters[n - 1] };
}

/** Returns the lon/lat interpolated along the route at `meters` cumulative distance. */
function lonLatAtRouteMeters(meters) {
  if (routeCoordinates.length < 2 || routeCumulativeMeters.length !== routeCoordinates.length) {
    return null;
  }
  const total = routeCumulativeMeters[routeCumulativeMeters.length - 1];
  if (!(total > 0)) return null;
  const m = Math.max(0, Math.min(meters, total));
  let lo = 0;
  let hi = routeCumulativeMeters.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (routeCumulativeMeters[mid] <= m) lo = mid;
    else hi = mid;
  }
  const segLen = routeCumulativeMeters[lo + 1] - routeCumulativeMeters[lo];
  const t = segLen > 0 ? (m - routeCumulativeMeters[lo]) / segLen : 0;
  const a = routeCoordinates[lo];
  const b = routeCoordinates[lo + 1];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * Returns the route gradient (rise/run as a ratio, e.g. 0.05 = 5%) averaged
 * over a ±100 m window around the given cumulative meters. Used to label the
 * hover crosshair with an instantaneous-ish gradient figure.
 */
function gradientAtRouteMeters(meters) {
  if (!routeElevationSeries || routeCumulativeMeters.length < 2) return null;
  const total = routeCumulativeMeters[routeCumulativeMeters.length - 1];
  if (!(total > 0)) return null;
  const window = 100;
  const lo = Math.max(0, meters - window);
  const hi = Math.min(total, meters + window);
  const dx = hi - lo;
  if (dx <= 0) return null;
  const eLo = elevationAtRouteMeters(lo);
  const eHi = elevationAtRouteMeters(hi);
  if (!Number.isFinite(eLo) || !Number.isFinite(eHi)) return null;
  return (eHi - eLo) / dx;
}

/** Interpolates the (filled) elevation series value at the given cumulative meters. */
function elevationAtRouteMeters(meters) {
  if (!routeElevationSeries || routeCumulativeMeters.length < 2) return null;
  const total = routeCumulativeMeters[routeCumulativeMeters.length - 1];
  if (!(total > 0)) return null;
  const m = Math.max(0, Math.min(meters, total));
  let lo = 0;
  let hi = routeCumulativeMeters.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (routeCumulativeMeters[mid] <= m) lo = mid;
    else hi = mid;
  }
  const segLen = routeCumulativeMeters[lo + 1] - routeCumulativeMeters[lo];
  const t = segLen > 0 ? (m - routeCumulativeMeters[lo]) / segLen : 0;
  const va = routeElevationSeries.values[lo];
  const vb = routeElevationSeries.values[lo + 1];
  return va + (vb - va) * t;
}

/** Picks a round elevation step (m) that yields roughly 3-5 grid lines for the given range. */
function pickElevationStep(rangeMeters) {
  const steps = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
  for (const s of steps) {
    if (rangeMeters / s <= 5) return s;
  }
  return 5000;
}

/** Picks a round distance step (m) for the X axis based on total route length. */
function pickDistanceStep(totalMeters) {
  const steps = [500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
  for (const s of steps) {
    if (totalMeters / s <= 6) return s;
  }
  return 200000;
}

/**
 * Projects each currently filtered oasis point onto the active route so the
 * chart can plot them on the cumulative-meters axis. Cache by reference so
 * hover redraws are free; both `routeCoordinates` and `filteredPoints` get
 * reassigned with fresh arrays on each route/filter change.
 */
function getOasisChartDots() {
  if (
    oasisChartDotsCache.route === routeCoordinates
    && oasisChartDotsCache.filtered === filteredPoints
  ) {
    return oasisChartDotsCache.dots;
  }
  const dots = [];
  if (
    routeCoordinates.length >= 2
    && filteredPoints.length > 0
    && routeElevationSeries
    && routeCumulativeMeters.length === routeCoordinates.length
  ) {
    for (const feature of filteredPoints) {
      const coord = feature?.geometry?.coordinates;
      if (!Array.isArray(coord) || coord.length < 2) continue;
      const proj = window.RouteMath.routeProjection(coord, routeCoordinates, routeCumulativeMeters);
      if (!proj) continue;
      const elevation = elevationAtRouteMeters(proj.alongMeters);
      if (!Number.isFinite(elevation)) continue;
      dots.push({
        alongMeters: proj.alongMeters,
        elevation,
        id: feature?.properties?.supply_point_id ?? null
      });
    }
  }
  oasisChartDotsCache = { route: routeCoordinates, filtered: filteredPoints, dots };
  return dots;
}

/**
 * Projects each currently visible course point (FIT/RWG ★) onto the active
 * route so the chart can plot them alongside the Oasis dots. Cached by
 * reference so chart redraws during hover stay cheap; the cache invalidates
 * whenever the route or the visibility filters change.
 */
function getCoursePointChartDots() {
  if (
    coursePointChartDotsCache.route === routeCoordinates
    && coursePointChartDotsCache.coursePoints === cachedCoursePoints
    && coursePointChartDotsCache.disabledTypes === disabledCoursePointTypes
    && coursePointChartDotsCache.masterVisible === (elements.showCoursePoints?.checked ?? true)
  ) {
    return coursePointChartDotsCache.dots;
  }
  const dots = [];
  const visible = visibleCoursePoints();
  if (
    visible.length > 0
    && routeCoordinates.length >= 2
    && routeElevationSeries
    && routeCumulativeMeters.length === routeCoordinates.length
  ) {
    for (const cp of visible) {
      if (!Number.isFinite(cp?.lat) || !Number.isFinite(cp?.lon)) continue;
      const proj = window.RouteMath.routeProjection([cp.lon, cp.lat], routeCoordinates, routeCumulativeMeters);
      if (!proj) continue;
      const elevation = elevationAtRouteMeters(proj.alongMeters);
      if (!Number.isFinite(elevation)) continue;
      dots.push({ alongMeters: proj.alongMeters, elevation, cp });
    }
  }
  coursePointChartDotsCache = {
    route: routeCoordinates,
    coursePoints: cachedCoursePoints,
    disabledTypes: disabledCoursePointTypes,
    masterVisible: elements.showCoursePoints?.checked ?? true,
    dots
  };
  return dots;
}

/**
 * Refreshes `routeCumulativeMeters` and `routeElevationSeries` from the
 * current route. Call this once whenever the route is replaced — the rest of
 * the chart code (renderElevationChart, hover handlers, projection helpers)
 * reads the cached values so pointermove never has to redo this O(N) work.
 *
 * Also clears the active hover position when the route's total length changes,
 * since stale cumulative meters from the previous route do not map to the
 * same point on the new route.
 */
function rebuildRouteElevationCache() {
  if (routeCoordinates.length < 2) {
    routeCumulativeMeters = [];
    routeElevationSeries = null;
    lastChartTotalMeters = null;
    hoverCumulativeMeters = null;
    hoverPointerKind = null;
    hoverMarkerSource.clear();
    return;
  }
  routeCumulativeMeters = window.RouteMath.cumulativeDistancesMeters(routeCoordinates);
  routeElevationSeries = routeElevations.length >= 2
    ? buildElevationSeries(routeElevations, routeCumulativeMeters)
    : null;
  if (!routeElevationSeries) {
    lastChartTotalMeters = null;
    hoverCumulativeMeters = null;
    hoverPointerKind = null;
    hoverMarkerSource.clear();
    return;
  }
  if (lastChartTotalMeters !== null && lastChartTotalMeters !== routeElevationSeries.totalDistanceMeters) {
    hoverCumulativeMeters = null;
    hoverPointerKind = null;
    hoverMarkerSource.clear();
  }
  lastChartTotalMeters = routeElevationSeries.totalDistanceMeters;
}

/** Renders the elevation profile in the bottom-of-map overlay (or hides it). */
function renderElevationChart() {
  const container = elements.elevationChart;
  const canvas = elements.elevationCanvas;
  if (!container || !canvas) return;

  if (!routeElevationSeries || routeCumulativeMeters.length < 2) {
    container.hidden = true;
    return;
  }
  container.hidden = false;

  const rect = canvas.getBoundingClientRect();
  const cssWidth = Math.max(rect.width, 1);
  const cssHeight = Math.max(rect.height, 1);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const padLeft = CHART_PAD_LEFT;
  const padRight = CHART_PAD_RIGHT;
  const padTop = CHART_PAD_TOP;
  const padBottom = CHART_PAD_BOTTOM;
  const plotW = cssWidth - padLeft - padRight;
  const plotH = cssHeight - padTop - padBottom;
  const series = routeElevationSeries;
  const totalMeters = series.totalDistanceMeters || 1;
  // Pad the y range to the nearest grid step so the axis aligns with labels.
  const rawRange = Math.max(series.max - series.min, 1);
  const eleStep = pickElevationStep(rawRange);
  const yMin = Math.floor(series.min / eleStep) * eleStep;
  const yMax = Math.ceil(series.max / eleStep) * eleStep;
  const rangeMeters = Math.max(yMax - yMin, 1);

  const xFromMeters = (m) => padLeft + (m / totalMeters) * plotW;
  const yFromValue = (v) => padTop + (1 - (v - yMin) / rangeMeters) * plotH;

  // Grid lines: horizontal elevation guides + faint vertical distance guides.
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.08)';
  ctx.fillStyle = 'rgba(15, 23, 42, 0.5)';
  ctx.font = '10px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  for (let v = yMin; v <= yMax + 1e-6; v += eleStep) {
    const y = yFromValue(v);
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(cssWidth - padRight, y);
    ctx.stroke();
    ctx.fillText(`${Math.round(v)}m`, padLeft - 4, y);
  }

  const distStep = pickDistanceStep(totalMeters);
  ctx.save();
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.22)';
  ctx.fillStyle = 'rgba(15, 23, 42, 0.6)';
  ctx.setLineDash([3, 3]);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  for (let d = distStep; d < totalMeters; d += distStep) {
    const x = xFromMeters(d);
    ctx.beginPath();
    ctx.moveTo(x, padTop);
    ctx.lineTo(x, padTop + plotH);
    ctx.stroke();
    const label = distStep >= 1000 ? `${Math.round(d / 1000)}km` : `${d}m`;
    ctx.fillText(label, x, padTop + plotH - 1);
  }
  ctx.restore();

  const accent = '#225ea8';
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = accent;
  ctx.fillStyle = 'rgba(34, 94, 168, 0.18)';
  ctx.beginPath();
  for (let i = 0; i < series.values.length; i += 1) {
    const x = xFromMeters(routeCumulativeMeters[i]);
    const y = yFromValue(series.values[i]);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.lineTo(xFromMeters(routeCumulativeMeters[series.values.length - 1]), padTop + plotH);
  ctx.lineTo(xFromMeters(routeCumulativeMeters[0]), padTop + plotH);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  for (let i = 0; i < series.values.length; i += 1) {
    const x = xFromMeters(routeCumulativeMeters[i]);
    const y = yFromValue(series.values[i]);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Oasis points projected onto the elevation profile.
  const dots = getOasisChartDots();
  if (dots.length > 0) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    for (const dot of dots) {
      const isActive = dot.id != null && supplyPointKey(dot.id) === highlightedSupplyPointId();
      const x = xFromMeters(Math.max(0, Math.min(dot.alongMeters, totalMeters)));
      const y = yFromValue(dot.elevation);
      ctx.fillStyle = isActive ? '#9e3d22' : '#12836b';
      ctx.beginPath();
      ctx.arc(x, y, isActive ? 4 : 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  // Course points (FIT/RWG ★) projected onto the elevation profile. Drawn as
  // diamond-ish red dots so they read distinctly from the round oasis dots.
  const cpDots = getCoursePointChartDots();
  if (cpDots.length > 0) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#c62f2f';
    for (const dot of cpDots) {
      const x = xFromMeters(Math.max(0, Math.min(dot.alongMeters, totalMeters)));
      const y = yFromValue(dot.elevation);
      ctx.beginPath();
      ctx.moveTo(x, y - 4);
      ctx.lineTo(x + 3.5, y);
      ctx.lineTo(x, y + 4);
      ctx.lineTo(x - 3.5, y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  // Hover guide: full-height vertical line + horizontal line at the elevation
  // value, plus boxed distance / elevation labels at the axes (Google-Maps
  // style crosshair).
  if (Number.isFinite(hoverCumulativeMeters)) {
    const clampedMeters = Math.max(0, Math.min(hoverCumulativeMeters, totalMeters));
    const hx = xFromMeters(clampedMeters);
    const hv = elevationAtRouteMeters(hoverCumulativeMeters);
    ctx.save();
    ctx.strokeStyle = 'rgba(60, 70, 90, 0.85)';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(hx, padTop);
    ctx.lineTo(hx, padTop + plotH);
    ctx.stroke();

    if (Number.isFinite(hv)) {
      const hy = yFromValue(hv);
      ctx.beginPath();
      ctx.moveTo(padLeft, hy);
      ctx.lineTo(cssWidth - padRight, hy);
      ctx.stroke();
      ctx.fillStyle = '#c62f2f';
      ctx.beginPath();
      ctx.arc(hx, hy, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Boxed distance label at the bottom axis, centered on hx.
    const kmText = (clampedMeters / 1000).toFixed(2);
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const distPad = 6;
    const distW = ctx.measureText(kmText).width + distPad * 2;
    const distH = 16;
    const distX = Math.max(padLeft, Math.min(hx - distW / 2, cssWidth - padRight - distW));
    const distY = padTop + plotH - distH;
    ctx.fillStyle = 'rgba(255, 248, 220, 0.96)';
    ctx.strokeStyle = 'rgba(120, 30, 30, 0.7)';
    ctx.lineWidth = 1;
    ctx.fillRect(distX, distY, distW, distH);
    ctx.strokeRect(distX + 0.5, distY + 0.5, distW - 1, distH - 1);
    ctx.fillStyle = '#3a2a16';
    ctx.fillText(kmText, distX + distPad, distY + distH / 2);

    // Boxed elevation / gradient label near the horizontal line, offset from hx.
    if (Number.isFinite(hv)) {
      const hy = yFromValue(hv);
      const gradient = gradientAtRouteMeters(clampedMeters);
      const gradientText = Number.isFinite(gradient)
        ? ` (${gradient >= 0 ? '+' : ''}${(gradient * 100).toFixed(1)}%)`
        : '';
      const eleText = `${Math.round(hv)} m${gradientText}`;
      const elePad = 6;
      const eleW = ctx.measureText(eleText).width + elePad * 2;
      const eleH = 16;
      // Position the label opposite the cursor side so it doesn't overlap the marker.
      const placeRight = hx < cssWidth / 2;
      let eleX = placeRight ? hx + 10 : hx - eleW - 10;
      eleX = Math.max(padLeft + 2, Math.min(eleX, cssWidth - padRight - eleW - 2));
      let eleY = hy - eleH - 4;
      if (eleY < padTop) eleY = hy + 4;
      ctx.fillStyle = 'rgba(255, 248, 220, 0.96)';
      ctx.strokeStyle = 'rgba(120, 30, 30, 0.7)';
      ctx.fillRect(eleX, eleY, eleW, eleH);
      ctx.strokeRect(eleX + 0.5, eleY + 0.5, eleW - 1, eleH - 1);
      ctx.fillStyle = '#3a2a16';
      ctx.fillText(eleText, eleX + elePad, eleY + eleH / 2);
    }
    ctx.restore();
  }

  if (elements.elevationMeta) {
    const km = (totalMeters / 1000).toFixed(totalMeters >= 10000 ? 0 : 1);
    if (Number.isFinite(hoverCumulativeMeters)) {
      const hv = elevationAtRouteMeters(hoverCumulativeMeters);
      const hovKm = (hoverCumulativeMeters / 1000).toFixed(hoverCumulativeMeters >= 10000 ? 0 : 1);
      elements.elevationMeta.innerHTML = `
        <span>${hovKm} km / 全 ${km} km</span>
        <span>標高 ${Number.isFinite(hv) ? Math.round(hv) : '-'} m</span>
        <span>↑ ${Math.round(series.gain)} m / ↓ ${Math.round(series.loss)} m</span>
      `;
    } else {
      elements.elevationMeta.innerHTML = `
        <span>距離 ${km} km</span>
        <span>標高 ${Math.round(series.min)}–${Math.round(series.max)} m</span>
        <span>↑ ${Math.round(series.gain)} m / ↓ ${Math.round(series.loss)} m</span>
      `;
    }
  }
}

/** Updates the shared hover state (cumulative meters along the route). */
function setHoverCumulativeMeters(meters, sourceKind) {
  if (meters === hoverCumulativeMeters && sourceKind === hoverPointerKind) return;
  hoverCumulativeMeters = Number.isFinite(meters) ? meters : null;
  hoverPointerKind = hoverCumulativeMeters === null ? null : sourceKind;
  syncHoverMarker();
  renderElevationChart();
}

/** Builds the hover tooltip HTML for a supply point GeoJSON feature. */
function buildOasisHoverHtml(props) {
  if (!props) return '';
  const distance = Number.isFinite(props.route_distance_m)
    ? `<div class="hover-tip-meta">${Math.round(props.route_distance_m)}m ・ ${escapeHtml(precisionLabel(props.geocode_point_level))}</div>`
    : '';
  return [
    `<div class="hover-tip-chain">${escapeHtml(props.chain || '')}</div>`,
    `<div class="hover-tip-title">${escapeHtml(props.name || '')}</div>`,
    distance
  ].filter(Boolean).join('');
}

/** Builds the hover tooltip HTML for a FIT/RWG course point object. */
function buildCoursePointHoverHtml(cp) {
  if (!cp) return '';
  let meta = '';
  if (routeCoordinates.length >= 2) {
    const proj = window.RouteMath.routeProjection([cp.lon, cp.lat], routeCoordinates, routeCumulativeMeters);
    if (proj) {
      const cumKm = (proj.alongMeters / 1000).toFixed(1);
      const sideLabel = proj.side === 'L' ? '左' : proj.side === 'R' ? '右' : '・';
      meta = `<div class="hover-tip-meta">累計 ${cumKm} km / ${sideLabel}側</div>`;
    }
  }
  return [
    `<div class="hover-tip-chain">${escapeHtml(cp.type || 'course point')}</div>`,
    `<div class="hover-tip-title">${escapeHtml(cp.name || '(無名)')}</div>`,
    meta
  ].filter(Boolean).join('');
}

/** Positions the fixed tooltip near the cursor, clamped to the viewport. */
function showHoverTip(html, clientX, clientY) {
  const tip = elements.hoverTip;
  if (!tip || !html) return;
  tip.innerHTML = html;
  tip.hidden = false;
  const padding = 12;
  const rect = tip.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = clientX + padding;
  let top = clientY + padding;
  if (left + rect.width > vw - 4) left = clientX - padding - rect.width;
  if (top + rect.height > vh - 4) top = clientY - padding - rect.height;
  tip.style.left = `${Math.max(4, left)}px`;
  tip.style.top = `${Math.max(4, top)}px`;
}

/** Hides the floating tooltip. */
function hideHoverTip() {
  const tip = elements.hoverTip;
  if (tip && !tip.hidden) tip.hidden = true;
}

/** Returns viewport pixel coords for an oasis dot on the elevation chart, or null. */
function chartDotViewportXY(alongMeters, elevation) {
  if (!routeElevationSeries) return null;
  const canvas = elements.elevationCanvas;
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  if (!(rect.width > 0)) return null;
  const plotW = Math.max(rect.width - CHART_PAD_LEFT - CHART_PAD_RIGHT, 1);
  const plotH = Math.max(rect.height - CHART_PAD_TOP - CHART_PAD_BOTTOM, 1);
  const series = routeElevationSeries;
  const totalMeters = series.totalDistanceMeters || 1;
  const eleStep = pickElevationStep(Math.max(series.max - series.min, 1));
  const yMin = Math.floor(series.min / eleStep) * eleStep;
  const yMax = Math.ceil(series.max / eleStep) * eleStep;
  const rangeMeters = Math.max(yMax - yMin, 1);
  const canvasX = CHART_PAD_LEFT + (Math.max(0, Math.min(alongMeters, totalMeters)) / totalMeters) * plotW;
  const canvasY = CHART_PAD_TOP + (1 - (elevation - yMin) / rangeMeters) * plotH;
  return { x: rect.left + canvasX, y: rect.top + canvasY };
}

/** Returns viewport pixel coords for a lon/lat on the map, or null when off-screen. */
function mapMarkerViewportXY(lon, lat) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const coord = ol.proj.fromLonLat([lon, lat]);
  const pixel = map.getPixelFromCoordinate(coord);
  if (!pixel) return null;
  const rect = map.getViewport().getBoundingClientRect();
  return { x: rect.left + pixel[0], y: rect.top + pixel[1] };
}

/** Shows the secondary (linked-surface) tooltip near the given viewport coords. */
function showLinkedTip(html, viewportX, viewportY) {
  const tip = elements.hoverTipLinked;
  if (!tip || !html) return;
  tip.innerHTML = html;
  tip.hidden = false;
  const padding = 10;
  const rect = tip.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = viewportX + padding;
  let top = viewportY - rect.height - padding;
  if (left + rect.width > vw - 4) left = viewportX - padding - rect.width;
  if (top < 4) top = viewportY + padding;
  tip.style.left = `${Math.max(4, left)}px`;
  tip.style.top = `${Math.max(4, Math.min(top, vh - rect.height - 4))}px`;
}

/** Hides the secondary tooltip. */
function hideLinkedTip() {
  const tip = elements.hoverTipLinked;
  if (tip && !tip.hidden) tip.hidden = true;
}

/**
 * Marks the given supply point as the hover preview so the chart dot and the
 * map marker both render in the active color. Intentionally does NOT open the
 * click-popup — `previewPoint` (used by the side list) does that, but here we
 * only want the small floating tooltip plus the highlight.
 */
function setHoverPreviewOasis(supplyPointId) {
  const key = supplyPointKey(supplyPointId);
  if (!key || key === hoverPreviewOasisKey) return;
  hoverPreviewOasisKey = key;
  if (key === supplyPointKey(activeSupplyPointId)) {
    syncPointHighlight();
    return;
  }
  previewSupplyPointId = key;
  syncPointHighlight();
}

/** Clears any hover-driven Oasis preview from both the map and the chart. */
function clearHoverPreview() {
  if (!hoverPreviewOasisKey) return;
  const key = hoverPreviewOasisKey;
  hoverPreviewOasisKey = null;
  if (previewSupplyPointId === key) {
    previewSupplyPointId = null;
    syncPointHighlight();
  }
}

/**
 * Wires bidirectional hover linking between the map route and the elevation
 * chart. Pointer events on either surface project the cursor onto the route's
 * cumulative-meter axis and call `setHoverCumulativeMeters`, which redraws the
 * chart guide and updates the on-map marker in one place.
 *
 * Map hover uses `routeProjection`; we bail when the perpendicular distance to
 * the route exceeds a screen-resolution-scaled tolerance so wildly off-route
 * cursors don't drag the marker to the route end.
 */
function bindRouteHoverLinks() {
  // Map → chart + tooltip: project the cursor onto the active route and show a
  // tooltip when the cursor is over an Oasis / course-point marker. Hovering an
  // Oasis also previews it on the map and chart (highlighted dot) without
  // toggling its active selection state.
  map.on('pointermove', (event) => {
    if (event.dragging) {
      hideHoverTip();
      clearHoverPreview();
      return;
    }
    const oeEvent = event.originalEvent;
    const clientX = oeEvent ? oeEvent.clientX : 0;
    const clientY = oeEvent ? oeEvent.clientY : 0;

    const supplyFeature = map.forEachFeatureAtPixel(event.pixel, (candidate) => {
      const props = candidate && candidate.get('properties');
      return props && props.supply_point_id != null ? candidate : undefined;
    });
    if (supplyFeature) {
      const props = supplyFeature.get('properties');
      const html = buildOasisHoverHtml(props);
      showHoverTip(html, clientX, clientY);
      setHoverPreviewOasis(props.supply_point_id);
      // Also surface the same info next to the corresponding chart dot.
      const coord = supplyFeature.getGeometry().getCoordinates();
      const lonLat = ol.proj.toLonLat(coord);
      const proj = window.RouteMath.routeProjection(lonLat, routeCoordinates, routeCumulativeMeters);
      if (proj && routeElevationSeries) {
        const elevation = elevationAtRouteMeters(proj.alongMeters);
        if (Number.isFinite(elevation)) {
          const pos = chartDotViewportXY(proj.alongMeters, elevation);
          if (pos) showLinkedTip(html, pos.x, pos.y);
          else hideLinkedTip();
        } else hideLinkedTip();
      } else hideLinkedTip();
    } else {
      const cpFeature = map.forEachFeatureAtPixel(event.pixel, (candidate) => {
        const cp = candidate && candidate.get('coursePoint');
        if (!cp) return undefined;
        if (disabledCoursePointTypes.has(cp.type)) return undefined;
        return candidate;
      });
      clearHoverPreview();
      if (cpFeature) {
        const cp = cpFeature.get('coursePoint');
        const html = buildCoursePointHoverHtml(cp);
        showHoverTip(html, clientX, clientY);
        // Linked tooltip near the corresponding chart course-point dot.
        if (routeElevationSeries && cp && Number.isFinite(cp.lat) && Number.isFinite(cp.lon)) {
          const proj = window.RouteMath.routeProjection([cp.lon, cp.lat], routeCoordinates, routeCumulativeMeters);
          if (proj) {
            const elevation = elevationAtRouteMeters(proj.alongMeters);
            if (Number.isFinite(elevation)) {
              const pos = chartDotViewportXY(proj.alongMeters, elevation);
              if (pos) showLinkedTip(html, pos.x, pos.y);
              else hideLinkedTip();
            } else hideLinkedTip();
          } else hideLinkedTip();
        } else hideLinkedTip();
      } else {
        hideHoverTip();
        hideLinkedTip();
      }
    }

    if (routeCoordinates.length < 2 || routeCumulativeMeters.length !== routeCoordinates.length) {
      if (hoverPointerKind === 'map') setHoverCumulativeMeters(null, null);
      return;
    }
    const lonLat = ol.proj.toLonLat(event.coordinate);
    const proj = window.RouteMath.routeProjection(lonLat, routeCoordinates, routeCumulativeMeters);
    if (!proj) {
      if (hoverPointerKind === 'map') setHoverCumulativeMeters(null, null);
      return;
    }
    // Tolerance: 12 px in current view, but at least 50 m so very-zoomed-in
    // views still allow a hover band wider than a hair.
    const view = map.getView();
    const resolution = view ? view.getResolution() || 1 : 1;
    const tolerance = Math.max(resolution * 12, 50);
    if (proj.perpMeters > tolerance) {
      if (hoverPointerKind === 'map') setHoverCumulativeMeters(null, null);
      return;
    }
    setHoverCumulativeMeters(proj.alongMeters, 'map');
  });

  const mapViewport = map.getViewport();
  if (mapViewport) {
    mapViewport.addEventListener('mouseleave', () => {
      if (hoverPointerKind === 'map') setHoverCumulativeMeters(null, null);
      hideHoverTip();
      hideLinkedTip();
      clearHoverPreview();
    });
  }

  // Chart → map: convert the cursor's X offset into cumulative meters along
  // the route, then let `setHoverCumulativeMeters` place the marker. The same
  // handler also checks whether the cursor is on an oasis dot — when it is, we
  // show the same tooltip used on the map and preview the point.
  const canvas = elements.elevationCanvas;
  if (canvas) {
    const handleChartMove = (event) => {
      if (!routeElevationSeries || routeCoordinates.length < 2) return;
      const rect = canvas.getBoundingClientRect();
      if (!(rect.width > 0)) return;
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const plotW = Math.max(rect.width - CHART_PAD_LEFT - CHART_PAD_RIGHT, 1);
      const ratio = Math.max(0, Math.min(1, (x - CHART_PAD_LEFT) / plotW));
      const total = routeCumulativeMeters[routeCumulativeMeters.length - 1] || 0;
      setHoverCumulativeMeters(ratio * total, 'chart');

      const hit = findChartDotNear(rect, x, y);
      if (hit && hit.kind === 'oasis' && hit.dot.id != null) {
        const feature = findPointFeature(hit.dot.id);
        if (feature) {
          const html = buildOasisHoverHtml(feature.get('properties'));
          showHoverTip(html, event.clientX, event.clientY);
          setHoverPreviewOasis(hit.dot.id);
          const coord = feature.getGeometry().getCoordinates();
          const lonLat = ol.proj.toLonLat(coord);
          const pos = mapMarkerViewportXY(lonLat[0], lonLat[1]);
          if (pos) showLinkedTip(html, pos.x, pos.y);
          else hideLinkedTip();
          return;
        }
      } else if (hit && hit.kind === 'course') {
        const cp = hit.dot.cp;
        const html = buildCoursePointHoverHtml(cp);
        showHoverTip(html, event.clientX, event.clientY);
        clearHoverPreview();
        const pos = mapMarkerViewportXY(cp.lon, cp.lat);
        if (pos) showLinkedTip(html, pos.x, pos.y);
        else hideLinkedTip();
        return;
      }
      clearHoverPreview();
      hideHoverTip();
      hideLinkedTip();
    };
    canvas.addEventListener('pointermove', handleChartMove);
    canvas.addEventListener('pointerleave', () => {
      if (hoverPointerKind === 'chart') setHoverCumulativeMeters(null, null);
      clearHoverPreview();
      hideHoverTip();
      hideLinkedTip();
    });
  }
}

/**
 * Returns the chart dot closest to the cursor's X position, tagged with its
 * kind so the caller can dispatch tooltip + linked-tooltip logic. The cursor's
 * Y is ignored on purpose — the user only needs to sweep horizontally along
 * the route to surface any point at that distance, regardless of where the
 * dot lands on the elevation curve. `rect` is the canvas bounding rect;
 * (x, _y) are cursor coords relative to that rect.
 *
 * Both Oasis dots and course-point dots are eligible; ties on X distance fall
 * back to course points (they tend to be sparser and more "intentional" — a
 * brevet PC takes priority over a random convenience store next to it).
 */
function findChartDotNear(rect, x, _y) {
  if (!routeElevationSeries) return null;
  const plotW = Math.max(rect.width - CHART_PAD_LEFT - CHART_PAD_RIGHT, 1);
  const totalMeters = routeElevationSeries.totalDistanceMeters || 1;
  const toX = (m) => CHART_PAD_LEFT + (Math.max(0, Math.min(m, totalMeters)) / totalMeters) * plotW;

  const xTolerance = 6;
  // Course points first — they're sparser and more "intentional" (turn /
  // PC / finish markers), so if one is within tolerance prefer it even if an
  // adjacent Oasis is a pixel closer. Only fall back to Oasis when no course
  // point is in range.
  let best = null;
  let bestDx = Infinity;
  for (const dot of getCoursePointChartDots()) {
    const dx = Math.abs(toX(dot.alongMeters) - x);
    if (dx <= xTolerance && dx < bestDx) {
      best = { kind: 'course', dot };
      bestDx = dx;
    }
  }
  if (best) return best;
  for (const dot of getOasisChartDots()) {
    const dx = Math.abs(toX(dot.alongMeters) - x);
    if (dx <= xTolerance && dx < bestDx) {
      best = { kind: 'oasis', dot };
      bestDx = dx;
    }
  }
  return best;
}

/** Reflects the hover state onto the map marker layer. */
function syncHoverMarker() {
  hoverMarkerSource.clear();
  if (!Number.isFinite(hoverCumulativeMeters)) return;
  const lonLat = lonLatAtRouteMeters(hoverCumulativeMeters);
  if (!lonLat) return;
  const feature = new ol.Feature({ geometry: new ol.geom.Point(ol.proj.fromLonLat(lonLat)) });
  hoverMarkerSource.addFeature(feature);
}

/** Parses GPX text and converts it into an OpenLayers route feature. */
function createRouteFeatureFromGpx(gpxText) {
  const parsed = window.GpxParser.parseGpxText(gpxText);
  return {
    coordinates: parsed.geometry.coordinates,
    elevations: Array.isArray(parsed.properties?.elevations) ? parsed.properties.elevations : null,
    feature: routeGeoJsonFormat.readFeature(parsed)
  };
}

/** Builds an OpenLayers route feature from an ordered [lon, lat] coordinate array. */
function createRouteFeatureFromCoords(coordinates, elevations = null) {
  const geojson = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates },
    properties: { point_count: coordinates.length }
  };
  return {
    coordinates,
    elevations: Array.isArray(elevations) ? elevations : null,
    feature: routeGeoJsonFormat.readFeature(geojson)
  };
}

// /api/supply-points の Worker edge cache (caches.default) はキー = URL なので
// 微妙に異なる bbox URL ばかりだと cache hit しない。0.01° (~1km) の格子に
// 量子化することで、同エリアの 2 回目以降は同じ URL になり edge cache 命中。
// over-fetch 分は post-filter の filterMatchedPoints が距離で削るので影響なし。
const SUPPLY_POINTS_BBOX_GRID_DEG = 0.01;

/** Expands the route bbox so the API can return nearby candidate points. */
function expandedBboxForQuery(routeSnapshot, distanceMeters) {
  const routeBbox = window.RouteMath.computeBbox(routeSnapshot);
  const padded = window.RouteMath.expandBbox(routeBbox, Math.max(distanceMeters, 2000));
  return window.RouteMath.quantizeBbox(padded, SUPPLY_POINTS_BBOX_GRID_DEG);
}

// ルートを query param に乗せる時の Douglas-Peucker 許容ズレ (m)。
// 100m なら ブルベ規模の 5000 vertices route が ~200-500 vertex に圧縮
// (約 22B/vertex × 500 = 11KB → 大半は URL 8KB 制限超なので server 側で
// 拒否されたら client filter にフォールバック)。
const ROUTE_PARAM_SIMPLIFY_M = 100;
// Server side のリクエスト URL 上限 (8KB) を超えそうな場合は route 送信を
// 諦めて bbox-only にフォールバック。安全マージンで 7000B。
const ROUTE_PARAM_MAX_BYTES = 7000;

/**
 * 送信用 route param 文字列を作る。ルートが大きすぎる場合は null を返して
 * route param を付けない (bbox-only フォールバック)。
 */
function buildRouteQueryParam(routeSnapshot) {
  if (!Array.isArray(routeSnapshot) || routeSnapshot.length < 2) return null;
  const simplified = window.RouteMath.simplifyDouglasPeucker(
    routeSnapshot,
    ROUTE_PARAM_SIMPLIFY_M
  );
  // lon,lat;lon,lat;... 形式。小数 6 桁 (約 0.1m 精度) で encode。
  const parts = simplified.map(([lon, lat]) => `${lon.toFixed(6)},${lat.toFixed(6)}`);
  const joined = parts.join(';');
  // URLSearchParams で送ると `,` → `%2C` / `;` → `%3B` に展開され実バイト数が
  // 大幅に膨らむ。生文字列長で判定すると 7KB 上限を素通りして 21KB 級まで
  // 行ってしまうので、URLSearchParams で実 encode した byte 長で guard する
  // (CodeRabbit PR #89 指摘)。
  const encodedRoute = new URLSearchParams({ route: joined }).toString();
  const encodedBytes = new TextEncoder().encode(encodedRoute).length;
  if (encodedBytes > ROUTE_PARAM_MAX_BYTES) return null;
  return joined;
}

/** Loads candidate supply points from the local API for the current filters. */
async function fetchCandidatePoints(routeSnapshot, distanceMeters) {
  const bbox = expandedBboxForQuery(routeSnapshot, distanceMeters);
  // server side で route filter してくれるなら client は受信量が激減する。
  // route param が大きすぎて URL 上限を超えそうなら null = bbox-only に。
  const routeParam = buildRouteQueryParam(routeSnapshot);
  const features = [];
  const seenIds = new Set();
  let offset = 0;

  while (true) {
    const params = new URLSearchParams();
    if (bbox) {
      params.set('bbox', bbox.join(','));
    }
    if (routeParam) {
      params.set('route', routeParam);
      // 初回は wide threshold (3000m か user 設定値) で server filter。
      // slider 操作で更に絞る時は client WASM 側で route_distance_m 再 filter
      // するので、ここでは生成的に粗く取って渡す。
      const initialThreshold = Math.max(distanceMeters, 1000);
      params.set('route_distance_m', String(Math.ceil(initialThreshold)));
    }
    params.set('min_point_level', String(DEFAULT_MIN_POINT_LEVEL));
    params.set('limit', String(API_PAGE_LIMIT));
    params.set('offset', String(offset));

    const response = await fetch(`${API_BASE}/supply-points?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`API error (${response.status})`);
    }
    const page = await response.json();
    for (const feature of page.features) {
      const id = feature.properties?.supply_point_id;
      if (id && !seenIds.has(id)) {
        seenIds.add(id);
        features.push(feature);
      }
    }
    // page.raw_count = D1 query が返した filter 前の件数。route filter で
    // 0 件残りでも raw_count == LIMIT なら次ページ存在の可能性あり。
    // 後方互換: raw_count 無いなら従来通り features.length で判断。
    const rawCount = Number.isFinite(page.raw_count) ? page.raw_count : page.features.length;
    if (rawCount < API_PAGE_LIMIT) {
      break;
    }
    offset += API_PAGE_LIMIT;
  }

  return {
    type: 'FeatureCollection',
    features
  };
}

/** Applies the browser-side point-to-route distance filter.
 *
 * 高速化: window.RouterWasm.routeDistances が ready なら Rust WASM で
 * batch 計算 (5-10x 速い)。failed/older browser では従来の JS loop に
 * フォールバック。
 */
function filterMatchedPoints(featureCollection, routeSnapshot, distanceMeters) {
  const features = featureCollection.features;
  const origin = routeSnapshot[0] || null;

  // WASM fast path: 全 shop の距離を 1 回の WASM 呼び出しで batch 計算。
  // 実行時例外も try/catch で握って JS path に逃がす (CodeRabbit PR #89 指摘)。
  if (
    features.length > 0 &&
    routeSnapshot.length >= 2 &&
    window.RouterWasm && window.RouterWasm.routeDistances
  ) {
    try {
      // flatten route: [[lon, lat], ...] → Float64Array [lon0, lat0, lon1, lat1, ...]
      const routeFlat = new Float64Array(routeSnapshot.length * 2);
      for (let i = 0; i < routeSnapshot.length; i += 1) {
        routeFlat[i * 2] = routeSnapshot[i][0];
        routeFlat[i * 2 + 1] = routeSnapshot[i][1];
      }
      const shopFlat = new Float64Array(features.length * 2);
      for (let i = 0; i < features.length; i += 1) {
        const c = features[i].geometry.coordinates;
        shopFlat[i * 2] = c[0];
        shopFlat[i * 2 + 1] = c[1];
      }
      const dists = window.RouterWasm.routeDistances(routeFlat, shopFlat);
      if (!dists || dists.length !== features.length) {
        throw new Error(`route_distances length mismatch: features=${features.length} dists=${dists?.length}`);
      }
      const out = [];
      for (let i = 0; i < features.length; i += 1) {
        const d = dists[i];
        if (d <= distanceMeters) {
          out.push({
            ...features[i],
            properties: {
              ...features[i].properties,
              route_distance_m: d
            }
          });
        }
      }
      out.sort((a, b) => a.properties.route_distance_m - b.properties.route_distance_m);
      return out;
    } catch (err) {
      console.warn('[RouterWasm] routeDistances failed; falling back to JS', err);
      // fall through to JS path
    }
  }

  // JS fallback (routeSnapshot 1 点 or WASM 未初期化)
  return features
    .map((feature) => {
      const distance = routeSnapshot.length >= 2
        ? window.RouteMath.pointToRouteDistanceMeters(feature.geometry.coordinates, routeSnapshot)
        : window.RouteMath.pointToPointDistanceMeters(feature.geometry.coordinates, origin);
      return {
        ...feature,
        properties: {
          ...feature.properties,
          route_distance_m: distance
        }
      };
    })
    .filter((feature) => feature.properties.route_distance_m <= distanceMeters)
    .sort((a, b) => a.properties.route_distance_m - b.properties.route_distance_m);
}

/** Applies result-screen chain and precision filters without requerying the API. */
function applyResultFilters() {
  const chains = new Set(selectedResultChains());
  const precisionFilters = selectedPrecisionFilters();
  const activeId = activeSupplyPointId;
  const previewId = previewSupplyPointId;
  filteredPoints = allMatchedPoints.filter((feature) => {
    const chainMatched = chains.has(feature.properties.chain);
    const precisionMatched = precisionFilters.has(
      Number(feature.properties.geocode_point_level) >= PRECISE_POINT_LEVEL ? 'precise' : 'rough'
    );
    return chainMatched && precisionMatched;
  });
  const visibleIds = new Set(filteredPoints.map((feature) => supplyPointKey(feature.properties.supply_point_id)));
  if (activeId && !visibleIds.has(activeId)) {
    activeSupplyPointId = null;
  }
  if (previewId && !visibleIds.has(previewId)) {
    previewSupplyPointId = null;
  }
  renderMatchedPoints(filteredPoints);
  buildPointList(filteredPoints);
  syncPointHighlight();
  syncPointListSelection();
  const highlightedId = highlightedSupplyPointId();
  const highlightedFeature = highlightedId ? findPointFeature(highlightedId) : null;
  if (highlightedFeature) {
    openPopupForFeature(highlightedFeature);
  } else {
    elements.popup.hidden = true;
    popupOverlay.setPosition(undefined);
  }
  updateSummary(filteredPoints.length);
  syncCueSheetButton();
  fitToVisibleData();
  setStatus(`${filteredPoints.length} 件を表示中`);
}

/** Refreshes API candidates and matched points for the loaded route. */
async function refreshMap(routeSnapshot = [...routeCoordinates]) {
  if (!routeSnapshot.length) {
    setStatus('先に GPX か現在地を指定してください');
    return;
  }

  clearPopup();
  const distanceMeters = selectedDistanceMeters();
  const refreshToken = ++latestRefreshToken;
  setStatus('補給地点を検索中...');

  try {
    const candidates = await fetchCandidatePoints(routeSnapshot, distanceMeters);
    if (refreshToken !== latestRefreshToken) return;

    // Race condition 回避: WASM が後から準備完了した場合に再フィルタできるよう保存。
    lastCandidates = candidates;
    lastRouteSnapshot = routeSnapshot;

    allMatchedPoints = filterMatchedPoints(candidates, routeSnapshot, distanceMeters);
    if (refreshToken !== latestRefreshToken) return;

    // WASM が使用されなかった場合、準備完了時に再フィルタするハンドラを一度だけ登録。
    if (
      !wasmReadyHandlerInstalled &&
      routeSnapshot.length >= 2 &&
      window.RouterWasmReady &&
      !window.RouterWasm
    ) {
      wasmReadyHandlerInstalled = true;
      window.RouterWasmReady.then((wasmAvailable) => {
        if (!wasmAvailable || !window.RouterWasm) return;
        // WASM が利用可能になったので、最新の candidates を WASM で再フィルタ。
        if (lastCandidates && lastRouteSnapshot && lastRouteSnapshot.length >= 2) {
          console.log('[RouterWasm] re-filtering with WASM after late initialization');
          const distanceMeters = selectedDistanceMeters();
          allMatchedPoints = filterMatchedPoints(lastCandidates, lastRouteSnapshot, distanceMeters);
          applyResultFilters();
        }
      }).catch((err) => {
        console.warn('[RouterWasm] readiness check failed:', err);
      });
    }

    applyResultFilters();
  } catch (error) {
    if (refreshToken !== latestRefreshToken) return;
    setStatus('補給地点の取得に失敗しました');
    console.error(error);
  }
}

/** Reads the selected route file (GPX or FIT) and refreshes the map candidates. */
async function handleRouteFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const isFit = /\.fit$/i.test(file.name);
  const loadToken = ++latestRouteLoadToken;
  cancelPendingRefreshes();
  const previousFileName = elements.gpxFileName.textContent;
  try {
    let parsedRoute;
    let coursePoints = [];
    if (isFit) {
      if (!window.FitParser || typeof window.FitParser.parseFitArrayBuffer !== 'function') {
        throw new Error('FIT パーサーの初期化に失敗しました。ページを再読み込みしてください');
      }
      setStatus('FIT を読み込み中...');
      const buffer = await file.arrayBuffer();
      if (loadToken !== latestRouteLoadToken) return;
      const fit = await window.FitParser.parseFitArrayBuffer(buffer);
      if (loadToken !== latestRouteLoadToken) return;
      if (fit.records.length < 2) {
        throw new Error('FIT から 2 点以上の経路座標を抽出できませんでした');
      }
      const coords = fit.records.map((r) => [r.lon, r.lat]);
      const eles = fit.records.map((r) => (Number.isFinite(r.elevationMeters) ? r.elevationMeters : null));
      const hasEle = eles.some((e) => e !== null);
      parsedRoute = createRouteFeatureFromCoords(coords, hasEle ? eles : null);
      coursePoints = fit.coursePoints;
    } else {
      const gpxText = await file.text();
      if (loadToken !== latestRouteLoadToken) return;
      parsedRoute = createRouteFeatureFromGpx(gpxText);
    }
    if (loadToken !== latestRouteLoadToken) return;
    routeFeature = parsedRoute.feature;
    routeCoordinates = parsedRoute.coordinates;
    routeElevations = parsedRoute.elevations || [];
    rebuildRouteElevationCache();
    manualPoints = [];
    currentRwgId = null;
    elements.gpxFileName.textContent = file.name;
    renderRoute(routeFeature);
    renderCoursePoints(coursePoints);
    resetResults();
    updateRoutePointCount();
    fitToVisibleData();
    renderElevationChart();
    syncUrlState();
    const cpInfo = coursePoints.length > 0 ? ` (PC ${coursePoints.length} 件)` : '';
    setStatus(`${isFit ? 'FIT' : 'GPX'} を読み込みました: ${file.name}${cpInfo}`);
    await refreshMap([...routeCoordinates]);
  } catch (error) {
    if (loadToken !== latestRouteLoadToken) return;
    elements.gpxFileName.textContent = previousFileName;
    setStatus(error?.message || 'ルートファイルの読み込みに失敗しました');
    console.error(error);
  }
}

/** Fetches a RideWithGPS public route by URL/id, applies it as the active route. */
async function handleRwgFetch(event) {
  if (event && typeof event.preventDefault === 'function') event.preventDefault();
  if (!window.RwgImport || typeof window.RwgImport.fetchRoute !== 'function') {
    setStatus('RWG インポータの初期化に失敗しました。ページを再読み込みしてください');
    return;
  }
  const value = elements.rwgUrl ? elements.rwgUrl.value : '';
  const id = window.RwgImport.parseRouteId(value);
  if (id == null) {
    setStatus('RWG の URL / ID が認識できません');
    return;
  }
  const loadToken = ++latestRouteLoadToken;
  cancelPendingRefreshes();
  const previousFileName = elements.gpxFileName.textContent;
  if (elements.rwgFetch) elements.rwgFetch.disabled = true;
  try {
    setStatus(`RWG #${id} を取得中...`);
    const rwg = await window.RwgImport.fetchRoute(id);
    if (loadToken !== latestRouteLoadToken) return;
    if (!rwg.records || rwg.records.length < 2) {
      throw new Error('RWG ルートから 2 点以上の経路座標を取得できませんでした');
    }
    const coords = rwg.records.map((r) => [r.lon, r.lat]);
    const eles = rwg.records.map((r) => (Number.isFinite(r.elevationMeters) ? r.elevationMeters : null));
    const hasEle = eles.some((e) => e !== null);
    const parsedRoute = createRouteFeatureFromCoords(coords, hasEle ? eles : null);
    routeFeature = parsedRoute.feature;
    routeCoordinates = parsedRoute.coordinates;
    routeElevations = parsedRoute.elevations || [];
    rebuildRouteElevationCache();
    manualPoints = [];
    const displayName = rwg.name || `RWG #${id}`;
    elements.gpxFileName.textContent = displayName;
    renderRoute(routeFeature);
    renderCoursePoints(rwg.coursePoints || []);
    resetResults();
    updateRoutePointCount();
    fitToVisibleData();
    renderElevationChart();
    const cpInfo = (rwg.coursePoints || []).length > 0 ? ` (PC ${rwg.coursePoints.length} 件)` : '';
    setStatus(`RWG ルートを読み込みました: ${displayName}${cpInfo}`);
    currentRwgId = id;
    syncUrlState();
    await refreshMap([...routeCoordinates]);
  } catch (error) {
    if (loadToken !== latestRouteLoadToken) return;
    elements.gpxFileName.textContent = previousFileName;
    setStatus(error?.message || 'RWG ルートの取得に失敗しました');
    console.error(error);
  } finally {
    if (elements.rwgFetch) elements.rwgFetch.disabled = false;
  }
}

// Worker edge cache に加えて、ブラウザ再訪問でも同 from/to 組合せが即時返却
// されるよう localStorage に結果を寄せておく。座標は ~10m grid に量子化して
// キーを安定化させ、同タップ箇所での re-fetch を防ぐ。
const ROUTE_CACHE_PREFIX = 'rideoasis.route.v1.';
const ROUTE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const ROUTE_COORD_GRID = 0.0001;

function routeCacheKey(from, to) {
  const qz = (v) => Math.round(v / ROUTE_COORD_GRID) * ROUTE_COORD_GRID;
  return `${ROUTE_CACHE_PREFIX}${qz(from[0]).toFixed(4)},${qz(from[1]).toFixed(4)}|${qz(to[0]).toFixed(4)},${qz(to[1]).toFixed(4)}`;
}

function readRouteCache(from, to) {
  const key = routeCacheKey(from, to);
  try {
    const raw = window.localStorage?.getItem(key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj.ts !== 'number' || Date.now() - obj.ts > ROUTE_CACHE_TTL_MS) {
      // 期限切れエントリは読取時に削除して localStorage 容量を圧迫しない
      try { window.localStorage?.removeItem(key); } catch (_) { /* ignore */ }
      return null;
    }
    return obj.payload || null;
  } catch (_) {
    return null;
  }
}

function writeRouteCache(from, to, payload) {
  try {
    const key = routeCacheKey(from, to);
    window.localStorage?.setItem(key, JSON.stringify({ ts: Date.now(), payload }));
  } catch (_) {
    // QuotaExceeded などは無視 (キャッシュは best-effort)
  }
}

/**
 * Calls /api/route. Returns { coordinates } on success, { error, ...meta } when
 * the worker rejects the request with a known reason (e.g. too_far), or null on
 * unknown failures so the caller falls back to a straight line silently.
 *
 * Successful results are kept in localStorage for 1 day to skip the network
 * round-trip on re-visits with (near-)identical click coordinates.
 */
async function fetchCyclingRoute(from, to, loadToken) {
  const cached = readRouteCache(from, to);
  if (cached && Array.isArray(cached.coordinates) && cached.coordinates.length >= 2) {
    return cached;
  }
  const qs = new URLSearchParams({
    from: `${from[0]},${from[1]}`,
    to: `${to[0]},${to[1]}`
  });
  try {
    const res = await fetch(`${API_BASE}/route?${qs.toString()}`, {
      headers: { accept: 'application/geo+json' }
    });
    if (loadToken !== latestRouteLoadToken) return null;
    if (res.status === 422 || res.status === 404) {
      try {
        const body = await res.json();
        return body && body.error ? body : null;
      } catch (_) {
        return null;
      }
    }
    if (!res.ok) return null;
    const json = await res.json();
    const coords = json && json.geometry && Array.isArray(json.geometry.coordinates)
      ? json.geometry.coordinates
      : null;
    if (!coords || coords.length < 2) return null;
    const payload = { coordinates: coords };
    writeRouteCache(from, to, payload);
    return payload;
  } catch (_err) {
    return null;
  }
}

/** Multi-waypoint click handler. 1st click = start, 2nd = goal, 3rd+ = no-op
 *  (waypoint 追加は 灰色 segment のクリックから handleManualSegmentClick で行う)。 */
async function handleManualMapClick(mapCoord) {
  if (manualPoints.length >= 2) return;

  const lonLat = ol.proj.toLonLat(mapCoord);
  manualPoints.push([lonLat[0], lonLat[1]]);

  const loadToken = ++latestRouteLoadToken;
  cancelPendingRefreshes();

  if (manualPoints.length === 1) {
    manualSegments = [];
    renderManualPoints();
    routeFeature = null;
    routeCoordinates = [];
    routeElevations = [];
    rebuildRouteElevationCache();
    resetResults();
    updateRoutePointCount();
    renderElevationChart();
    setStatus('目的地をクリックしてください');
    return;
  }

  // 2 点目: segments を再構築 + pending segment を CH 計算
  rebuildSegmentsFromWaypoints();
  renderManualPoints();
  setStatus('ルート計算中…');
  await computeManualSegments(manualSegments.map((_, i) => i), loadToken);
  if (loadToken !== latestRouteLoadToken) return;
  await applyManualResult(loadToken);
}

/** 灰色 segment クリックで waypoint 挿入。クリック座標を直近の灰色
 *  segment の endpoints の間に挿入し、隣接 segments を再計算する。 */
async function handleManualSegmentClick(segmentIndex, mapCoord) {
  if (segmentIndex < 0 || segmentIndex >= manualSegments.length) return;
  const seg = manualSegments[segmentIndex];
  if (seg.state !== 'gray') return; // computed / pending は分割しない
  const lonLat = ol.proj.toLonLat(mapCoord);
  const insertAt = segmentIndex + 1;
  manualPoints.splice(insertAt, 0, [lonLat[0], lonLat[1]]);

  const loadToken = ++latestRouteLoadToken;
  cancelPendingRefreshes();

  rebuildSegmentsFromWaypoints();
  renderManualPoints();
  setStatus('ルート計算中…');
  // 挿入後は全 pending を再計算 (簡素化、最適化余地: 影響 segments のみ)
  await computeManualSegments(manualSegments.map((_, i) => i), loadToken);
  if (loadToken !== latestRouteLoadToken) return;
  await applyManualResult(loadToken);
}

/** waypoint 削除 (dblclick)。中間点削除なら左右 segment 結合 + 再計算。
 *  端点 (start / goal) 削除は manualPoints から外して状態リセット。 */
async function handleManualWaypointDelete(idx) {
  if (idx < 0 || idx >= manualPoints.length) return;
  manualPoints.splice(idx, 1);
  const loadToken = ++latestRouteLoadToken;
  cancelPendingRefreshes();

  if (manualPoints.length < 2) {
    // start 単独 or 空: route も segments も初期化
    manualSegments = [];
    renderManualPoints();
    routeFeature = null;
    routeCoordinates = [];
    routeElevations = [];
    rebuildRouteElevationCache();
    resetResults();
    updateRoutePointCount();
    renderElevationChart();
    setStatus(manualPoints.length === 0
      ? '地図をタップして出発地を指定してください'
      : '目的地をクリックしてください');
    return;
  }

  rebuildSegmentsFromWaypoints();
  renderManualPoints();
  setStatus('ルート再計算中…');
  await computeManualSegments(manualSegments.map((_, i) => i), loadToken);
  if (loadToken !== latestRouteLoadToken) return;
  await applyManualResult(loadToken);
}

/** waypoint drag 終了時 (Modify interaction の modifyend で呼ばれる)。
 *  drag された waypoint の隣接 segments のみ再計算 (それ以外は維持)。 */
async function handleManualWaypointDragEnd(idx, newLonLat) {
  if (idx < 0 || idx >= manualPoints.length) return;
  manualPoints[idx] = [newLonLat[0], newLonLat[1]];
  const loadToken = ++latestRouteLoadToken;
  cancelPendingRefreshes();

  rebuildSegmentsFromWaypoints();
  renderManualPoints();
  setStatus('ルート再計算中…');
  // 隣接 segments のみ再計算 = idx-1, idx の 2 つ (端なら 1 つ)
  const toCompute = [];
  if (idx - 1 >= 0) toCompute.push(idx - 1);
  if (idx < manualSegments.length) toCompute.push(idx);
  // rebuildSegmentsFromWaypoints が全て pending/gray にしているので、
  // 他 segments の元 state は失われている。簡素化のため全部再計算する。
  // (UX 上 drag は遅くて構わない)
  await computeManualSegments(manualSegments.map((_, i) => i), loadToken);
  if (loadToken !== latestRouteLoadToken) return;
  await applyManualResult(loadToken);
}

/** segments 計算結果を flatten して route 描画・shop 検索を流す共通処理。 */
async function applyManualResult(loadToken) {
  renderManualPoints(); // segments の最新 state で再描画
  const flat = flattenManualRoute();
  routeCoordinates = flat;
  routeFeature = null; // multi-segment では従来の routeFeature は使わない
  routeElevations = [];
  rebuildRouteElevationCache();
  resetResults();
  updateRoutePointCount();
  fitToVisibleData();
  renderElevationChart();

  const total = manualSegments.length;
  const computed = manualSegments.filter((s) => s.state === 'computed').length;
  const gray = manualSegments.filter((s) => s.state === 'gray').length;
  const err = manualSegments.filter((s) => s.state === 'error').length;
  let msg;
  if (gray > 0) {
    msg = `灰色区間 ${gray}/${total} は 25km 超で計算不可。灰色線をクリックして中継点を追加してください`;
  } else if (err > 0) {
    msg = `${err}/${total} 区間で API エラー (直線代用)`;
  } else if (computed === total) {
    msg = total === 1
      ? '自転車ルートを生成しました'
      : `${total} 区間すべてルート計算完了`;
  } else {
    msg = `${computed}/${total} 区間ルート計算完了`;
  }
  setStatus(msg);
  syncUrlState();
  if (loadToken !== latestRouteLoadToken) return;
  // gray / error が残っている間は shop 検索を止める: 灰色区間の直線を
  // pointToRouteDistanceMeters の基準に使うと「実経路と大きく離れた直線
  // 沿いの shop」が候補に出て誤誘導になる (CodeRabbit PR #90 指摘)。
  // ユーザが中継点追加で全 segment computed にしたら自動で再走する。
  if (gray > 0 || err > 0) {
    resetResults();
    return;
  }
  await refreshMap([...routeCoordinates]);
}

/** Resets manual-mode state so the user can re-pick start and goal. */
function resetManualState() {
  manualPoints = [];
  manualSegments = [];
  routeFeature = null;
  routeCoordinates = [];
  routeElevations = [];
  rebuildRouteElevationCache();
  ++latestRouteLoadToken;
  cancelPendingRefreshes();
  clearRouteVisualSources();
  resetResults();
  updateRoutePointCount();
  renderElevationChart();
  if (selectedSourceMode() === 'manual') {
    setStatus('地図をクリックして出発地を指定してください');
  }
}

/** Prompts the browser for the device's current position and refreshes nearby points. */
async function handleCurrentLocation() {
  if (!navigator.geolocation) {
    setStatus('このブラウザは現在地取得に対応していません');
    return;
  }

  const loadToken = ++latestRouteLoadToken;
  cancelPendingRefreshes();
  setStatus('現在地を取得中...');
  try {
    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000
      });
    });
    if (loadToken !== latestRouteLoadToken) return;
    const coord = [position.coords.longitude, position.coords.latitude];
    routeFeature = null;
    routeCoordinates = [coord];
    routeElevations = [];
    rebuildRouteElevationCache();
    manualPoints = [];
    renderCurrentLocation(coord);
    resetResults();
    updateRoutePointCount();
    fitToVisibleData();
    renderElevationChart();
    setStatus('現在地を取得しました');
    syncUrlState();
    await refreshMap([...routeCoordinates]);
  } catch (error) {
    if (loadToken !== latestRouteLoadToken) return;
    const message = error?.code === 1
      ? '位置情報の利用が許可されていません'
      : error?.code === 3
        ? '現在地の取得がタイムアウトしました'
        : '現在地の取得に失敗しました';
    setStatus(message);
    console.error(error);
  }
}

/** Marks rendered point features that fall in the forward cone of the follow heading. */
function applyForwardEmphasis() {
  if (followBearingDeg === null || !followLastCoord) {
    for (const feature of pointSource.getFeatures()) {
      feature.set('forward', false);
    }
    return;
  }
  for (const feature of pointSource.getFeatures()) {
    const lonLat = ol.proj.toLonLat(feature.getGeometry().getCoordinates());
    const target = window.RouteMath.bearingDegrees(followLastCoord, lonLat);
    const inFront = target !== null
      ? window.RouteMath.isWithinHeadingDeg(followBearingDeg, target, FOLLOW_FORWARD_HALF_CONE_DEG)
      : false;
    feature.set('forward', inFront);
  }
}

/** Handles a single follow-mode position update. */
function handleFollowPosition(position) {
  handleFollowPositionAsync(position).catch((error) => {
    console.error('follow position handling error', error);
  });
}

/** Returns true when follow mode is currently active (watch running and toggle on). */
function isFollowActive() {
  return followWatchId !== null && elements.followToggle.checked;
}

/** Async core for follow-mode position updates; called via the sync wrapper above. */
async function handleFollowPositionAsync(position) {
  if (!isFollowActive()) return;

  const coord = [position.coords.longitude, position.coords.latitude];
  if (followLastCoord) {
    const distance = window.RouteMath.pointToPointDistanceMeters(followLastCoord, coord);
    if (distance >= FOLLOW_BEARING_MIN_MOVEMENT_M) {
      const bearing = window.RouteMath.bearingDegrees(followLastCoord, coord);
      if (bearing !== null) followBearingDeg = bearing;
    }
  }
  followLastCoord = coord;

  routeFeature = null;
  routeCoordinates = [coord];
  routeElevations = [];
  rebuildRouteElevationCache();
  renderCurrentLocation(coord);
  updateRoutePointCount();

  const now = Date.now();
  const stale = now - followLastRefreshAt >= FOLLOW_MIN_REFRESH_INTERVAL_MS;
  const firstFollowRefresh = followLastRefreshAt === 0;
  if (stale || firstFollowRefresh) {
    followLastRefreshAt = now;
    await refreshMap([...routeCoordinates]);
    if (!isFollowActive()) return;
  }
  applyForwardEmphasis();
  const bearingLabel = followBearingDeg !== null ? `${Math.round(followBearingDeg)}°` : '方位推定中';
  setStatus(`追従中 (${bearingLabel})`);
}

/** Handles a follow-mode geolocation error and stops the watch. */
function handleFollowError(error) {
  console.error('follow position error', error);
  setStatus('追従モード: 位置情報の取得に失敗しました');
  if (elements.followToggle.checked) {
    elements.followToggle.checked = false;
  }
  stopFollowMode();
}

/** Starts watching the device position and switches to current-location mode. */
async function startFollowMode() {
  if (!navigator.geolocation) {
    setStatus('このブラウザは現在地取得に対応していません');
    elements.followToggle.checked = false;
    return;
  }
  if (followWatchId !== null) return;

  manualPoints = [];
  const currentRadio = document.querySelector('input[name="source-mode"][value="current"]');
  if (currentRadio && !currentRadio.checked) {
    currentRadio.checked = true;
    syncSourceModeUi();
  }
  followLastRefreshAt = 0;
  setStatus('追従モード: 現在地を取得中...');
  followWatchId = navigator.geolocation.watchPosition(
    handleFollowPosition,
    handleFollowError,
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 30000 }
  );
}

/** Stops watching the device position and clears forward emphasis. */
function stopFollowMode() {
  if (followWatchId !== null) {
    navigator.geolocation.clearWatch(followWatchId);
    followWatchId = null;
  }
  followBearingDeg = null;
  followLastCoord = null;
  followLastRefreshAt = 0;
  applyForwardEmphasis();
}

/** Toggle handler for the follow checkbox. */
async function handleFollowToggle() {
  if (elements.followToggle.checked) {
    await startFollowMode();
  } else {
    stopFollowMode();
    setStatus('追従モードを停止しました');
  }
}

/** Reads the currently checked filter inputs into the {chains, precision, cptypes} state shape. */
function readFilterStateForUrl() {
  const allChainInputs = Array.from(document.querySelectorAll('.chain-filters input[type="checkbox"]'));
  const checkedChains = allChainInputs.filter((input) => input.checked).map((input) => input.value);
  const allPrecisionInputs = Array.from(document.querySelectorAll('input[name="precision-filter"]'));
  const checkedPrecisions = allPrecisionInputs.filter((input) => input.checked).map((input) => input.value);
  const cptypesInputs = elements.coursePointTypes
    ? Array.from(elements.coursePointTypes.querySelectorAll('input[type="checkbox"]'))
    : [];
  const checkedCptypes = cptypesInputs.filter((input) => input.checked).map((input) => input.value);

  const chainsAllOn = checkedChains.length === allChainInputs.length;
  const precisionAllOn = checkedPrecisions.length === allPrecisionInputs.length;
  const cptypesAllOn = cptypesInputs.length === 0 || checkedCptypes.length === cptypesInputs.length;
  const cpMaster = elements.showCoursePoints ? elements.showCoursePoints.checked : true;

  return {
    chains: chainsAllOn ? null : checkedChains,
    precision: precisionAllOn ? null : checkedPrecisions,
    cp: cpMaster ? null : false,
    cptypes: cptypesInputs.length === 0 || cptypesAllOn ? null : checkedCptypes
  };
}

/** Replaces the URL query string with the current filter state + active RWG id. */
function syncUrlState() {
  if (!window.UrlState) return;
  const existing = window.UrlState.parseUrlState(window.location.search);
  const filterState = readFilterStateForUrl();
  const next = {
    rwg: Number.isFinite(currentRwgId) ? currentRwgId : null,
    ...filterState,
    extra: existing.extra
  };
  const search = window.UrlState.formatUrlState(next);
  const url = `${window.location.pathname}${search}${window.location.hash}`;
  window.history.replaceState({}, '', url);
}

/** Applies the parsed URL state to checkbox inputs and queues async work (RWG fetch + cptypes). */
function applyUrlStateOnInit() {
  if (!window.UrlState) return;
  const state = window.UrlState.parseUrlState(window.location.search);

  if (Array.isArray(state.chains)) {
    const allow = new Set(state.chains);
    for (const input of document.querySelectorAll('.chain-filters input[type="checkbox"]')) {
      input.checked = allow.has(input.value);
    }
  }
  if (Array.isArray(state.precision)) {
    const allow = new Set(state.precision);
    for (const input of document.querySelectorAll('input[name="precision-filter"]')) {
      input.checked = allow.has(input.value);
    }
  }
  if (state.cp === false && elements.showCoursePoints) {
    elements.showCoursePoints.checked = false;
    coursePointLayer.setVisible(false);
  }
  if (Array.isArray(state.cptypes)) {
    pendingCptypesFilter = state.cptypes;
  }

  if (Number.isFinite(state.rwg) && state.rwg > 0 && elements.rwgUrl) {
    elements.rwgUrl.value = String(state.rwg);
    handleRwgFetch();
  }
}

/** Wires DOM and map click events for the static frontend. */
function bindEvents() {
  for (const input of document.querySelectorAll('input[name="source-mode"]')) {
    input.addEventListener('change', () => {
      const mode = selectedSourceMode();
      if (mode !== 'manual' && manualPoints.length > 0) {
        resetManualState();
      }
      if (mode !== 'current' && elements.followToggle.checked) {
        elements.followToggle.checked = false;
        stopFollowMode();
      }
      syncSourceModeUi();
      if (mode === 'manual' && manualPoints.length === 0 && routeCoordinates.length === 0) {
        setStatus('地図をクリックして出発地を指定してください');
      }
    });
  }
  elements.distanceThreshold.addEventListener('input', syncDistanceUi);
  elements.distanceThreshold.addEventListener('change', () => {
    syncDistanceUi();
    if (routeCoordinates.length) {
      refreshMap();
    }
  });
  for (const input of document.querySelectorAll('.result-filters input[type="checkbox"]')) {
    input.addEventListener('change', () => {
      applyResultFilters();
      syncUrlState();
    });
  }
  elements.gpxFile.addEventListener('change', handleRouteFile);
  if (elements.rwgForm) {
    elements.rwgForm.addEventListener('submit', handleRwgFetch);
  }
  elements.useCurrentLocation.addEventListener('click', handleCurrentLocation);
  elements.followToggle.addEventListener('change', handleFollowToggle);
  elements.manualReset.addEventListener('click', resetManualState);
  elements.pointList.addEventListener('mouseover', (event) => {
    const item = findPointListItem(event.target);
    if (!item || item === findPointListItem(event.relatedTarget)) return;
    previewPoint(item.dataset.supplyPointId);
  });
  elements.pointList.addEventListener('mouseout', (event) => {
    const item = findPointListItem(event.target);
    if (!item || item === findPointListItem(event.relatedTarget)) return;
    clearPreviewPoint(item.dataset.supplyPointId);
  });
  elements.pointList.addEventListener('focusin', (event) => {
    const item = findPointListItem(event.target);
    if (!item) return;
    previewPoint(item.dataset.supplyPointId);
  });
  elements.pointList.addEventListener('focusout', (event) => {
    const item = findPointListItem(event.target);
    if (!item || item === findPointListItem(event.relatedTarget)) return;
    clearPreviewPoint(item.dataset.supplyPointId);
  });
  elements.pointList.addEventListener('click', (event) => {
    const item = findPointListItem(event.target);
    if (!item) return;
    activatePoint(item.dataset.supplyPointId);
  });
  elements.popupClose.addEventListener('click', clearPopup);
  if (elements.cueSheetButton) {
    elements.cueSheetButton.addEventListener('click', openCueSheet);
  }
  if (elements.gpxExportButton) {
    elements.gpxExportButton.addEventListener('click', exportGpx);
  }
  if (elements.showCoursePoints) {
    elements.showCoursePoints.addEventListener('change', () => {
      coursePointLayer.setVisible(elements.showCoursePoints.checked);
      coursePointChartDotsCache.coursePoints = null;
      renderElevationChart();
      if (!elements.showCoursePoints.checked && activePopupKind === 'course-point') {
        clearPopup();
      }
      syncUrlState();
    });
  }
  elements.resultsToggle.addEventListener('click', () => {
    if (desktopMediaQuery && desktopMediaQuery.matches) return;
    const expanded = elements.resultsSheet.classList.toggle('expanded');
    elements.resultsToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    setTimeout(() => {
      map.updateSize();
      renderElevationChart();
    }, 260);
  });
  if (desktopMediaQuery) {
    desktopMediaQuery.addEventListener('change', () => {
      map.updateSize();
      renderElevationChart();
    });
  }
  window.addEventListener('resize', () => {
    map.updateSize();
    renderElevationChart();
  });

  bindRouteHoverLinks();

  map.on('singleclick', (event) => {
    const supplyFeature = map.forEachFeatureAtPixel(
      event.pixel,
      (candidate) => {
        const props = candidate && candidate.get('properties');
        return props && props.supply_point_id != null ? candidate : undefined;
      }
    );
    if (supplyFeature) {
      activatePoint(supplyFeature.get('properties').supply_point_id);
      return;
    }
    const cpFeature = map.forEachFeatureAtPixel(
      event.pixel,
      (candidate) => {
        const cp = candidate && candidate.get('coursePoint');
        if (!cp) return undefined;
        if (disabledCoursePointTypes.has(cp.type)) return undefined;
        return candidate;
      }
    );
    if (cpFeature) {
      activateCoursePoint(cpFeature);
      return;
    }
    clearPopup();
    if (selectedSourceMode() === 'manual') {
      // 灰色 segment 上のクリックは waypoint 挿入 (>25km の分割)
      const segFeature = map.forEachFeatureAtPixel(
        event.pixel,
        (candidate) => {
          if (candidate.get('kind') === 'manual-segment' && candidate.get('segmentState') === 'gray') {
            return candidate;
          }
          return undefined;
        }
      );
      if (segFeature) {
        handleManualSegmentClick(segFeature.get('segmentIndex'), event.coordinate);
        return;
      }
      handleManualMapClick(event.coordinate);
    }
  });

  // waypoint drag = ol.interaction.Translate (Modify より drag に向く;
  // Modify は grab tolerance 10px で掴みづらい / vertex 追加 mode と
  // 競合する。Translate は feature 単位の自由移動)。
  // - filter: manual mode の start/goal/intermediate のみ
  // - translateend で 1 回 (drag 中 every frame ではない) → 隣接 segment 再計算
  // - hover で cursor 'move' に変更 (掴めることを可視化)
  const translateInteraction = new ol.interaction.Translate({
    layers: [endpointLayer],
    filter: (feature) => {
      if (selectedSourceMode() !== 'manual') return false;
      const k = feature.get('kind');
      return k === 'start' || k === 'goal' || k === 'intermediate';
    }
  });
  translateInteraction.on('translateend', (ev) => {
    if (selectedSourceMode() !== 'manual') return;
    ev.features.forEach((feature) => {
      const idx = feature.get('waypointIndex');
      if (!Number.isInteger(idx)) return;
      const coord3857 = feature.getGeometry().getCoordinates();
      const lonLat = ol.proj.toLonLat(coord3857);
      handleManualWaypointDragEnd(idx, lonLat);
    });
  });
  map.addInteraction(translateInteraction);

  // hover で cursor 'move' に。Translate interaction は標準で 'grab/grabbing'
  // を出さないため自前で waypoint hover を検知して切替。
  const mapTarget = map.getTargetElement();
  map.on('pointermove', (event) => {
    if (event.dragging) return;
    const mode = selectedSourceMode();
    if (mode !== 'manual') {
      mapTarget.style.cursor = '';
      return;
    }
    const hit = map.forEachFeatureAtPixel(event.pixel, (candidate) => {
      const k = candidate.get('kind');
      return (k === 'start' || k === 'goal' || k === 'intermediate') ? candidate : undefined;
    });
    mapTarget.style.cursor = hit ? 'move' : '';
  });

  // waypoint dblclick で削除 (端点でなければ)。中間点を削除すると左右の
  // segment が結合され、25km 超ならまた灰色に戻る。
  map.on('dblclick', (event) => {
    if (selectedSourceMode() !== 'manual') return;
    const wpFeature = map.forEachFeatureAtPixel(event.pixel, (candidate) => {
      const k = candidate.get('kind');
      return (k === 'start' || k === 'goal' || k === 'intermediate') ? candidate : undefined;
    });
    if (!wpFeature) return;
    const idx = wpFeature.get('waypointIndex');
    if (!Number.isInteger(idx)) return;
    event.stopPropagation();
    event.preventDefault();
    handleManualWaypointDelete(idx);
  });
}

syncSourceModeUi();
updateRoutePointCount();
syncDistanceUi();
buildPointList([]);
updateSummary(0);
syncCueSheetButton();
bindEvents();
applyUrlStateOnInit();

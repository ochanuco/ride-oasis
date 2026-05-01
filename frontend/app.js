const API_BASE = window.RIDEOASIS_API_BASE || '/api';
// Public Nominatim forbids client-side autocomplete and limits usage to ~1 req/s.
// The geo-search UI uses submit-only firing (Enter / search button) so a single
// user-initiated request is sent per search. For higher volume or hosted use,
// override this with a self-hosted Nominatim or proxy via window.RIDEOASIS_NOMINATIM_BASE.
const PUBLIC_NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_BASE = window.RIDEOASIS_NOMINATIM_BASE || PUBLIC_NOMINATIM_BASE;
const NOMINATIM_PUBLIC_MIN_INTERVAL_MS = 1000;

const PRECISE_POINT_LEVEL = 8;
const DEFAULT_MIN_POINT_LEVEL = 3;
const DISTANCE_OPTIONS = [100, 250, 500, 1000, 2000, 5000, 10000];
const FOLLOW_MIN_REFRESH_INTERVAL_MS = 30000;
const FOLLOW_FORWARD_HALF_CONE_DEG = 90;
const FOLLOW_BEARING_MIN_MOVEMENT_M = 5;
const GEO_SEARCH_MIN_QUERY = 2;
const GEO_SEARCH_LIMIT = 5;

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
  geoSearchForm: document.getElementById('geo-search-form'),
  geoSearchInput: document.getElementById('geo-search-input'),
  geoSearchSubmit: document.getElementById('geo-search-submit'),
  geoSearchClear: document.getElementById('geo-search-clear'),
  geoSearchResults: document.getElementById('geo-search-results'),
  resultsSheet: document.getElementById('results-sheet'),
  resultsToggle: document.getElementById('results-toggle'),
  cueSheetButton: document.getElementById('cue-sheet-button')
};

const CUE_SHEET_STORAGE_KEY = 'rideoasis-cue-sheet';

const desktopMediaQuery = typeof window.matchMedia === 'function'
  ? window.matchMedia('(min-width: 821px)')
  : null;

const routeGeoJsonFormat = new ol.format.GeoJSON({ featureProjection: 'EPSG:3857' });

const routeSource = new ol.source.Vector();
const pointSource = new ol.source.Vector();
const endpointSource = new ol.source.Vector();
const currentLocationSource = new ol.source.Vector();

const routeLayer = new ol.layer.Vector({
  source: routeSource,
  style: new ol.style.Style({
    stroke: new ol.style.Stroke({
      color: '#225ea8',
      width: 4
    })
  })
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

const map = new ol.Map({
  target: 'map',
  layers: [
    new ol.layer.Tile({ source: new ol.source.OSM() }),
    routeLayer,
    pointLayer,
    endpointLayer,
    currentLocationLayer
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
let manualPoints = [];
let allMatchedPoints = [];
let filteredPoints = [];
let activeSupplyPointId = null;
let previewSupplyPointId = null;
const API_PAGE_LIMIT = 10000;
const featureIndex = new Map();
let latestRouteLoadToken = 0;
let latestRefreshToken = 0;
let followWatchId = null;
let followLastCoord = null;
let followBearingDeg = null;
let followLastRefreshAt = 0;
let geoSearchAbortController = null;
let latestGeoSearchToken = 0;
let lastGeoSearchRequestTs = 0;

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
  syncPointHighlight();
  syncPointListSelection();
}

/** Updates summary card for visible results. */
function updateSummary(visibleCount) {
  elements.matchedCount.textContent = String(visibleCount);
}

/** Enables the cue-sheet button only when a route and matched results exist. */
function syncCueSheetButton() {
  if (!elements.cueSheetButton) return;
  const ready = routeCoordinates.length >= 2 && filteredPoints.length > 0;
  elements.cueSheetButton.disabled = !ready;
}

/** Serializes the current cue-sheet input and opens the printable page. */
function openCueSheet() {
  if (routeCoordinates.length < 2 || filteredPoints.length === 0) return;
  try {
    localStorage.setItem(CUE_SHEET_STORAGE_KEY, JSON.stringify({
      routeCoordinates,
      filteredPoints,
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

/** Clears the three drawing sources used for route and location visuals. */
function clearRouteVisualSources() {
  routeSource.clear();
  endpointSource.clear();
  currentLocationSource.clear();
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

/** Renders manual-mode endpoints and the connecting straight LineString. */
function renderManualPoints() {
  clearRouteVisualSources();

  if (manualPoints.length === 0) return;

  const start = new ol.Feature({
    geometry: new ol.geom.Point(ol.proj.fromLonLat(manualPoints[0]))
  });
  start.set('kind', 'start');
  endpointSource.addFeature(start);

  if (manualPoints.length >= 2) {
    const goal = new ol.Feature({
      geometry: new ol.geom.Point(ol.proj.fromLonLat(manualPoints[1]))
    });
    goal.set('kind', 'goal');
    endpointSource.addFeature(goal);

    const line = new ol.Feature({
      geometry: new ol.geom.LineString(manualPoints.map((coord) => ol.proj.fromLonLat(coord)))
    });
    routeSource.addFeature(line);
  }
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
  for (const source of [routeSource, pointSource, endpointSource, currentLocationSource]) {
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

/** Parses GPX text and converts it into an OpenLayers route feature. */
function createRouteFeatureFromGpx(gpxText) {
  const parsed = window.GpxParser.parseGpxText(gpxText);
  return {
    coordinates: parsed.geometry.coordinates,
    feature: routeGeoJsonFormat.readFeature(parsed)
  };
}

/** Expands the route bbox so the API can return nearby candidate points. */
function expandedBboxForQuery(routeSnapshot, distanceMeters) {
  const routeBbox = window.RouteMath.computeBbox(routeSnapshot);
  return window.RouteMath.expandBbox(routeBbox, Math.max(distanceMeters, 2000));
}

/** Loads candidate supply points from the local API for the current filters. */
async function fetchCandidatePoints(routeSnapshot, distanceMeters) {
  const bbox = expandedBboxForQuery(routeSnapshot, distanceMeters);
  const features = [];
  const seenIds = new Set();
  let offset = 0;

  while (true) {
    const params = new URLSearchParams();
    if (bbox) {
      params.set('bbox', bbox.join(','));
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
    if (page.features.length < API_PAGE_LIMIT) {
      break;
    }
    offset += API_PAGE_LIMIT;
  }

  return {
    type: 'FeatureCollection',
    features
  };
}

/** Applies the browser-side point-to-route distance filter. */
function filterMatchedPoints(featureCollection, routeSnapshot, distanceMeters) {
  const origin = routeSnapshot[0] || null;
  return featureCollection.features
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
    allMatchedPoints = filterMatchedPoints(candidates, routeSnapshot, distanceMeters);
    if (refreshToken !== latestRefreshToken) return;
    applyResultFilters();
  } catch (error) {
    if (refreshToken !== latestRefreshToken) return;
    setStatus('補給地点の取得に失敗しました');
    console.error(error);
  }
}

/** Reads the selected GPX file and refreshes the map candidates. */
async function handleGpxFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const loadToken = ++latestRouteLoadToken;
  cancelPendingRefreshes();
  const previousFileName = elements.gpxFileName.textContent;
  try {
    const gpxText = await file.text();
    if (loadToken !== latestRouteLoadToken) return;
    const parsedRoute = createRouteFeatureFromGpx(gpxText);
    if (loadToken !== latestRouteLoadToken) return;
    routeFeature = parsedRoute.feature;
    routeCoordinates = parsedRoute.coordinates;
    manualPoints = [];
    elements.gpxFileName.textContent = file.name;
    renderRoute(routeFeature);
    resetResults();
    updateRoutePointCount();
    fitToVisibleData();
    setStatus(`GPX を読み込みました: ${file.name}`);
    await refreshMap([...routeCoordinates]);
  } catch (error) {
    if (loadToken !== latestRouteLoadToken) return;
    elements.gpxFileName.textContent = previousFileName;
    setStatus(error?.message || 'GPX の読み込みに失敗しました');
    console.error(error);
  }
}

/** Records a manual map click as start (1st click) or goal (2nd click) and refreshes the map. */
async function handleManualMapClick(mapCoord) {
  if (manualPoints.length >= 2) return;

  const lonLat = ol.proj.toLonLat(mapCoord);
  manualPoints.push([lonLat[0], lonLat[1]]);
  renderManualPoints();

  const loadToken = ++latestRouteLoadToken;
  cancelPendingRefreshes();

  if (manualPoints.length === 1) {
    routeFeature = null;
    routeCoordinates = [];
    resetResults();
    updateRoutePointCount();
    setStatus('目的地をクリックしてください');
    return;
  }

  routeFeature = routeSource.getFeatures()[0] || null;
  routeCoordinates = manualPoints.map((coord) => [coord[0], coord[1]]);
  resetResults();
  updateRoutePointCount();
  fitToVisibleData();
  setStatus('手動経路を生成しました');
  if (loadToken !== latestRouteLoadToken) return;
  await refreshMap([...routeCoordinates]);
}

/** Resets manual-mode state so the user can re-pick start and goal. */
function resetManualState() {
  manualPoints = [];
  routeFeature = null;
  routeCoordinates = [];
  ++latestRouteLoadToken;
  cancelPendingRefreshes();
  clearRouteVisualSources();
  resetResults();
  updateRoutePointCount();
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
    manualPoints = [];
    renderCurrentLocation(coord);
    resetResults();
    updateRoutePointCount();
    fitToVisibleData();
    setStatus('現在地を取得しました');
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

/** Empties the geo-search dropdown and hides it. */
function clearGeoSearchResults() {
  elements.geoSearchResults.innerHTML = '';
  elements.geoSearchResults.hidden = true;
}

/** Renders Nominatim search results into the dropdown with two actions per row. */
function renderGeoSearchResults(items) {
  elements.geoSearchResults.innerHTML = '';
  if (!items.length) {
    const empty = document.createElement('li');
    empty.className = 'geo-search-empty';
    empty.textContent = '該当する地名が見つかりません';
    elements.geoSearchResults.appendChild(empty);
    elements.geoSearchResults.hidden = false;
    return;
  }
  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'geo-search-result';

    const name = document.createElement('span');
    name.className = 'geo-search-result-name';
    name.textContent = item.display_name;

    const actions = document.createElement('div');
    actions.className = 'geo-search-result-actions';

    const fitBtn = document.createElement('button');
    fitBtn.type = 'button';
    fitBtn.className = 'geo-search-result-fit';
    fitBtn.textContent = 'この場所を表示';
    fitBtn.addEventListener('click', () => fitMapToPlace(item));

    const searchBtn = document.createElement('button');
    searchBtn.type = 'button';
    searchBtn.className = 'geo-search-result-search';
    searchBtn.textContent = 'ここで検索';
    searchBtn.addEventListener('click', () => searchAtPlace(item));

    actions.append(fitBtn, searchBtn);
    li.append(name, actions);
    elements.geoSearchResults.appendChild(li);
  }
  elements.geoSearchResults.hidden = false;
}

/** Calls Nominatim and returns up to GEO_SEARCH_LIMIT places matching the query. */
async function fetchPlaces(query) {
  if (geoSearchAbortController) {
    geoSearchAbortController.abort();
  }
  geoSearchAbortController = new AbortController();
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    countrycodes: 'jp',
    'accept-language': 'ja',
    limit: String(GEO_SEARCH_LIMIT),
    addressdetails: '0'
  });
  const response = await fetch(`${NOMINATIM_BASE}?${params.toString()}`, {
    signal: geoSearchAbortController.signal,
    headers: { Accept: 'application/json' }
  });
  if (!response.ok) {
    throw new Error(`Nominatim error (${response.status})`);
  }
  return response.json();
}

/** Cancels any in-flight geo-search request and invalidates pending response tokens. */
function cancelPendingGeoSearch() {
  latestGeoSearchToken += 1;
  if (geoSearchAbortController) {
    geoSearchAbortController.abort();
    geoSearchAbortController = null;
  }
}

/** Fits the map view to a Nominatim place's bounding box. */
function fitMapToPlace(item) {
  cancelPendingGeoSearch();
  const bbox = Array.isArray(item.boundingbox) ? item.boundingbox.map(Number) : null;
  if (!bbox || bbox.length !== 4 || !bbox.every(Number.isFinite)) {
    return;
  }
  const [minLat, maxLat, minLon, maxLon] = bbox;
  const extent = ol.proj.transformExtent(
    [minLon, minLat, maxLon, maxLat],
    'EPSG:4326',
    'EPSG:3857'
  );
  map.getView().fit(extent, { padding: [40, 40, 40, 40], duration: 250, maxZoom: 14 });
  clearGeoSearchResults();
}

/** Uses a Nominatim place as the current-location anchor and runs nearby search. */
async function searchAtPlace(item) {
  const lat = Number(item.lat);
  const lon = Number(item.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

  cancelPendingGeoSearch();
  manualPoints = [];

  const currentRadio = document.querySelector('input[name="source-mode"][value="current"]');
  if (currentRadio) {
    currentRadio.checked = true;
    syncSourceModeUi();
  }

  const loadToken = ++latestRouteLoadToken;
  cancelPendingRefreshes();
  if (loadToken !== latestRouteLoadToken) return;
  const coord = [lon, lat];
  routeFeature = null;
  routeCoordinates = [coord];
  renderCurrentLocation(coord);
  resetResults();
  updateRoutePointCount();
  fitToVisibleData();
  setStatus(`「${item.display_name}」を中心に検索中...`);
  clearGeoSearchResults();
  await refreshMap([...routeCoordinates]);
}

/** Updates clear-button visibility on input change. Submission is explicit (Enter / button). */
function handleGeoSearchInput() {
  const query = elements.geoSearchInput.value.trim();
  elements.geoSearchClear.hidden = query.length === 0;
}

/** Submit-only Nominatim search triggered by Enter key or the search button. */
async function handleGeoSearchSubmit(event) {
  event.preventDefault();
  const query = elements.geoSearchInput.value.trim();
  if (query.length < GEO_SEARCH_MIN_QUERY) {
    cancelPendingGeoSearch();
    clearGeoSearchResults();
    return;
  }

  if (NOMINATIM_BASE === PUBLIC_NOMINATIM_BASE) {
    const sinceLast = Date.now() - lastGeoSearchRequestTs;
    if (sinceLast < NOMINATIM_PUBLIC_MIN_INTERVAL_MS) {
      const waitSec = Math.ceil((NOMINATIM_PUBLIC_MIN_INTERVAL_MS - sinceLast) / 100) / 10;
      setStatus(`連続検索を抑制中: ${waitSec}秒後に再試行してください`);
      return;
    }
  }

  cancelPendingGeoSearch();
  lastGeoSearchRequestTs = Date.now();
  const token = ++latestGeoSearchToken;
  try {
    const items = await fetchPlaces(query);
    if (token !== latestGeoSearchToken) return;
    renderGeoSearchResults(items);
  } catch (error) {
    if (error?.name === 'AbortError') return;
    if (token !== latestGeoSearchToken) return;
    console.error(error);
    clearGeoSearchResults();
  }
}

/** Clears the search box and hides results. */
function handleGeoSearchClear() {
  elements.geoSearchInput.value = '';
  elements.geoSearchClear.hidden = true;
  cancelPendingGeoSearch();
  clearGeoSearchResults();
  elements.geoSearchInput.focus();
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
    input.addEventListener('change', applyResultFilters);
  }
  elements.gpxFile.addEventListener('change', handleGpxFile);
  elements.useCurrentLocation.addEventListener('click', handleCurrentLocation);
  elements.followToggle.addEventListener('change', handleFollowToggle);
  elements.manualReset.addEventListener('click', resetManualState);
  elements.geoSearchForm.addEventListener('submit', handleGeoSearchSubmit);
  elements.geoSearchInput.addEventListener('input', handleGeoSearchInput);
  elements.geoSearchClear.addEventListener('click', handleGeoSearchClear);
  document.addEventListener('click', (event) => {
    if (elements.geoSearchResults.hidden) return;
    const target = event.target;
    if (target instanceof Node && (
      elements.geoSearchResults.contains(target) ||
      elements.geoSearchInput.contains(target)
    )) {
      return;
    }
    cancelPendingGeoSearch();
    clearGeoSearchResults();
  });
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
  elements.resultsToggle.addEventListener('click', () => {
    if (desktopMediaQuery && desktopMediaQuery.matches) return;
    const expanded = elements.resultsSheet.classList.toggle('expanded');
    elements.resultsToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    setTimeout(() => map.updateSize(), 260);
  });
  if (desktopMediaQuery) {
    desktopMediaQuery.addEventListener('change', () => {
      map.updateSize();
    });
  }
  window.addEventListener('resize', () => map.updateSize());
  map.on('singleclick', (event) => {
    const feature = map.forEachFeatureAtPixel(event.pixel, (candidate) => candidate);
    const supplyFeature = feature && feature.get('properties') ? feature : null;
    if (supplyFeature) {
      activatePoint(supplyFeature.get('properties').supply_point_id);
      return;
    }
    clearPopup();
    if (selectedSourceMode() === 'manual') {
      handleManualMapClick(event.coordinate);
    }
  });
}

syncSourceModeUi();
updateRoutePointCount();
syncDistanceUi();
buildPointList([]);
updateSummary(0);
syncCueSheetButton();
bindEvents();

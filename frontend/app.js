const API_BASE = window.RIDEOASIS_API_BASE || '/api';

const elements = {
  status: document.getElementById('status'),
  gpxFile: document.getElementById('gpx-file'),
  useCurrentLocation: document.getElementById('use-current-location'),
  distanceThreshold: document.getElementById('distance-threshold'),
  minPointLevel: document.getElementById('min-point-level'),
  refresh: document.getElementById('refresh'),
  pointList: document.getElementById('point-list'),
  routePointCount: document.getElementById('route-point-count'),
  candidateCount: document.getElementById('candidate-count'),
  matchedCount: document.getElementById('matched-count'),
  popup: document.getElementById('popup'),
  popupBody: document.getElementById('popup-body'),
  popupClose: document.getElementById('popup-close')
};

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
    return new ol.style.Style({
      image: new ol.style.Circle({
        radius: active ? 8 : 6,
        fill: new ol.style.Fill({ color: active ? '#9e3d22' : '#12836b' }),
        stroke: new ol.style.Stroke({ color: '#ffffff', width: 1.5 })
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
let matchedPoints = [];
let activeSupplyPointId = null;
const API_PAGE_LIMIT = 10000;

/** Updates the top-right status badge. */
function setStatus(message) {
  elements.status.textContent = message;
}

/** Returns the currently enabled chain filters from the UI. */
function selectedChains() {
  return Array.from(document.querySelectorAll('.chains input[type="checkbox"]:checked')).map(
    (input) => input.value
  );
}

/** Renders the matched supply point list beside the map. */
function buildPointList(points) {
  elements.pointList.innerHTML = '';
  if (points.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'point-item';
    empty.textContent = '近傍の補給地点は見つかりませんでした';
    elements.pointList.appendChild(empty);
    return;
  }

  for (const feature of points) {
    const props = feature.properties;
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'point-item';
    if (props.supply_point_id === activeSupplyPointId) {
      item.classList.add('active');
    }
    item.innerHTML = [
      `<div class="title">${escapeHtml(props.name)}</div>`,
      `<div class="meta">${escapeHtml(props.chain)} · ${Math.round(props.route_distance_m)}m</div>`,
      `<div class="meta">${escapeHtml(props.address_norm || '-')}</div>`
    ].join('');
    item.addEventListener('click', () => activatePoint(props.supply_point_id));
    elements.pointList.appendChild(item);
  }
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

/** Allows only http/https URLs for outbound source links shown in the popup. */
function safeExternalUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.toString();
    }
    return null;
  } catch {
    return null;
  }
}

/** Builds the popup HTML for a selected supply point. */
function buildPopupHtml(props) {
  const safeUrl = safeExternalUrl(props.source_url);
  const link = safeUrl
    ? `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noreferrer">source</a>`
    : '-';
  return [
    `<strong>${escapeHtml(props.name)}</strong>`,
    `<div>chain: ${escapeHtml(props.chain)}</div>`,
    `<div>distance: ${Math.round(props.route_distance_m)}m</div>`,
    `<div>point_level: ${escapeHtml(props.geocode_point_level ?? '-')}</div>`,
    `<div>updated_at: ${escapeHtml(props.updated_at || '-')}</div>`,
    `<div>${escapeHtml(props.address_norm || '-')}</div>`,
    `<div>${link}</div>`
  ].join('');
}

/** Marks one supply point active and opens its popup. */
function activatePoint(supplyPointId) {
  activeSupplyPointId = supplyPointId;
  for (const feature of pointSource.getFeatures()) {
    const isActive = feature.get('properties').supply_point_id === supplyPointId;
    feature.set('active', isActive);
    if (isActive) {
      popupOverlay.setPosition(feature.getGeometry().getCoordinates());
      elements.popupBody.innerHTML = buildPopupHtml(feature.get('properties'));
      elements.popup.hidden = false;
    }
  }
  buildPointList(matchedPoints);
}

/** Clears popup and active marker state. */
function clearPopup() {
  activeSupplyPointId = null;
  elements.popup.hidden = true;
  popupOverlay.setPosition(undefined);
  for (const feature of pointSource.getFeatures()) {
    feature.set('active', false);
  }
  buildPointList(matchedPoints);
}

/** Updates summary cards for route points, candidates, and matches. */
function updateSummary(candidateCount, matchedCount) {
  elements.routePointCount.textContent = routeCoordinates.length ? String(routeCoordinates.length) : '-';
  elements.candidateCount.textContent = String(candidateCount);
  elements.matchedCount.textContent = String(matchedCount);
}

/** Renders the uploaded route and its start/end markers. */
function renderRoute(feature) {
  routeSource.clear();
  endpointSource.clear();
  currentLocationSource.clear();
  routeSource.addFeature(feature);

  const coordinates = feature.getGeometry().getCoordinates();
  if (coordinates.length >= 2) {
    const start = new ol.Feature({
      geometry: new ol.geom.Point(coordinates[0])
    });
    start.set('kind', 'start');
    const goal = new ol.Feature({
      geometry: new ol.geom.Point(coordinates[coordinates.length - 1])
    });
    goal.set('kind', 'goal');
    endpointSource.addFeatures([start, goal]);
  }
}

/** Renders a single current-location marker instead of a route line. */
function renderCurrentLocation(coord) {
  routeSource.clear();
  endpointSource.clear();
  currentLocationSource.clear();
  currentLocationSource.addFeature(
    new ol.Feature({
      geometry: new ol.geom.Point(ol.proj.fromLonLat(coord))
    })
  );
}

/** Converts matched GeoJSON points into OpenLayers features. */
function renderMatchedPoints(points) {
  pointSource.clear();
  const features = points.map((feature) => {
    const olFeature = new ol.Feature({
      geometry: new ol.geom.Point(ol.proj.fromLonLat(feature.geometry.coordinates))
    });
    olFeature.set('properties', feature.properties);
    olFeature.set('active', feature.properties.supply_point_id === activeSupplyPointId);
    return olFeature;
  });
  pointSource.addFeatures(features);
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
  routeCoordinates = parsed.geometry.coordinates;
  return routeGeoJsonFormat.readFeature(parsed);
}

/** Expands the route bbox so the API can return nearby candidate points. */
function expandedBboxForQuery(distanceMeters) {
  const routeBbox = window.RouteMath.computeBbox(routeCoordinates);
  return window.RouteMath.expandBbox(routeBbox, Math.max(distanceMeters, 2000));
}

/** Loads candidate supply points from the local API for the current filters. */
async function fetchCandidatePoints(distanceMeters) {
  const chains = selectedChains();
  const minPointLevel = Number(elements.minPointLevel.value) || 8;
  const bbox = expandedBboxForQuery(distanceMeters);
  const features = [];
  const seenIds = new Set();
  let offset = 0;

  while (true) {
    const params = new URLSearchParams();
    if (bbox) {
      params.set('bbox', bbox.join(','));
    }
    params.set('chains', chains.length > 0 ? chains.join(',') : '');
    params.set('min_point_level', String(minPointLevel));
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
function filterMatchedPoints(featureCollection, distanceMeters) {
  const origin = routeCoordinates[0] || null;
  return featureCollection.features
    .map((feature) => {
      const distance = routeCoordinates.length >= 2
        ? window.RouteMath.pointToRouteDistanceMeters(feature.geometry.coordinates, routeCoordinates)
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

/** Refreshes API candidates and matched points for the loaded route. */
async function refreshMap() {
  if (!routeCoordinates.length) {
    setStatus('先に GPX か現在地を読み込んでください');
    return;
  }

  clearPopup();
  const distanceMeters = Math.max(100, Number(elements.distanceThreshold.value) || 1000);
  setStatus('補給地点を検索中...');

  try {
    const candidates = await fetchCandidatePoints(distanceMeters);
    matchedPoints = filterMatchedPoints(candidates, distanceMeters);
    renderMatchedPoints(matchedPoints);
    buildPointList(matchedPoints);
    updateSummary(candidates.features.length, matchedPoints.length);
    fitToVisibleData();
    setStatus(`${matchedPoints.length} 件の補給地点が ${distanceMeters}m 以内にあります`);
  } catch (error) {
    setStatus('補給地点の取得に失敗しました');
    console.error(error);
  }
}

/** Reads the selected GPX file and triggers the initial map render. */
async function handleGpxFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const gpxText = await file.text();
    routeFeature = createRouteFeatureFromGpx(gpxText);
    renderRoute(routeFeature);
    updateSummary(0, 0);
    fitToVisibleData();
    setStatus(`GPX を読み込みました: ${file.name}`);
    await refreshMap();
  } catch (error) {
    setStatus(error?.message || 'GPX の読み込みに失敗しました');
    console.error(error);
  }
}

/** Prompts the browser for the device's current position and refreshes nearby points. */
async function handleCurrentLocation() {
  if (!navigator.geolocation) {
    setStatus('このブラウザは現在地取得に対応していません');
    return;
  }

  setStatus('現在地を取得中...');
  try {
    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000
      });
    });
    const coord = [position.coords.longitude, position.coords.latitude];
    routeFeature = null;
    routeCoordinates = [coord];
    renderCurrentLocation(coord);
    updateSummary(0, 0);
    fitToVisibleData();
    setStatus('現在地を取得しました');
    await refreshMap();
  } catch (error) {
    const message = error?.code === 1
      ? '位置情報の利用が許可されていません'
      : error?.code === 3
        ? '現在地の取得がタイムアウトしました'
        : '現在地の取得に失敗しました';
    setStatus(message);
    console.error(error);
  }
}

/** Wires DOM and map click events for the static frontend. */
function bindEvents() {
  elements.gpxFile.addEventListener('change', handleGpxFile);
  elements.useCurrentLocation?.addEventListener('click', handleCurrentLocation);
  elements.refresh?.addEventListener('click', refreshMap);
  elements.popupClose.addEventListener('click', clearPopup);
  map.on('singleclick', (event) => {
    const feature = map.forEachFeatureAtPixel(event.pixel, (candidate) => candidate);
    if (!feature || !feature.get('properties')) {
      clearPopup();
      return;
    }
    activatePoint(feature.get('properties').supply_point_id);
  });
}

bindEvents();

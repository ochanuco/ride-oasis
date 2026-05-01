(function () {
  'use strict';

  const STORAGE_KEY = 'rideoasis-cue-sheet';

  /** Reads serialized cue-sheet input from localStorage. */
  function loadInput() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_error) {
      return null;
    }
  }

  /** Escapes text before inserting into innerHTML. */
  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  /** Formats a meter distance as "12.3 km" or "850 m". */
  function formatDistanceMeters(meters) {
    if (!Number.isFinite(meters)) return '-';
    if (meters >= 1000) return `${(meters / 1000).toFixed(meters >= 10000 ? 0 : 1)} km`;
    return `${Math.round(meters)} m`;
  }

  /** Renders the cue-sheet rows derived from route + matched supply points. */
  function render(input) {
    const tbody = document.getElementById('cue-body');
    const metaRouteLength = document.getElementById('meta-route-length');
    const metaDistance = document.getElementById('meta-distance');
    const metaCount = document.getElementById('meta-count');
    const generatedAt = document.getElementById('generated-at');

    if (!input || !Array.isArray(input.routeCoordinates) || input.routeCoordinates.length < 2) {
      generatedAt.textContent = new Date().toLocaleString('ja-JP');
      return;
    }

    const points = Array.isArray(input.filteredPoints) ? input.filteredPoints : [];
    const cum = window.RouteMath.cumulativeDistancesMeters(input.routeCoordinates);
    const totalKm = cum[cum.length - 1] / 1000;

    const rows = points
      .map((feature) => {
        const proj = window.RouteMath.routeProjection(
          feature.geometry.coordinates,
          input.routeCoordinates,
          cum
        );
        return proj ? { feature, proj } : null;
      })
      .filter((row) => row !== null)
      .sort((a, b) => a.proj.alongMeters - b.proj.alongMeters);

    metaRouteLength.innerHTML = `経路長 <strong>${totalKm.toFixed(1)} km</strong>`;
    metaDistance.innerHTML = `近傍距離 <strong>${formatDistanceMeters(input.distanceMeters)}</strong>`;
    metaCount.innerHTML = `補給地点 <strong>${rows.length}</strong> 件`;
    generatedAt.textContent = input.generatedAt
      ? new Date(input.generatedAt).toLocaleString('ja-JP')
      : new Date().toLocaleString('ja-JP');

    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty">条件に一致する補給地点はありません。</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    let prevAlong = 0;
    rows.forEach((row, index) => {
      const { feature, proj } = row;
      const props = feature.properties || {};
      const intervalMeters = proj.alongMeters - prevAlong;
      prevAlong = proj.alongMeters;

      const cumKm = (proj.alongMeters / 1000).toFixed(1);
      const intervalKm = (intervalMeters / 1000).toFixed(1);
      const sideLabel = proj.side === 'L' ? '左' : proj.side === 'R' ? '右' : '・';
      const sideClass = `side side-${proj.side.toLowerCase()}`;

      const tr = document.createElement('tr');
      tr.innerHTML = [
        `<td class="num">${index + 1}</td>`,
        `<td class="num">${cumKm}</td>`,
        `<td class="num">${intervalKm}</td>`,
        `<td class="${sideClass}">${sideLabel}</td>`,
        `<td class="num">${Math.round(proj.perpMeters)}</td>`,
        `<td><span class="chain-badge">${escapeHtml(props.chain || '')}</span><span class="store-name">${escapeHtml(props.name || '-')}</span></td>`,
        `<td>${escapeHtml(props.address_norm || '-')}</td>`
      ].join('');
      tbody.appendChild(tr);
    });
  }

  function bindControls() {
    const printBtn = document.getElementById('print-btn');
    const closeBtn = document.getElementById('close-btn');
    if (printBtn) printBtn.addEventListener('click', () => window.print());
    if (closeBtn) closeBtn.addEventListener('click', () => window.close());
  }

  render(loadInput());
  bindControls();
})();

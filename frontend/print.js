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

  /** Builds a row descriptor (kind + projection) for one supply point feature. */
  function makeSupplyRow(feature, route, cum) {
    const coords = feature?.geometry?.coordinates;
    if (!Array.isArray(coords)) return null;
    const proj = window.RouteMath.routeProjection(coords, route, cum);
    return proj ? { kind: 'supply', proj, props: feature.properties || {} } : null;
  }

  /** Builds a row descriptor for one course point. */
  function makeCoursePointRow(cp, route, cum) {
    if (!cp || !Number.isFinite(cp.lat) || !Number.isFinite(cp.lon)) return null;
    const proj = window.RouteMath.routeProjection([cp.lon, cp.lat], route, cum);
    return proj ? { kind: 'course-point', proj, cp } : null;
  }

  /** Renders one row's cells into innerHTML based on its kind. */
  function renderRow(row, index, intervalKm) {
    const cumKm = (row.proj.alongMeters / 1000).toFixed(1);
    const sideLabel = row.proj.side === 'L' ? '左' : row.proj.side === 'R' ? '右' : '・';
    const sideClass = `side side-${row.proj.side.toLowerCase()}`;

    if (row.kind === 'course-point') {
      const cp = row.cp;
      const desc = cp.description
        ? `<div class="cp-description">${escapeHtml(cp.description)}</div>`
        : '';
      return {
        className: 'cue-row-cp',
        html: [
          `<td class="num">${index + 1}</td>`,
          `<td class="num">${cumKm}</td>`,
          `<td class="num">${intervalKm}</td>`,
          `<td class="${sideClass}">${sideLabel}</td>`,
          `<td class="num">${Math.round(row.proj.perpMeters)}</td>`,
          `<td><span class="chain-badge cp-badge">★ ${escapeHtml(cp.type || 'PC')}</span><span class="store-name">${escapeHtml(cp.name || '(無名)')}</span>${desc}</td>`,
          `<td>—</td>`
        ].join('')
      };
    }

    const props = row.props;
    return {
      className: '',
      html: [
        `<td class="num">${index + 1}</td>`,
        `<td class="num">${cumKm}</td>`,
        `<td class="num">${intervalKm}</td>`,
        `<td class="${sideClass}">${sideLabel}</td>`,
        `<td class="num">${Math.round(row.proj.perpMeters)}</td>`,
        `<td><span class="chain-badge">${escapeHtml(props.chain || '')}</span><span class="store-name">${escapeHtml(props.name || '-')}</span></td>`,
        `<td>${escapeHtml(props.address_norm || '-')}</td>`
      ].join('')
    };
  }

  /** Renders the cue-sheet rows derived from route + matched supply points + course points. */
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

    const supplyFeatures = Array.isArray(input.filteredPoints) ? input.filteredPoints : [];
    const coursePoints = Array.isArray(input.coursePoints) ? input.coursePoints : [];
    const cum = window.RouteMath.cumulativeDistancesMeters(input.routeCoordinates);
    const totalKm = cum[cum.length - 1] / 1000;

    const supplyRows = supplyFeatures.map((f) => makeSupplyRow(f, input.routeCoordinates, cum));
    const cpRows = coursePoints.map((cp) => makeCoursePointRow(cp, input.routeCoordinates, cum));
    const rows = [...supplyRows, ...cpRows]
      .filter((row) => row !== null)
      .sort((a, b) => a.proj.alongMeters - b.proj.alongMeters);

    const supplyCount = rows.filter((r) => r.kind === 'supply').length;
    const cpCount = rows.filter((r) => r.kind === 'course-point').length;
    const cpSummary = cpCount > 0 ? ` / ★ <strong>${cpCount}</strong> 件` : '';

    metaRouteLength.innerHTML = `経路長 <strong>${totalKm.toFixed(1)} km</strong>`;
    metaDistance.innerHTML = `近傍距離 <strong>${formatDistanceMeters(input.distanceMeters)}</strong>`;
    metaCount.innerHTML = `補給地点 <strong>${supplyCount}</strong> 件${cpSummary}`;
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
      const intervalMeters = row.proj.alongMeters - prevAlong;
      prevAlong = row.proj.alongMeters;
      const intervalKm = (intervalMeters / 1000).toFixed(1);
      const tr = document.createElement('tr');
      const rendered = renderRow(row, index, intervalKm);
      if (rendered.className) tr.className = rendered.className;
      tr.innerHTML = rendered.html;
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

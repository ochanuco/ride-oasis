'use strict';

const { MinHeap } = require('./min_heap');
const {
  neighborhoodKeys,
  corridorKeys
} = require('./tile_partition');
const { buildCsr, csrMemoryBytes } = require('./ch_csr');
const { chQueryCsr, unpackChEdgeCsr } = require('./chquery_csr');

const MAX_SNAP_METERS = 500;
// NBA* (symmetric bidirectional A*) で settle は forward A* 比 ~30-40% 減
// (15km: 134k → 84k)。実機実測で 18km まで CPU 内完走、19km は 503。
// 旧 A* cap (15km) → 18km へ拡張。CH 統合で更に伸ばす想定。
const MAX_STRAIGHT_LINE_METERS = 18000;
const MAX_CORRIDOR_TILES = 96;

// COST_FACTOR の最小値 (cycleway = 0.7) を A* heuristic の係数に使う。
// 任意の道路エッジで cost >= length * 0.7 が保証されるため、heuristic
// haversine * 0.7 は admissible で consistent (= 最適性を保証する)。
const MIN_COST_FACTOR = 0.7;

function straightLineMeters(fromLon, fromLat, toLon, toLat) {
  const refLat = (fromLat + toLat) / 2;
  const cosLat = Math.cos((refLat * Math.PI) / 180);
  const dxm = (toLon - fromLon) * cosLat * 111320;
  const dym = (toLat - fromLat) * 110540;
  return Math.hypot(dxm, dym);
}

class TiledRouter {
  constructor(tileLoader, opts = {}) {
    this.tileLoader = tileLoader;
    this.maxSnapMeters = opts.maxSnapMeters ?? MAX_SNAP_METERS;
    this.maxStraightLineMeters = opts.maxStraightLineMeters ?? MAX_STRAIGHT_LINE_METERS;
    this.maxCorridorTiles = opts.maxCorridorTiles ?? MAX_CORRIDOR_TILES;
    this.corridorPadding = opts.corridorPadding ?? 1;
    this.snapNeighborhoodRadius = opts.snapNeighborhoodRadius ?? 1;
    // CH CSR を CH 経路で使うフラグ。true なら chQueryOnView ではなく
    // chQueryCsr を呼び、view ではなく ephemeral CSR で routing する。
    // CSR は per-request build → query → 即 release で memory を抑える。
    this.useChCsr = !!opts.useChCsr;
  }

  async _snap(lon, lat) {
    await this.tileLoader.loadMany(
      neighborhoodKeys(lon, lat, this.snapNeighborhoodRadius)
    );
    return this.tileLoader.grid.nearest(lon, lat, 8);
  }

  async route(fromLon, fromLat, toLon, toLat) {
    const straightLine = straightLineMeters(fromLon, fromLat, toLon, toLat);
    if (straightLine > this.maxStraightLineMeters) {
      return {
        error: 'too_far',
        straight_line_m: straightLine,
        max_straight_line_m: this.maxStraightLineMeters
      };
    }

    const corridor = corridorKeys(fromLon, fromLat, toLon, toLat, this.corridorPadding);
    if (corridor.length > this.maxCorridorTiles) {
      return {
        error: 'corridor_too_large',
        corridor_tiles: corridor.length,
        max_corridor_tiles: this.maxCorridorTiles
      };
    }
    await this.tileLoader.loadMany(corridor);

    const fromSnap = await this._snap(fromLon, fromLat);
    if (!fromSnap || fromSnap.distanceMeters > this.maxSnapMeters) {
      return { error: 'no_nearby_node_from' };
    }
    const toSnap = await this._snap(toLon, toLat);
    if (!toSnap || toSnap.distanceMeters > this.maxSnapMeters) {
      return { error: 'no_nearby_node_to' };
    }

    const view = this.tileLoader.view;
    // タイル v2 (CH 付き) がロードされていれば chQuery を先に試し、結果が
    // 到達不能 (CH 側の level 制約 / via 不在等で失敗) なら NBA* に
    // フォールバックする。NBA* は CH 制約なしの通常探索なので、CH が
    // 解けない問題でも level 関係なく到達可能なら解ける。
    let r;
    let algorithm;
    let chSettled = null;
    let chMs = null;
    let nbaMs = null;
    let csrBytes = null;
    let csrBuildMs = null;
    if (this.useChCsr) {
      // CH CSR path: per-request build of typed-array CSR from raw tile
      // buffers. View ベースの chQueryOnView は Workers 128MB を超過して
      // 1102 で落ちるため、CSR で同等の探索をやって memory を抑える。
      // NBA* fallback も view を使うので view も並行で必要 (上 loadMany 済)。
      // snap タイルも含めて CSR を build (snap で view に積まれたタイルが
      // corridor 外の場合もあるため)。重複は loadBuffers が自然に処理する。
      const tCsr0 = Date.now();
      const snapKeysFrom = neighborhoodKeys(fromLon, fromLat, this.snapNeighborhoodRadius);
      const snapKeysTo = neighborhoodKeys(toLon, toLat, this.snapNeighborhoodRadius);
      const csrKeys = Array.from(new Set([...corridor, ...snapKeysFrom, ...snapKeysTo]));
      const tileBufs = await this.tileLoader.loadBuffers(csrKeys);
      const csr = buildCsr(tileBufs);
      csrBuildMs = Date.now() - tCsr0;
      csrBytes = csrMemoryBytes(csr);
      this._lastCsrNodeCount = csr.nodeCount;
      this._lastCsrEdgeCount = csr.edgeCount;
      const fromIdx = csr.idToIdx.get(fromSnap.id);
      const toIdx = csr.idToIdx.get(toSnap.id);
      if (fromIdx === undefined || toIdx === undefined) {
        // snap node が CSR に居なかった (corridor 外 etc.) → 直接 NBA* に
        const tNba0 = Date.now();
        r = nbaStarOnView(view, fromSnap.id, toSnap.id);
        nbaMs = Date.now() - tNba0;
        algorithm = 'csr-snap-miss-nba';
      } else {
        const tCh0 = Date.now();
        const rc = chQueryCsr(csr, fromIdx, toIdx);
        chMs = Date.now() - tCh0;
        chSettled = rc.settled;
        if (Number.isFinite(rc.distance)) {
          // path expansion: idx 列 → unpack shortcut → osm id 列
          const expanded = [rc.pathIdx[0]];
          for (let i = 1; i < rc.pathIdx.length; i += 1) {
            unpackChEdgeCsr(csr, rc.pathIdx[i - 1], rc.pathIdx[i], expanded);
          }
          const osmPath = expanded.map(i => csr.ids[i]);
          r = {
            distance: rc.distance,
            path: osmPath,
            settled: rc.settled
          };
          algorithm = 'ch-csr';
        } else {
          const tNba0 = Date.now();
          r = nbaStarOnView(view, fromSnap.id, toSnap.id);
          nbaMs = Date.now() - tNba0;
          algorithm = 'ch-csr-fallback-nba';
        }
      }
    } else if (view.hasCh) {
      const tCh0 = Date.now();
      r = chQueryOnView(view, fromSnap.id, toSnap.id);
      chMs = Date.now() - tCh0;
      chSettled = r.settled;
      if (Number.isFinite(r.distance)) {
        algorithm = 'ch';
      } else {
        const tNba0 = Date.now();
        r = nbaStarOnView(view, fromSnap.id, toSnap.id);
        nbaMs = Date.now() - tNba0;
        algorithm = 'ch-fallback-nba';
      }
    } else {
      const tNba0 = Date.now();
      r = nbaStarOnView(view, fromSnap.id, toSnap.id);
      nbaMs = Date.now() - tNba0;
      algorithm = 'nba';
    }
    // Production CH 究明用テレメトリ。Cloudflare Workers の Logs
    // (wrangler tail) で alg / settled / 時間 / CSR memory を観測する。
    if (view.hasCh || this.useChCsr) {
      try {
        console.log(JSON.stringify({
          evt: 'route',
          alg: algorithm,
          ch_ms: chMs,
          ch_settled: chSettled,
          nba_ms: nbaMs,
          csr_build_ms: csrBuildMs,
          csr_bytes: csrBytes,
          csr_node_count: this._lastCsrNodeCount,
          csr_edge_count: this._lastCsrEdgeCount,
          settled: r.settled,
          dist: r.distance,
          nodes: r.path ? r.path.length : null,
          tiles: this.tileLoader.loaded.size,
          view_nodes: view.nodes.size,
          from: fromSnap.id,
          to: toSnap.id
        }));
      } catch (_) { /* logging best-effort */ }
    }
    if (!Number.isFinite(r.distance)) {
      return {
        error: 'unreachable_in_corridor',
        from_node: fromSnap.id,
        to_node: toSnap.id,
        loaded_tiles: this.tileLoader.loaded.size,
        algorithm
      };
    }
    const coordinates = r.path.map((id) => view.nodes.get(id)).filter(Boolean);
    return {
      distance_cost: r.distance,
      node_count: r.path.length,
      settled: r.settled,
      snap_from_m: fromSnap.distanceMeters,
      snap_to_m: toSnap.distanceMeters,
      loaded_tiles: this.tileLoader.loaded.size,
      algorithm,
      coordinates
    };
  }
}

/**
 * CH (Contraction Hierarchies) クエリ。view.hasCh=true (タイル v2) のときに
 * TiledRouter から呼ばれる。標準的な bidirectional CH:
 *   forward Dijkstra: u → v は level[v] > level[u] のエッジだけ relax
 *   backward Dijkstra: u ← v は level[v] > level[u] のエッジだけ relax
 *   ただし partial CH の core (uncontracted top + degree-skipped) 同士の
 *   edge は level 比較を緩めて lateral 移動を許可する (view.cores 参照)
 *   meeting node m で best 更新、両方向の top key が best 以上で停止
 *   (片側 heap が空 = top=Infinity で自動的にその方向は terminated 扱い)
 * パスは meeting から forward/backward の parent を辿って取得し、各エッジ
 * (original or shortcut) を unpackChEdge で再帰的に展開する。via のタイルが
 * 未ロードな場合は inline 座標による直線 segment にフォールバック (描画上は
 * 滑らかになりにくいが、distance は正しい)。
 */
function chQueryOnView(view, startId, goalId) {
  if (startId === goalId) {
    return { distance: 0, path: [startId], settled: 0 };
  }
  const levels = view.levels;
  const startLevel = levels.get(startId);
  const goalLevel = levels.get(goalId);
  if (startLevel === undefined || goalLevel === undefined) {
    return { distance: Infinity, path: [], settled: 0 };
  }
  const distF = new Map([[startId, 0]]);
  const distB = new Map([[goalId, 0]]);
  const parentF = new Map();
  const parentB = new Map();
  const settledF = new Set();
  const settledB = new Set();
  const heapF = new MinHeap();
  const heapB = new MinHeap();
  heapF.push(0, startId);
  heapB.push(0, goalId);
  let best = Infinity;
  let meeting = null;
  const tryMeet = (u, df, db) => {
    const sum = df + db;
    if (sum < best) {
      best = sum;
      meeting = u;
    }
  };
  // Bidirectional CH の停止条件は **direction ごと** に topKey >= best。
  // 旧実装の min(topF, topB) >= best は両側 queue top が best 以上に
  // なるまで掘り続けてしまい (片側が早期に止まれるはずでも止まれない)、
  // CH の利点を潰して Workers CPU 1102 の主因になっていた。
  // 片側 heap が空になっても (空側の top=Infinity)、もう片側は best 確定
  // まで継続する (level chain など片側 heap が早期に枯れるケース対応)。
  //
  // Defensive caps (PR #77 で追加): production の CH CPU 1102 再発を
  // 防ぐため、SETTLED / POPS / TIME を全て上限化。どれか触れたら Infinity
  // を返して TiledRouter 側で NBA* fallback に逃がす。
  // - SETTLED_CAP=12000: ローカル bench で 3km route は ~9763 settle で完走
  //   するので 12000 ならゆとり。中・長距離は元から fallback 想定。
  // - POPS_CAP=50000: heap pop 上限。settled/skipped 含む実工程数のガード
  //   (重複 pop が多発するパスでも settled cap より先に当たらないよう余裕)
  // - TIME_BUDGET_MS=800: 壁時計上限。Workers CPU 計測は壁時計ではないが
  //   handle が CPU を消費しないアイドル待ちを挟むこともあるため二重防御
  const SETTLED_CAP = 12000;
  const POPS_CAP = 50000;
  const TIME_BUDGET_MS = 800;
  const t0 = Date.now();
  let pops = 0;
  while (heapF.size > 0 || heapB.size > 0) {
    if (settledF.size + settledB.size > SETTLED_CAP || pops > POPS_CAP) {
      return { distance: Infinity, path: [], settled: settledF.size + settledB.size };
    }
    // Date.now() は安価だが念のため 1024 pop に 1 度だけチェック。
    if ((pops & 0x3FF) === 0 && (Date.now() - t0) > TIME_BUDGET_MS) {
      return { distance: Infinity, path: [], settled: settledF.size + settledB.size };
    }
    pops += 1;
    const topF = heapF.size > 0 ? heapF.peek().key : Infinity;
    const topB = heapB.size > 0 ? heapB.peek().key : Infinity;
    if (topF >= best && topB >= best) break;
    // 各 direction の termination 後はもう片側のみ伸ばす。両方未終了なら
    // 小さい top を持つ側を expand する古典 bidirectional Dijkstra 戦略。
    const expandF = topF < best && (topB >= best || topF <= topB);
    if (expandF) {
      const { key: d, val: u } = heapF.pop();
      if (settledF.has(u)) continue;
      if (d > (distF.get(u) ?? Infinity)) continue;
      settledF.add(u);
      const db = distB.get(u);
      if (db !== undefined) tryMeet(u, d, db);
      const uLevel = levels.get(u);
      const uIsCore = view.cores ? view.cores.has(u) : false;
      // 1) original edges (view.fwd: edge object 配列)
      const fwdList = view.fwd.get(u);
      if (fwdList) for (let i = 0; i < fwdList.length; i += 1) {
        const e = fwdList[i];
        const vTo = e.to;
        const vLevel = levels.get(vTo);
        if (vLevel === undefined) continue;
        const vIsCore = view.cores ? view.cores.has(vTo) : false;
        const coreCoreLateral = uIsCore && vIsCore;
        if (!coreCoreLateral && vLevel <= uLevel) continue;
        const nd = d + e.cost;
        if (nd < (distF.get(vTo) ?? Infinity)) {
          distF.set(vTo, nd);
          parentF.set(vTo, u);
          heapF.push(nd, vTo);
          const dbTo = distB.get(vTo);
          if (dbTo !== undefined) tryMeet(vTo, nd, dbTo);
        }
      }
      // 2) shortcut edges (view.scFwd: packed flat number 配列 5 値 / edge)
      const scList = view.scFwd && view.scFwd.get(u);
      if (scList) for (let i = 0; i < scList.length; i += 5) {
        const vTo = scList[i];
        const eCost = scList[i + 1];
        const vLevel = levels.get(vTo);
        if (vLevel === undefined) continue;
        const vIsCore = view.cores ? view.cores.has(vTo) : false;
        const coreCoreLateral = uIsCore && vIsCore;
        if (!coreCoreLateral && vLevel <= uLevel) continue;
        const nd = d + eCost;
        if (nd < (distF.get(vTo) ?? Infinity)) {
          distF.set(vTo, nd);
          parentF.set(vTo, u);
          heapF.push(nd, vTo);
          const dbTo = distB.get(vTo);
          if (dbTo !== undefined) tryMeet(vTo, nd, dbTo);
        }
      }
    } else {
      const { key: d, val: u } = heapB.pop();
      if (settledB.has(u)) continue;
      if (d > (distB.get(u) ?? Infinity)) continue;
      settledB.add(u);
      const df = distF.get(u);
      if (df !== undefined) tryMeet(u, df, d);
      const uLevel = levels.get(u);
      const uIsCore = view.cores ? view.cores.has(u) : false;
      // 1) original edges (view.rev: edge object 配列)
      const revList = view.rev.get(u);
      if (revList) for (let i = 0; i < revList.length; i += 1) {
        const e = revList[i];
        const vFrom = e.from;
        const fromLevel = levels.get(vFrom);
        if (fromLevel === undefined) continue;
        const fromIsCore = view.cores ? view.cores.has(vFrom) : false;
        const coreCoreLateral = uIsCore && fromIsCore;
        if (!coreCoreLateral && fromLevel <= uLevel) continue;
        const nd = d + e.cost;
        if (nd < (distB.get(vFrom) ?? Infinity)) {
          distB.set(vFrom, nd);
          parentB.set(vFrom, u);
          heapB.push(nd, vFrom);
          const dfFrom = distF.get(vFrom);
          if (dfFrom !== undefined) tryMeet(vFrom, dfFrom, nd);
        }
      }
      // 2) shortcut edges (view.scRev: packed flat number 配列 5 値 / edge)
      //    scRev[fromId=u-side] には [from, cost, viaId, fromLon, fromLat] が
      //    入っている (scFwd と対称、_mergeBinary の to/from 入替に対応)。
      const scList = view.scRev && view.scRev.get(u);
      if (scList) for (let i = 0; i < scList.length; i += 5) {
        const vFrom = scList[i];
        const eCost = scList[i + 1];
        const fromLevel = levels.get(vFrom);
        if (fromLevel === undefined) continue;
        const fromIsCore = view.cores ? view.cores.has(vFrom) : false;
        const coreCoreLateral = uIsCore && fromIsCore;
        if (!coreCoreLateral && fromLevel <= uLevel) continue;
        const nd = d + eCost;
        if (nd < (distB.get(vFrom) ?? Infinity)) {
          distB.set(vFrom, nd);
          parentB.set(vFrom, u);
          heapB.push(nd, vFrom);
          const dfFrom = distF.get(vFrom);
          if (dfFrom !== undefined) tryMeet(vFrom, dfFrom, nd);
        }
      }
    }
  }
  if (meeting === null || !Number.isFinite(best)) {
    return { distance: Infinity, path: [], settled: settledF.size + settledB.size };
  }
  // forward parents から meeting → start を逆順、backward parents から meeting → goal を順方向
  const fwdNodes = [meeting];
  let cur = meeting;
  while (parentF.has(cur)) {
    cur = parentF.get(cur);
    fwdNodes.push(cur);
  }
  fwdNodes.reverse();
  const backNodes = [];
  cur = meeting;
  while (parentB.has(cur)) {
    cur = parentB.get(cur);
    backNodes.push(cur);
  }
  // shortcut を含む可能性のある (u, v) ペアを original エッジまで展開
  const expanded = [fwdNodes[0]];
  const pushSeg = (uId, vId) => unpackChEdge(view, uId, vId, expanded);
  for (let i = 1; i < fwdNodes.length; i += 1) pushSeg(fwdNodes[i - 1], fwdNodes[i]);
  let prev = fwdNodes[fwdNodes.length - 1];
  for (const next of backNodes) {
    pushSeg(prev, next);
    prev = next;
  }
  return { distance: best, path: expanded, settled: settledF.size + settledB.size };
}

/**
 * Look up an edge (fromId → toId) in the view, considering both original
 * edges (view.fwd) and shortcut edges (view.scFwd packed flat number 配列).
 * Returns { cost, viaId } のような最小限の object、または original edge object
 * を返す (caller は `.viaId` だけ参照すれば良い)。見つからなければ null。
 */
function findEdgeInView(view, fromId, toId) {
  const list = view.fwd.get(fromId);
  if (list) {
    for (const e of list) if (e.to === toId) return e;
  }
  // shortcut store も検索: 5 値 / edge の packed flat [to, cost, viaId, toLon, toLat]
  const scList = view.scFwd && view.scFwd.get(fromId);
  if (scList) {
    for (let i = 0; i < scList.length; i += 5) {
      if (scList[i] === toId) {
        return { to: toId, cost: scList[i + 1], viaId: scList[i + 2], toLon: scList[i + 3], toLat: scList[i + 4] };
      }
    }
  }
  return null;
}

/**
 * Iteratively expand (fromId → toId) into a sequence of original edges via the
 * shortcut tree. Pushes intermediate node IDs (excluding fromId) into `out`.
 * If the via tile is not loaded (edge not found in view), fall back to direct
 * segment so the path stays continuous.
 */
function unpackChEdge(view, fromId, toId, out) {
  const stack = [[fromId, toId]];
  let safety = 0;
  while (stack.length > 0) {
    if (++safety > 1_000_000) break; // 暴走防御
    const [a, b] = stack.pop();
    const e = findEdgeInView(view, a, b);
    if (!e || !e.viaId) {
      out.push(b);
      continue;
    }
    // shortcut: (a, via, b) を逆順スタック (展開後は a→via→b の順で push)
    stack.push([e.viaId, b]);
    stack.push([a, e.viaId]);
  }
}

/**
 * Forward A* on the loaded tile view. Heuristic は直線距離 (緯度補正済
 * Euclidean 近似) × 最小コスト係数 (cycleway の 0.7) で admissible + consistent。
 * Kansai スケールでは球面 haversine との差は無視できる範囲。
 *
 * 内部状態 (dist/parent/settled) は Map/Set ではなく typed array で持つ。
 * ノード ID は密でないため view.nodeIdToIndex で連続インデックスに射影し、
 * Float64Array(N) / Int32Array(N) / Uint8Array(N) を確保する。算術コスト
 * は同じだが、Map.set/get の per-entry GC アロケーションが消えて isolate
 * 内の GC 圧 + warm path レイテンシが下がる。
 */
function aStarOnView(view, startId, goalId) {
  if (startId === goalId) {
    return { distance: 0, path: [startId], settled: 0 };
  }
  const goalCoord = view.nodes.get(goalId);
  if (!goalCoord) {
    return { distance: Infinity, path: [], settled: 0 };
  }
  // 公開関数として旧形式 view (sidecar 未設定) でも落ちないようフォールバック。
  // TileLoader 経由なら 0 コスト (既に同期構築済)。手作り view では view.nodes
  // から都度生成する。
  let idToIdx = view.nodeIdToIndex;
  let idxToId = view.indexToNodeId;
  if (!(idToIdx instanceof Map) || !Array.isArray(idxToId)) {
    idToIdx = new Map();
    idxToId = [];
    for (const id of view.nodes.keys()) {
      idToIdx.set(id, idxToId.length);
      idxToId.push(id);
    }
  }
  const startIdx = idToIdx.get(startId);
  const goalIdx = idToIdx.get(goalId);
  if (startIdx === undefined || goalIdx === undefined) {
    return { distance: Infinity, path: [], settled: 0 };
  }
  const N = idxToId.length;
  const goalLat = goalCoord[1];
  const goalLon = goalCoord[0];

  const dist = new Float64Array(N);
  dist.fill(Infinity);
  const parent = new Int32Array(N);
  parent.fill(-1);
  const settled = new Uint8Array(N);
  const heap = new MinHeap();

  const heuristic = (id) => {
    const c = view.nodes.get(id);
    if (!c) return 0;
    const refLat = (c[1] + goalLat) / 2;
    const cosLat = Math.cos((refLat * Math.PI) / 180);
    const dxm = (goalLon - c[0]) * cosLat * 111320;
    const dym = (goalLat - c[1]) * 110540;
    return Math.hypot(dxm, dym) * MIN_COST_FACTOR;
  };

  dist[startIdx] = 0;
  heap.push(heuristic(startId), startIdx);
  let settledCount = 0;

  while (heap.size > 0) {
    const { val: uIdx } = heap.pop();
    if (settled[uIdx]) continue;
    settled[uIdx] = 1;
    settledCount += 1;
    if (uIdx === goalIdx) break;

    const u = idxToId[uIdx];
    const g = dist[uIdx];
    for (const e of view.fwd.get(u) || []) {
      const vIdx = idToIdx.get(e.to);
      if (vIdx === undefined || settled[vIdx]) continue;
      const ng = g + e.cost;
      if (ng < dist[vIdx]) {
        dist[vIdx] = ng;
        parent[vIdx] = uIdx;
        heap.push(ng + heuristic(e.to), vIdx);
      }
    }
  }

  if (!Number.isFinite(dist[goalIdx])) {
    return { distance: Infinity, path: [], settled: settledCount };
  }

  const path = [];
  let curIdx = goalIdx;
  while (curIdx !== -1) {
    path.push(idxToId[curIdx]);
    curIdx = parent[curIdx];
  }
  path.reverse();

  return { distance: dist[goalIdx], path, settled: settledCount };
}

/**
 * Symmetric bidirectional A* via potential-transformed Dijkstra (Pijls/Post 流)。
 * potential p(v) = (h_f(v) - h_b(v)) / 2 で edge cost を c'(u,v) = c(u,v) - p(u) + p(v)
 * に変換すると、p が consistent (両側 h が consistent + admissible) なら c' >= 0 となり
 * bidi Dijkstra を modified graph に適用して最適性を保ったまま goal-directed 化できる。
 *
 * 真のコスト復元: best_modified = best_true + p(goal) - p(start) なので
 *   best_true = best_modified - p(goal) + p(start)
 */
function nbaStarOnView(view, startId, goalId) {
  if (startId === goalId) {
    return { distance: 0, path: [startId], settled: 0 };
  }
  const startCoord = view.nodes.get(startId);
  const goalCoord = view.nodes.get(goalId);
  if (!startCoord || !goalCoord) {
    return { distance: Infinity, path: [], settled: 0 };
  }

  let idToIdx = view.nodeIdToIndex;
  let idxToId = view.indexToNodeId;
  if (!(idToIdx instanceof Map) || !Array.isArray(idxToId)) {
    idToIdx = new Map();
    idxToId = [];
    for (const id of view.nodes.keys()) {
      idToIdx.set(id, idxToId.length);
      idxToId.push(id);
    }
  }
  const startIdx = idToIdx.get(startId);
  const goalIdx = idToIdx.get(goalId);
  if (startIdx === undefined || goalIdx === undefined) {
    return { distance: Infinity, path: [], settled: 0 };
  }

  const N = idxToId.length;
  const startLon = startCoord[0];
  const startLat = startCoord[1];
  const goalLon = goalCoord[0];
  const goalLat = goalCoord[1];

  const haversineTo = (c, refLon, refLat) => {
    const meanLat = (c[1] + refLat) / 2;
    const cosLat = Math.cos((meanLat * Math.PI) / 180);
    const dxm = (refLon - c[0]) * cosLat * 111320;
    const dym = (refLat - c[1]) * 110540;
    return Math.hypot(dxm, dym);
  };
  const hToGoal = (c) => haversineTo(c, goalLon, goalLat) * MIN_COST_FACTOR;
  const hFromStart = (c) => haversineTo(c, startLon, startLat) * MIN_COST_FACTOR;

  // potentials は node ごと 2 度以上参照するので Float64Array にキャッシュ
  const potentials = new Float64Array(N);
  const pComputed = new Uint8Array(N);
  const getP = (idx) => {
    if (pComputed[idx]) return potentials[idx];
    const c = view.nodes.get(idxToId[idx]);
    const p = c ? (hToGoal(c) - hFromStart(c)) / 2 : 0;
    potentials[idx] = p;
    pComputed[idx] = 1;
    return p;
  };
  const pStart = getP(startIdx);
  const pGoal = getP(goalIdx);

  const distF = new Float64Array(N);
  distF.fill(Infinity);
  const distB = new Float64Array(N);
  distB.fill(Infinity);
  const parentF = new Int32Array(N);
  parentF.fill(-1);
  const parentB = new Int32Array(N);
  parentB.fill(-1);
  const settledF = new Uint8Array(N);
  const settledB = new Uint8Array(N);

  distF[startIdx] = 0;
  distB[goalIdx] = 0;
  const heapF = new MinHeap();
  const heapB = new MinHeap();
  heapF.push(0, startIdx);
  heapB.push(0, goalIdx);

  let bestTrue = Infinity;
  let meetingIdx = -1;
  let settledCount = 0;
  // modified スケールでの best (停止条件で使う)
  const stopThreshold = () =>
    bestTrue === Infinity ? Infinity : bestTrue + pGoal - pStart;

  const tryMeet = (idx) => {
    if (distF[idx] === Infinity || distB[idx] === Infinity) return;
    const trueSum = distF[idx] + distB[idx] + pStart - pGoal;
    if (trueSum < bestTrue) {
      bestTrue = trueSum;
      meetingIdx = idx;
    }
  };

  while (heapF.size > 0 && heapB.size > 0) {
    if (heapF.peek().key + heapB.peek().key >= stopThreshold()) break;

    if (heapF.peek().key <= heapB.peek().key) {
      const { val: uIdx } = heapF.pop();
      if (settledF[uIdx]) continue;
      settledF[uIdx] = 1;
      settledCount += 1;
      tryMeet(uIdx);
      const u = idxToId[uIdx];
      const pU = getP(uIdx);
      for (const e of view.fwd.get(u) || []) {
        const vIdx = idToIdx.get(e.to);
        if (vIdx === undefined || settledF[vIdx]) continue;
        const pV = getP(vIdx);
        // consistent な h なら modCost >= 0。浮動小数誤差で僅かに負値に
        // なる/heuristic がデータ的に微妙に inconsistent な辺で edge を捨て
        // 経路欠落するのを避けるため、0 にクランプして必ず辺を relax する。
        const modCost = Math.max(0, e.cost - pU + pV);
        const nd = distF[uIdx] + modCost;
        if (nd < distF[vIdx]) {
          distF[vIdx] = nd;
          parentF[vIdx] = uIdx;
          heapF.push(nd, vIdx);
          tryMeet(vIdx);
        }
      }
    } else {
      const { val: uIdx } = heapB.pop();
      if (settledB[uIdx]) continue;
      settledB[uIdx] = 1;
      settledCount += 1;
      tryMeet(uIdx);
      const u = idxToId[uIdx];
      const pU = getP(uIdx);
      for (const e of view.rev.get(u) || []) {
        const aIdx = idToIdx.get(e.from);
        if (aIdx === undefined || settledB[aIdx]) continue;
        const pA = getP(aIdx);
        const modCost = Math.max(0, e.cost - pA + pU);
        const nd = distB[uIdx] + modCost;
        if (nd < distB[aIdx]) {
          distB[aIdx] = nd;
          parentB[aIdx] = uIdx;
          heapB.push(nd, aIdx);
          tryMeet(aIdx);
        }
      }
    }
  }

  if (meetingIdx === -1 || !Number.isFinite(bestTrue)) {
    return { distance: Infinity, path: [], settled: settledCount };
  }

  const pathF = [];
  let cur = meetingIdx;
  while (cur !== -1) {
    pathF.push(idxToId[cur]);
    cur = parentF[cur];
  }
  pathF.reverse();
  const pathB = [];
  cur = parentB[meetingIdx];
  while (cur !== -1) {
    pathB.push(idxToId[cur]);
    cur = parentB[cur];
  }

  return {
    distance: bestTrue,
    path: pathF.concat(pathB),
    settled: settledCount
  };
}

function bidiDijkstraOnView(view, startId, goalId) {
  if (startId === goalId) {
    return { distance: 0, path: [startId], settled: 0 };
  }
  const distF = new Map([[startId, 0]]);
  const distB = new Map([[goalId, 0]]);
  const parentF = new Map();
  const parentB = new Map();
  const settledF = new Set();
  const settledB = new Set();
  const heapF = new MinHeap();
  const heapB = new MinHeap();
  heapF.push(0, startId);
  heapB.push(0, goalId);
  let best = Infinity;
  let meeting = null;
  const tryMeet = (u, df, db) => {
    const sum = df + db;
    if (sum < best) {
      best = sum;
      meeting = u;
    }
  };
  while (heapF.size > 0 && heapB.size > 0) {
    if (heapF.peek().key + heapB.peek().key >= best) break;
    if (heapF.peek().key <= heapB.peek().key) {
      const { key: d, val: u } = heapF.pop();
      if (settledF.has(u)) continue;
      if (d > (distF.get(u) ?? Infinity)) continue;
      settledF.add(u);
      const db = distB.get(u);
      if (db !== undefined) tryMeet(u, d, db);
      for (const e of view.fwd.get(u) || []) {
        if (settledF.has(e.to)) continue;
        const nd = d + e.cost;
        if (nd < (distF.get(e.to) ?? Infinity)) {
          distF.set(e.to, nd);
          parentF.set(e.to, u);
          heapF.push(nd, e.to);
          const dbTo = distB.get(e.to);
          if (dbTo !== undefined) tryMeet(e.to, nd, dbTo);
        }
      }
    } else {
      const { key: d, val: u } = heapB.pop();
      if (settledB.has(u)) continue;
      if (d > (distB.get(u) ?? Infinity)) continue;
      settledB.add(u);
      const df = distF.get(u);
      if (df !== undefined) tryMeet(u, df, d);
      for (const e of view.rev.get(u) || []) {
        if (settledB.has(e.from)) continue;
        const nd = d + e.cost;
        if (nd < (distB.get(e.from) ?? Infinity)) {
          distB.set(e.from, nd);
          parentB.set(e.from, u);
          heapB.push(nd, e.from);
          const dfFrom = distF.get(e.from);
          if (dfFrom !== undefined) tryMeet(e.from, dfFrom, nd);
        }
      }
    }
  }
  if (meeting === null || !Number.isFinite(best)) {
    return { distance: Infinity, path: [], settled: settledF.size + settledB.size };
  }
  const pathF = [];
  let cur = meeting;
  while (cur !== undefined) {
    pathF.push(cur);
    cur = parentF.get(cur);
  }
  pathF.reverse();
  const pathB = [];
  cur = parentB.get(meeting);
  while (cur !== undefined) {
    pathB.push(cur);
    cur = parentB.get(cur);
  }
  return {
    distance: best,
    path: pathF.concat(pathB),
    settled: settledF.size + settledB.size
  };
}

module.exports = {
  TiledRouter,
  MAX_SNAP_METERS,
  MAX_STRAIGHT_LINE_METERS,
  MAX_CORRIDOR_TILES,
  MIN_COST_FACTOR,
  aStarOnView,
  nbaStarOnView,
  chQueryOnView,
  unpackChEdge,
  bidiDijkstraOnView,
  straightLineMeters
};

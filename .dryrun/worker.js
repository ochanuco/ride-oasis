var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// lib/map_data.js
var require_map_data = __commonJS({
  "lib/map_data.js"(exports, module) {
    var DEFAULT_MART_DATASET = "rideoasis_mart";
    var DEFAULT_MART_TABLE = "rideoasis_supply_points";
    var DEFAULT_SQLITE_PATH = ".local/rideoasis-map.db";
    var DEFAULT_API_PORT = 8787;
    var DEFAULT_MIN_POINT_LEVEL = 8;
    var DEFAULT_LIMIT = 5e3;
    var MAX_LIMIT = 1e4;
    var ValidationError2 = class extends Error {
      static {
        __name(this, "ValidationError");
      }
      constructor(message) {
        super(message);
        this.name = "ValidationError";
      }
    };
    var SQLITE_COLUMNS = [
      "supply_point_id",
      "chain",
      "store_id",
      "name",
      "lat",
      "lng",
      "address_norm",
      "geocode_level",
      "geocode_point_level",
      "source_url",
      "updated_at"
    ];
    var API_COLUMNS = [
      "supply_point_id",
      "chain",
      "name",
      "lat",
      "lng",
      "address_norm",
      "geocode_point_level"
    ];
    function sanitizeSqlitePath(value) {
      if (!value) {
        throw new ValidationError2("sqlite path is required");
      }
      return String(value);
    }
    __name(sanitizeSqlitePath, "sanitizeSqlitePath");
    function readValue(argv, index, flag) {
      const value = argv[index + 1];
      if (!value || String(value).startsWith("-")) {
        throw new ValidationError2(`${flag} requires a value`);
      }
      return value;
    }
    __name(readValue, "readValue");
    function parseExportArgs(argv = process.argv) {
      const args = {
        project: null,
        dataset: DEFAULT_MART_DATASET,
        table: DEFAULT_MART_TABLE,
        output: DEFAULT_SQLITE_PATH,
        location: null,
        dryRun: false
      };
      for (let i = 2; i < argv.length; i += 1) {
        const token = argv[i];
        if (token === "--project") {
          args.project = readValue(argv, i, "--project");
          i += 1;
          continue;
        }
        if (token === "--dataset") {
          args.dataset = readValue(argv, i, "--dataset");
          i += 1;
          continue;
        }
        if (token === "--table") {
          args.table = readValue(argv, i, "--table");
          i += 1;
          continue;
        }
        if (token === "--output") {
          args.output = readValue(argv, i, "--output");
          i += 1;
          continue;
        }
        if (token === "--location") {
          args.location = readValue(argv, i, "--location");
          i += 1;
          continue;
        }
        if (token === "--dry-run") {
          args.dryRun = true;
          continue;
        }
        if (token === "--help" || token === "-h") {
          return { help: true };
        }
        throw new ValidationError2(`unknown arg: ${token}`);
      }
      if (!args.project) throw new ValidationError2("--project is required");
      return { help: false, ...args };
    }
    __name(parseExportArgs, "parseExportArgs");
    function parseServerArgs(argv = process.argv) {
      const args = {
        db: DEFAULT_SQLITE_PATH,
        port: DEFAULT_API_PORT
      };
      for (let i = 2; i < argv.length; i += 1) {
        const token = argv[i];
        if (token === "--db") {
          args.db = readValue(argv, i, "--db");
          i += 1;
          continue;
        }
        if (token === "--port") {
          const value = Number(readValue(argv, i, "--port"));
          if (!Number.isInteger(value) || value <= 0) {
            throw new ValidationError2("--port must be a positive integer");
          }
          args.port = value;
          i += 1;
          continue;
        }
        if (token === "--help" || token === "-h") {
          return { help: true };
        }
        throw new ValidationError2(`unknown arg: ${token}`);
      }
      return { help: false, ...args };
    }
    __name(parseServerArgs, "parseServerArgs");
    function sanitizeId(value, label) {
      if (!/^[A-Za-z0-9_]+$/.test(value)) {
        throw new ValidationError2(`invalid ${label}: ${value}`);
      }
      return value;
    }
    __name(sanitizeId, "sanitizeId");
    function validateProjectId(value) {
      const projectId = String(value || "");
      if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) {
        throw new ValidationError2(`invalid project: ${projectId}`);
      }
      return projectId;
    }
    __name(validateProjectId, "validateProjectId");
    function buildBqSelectSql(project, dataset, table) {
      const validatedProject = validateProjectId(project);
      const safeDataset = sanitizeId(dataset, "dataset");
      const safeTable = sanitizeId(table, "table");
      return [
        "SELECT",
        "  supply_point_id,",
        "  chain,",
        "  store_id,",
        "  name,",
        "  lat,",
        "  lng,",
        "  address_norm,",
        "  geocode_level,",
        "  geocode_point_level,",
        "  source_url,",
        "  updated_at",
        `FROM \`${validatedProject}.${safeDataset}.${safeTable}\``,
        "WHERE lat IS NOT NULL AND lng IS NOT NULL",
        "ORDER BY supply_point_id"
      ].join("\n");
    }
    __name(buildBqSelectSql, "buildBqSelectSql");
    function createSchemaSql() {
      return [
        "CREATE TABLE IF NOT EXISTS supply_points (",
        "  supply_point_id TEXT PRIMARY KEY,",
        "  chain TEXT NOT NULL,",
        "  store_id TEXT NOT NULL,",
        "  name TEXT NOT NULL,",
        "  lat REAL NOT NULL,",
        "  lng REAL NOT NULL,",
        "  address_norm TEXT,",
        "  geocode_level INTEGER,",
        "  geocode_point_level INTEGER,",
        "  source_url TEXT,",
        "  updated_at TEXT",
        ")",
        ";",
        "CREATE INDEX IF NOT EXISTS idx_supply_points_chain ON supply_points(chain);",
        "CREATE INDEX IF NOT EXISTS idx_supply_points_point_level ON supply_points(geocode_point_level);",
        "CREATE INDEX IF NOT EXISTS idx_supply_points_lat_lng ON supply_points(lat, lng);"
      ].join("\n");
    }
    __name(createSchemaSql, "createSchemaSql");
    function normalizePointRow(row) {
      if (!row || row.lat == null || row.lng == null) {
        return null;
      }
      return {
        supply_point_id: String(row.supply_point_id),
        chain: String(row.chain),
        store_id: String(row.store_id),
        name: String(row.name || row.supply_point_id),
        lat: Number(row.lat),
        lng: Number(row.lng),
        address_norm: row.address_norm == null ? null : String(row.address_norm),
        geocode_level: row.geocode_level == null ? null : Number(row.geocode_level),
        geocode_point_level: row.geocode_point_level == null ? null : Number(row.geocode_point_level),
        source_url: row.source_url == null ? null : String(row.source_url),
        updated_at: row.updated_at == null ? null : String(row.updated_at)
      };
    }
    __name(normalizePointRow, "normalizePointRow");
    function createUpsertStatement(database) {
      return database.prepare(`
    INSERT INTO supply_points (
      supply_point_id,
      chain,
      store_id,
      name,
      lat,
      lng,
      address_norm,
      geocode_level,
      geocode_point_level,
      source_url,
      updated_at
    ) VALUES (
      :supply_point_id,
      :chain,
      :store_id,
      :name,
      :lat,
      :lng,
      :address_norm,
      :geocode_level,
      :geocode_point_level,
      :source_url,
      :updated_at
    )
    ON CONFLICT(supply_point_id) DO UPDATE SET
      chain = excluded.chain,
      store_id = excluded.store_id,
      name = excluded.name,
      lat = excluded.lat,
      lng = excluded.lng,
      address_norm = excluded.address_norm,
      geocode_level = excluded.geocode_level,
      geocode_point_level = excluded.geocode_point_level,
      source_url = excluded.source_url,
      updated_at = excluded.updated_at
  `);
    }
    __name(createUpsertStatement, "createUpsertStatement");
    function parseBBox(value) {
      if (!value) return null;
      const parts = String(value).split(",").map((v) => Number(v.trim()));
      if (parts.length !== 4 || parts.some((v) => !Number.isFinite(v))) {
        throw new ValidationError2("bbox must be minLng,minLat,maxLng,maxLat");
      }
      const [minLng, minLat, maxLng, maxLat] = parts;
      if (minLng > maxLng || minLat > maxLat) {
        throw new ValidationError2("bbox min values must be <= max values");
      }
      return { minLng, minLat, maxLng, maxLat };
    }
    __name(parseBBox, "parseBBox");
    function parseChains(value) {
      if (value == null) return null;
      if (String(value).trim() === "") return [];
      return String(value).split(",").map((item) => item.trim()).filter(Boolean).map((item) => sanitizeId(item, "chain"));
    }
    __name(parseChains, "parseChains");
    function parsePositiveInt(value, label, fallback) {
      if (value == null || value === "") return fallback;
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new ValidationError2(`${label} must be a positive integer`);
      }
      return parsed;
    }
    __name(parsePositiveInt, "parsePositiveInt");
    function parseNonNegativeInt(value, label, fallback) {
      if (value == null || value === "") return fallback;
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new ValidationError2(`${label} must be a non-negative integer`);
      }
      return parsed;
    }
    __name(parseNonNegativeInt, "parseNonNegativeInt");
    function parseSupplyPointFilters2(searchParams) {
      const limit = parsePositiveInt(searchParams.get("limit"), "limit", DEFAULT_LIMIT);
      if (limit > MAX_LIMIT) {
        throw new ValidationError2(`limit must be <= ${MAX_LIMIT}`);
      }
      return {
        bbox: parseBBox(searchParams.get("bbox")),
        chains: parseChains(searchParams.get("chains")),
        minPointLevel: parsePositiveInt(
          searchParams.get("min_point_level"),
          "min_point_level",
          DEFAULT_MIN_POINT_LEVEL
        ),
        limit,
        offset: parseNonNegativeInt(searchParams.get("offset"), "offset", 0)
      };
    }
    __name(parseSupplyPointFilters2, "parseSupplyPointFilters");
    function buildSupplyPointsQuery2(filters) {
      const where = [];
      const params = {};
      if (filters.bbox) {
        where.push("lng BETWEEN :minLng AND :maxLng");
        where.push("lat BETWEEN :minLat AND :maxLat");
        params.minLng = filters.bbox.minLng;
        params.maxLng = filters.bbox.maxLng;
        params.minLat = filters.bbox.minLat;
        params.maxLat = filters.bbox.maxLat;
      }
      if (Number.isInteger(filters.minPointLevel)) {
        where.push("(geocode_point_level IS NOT NULL AND geocode_point_level >= :minPointLevel)");
        params.minPointLevel = filters.minPointLevel;
      }
      if (filters.chains === null) {
      } else if (filters.chains.length === 0) {
        where.push("0 = 1");
      } else if (filters.chains.length > 0) {
        const placeholders = filters.chains.map((_, index) => `:chain${index}`);
        where.push(`chain IN (${placeholders.join(", ")})`);
        filters.chains.forEach((chain, index) => {
          params[`chain${index}`] = chain;
        });
      }
      params.limit = filters.limit;
      params.offset = filters.offset;
      return {
        sql: [
          "SELECT",
          // frontend が実利用する列のみ。store_id/source_url/updated_at/geocode_level
          // は外部 (将来の店舗詳細リンク) に必要になったら再追加する。
          `  ${API_COLUMNS.join(", ")}`,
          "FROM supply_points",
          where.length > 0 ? `WHERE ${where.join(" AND ")}` : "",
          // LIMIT/OFFSET ページングが有意義に動くよう安定キーで並べる。
          // 旧コードの 3 列ソート (chain, name, supply_point_id) は表示順依存が
          // 無いため不要だが、PRIMARY KEY 単独なら index 順スキャンで安価。
          "ORDER BY supply_point_id",
          "LIMIT :limit",
          "OFFSET :offset"
        ].filter(Boolean).join("\n"),
        params
      };
    }
    __name(buildSupplyPointsQuery2, "buildSupplyPointsQuery");
    function toGeoJsonFeature(row) {
      return {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [row.lng, row.lat]
        },
        properties: {
          supply_point_id: row.supply_point_id,
          chain: row.chain,
          name: row.name,
          address_norm: row.address_norm,
          geocode_point_level: row.geocode_point_level
        }
      };
    }
    __name(toGeoJsonFeature, "toGeoJsonFeature");
    function toFeatureCollection2(rows) {
      return {
        type: "FeatureCollection",
        features: rows.map(toGeoJsonFeature)
      };
    }
    __name(toFeatureCollection2, "toFeatureCollection");
    module.exports = {
      DEFAULT_API_PORT,
      DEFAULT_LIMIT,
      MAX_LIMIT,
      DEFAULT_MART_DATASET,
      DEFAULT_MART_TABLE,
      DEFAULT_MIN_POINT_LEVEL,
      DEFAULT_SQLITE_PATH,
      SQLITE_COLUMNS,
      buildBqSelectSql,
      buildSupplyPointsQuery: buildSupplyPointsQuery2,
      createSchemaSql,
      createUpsertStatement,
      normalizePointRow,
      parseBBox,
      parseChains,
      parseExportArgs,
      parseNonNegativeInt,
      parseServerArgs,
      parseSupplyPointFilters: parseSupplyPointFilters2,
      sanitizeId,
      sanitizeSqlitePath,
      toFeatureCollection: toFeatureCollection2,
      validateProjectId,
      ValidationError: ValidationError2
    };
  }
});

// lib/cycling/min_heap.js
var require_min_heap = __commonJS({
  "lib/cycling/min_heap.js"(exports, module) {
    "use strict";
    var MinHeap = class {
      static {
        __name(this, "MinHeap");
      }
      constructor() {
        this.keys = [];
        this.vals = [];
      }
      get size() {
        return this.keys.length;
      }
      push(key, val) {
        this.keys.push(key);
        this.vals.push(val);
        this._siftUp(this.keys.length - 1);
      }
      pop() {
        const n = this.keys.length;
        if (n === 0) return void 0;
        const topKey = this.keys[0];
        const topVal = this.vals[0];
        const lastKey = this.keys.pop();
        const lastVal = this.vals.pop();
        if (n > 1) {
          this.keys[0] = lastKey;
          this.vals[0] = lastVal;
          this._siftDown(0);
        }
        return { key: topKey, val: topVal };
      }
      peek() {
        if (this.keys.length === 0) return void 0;
        return { key: this.keys[0], val: this.vals[0] };
      }
      _siftUp(i) {
        const { keys, vals } = this;
        while (i > 0) {
          const parent = i - 1 >>> 1;
          if (keys[i] < keys[parent]) {
            [keys[i], keys[parent]] = [keys[parent], keys[i]];
            [vals[i], vals[parent]] = [vals[parent], vals[i]];
            i = parent;
          } else break;
        }
      }
      _siftDown(i) {
        const { keys, vals } = this;
        const n = keys.length;
        for (; ; ) {
          const left = i * 2 + 1;
          const right = left + 1;
          let smallest = i;
          if (left < n && keys[left] < keys[smallest]) smallest = left;
          if (right < n && keys[right] < keys[smallest]) smallest = right;
          if (smallest === i) break;
          [keys[i], keys[smallest]] = [keys[smallest], keys[i]];
          [vals[i], vals[smallest]] = [vals[smallest], vals[i]];
          i = smallest;
        }
      }
    };
    module.exports = { MinHeap };
  }
});

// lib/cycling/tile_partition.js
var require_tile_partition = __commonJS({
  "lib/cycling/tile_partition.js"(exports, module) {
    "use strict";
    var TILE_DEG = 0.05;
    var TILE_INV = 1 / TILE_DEG;
    function tileXY(lon, lat) {
      return [Math.floor(lon * TILE_INV), Math.floor(lat * TILE_INV)];
    }
    __name(tileXY, "tileXY");
    function tileKey(lon, lat) {
      const [x, y] = tileXY(lon, lat);
      return `${x}_${y}`;
    }
    __name(tileKey, "tileKey");
    function tileKeyXY(x, y) {
      return `${x}_${y}`;
    }
    __name(tileKeyXY, "tileKeyXY");
    function parseTileKey(key) {
      const m = /^(-?\d+)_(-?\d+)$/.exec(key);
      if (!m) return null;
      return [Number(m[1]), Number(m[2])];
    }
    __name(parseTileKey, "parseTileKey");
    function tileBboxXY(x, y) {
      return {
        west: x * TILE_DEG,
        south: y * TILE_DEG,
        east: (x + 1) * TILE_DEG,
        north: (y + 1) * TILE_DEG
      };
    }
    __name(tileBboxXY, "tileBboxXY");
    function neighborhoodKeys(lon, lat, radiusTiles = 1) {
      const [x, y] = tileXY(lon, lat);
      const keys = [];
      for (let dx = -radiusTiles; dx <= radiusTiles; dx += 1) {
        for (let dy = -radiusTiles; dy <= radiusTiles; dy += 1) {
          keys.push(tileKeyXY(x + dx, y + dy));
        }
      }
      return keys;
    }
    __name(neighborhoodKeys, "neighborhoodKeys");
    function corridorKeys(fromLon, fromLat, toLon, toLat, paddingTiles = 2) {
      const [fx, fy] = tileXY(fromLon, fromLat);
      const [tx, ty] = tileXY(toLon, toLat);
      const xMin = Math.min(fx, tx) - paddingTiles;
      const xMax = Math.max(fx, tx) + paddingTiles;
      const yMin = Math.min(fy, ty) - paddingTiles;
      const yMax = Math.max(fy, ty) + paddingTiles;
      const keys = [];
      for (let x = xMin; x <= xMax; x += 1) {
        for (let y = yMin; y <= yMax; y += 1) {
          keys.push(tileKeyXY(x, y));
        }
      }
      return keys;
    }
    __name(corridorKeys, "corridorKeys");
    module.exports = {
      TILE_DEG,
      tileXY,
      tileKey,
      tileKeyXY,
      parseTileKey,
      tileBboxXY,
      neighborhoodKeys,
      corridorKeys
    };
  }
});

// lib/cycling/ch_csr.js
var require_ch_csr = __commonJS({
  "lib/cycling/ch_csr.js"(exports, module) {
    "use strict";
    var HEADER_BYTES = 16;
    var NODE_BYTES = 16;
    var NODE_BYTES_V2 = 20;
    var EDGE_BYTES = 28;
    var EDGE_BYTES_V2 = 40;
    var MAGIC = 1162103122;
    var CORE_BIT_V2 = 2 ** 31;
    var NO_VIA = 4294967295;
    var UNKNOWN_LEVEL = 4294967294;
    function readHeader(buf) {
      if (!buf || buf.byteLength < HEADER_BYTES) return null;
      const dv = new DataView(buf);
      if (dv.getUint32(0, true) !== MAGIC) return null;
      const version = dv.getUint8(4);
      if (version !== 1 && version !== 2) return null;
      return {
        version,
        nodeCount: dv.getUint32(8, true),
        edgeCount: dv.getUint32(12, true)
      };
    }
    __name(readHeader, "readHeader");
    function buildCsr(tiles) {
      const headers = new Array(tiles.length);
      let nodeUpper = 0;
      let edgeUpper = 0;
      for (let i = 0; i < tiles.length; i += 1) {
        const h = readHeader(tiles[i].buf);
        headers[i] = h;
        if (h) {
          nodeUpper += h.nodeCount;
          edgeUpper += h.edgeCount;
        }
      }
      const maxNodeSlots = nodeUpper;
      const ids = new Float64Array(maxNodeSlots);
      const lons = new Float32Array(maxNodeSlots);
      const lats = new Float32Array(maxNodeSlots);
      const levels = new Uint32Array(maxNodeSlots);
      const cores = new Uint8Array(maxNodeSlots);
      let nodeCount = 0;
      const idToIdx = /* @__PURE__ */ new Map();
      const addNode = /* @__PURE__ */ __name((id, lon, lat, level, core) => {
        if (idToIdx.has(id)) return idToIdx.get(id);
        const idx = nodeCount;
        idToIdx.set(id, idx);
        ids[idx] = id;
        lons[idx] = lon;
        lats[idx] = lat;
        levels[idx] = level;
        cores[idx] = core;
        nodeCount += 1;
        return idx;
      }, "addNode");
      for (let t = 0; t < tiles.length; t += 1) {
        const h = headers[t];
        if (!h) continue;
        const dv = new DataView(tiles[t].buf);
        let off = HEADER_BYTES;
        if (h.version === 2) {
          for (let i = 0; i < h.nodeCount; i += 1) {
            const id = dv.getFloat64(off, true);
            const lon = dv.getFloat32(off + 8, true);
            const lat = dv.getFloat32(off + 12, true);
            const word = dv.getUint32(off + 16, true);
            const level = word >= CORE_BIT_V2 ? word - CORE_BIT_V2 : word;
            const core = word >= CORE_BIT_V2 ? 1 : 0;
            addNode(id, lon, lat, level, core);
            off += NODE_BYTES_V2;
          }
        } else {
          for (let i = 0; i < h.nodeCount; i += 1) {
            const id = dv.getFloat64(off, true);
            const lon = dv.getFloat32(off + 8, true);
            const lat = dv.getFloat32(off + 12, true);
            addNode(id, lon, lat, UNKNOWN_LEVEL, 0);
            off += NODE_BYTES;
          }
        }
      }
      const edgeOffsets = new Uint32Array(tiles.length);
      for (let t = 0; t < tiles.length; t += 1) {
        const h = headers[t];
        if (!h) {
          edgeOffsets[t] = 0;
          continue;
        }
        edgeOffsets[t] = HEADER_BYTES + h.nodeCount * (h.version === 2 ? NODE_BYTES_V2 : NODE_BYTES);
      }
      const fwdDeg = new Uint32Array(nodeCount);
      const revDeg = new Uint32Array(nodeCount);
      let totalEdges = 0;
      for (let t = 0; t < tiles.length; t += 1) {
        const h = headers[t];
        if (!h) continue;
        const dv = new DataView(tiles[t].buf);
        const eb = h.version === 2 ? EDGE_BYTES_V2 : EDGE_BYTES;
        let off = edgeOffsets[t];
        for (let i = 0; i < h.edgeCount; i += 1) {
          const from = dv.getFloat64(off, true);
          const to = dv.getFloat64(off + 8, true);
          const fIdx = idToIdx.get(from);
          const tIdx = idToIdx.get(to);
          if (fIdx !== void 0 && tIdx !== void 0) {
            fwdDeg[fIdx] += 1;
            revDeg[tIdx] += 1;
            totalEdges += 1;
          }
          off += eb;
        }
      }
      const fwdOffsets = new Uint32Array(nodeCount + 1);
      const revOffsets = new Uint32Array(nodeCount + 1);
      for (let i = 0; i < nodeCount; i += 1) {
        fwdOffsets[i + 1] = fwdOffsets[i] + fwdDeg[i];
        revOffsets[i + 1] = revOffsets[i] + revDeg[i];
      }
      const fwdTo = new Uint32Array(totalEdges);
      const fwdCost = new Float32Array(totalEdges);
      const fwdViaId = new Uint32Array(totalEdges);
      const revFrom = new Uint32Array(totalEdges);
      const revCost = new Float32Array(totalEdges);
      const revViaId = new Uint32Array(totalEdges);
      const fwdCursor = new Uint32Array(fwdOffsets.length);
      const revCursor = new Uint32Array(revOffsets.length);
      fwdCursor.set(fwdOffsets);
      revCursor.set(revOffsets);
      for (let t = 0; t < tiles.length; t += 1) {
        const h = headers[t];
        if (!h) continue;
        const dv = new DataView(tiles[t].buf);
        const eb = h.version === 2 ? EDGE_BYTES_V2 : EDGE_BYTES;
        let off = edgeOffsets[t];
        for (let i = 0; i < h.edgeCount; i += 1) {
          const from = dv.getFloat64(off, true);
          const to = dv.getFloat64(off + 8, true);
          const cost = dv.getFloat32(off + 24, true);
          let viaIdx = NO_VIA;
          if (h.version === 2) {
            const viaOsm = dv.getFloat64(off + 32, true);
            if (viaOsm) {
              const vi = idToIdx.get(viaOsm);
              if (vi !== void 0) viaIdx = vi;
            }
          }
          const fIdx = idToIdx.get(from);
          const tIdx = idToIdx.get(to);
          if (fIdx !== void 0 && tIdx !== void 0) {
            const fp = fwdCursor[fIdx]++;
            fwdTo[fp] = tIdx;
            fwdCost[fp] = cost;
            fwdViaId[fp] = viaIdx;
            const rp = revCursor[tIdx]++;
            revFrom[rp] = fIdx;
            revCost[rp] = cost;
            revViaId[rp] = viaIdx;
          }
          off += eb;
        }
      }
      return {
        nodeCount,
        edgeCount: totalEdges,
        idToIdx,
        ids,
        lons,
        lats,
        levels,
        cores,
        fwdOffsets,
        fwdTo,
        fwdCost,
        fwdViaId,
        revOffsets,
        revFrom,
        revCost,
        revViaId,
        NO_VIA
      };
    }
    __name(buildCsr, "buildCsr");
    function csrMemoryBytes(csr) {
      const arrs = [
        csr.ids,
        csr.lons,
        csr.lats,
        csr.levels,
        csr.cores,
        csr.fwdOffsets,
        csr.fwdTo,
        csr.fwdCost,
        csr.fwdViaId,
        csr.revOffsets,
        csr.revFrom,
        csr.revCost,
        csr.revViaId
      ];
      return arrs.reduce((s, a) => s + (a ? a.byteLength : 0), 0);
    }
    __name(csrMemoryBytes, "csrMemoryBytes");
    module.exports = {
      buildCsr,
      csrMemoryBytes,
      NO_VIA,
      UNKNOWN_LEVEL,
      readHeader
    };
  }
});

// lib/cycling/chquery_csr.js
var require_chquery_csr = __commonJS({
  "lib/cycling/chquery_csr.js"(exports, module) {
    "use strict";
    var { MinHeap } = require_min_heap();
    var { UNKNOWN_LEVEL } = require_ch_csr();
    var INF = Infinity;
    function chQueryCsr(csr, startIdx, goalIdx, opts) {
      const settledCap = opts?.settledCap ?? 2e4;
      const popsCap = opts?.popsCap ?? 8e4;
      const timeBudgetMs = opts?.timeBudgetMs ?? 1500;
      const n = csr.nodeCount;
      if (startIdx === goalIdx) {
        return { distance: 0, pathIdx: [startIdx], settled: 0, terminated: "same" };
      }
      if (startIdx < 0 || goalIdx < 0 || startIdx >= n || goalIdx >= n) {
        return { distance: INF, pathIdx: [], settled: 0, terminated: "oob" };
      }
      const distF = new Float64Array(n);
      const distB = new Float64Array(n);
      distF.fill(INF);
      distB.fill(INF);
      distF[startIdx] = 0;
      distB[goalIdx] = 0;
      const parentF = new Int32Array(n);
      const parentB = new Int32Array(n);
      parentF.fill(-1);
      parentB.fill(-1);
      const settledF = new Uint8Array(n);
      const settledB = new Uint8Array(n);
      const heapF = new MinHeap();
      const heapB = new MinHeap();
      heapF.push(0, startIdx);
      heapB.push(0, goalIdx);
      let best = INF;
      let meeting = -1;
      const tryMeet = /* @__PURE__ */ __name((u, df, db) => {
        const sum = df + db;
        if (sum < best) {
          best = sum;
          meeting = u;
        }
      }, "tryMeet");
      const t0 = Date.now();
      let pops = 0;
      let settledCount = 0;
      const { levels, cores, fwdOffsets, fwdTo, fwdCost, revOffsets, revFrom, revCost } = csr;
      while (heapF.size > 0 || heapB.size > 0) {
        if (settledCount > settledCap || pops > popsCap) {
          return { distance: INF, pathIdx: [], settled: settledCount, terminated: "cap" };
        }
        if ((pops & 1023) === 0 && Date.now() - t0 > timeBudgetMs) {
          return { distance: INF, pathIdx: [], settled: settledCount, terminated: "time" };
        }
        pops += 1;
        const topF = heapF.size > 0 ? heapF.peek().key : INF;
        const topB = heapB.size > 0 ? heapB.peek().key : INF;
        if (topF >= best && topB >= best) break;
        const expandF = topF < best && (topB >= best || topF <= topB);
        if (expandF) {
          const { key: d, val: u } = heapF.pop();
          if (settledF[u]) continue;
          if (d > distF[u]) continue;
          settledF[u] = 1;
          settledCount += 1;
          if (distB[u] !== INF) tryMeet(u, d, distB[u]);
          const uLevel = levels[u];
          const uIsCore = cores[u] === 1;
          const startOff = fwdOffsets[u];
          const endOff = fwdOffsets[u + 1];
          for (let e = startOff; e < endOff; e += 1) {
            const v = fwdTo[e];
            const vLevel = levels[v];
            if (vLevel === UNKNOWN_LEVEL) continue;
            const coreCoreLateral = uIsCore && cores[v] === 1;
            if (!coreCoreLateral && vLevel <= uLevel) continue;
            const nd = d + fwdCost[e];
            if (nd < distF[v]) {
              distF[v] = nd;
              parentF[v] = u;
              heapF.push(nd, v);
              if (distB[v] !== INF) tryMeet(v, nd, distB[v]);
            }
          }
        } else {
          const { key: d, val: u } = heapB.pop();
          if (settledB[u]) continue;
          if (d > distB[u]) continue;
          settledB[u] = 1;
          settledCount += 1;
          if (distF[u] !== INF) tryMeet(u, distF[u], d);
          const uLevel = levels[u];
          const uIsCore = cores[u] === 1;
          const startOff = revOffsets[u];
          const endOff = revOffsets[u + 1];
          for (let e = startOff; e < endOff; e += 1) {
            const v = revFrom[e];
            const vLevel = levels[v];
            if (vLevel === UNKNOWN_LEVEL) continue;
            const coreCoreLateral = uIsCore && cores[v] === 1;
            if (!coreCoreLateral && vLevel <= uLevel) continue;
            const nd = d + revCost[e];
            if (nd < distB[v]) {
              distB[v] = nd;
              parentB[v] = u;
              heapB.push(nd, v);
              if (distF[v] !== INF) tryMeet(v, distF[v], nd);
            }
          }
        }
      }
      if (meeting < 0 || !Number.isFinite(best)) {
        return { distance: INF, pathIdx: [], settled: settledCount, terminated: "noMeet" };
      }
      const fwdChain = [meeting];
      for (let cur = meeting; parentF[cur] !== -1; cur = parentF[cur]) fwdChain.push(parentF[cur]);
      fwdChain.reverse();
      const backChain = [];
      for (let cur = meeting; parentB[cur] !== -1; cur = parentB[cur]) backChain.push(parentB[cur]);
      const pathIdx = fwdChain.concat(backChain);
      return { distance: best, pathIdx, settled: settledCount, terminated: "ok" };
    }
    __name(chQueryCsr, "chQueryCsr");
    function unpackChEdgeCsr(csr, uIdx, vIdx, out) {
      const { fwdOffsets, fwdTo, fwdViaId, NO_VIA: noVia } = csr;
      const stack = [[uIdx, vIdx]];
      let safety = 0;
      while (stack.length > 0) {
        if (++safety > 1e6) break;
        const [a, b] = stack.pop();
        let foundViaIdx = -2;
        const startOff = fwdOffsets[a];
        const endOff = fwdOffsets[a + 1];
        for (let e = startOff; e < endOff; e += 1) {
          if (fwdTo[e] === b) {
            const v = fwdViaId[e];
            foundViaIdx = v === noVia ? -1 : v;
            break;
          }
        }
        if (foundViaIdx === -1 || foundViaIdx === -2) {
          out.push(b);
          continue;
        }
        stack.push([foundViaIdx, b]);
        stack.push([a, foundViaIdx]);
      }
    }
    __name(unpackChEdgeCsr, "unpackChEdgeCsr");
    module.exports = {
      chQueryCsr,
      unpackChEdgeCsr
    };
  }
});

// lib/cycling/snap_csr.js
var require_snap_csr = __commonJS({
  "lib/cycling/snap_csr.js"(exports, module) {
    "use strict";
    var EARTH_R = 6378137;
    function haversineMeters(aLon, aLat, bLon, bLat) {
      const toRad = Math.PI / 180;
      const dLat = (bLat - aLat) * toRad;
      const dLon = (bLon - aLon) * toRad;
      const lat1 = aLat * toRad;
      const lat2 = bLat * toRad;
      const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
      return 2 * EARTH_R * Math.asin(Math.sqrt(s));
    }
    __name(haversineMeters, "haversineMeters");
    function snapCsr(csr, lon, lat) {
      const lonsArr = csr.lons;
      const latsArr = csr.lats;
      const n = csr.nodeCount;
      if (n === 0) return null;
      const cosLat = Math.cos(lat * Math.PI / 180);
      let bestIdx = -1;
      let bestSq = Infinity;
      for (let i = 0; i < n; i += 1) {
        const ln = lonsArr[i];
        if (ln !== ln) continue;
        const la = latsArr[i];
        const dlon = (ln - lon) * cosLat;
        const dlat = la - lat;
        const sq = dlon * dlon + dlat * dlat;
        if (sq < bestSq) {
          bestSq = sq;
          bestIdx = i;
        }
      }
      if (bestIdx < 0) return null;
      const id = csr.ids[bestIdx];
      const distanceMeters = haversineMeters(lon, lat, lonsArr[bestIdx], latsArr[bestIdx]);
      return { idx: bestIdx, id, distanceMeters };
    }
    __name(snapCsr, "snapCsr");
    module.exports = { snapCsr, haversineMeters };
  }
});

// lib/cycling/tiled_router.js
var require_tiled_router = __commonJS({
  "lib/cycling/tiled_router.js"(exports, module) {
    "use strict";
    var { MinHeap } = require_min_heap();
    var {
      neighborhoodKeys,
      corridorKeys
    } = require_tile_partition();
    var { buildCsr, csrMemoryBytes } = require_ch_csr();
    var { chQueryCsr, unpackChEdgeCsr } = require_chquery_csr();
    var { snapCsr } = require_snap_csr();
    var MAX_SNAP_METERS = 500;
    var MAX_STRAIGHT_LINE_METERS = 18e3;
    var MAX_CORRIDOR_TILES = 96;
    var MIN_COST_FACTOR = 0.7;
    function straightLineMeters(fromLon, fromLat, toLon, toLat) {
      const refLat = (fromLat + toLat) / 2;
      const cosLat = Math.cos(refLat * Math.PI / 180);
      const dxm = (toLon - fromLon) * cosLat * 111320;
      const dym = (toLat - fromLat) * 110540;
      return Math.hypot(dxm, dym);
    }
    __name(straightLineMeters, "straightLineMeters");
    var TiledRouter2 = class {
      static {
        __name(this, "TiledRouter");
      }
      constructor(tileLoader, opts = {}) {
        this.tileLoader = tileLoader;
        this.maxSnapMeters = opts.maxSnapMeters ?? MAX_SNAP_METERS;
        this.maxStraightLineMeters = opts.maxStraightLineMeters ?? MAX_STRAIGHT_LINE_METERS;
        this.maxCorridorTiles = opts.maxCorridorTiles ?? MAX_CORRIDOR_TILES;
        this.corridorPadding = opts.corridorPadding ?? 1;
        this.snapNeighborhoodRadius = opts.snapNeighborhoodRadius ?? 1;
        this.useChCsr = !!opts.useChCsr;
        this.csrOnly = !!opts.csrOnly;
      }
      async _snap(lon, lat) {
        await this.tileLoader.loadMany(
          neighborhoodKeys(lon, lat, this.snapNeighborhoodRadius)
        );
        return this.tileLoader.grid.nearest(lon, lat, 8);
      }
      /**
       * CSR-only route: view を一切 populate せず、loadBuffers → buildCsr →
       * snapCsr → chQueryCsr を per-request で実行する。Workers 128MB 内に確実
       * に収めるための最終形。フォールバック NBA* は無効化 (chQuery 失敗時は
       * unreachable を返す)。
       */
      async _routeCsrOnly(fromLon, fromLat, toLon, toLat) {
        const straightLine = straightLineMeters(fromLon, fromLat, toLon, toLat);
        if (straightLine > this.maxStraightLineMeters) {
          return {
            error: "too_far",
            straight_line_m: straightLine,
            max_straight_line_m: this.maxStraightLineMeters
          };
        }
        const corridor = corridorKeys(fromLon, fromLat, toLon, toLat, this.corridorPadding);
        if (corridor.length > this.maxCorridorTiles) {
          return {
            error: "corridor_too_large",
            corridor_tiles: corridor.length,
            max_corridor_tiles: this.maxCorridorTiles
          };
        }
        const snapFrom = neighborhoodKeys(fromLon, fromLat, this.snapNeighborhoodRadius);
        const snapTo = neighborhoodKeys(toLon, toLat, this.snapNeighborhoodRadius);
        const allKeys = Array.from(/* @__PURE__ */ new Set([...corridor, ...snapFrom, ...snapTo]));
        const tCsr0 = Date.now();
        let csr = null;
        try {
          const bufs = await this.tileLoader.loadBuffers(allKeys);
          csr = buildCsr(bufs);
        } catch (err) {
          try {
            console.warn("csr-only build failed", err);
          } catch (_) {
          }
          return { error: "csr_build_failed" };
        }
        const csrBuildMs = Date.now() - tCsr0;
        const csrBytes = csrMemoryBytes(csr);
        const fromSnap = snapCsr(csr, fromLon, fromLat);
        const toSnap = snapCsr(csr, toLon, toLat);
        if (!fromSnap || fromSnap.distanceMeters > this.maxSnapMeters) {
          return { error: "no_nearby_node_from" };
        }
        if (!toSnap || toSnap.distanceMeters > this.maxSnapMeters) {
          return { error: "no_nearby_node_to" };
        }
        const tCh0 = Date.now();
        const rc = chQueryCsr(csr, fromSnap.idx, toSnap.idx);
        const chMs = Date.now() - tCh0;
        try {
          console.log(JSON.stringify({
            evt: "route",
            mode: "csr-only",
            alg: Number.isFinite(rc.distance) ? "ch-csr" : "unreachable",
            ch_ms: chMs,
            ch_settled: rc.settled,
            csr_build_ms: csrBuildMs,
            csr_bytes: csrBytes,
            csr_node_count: csr.nodeCount,
            csr_edge_count: csr.edgeCount,
            dist: rc.distance,
            nodes: rc.pathIdx.length,
            from: fromSnap.id,
            to: toSnap.id,
            terminated: rc.terminated
          }));
        } catch (_) {
        }
        if (!Number.isFinite(rc.distance)) {
          return {
            error: "unreachable_in_corridor",
            from_node: fromSnap.id,
            to_node: toSnap.id,
            algorithm: "ch-csr"
          };
        }
        const expanded = [rc.pathIdx[0]];
        for (let i = 1; i < rc.pathIdx.length; i += 1) {
          unpackChEdgeCsr(csr, rc.pathIdx[i - 1], rc.pathIdx[i], expanded);
        }
        const coordinates = [];
        for (let i = 0; i < expanded.length; i += 1) {
          const idx = expanded[i];
          const lon = csr.lons[idx];
          const lat = csr.lats[idx];
          if (lon === lon && lat === lat) coordinates.push([lon, lat]);
        }
        return {
          distance_cost: rc.distance,
          node_count: expanded.length,
          settled: rc.settled,
          snap_from_m: fromSnap.distanceMeters,
          snap_to_m: toSnap.distanceMeters,
          loaded_tiles: allKeys.length,
          algorithm: "ch-csr",
          coordinates
        };
      }
      async route(fromLon, fromLat, toLon, toLat) {
        if (this.csrOnly) {
          return this._routeCsrOnly(fromLon, fromLat, toLon, toLat);
        }
        const straightLine = straightLineMeters(fromLon, fromLat, toLon, toLat);
        if (straightLine > this.maxStraightLineMeters) {
          return {
            error: "too_far",
            straight_line_m: straightLine,
            max_straight_line_m: this.maxStraightLineMeters
          };
        }
        const corridor = corridorKeys(fromLon, fromLat, toLon, toLat, this.corridorPadding);
        if (corridor.length > this.maxCorridorTiles) {
          return {
            error: "corridor_too_large",
            corridor_tiles: corridor.length,
            max_corridor_tiles: this.maxCorridorTiles
          };
        }
        await this.tileLoader.loadMany(corridor);
        const fromSnap = await this._snap(fromLon, fromLat);
        if (!fromSnap || fromSnap.distanceMeters > this.maxSnapMeters) {
          return { error: "no_nearby_node_from" };
        }
        const toSnap = await this._snap(toLon, toLat);
        if (!toSnap || toSnap.distanceMeters > this.maxSnapMeters) {
          return { error: "no_nearby_node_to" };
        }
        const view = this.tileLoader.view;
        let r;
        let algorithm;
        let chSettled = null;
        let chMs = null;
        let nbaMs = null;
        let csrBytes = null;
        let csrBuildMs = null;
        if (this.useChCsr) {
          const tCsr0 = Date.now();
          const snapKeysFrom = neighborhoodKeys(fromLon, fromLat, this.snapNeighborhoodRadius);
          const snapKeysTo = neighborhoodKeys(toLon, toLat, this.snapNeighborhoodRadius);
          const csrKeys = Array.from(/* @__PURE__ */ new Set([...corridor, ...snapKeysFrom, ...snapKeysTo]));
          const tileBufs = await this.tileLoader.loadBuffers(csrKeys);
          const csr = buildCsr(tileBufs);
          csrBuildMs = Date.now() - tCsr0;
          csrBytes = csrMemoryBytes(csr);
          this._lastCsrNodeCount = csr.nodeCount;
          this._lastCsrEdgeCount = csr.edgeCount;
          const fromIdx = csr.idToIdx.get(fromSnap.id);
          const toIdx = csr.idToIdx.get(toSnap.id);
          if (fromIdx === void 0 || toIdx === void 0) {
            const tNba0 = Date.now();
            r = nbaStarOnView(view, fromSnap.id, toSnap.id);
            nbaMs = Date.now() - tNba0;
            algorithm = "csr-snap-miss-nba";
          } else {
            const tCh0 = Date.now();
            const rc = chQueryCsr(csr, fromIdx, toIdx);
            chMs = Date.now() - tCh0;
            chSettled = rc.settled;
            if (Number.isFinite(rc.distance)) {
              const expanded = [rc.pathIdx[0]];
              for (let i = 1; i < rc.pathIdx.length; i += 1) {
                unpackChEdgeCsr(csr, rc.pathIdx[i - 1], rc.pathIdx[i], expanded);
              }
              const osmPath = expanded.map((i) => csr.ids[i]);
              r = {
                distance: rc.distance,
                path: osmPath,
                settled: rc.settled
              };
              algorithm = "ch-csr";
            } else {
              const tNba0 = Date.now();
              r = nbaStarOnView(view, fromSnap.id, toSnap.id);
              nbaMs = Date.now() - tNba0;
              algorithm = "ch-csr-fallback-nba";
            }
          }
        } else if (view.hasCh) {
          const tCh0 = Date.now();
          r = chQueryOnView(view, fromSnap.id, toSnap.id);
          chMs = Date.now() - tCh0;
          chSettled = r.settled;
          if (Number.isFinite(r.distance)) {
            algorithm = "ch";
          } else {
            const tNba0 = Date.now();
            r = nbaStarOnView(view, fromSnap.id, toSnap.id);
            nbaMs = Date.now() - tNba0;
            algorithm = "ch-fallback-nba";
          }
        } else {
          const tNba0 = Date.now();
          r = nbaStarOnView(view, fromSnap.id, toSnap.id);
          nbaMs = Date.now() - tNba0;
          algorithm = "nba";
        }
        if (view.hasCh || this.useChCsr) {
          try {
            console.log(JSON.stringify({
              evt: "route",
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
          } catch (_) {
          }
        }
        if (!Number.isFinite(r.distance)) {
          return {
            error: "unreachable_in_corridor",
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
    };
    function chQueryOnView(view, startId, goalId) {
      if (startId === goalId) {
        return { distance: 0, path: [startId], settled: 0 };
      }
      const levels = view.levels;
      const startLevel = levels.get(startId);
      const goalLevel = levels.get(goalId);
      if (startLevel === void 0 || goalLevel === void 0) {
        return { distance: Infinity, path: [], settled: 0 };
      }
      const distF = /* @__PURE__ */ new Map([[startId, 0]]);
      const distB = /* @__PURE__ */ new Map([[goalId, 0]]);
      const parentF = /* @__PURE__ */ new Map();
      const parentB = /* @__PURE__ */ new Map();
      const settledF = /* @__PURE__ */ new Set();
      const settledB = /* @__PURE__ */ new Set();
      const heapF = new MinHeap();
      const heapB = new MinHeap();
      heapF.push(0, startId);
      heapB.push(0, goalId);
      let best = Infinity;
      let meeting = null;
      const tryMeet = /* @__PURE__ */ __name((u, df, db) => {
        const sum = df + db;
        if (sum < best) {
          best = sum;
          meeting = u;
        }
      }, "tryMeet");
      const SETTLED_CAP = 12e3;
      const POPS_CAP = 5e4;
      const TIME_BUDGET_MS = 800;
      const t0 = Date.now();
      let pops = 0;
      while (heapF.size > 0 || heapB.size > 0) {
        if (settledF.size + settledB.size > SETTLED_CAP || pops > POPS_CAP) {
          return { distance: Infinity, path: [], settled: settledF.size + settledB.size };
        }
        if ((pops & 1023) === 0 && Date.now() - t0 > TIME_BUDGET_MS) {
          return { distance: Infinity, path: [], settled: settledF.size + settledB.size };
        }
        pops += 1;
        const topF = heapF.size > 0 ? heapF.peek().key : Infinity;
        const topB = heapB.size > 0 ? heapB.peek().key : Infinity;
        if (topF >= best && topB >= best) break;
        const expandF = topF < best && (topB >= best || topF <= topB);
        if (expandF) {
          const { key: d, val: u } = heapF.pop();
          if (settledF.has(u)) continue;
          if (d > (distF.get(u) ?? Infinity)) continue;
          settledF.add(u);
          const db = distB.get(u);
          if (db !== void 0) tryMeet(u, d, db);
          const uLevel = levels.get(u);
          const uIsCore = view.cores ? view.cores.has(u) : false;
          const fwdList = view.fwd.get(u);
          if (fwdList) for (let i = 0; i < fwdList.length; i += 1) {
            const e = fwdList[i];
            const vTo = e.to;
            const vLevel = levels.get(vTo);
            if (vLevel === void 0) continue;
            const vIsCore = view.cores ? view.cores.has(vTo) : false;
            const coreCoreLateral = uIsCore && vIsCore;
            if (!coreCoreLateral && vLevel <= uLevel) continue;
            const nd = d + e.cost;
            if (nd < (distF.get(vTo) ?? Infinity)) {
              distF.set(vTo, nd);
              parentF.set(vTo, u);
              heapF.push(nd, vTo);
              const dbTo = distB.get(vTo);
              if (dbTo !== void 0) tryMeet(vTo, nd, dbTo);
            }
          }
          const scList = view.scFwd && view.scFwd.get(u);
          if (scList) for (let i = 0; i < scList.length; i += 5) {
            const vTo = scList[i];
            const eCost = scList[i + 1];
            const vLevel = levels.get(vTo);
            if (vLevel === void 0) continue;
            const vIsCore = view.cores ? view.cores.has(vTo) : false;
            const coreCoreLateral = uIsCore && vIsCore;
            if (!coreCoreLateral && vLevel <= uLevel) continue;
            const nd = d + eCost;
            if (nd < (distF.get(vTo) ?? Infinity)) {
              distF.set(vTo, nd);
              parentF.set(vTo, u);
              heapF.push(nd, vTo);
              const dbTo = distB.get(vTo);
              if (dbTo !== void 0) tryMeet(vTo, nd, dbTo);
            }
          }
        } else {
          const { key: d, val: u } = heapB.pop();
          if (settledB.has(u)) continue;
          if (d > (distB.get(u) ?? Infinity)) continue;
          settledB.add(u);
          const df = distF.get(u);
          if (df !== void 0) tryMeet(u, df, d);
          const uLevel = levels.get(u);
          const uIsCore = view.cores ? view.cores.has(u) : false;
          const revList = view.rev.get(u);
          if (revList) for (let i = 0; i < revList.length; i += 1) {
            const e = revList[i];
            const vFrom = e.from;
            const fromLevel = levels.get(vFrom);
            if (fromLevel === void 0) continue;
            const fromIsCore = view.cores ? view.cores.has(vFrom) : false;
            const coreCoreLateral = uIsCore && fromIsCore;
            if (!coreCoreLateral && fromLevel <= uLevel) continue;
            const nd = d + e.cost;
            if (nd < (distB.get(vFrom) ?? Infinity)) {
              distB.set(vFrom, nd);
              parentB.set(vFrom, u);
              heapB.push(nd, vFrom);
              const dfFrom = distF.get(vFrom);
              if (dfFrom !== void 0) tryMeet(vFrom, dfFrom, nd);
            }
          }
          const scList = view.scRev && view.scRev.get(u);
          if (scList) for (let i = 0; i < scList.length; i += 5) {
            const vFrom = scList[i];
            const eCost = scList[i + 1];
            const fromLevel = levels.get(vFrom);
            if (fromLevel === void 0) continue;
            const fromIsCore = view.cores ? view.cores.has(vFrom) : false;
            const coreCoreLateral = uIsCore && fromIsCore;
            if (!coreCoreLateral && fromLevel <= uLevel) continue;
            const nd = d + eCost;
            if (nd < (distB.get(vFrom) ?? Infinity)) {
              distB.set(vFrom, nd);
              parentB.set(vFrom, u);
              heapB.push(nd, vFrom);
              const dfFrom = distF.get(vFrom);
              if (dfFrom !== void 0) tryMeet(vFrom, dfFrom, nd);
            }
          }
        }
      }
      if (meeting === null || !Number.isFinite(best)) {
        return { distance: Infinity, path: [], settled: settledF.size + settledB.size };
      }
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
      const expanded = [fwdNodes[0]];
      const pushSeg = /* @__PURE__ */ __name((uId, vId) => unpackChEdge(view, uId, vId, expanded), "pushSeg");
      for (let i = 1; i < fwdNodes.length; i += 1) pushSeg(fwdNodes[i - 1], fwdNodes[i]);
      let prev = fwdNodes[fwdNodes.length - 1];
      for (const next of backNodes) {
        pushSeg(prev, next);
        prev = next;
      }
      return { distance: best, path: expanded, settled: settledF.size + settledB.size };
    }
    __name(chQueryOnView, "chQueryOnView");
    function findEdgeInView(view, fromId, toId) {
      const list = view.fwd.get(fromId);
      if (list) {
        for (const e of list) if (e.to === toId) return e;
      }
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
    __name(findEdgeInView, "findEdgeInView");
    function unpackChEdge(view, fromId, toId, out) {
      const stack = [[fromId, toId]];
      let safety = 0;
      while (stack.length > 0) {
        if (++safety > 1e6) break;
        const [a, b] = stack.pop();
        const e = findEdgeInView(view, a, b);
        if (!e || !e.viaId) {
          out.push(b);
          continue;
        }
        stack.push([e.viaId, b]);
        stack.push([a, e.viaId]);
      }
    }
    __name(unpackChEdge, "unpackChEdge");
    function aStarOnView(view, startId, goalId) {
      if (startId === goalId) {
        return { distance: 0, path: [startId], settled: 0 };
      }
      const goalCoord = view.nodes.get(goalId);
      if (!goalCoord) {
        return { distance: Infinity, path: [], settled: 0 };
      }
      let idToIdx = view.nodeIdToIndex;
      let idxToId = view.indexToNodeId;
      if (!(idToIdx instanceof Map) || !Array.isArray(idxToId)) {
        idToIdx = /* @__PURE__ */ new Map();
        idxToId = [];
        for (const id of view.nodes.keys()) {
          idToIdx.set(id, idxToId.length);
          idxToId.push(id);
        }
      }
      const startIdx = idToIdx.get(startId);
      const goalIdx = idToIdx.get(goalId);
      if (startIdx === void 0 || goalIdx === void 0) {
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
      const heuristic = /* @__PURE__ */ __name((id) => {
        const c = view.nodes.get(id);
        if (!c) return 0;
        const refLat = (c[1] + goalLat) / 2;
        const cosLat = Math.cos(refLat * Math.PI / 180);
        const dxm = (goalLon - c[0]) * cosLat * 111320;
        const dym = (goalLat - c[1]) * 110540;
        return Math.hypot(dxm, dym) * MIN_COST_FACTOR;
      }, "heuristic");
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
          if (vIdx === void 0 || settled[vIdx]) continue;
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
    __name(aStarOnView, "aStarOnView");
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
        idToIdx = /* @__PURE__ */ new Map();
        idxToId = [];
        for (const id of view.nodes.keys()) {
          idToIdx.set(id, idxToId.length);
          idxToId.push(id);
        }
      }
      const startIdx = idToIdx.get(startId);
      const goalIdx = idToIdx.get(goalId);
      if (startIdx === void 0 || goalIdx === void 0) {
        return { distance: Infinity, path: [], settled: 0 };
      }
      const N = idxToId.length;
      const startLon = startCoord[0];
      const startLat = startCoord[1];
      const goalLon = goalCoord[0];
      const goalLat = goalCoord[1];
      const haversineTo = /* @__PURE__ */ __name((c, refLon, refLat) => {
        const meanLat = (c[1] + refLat) / 2;
        const cosLat = Math.cos(meanLat * Math.PI / 180);
        const dxm = (refLon - c[0]) * cosLat * 111320;
        const dym = (refLat - c[1]) * 110540;
        return Math.hypot(dxm, dym);
      }, "haversineTo");
      const hToGoal = /* @__PURE__ */ __name((c) => haversineTo(c, goalLon, goalLat) * MIN_COST_FACTOR, "hToGoal");
      const hFromStart = /* @__PURE__ */ __name((c) => haversineTo(c, startLon, startLat) * MIN_COST_FACTOR, "hFromStart");
      const potentials = new Float64Array(N);
      const pComputed = new Uint8Array(N);
      const getP = /* @__PURE__ */ __name((idx) => {
        if (pComputed[idx]) return potentials[idx];
        const c = view.nodes.get(idxToId[idx]);
        const p = c ? (hToGoal(c) - hFromStart(c)) / 2 : 0;
        potentials[idx] = p;
        pComputed[idx] = 1;
        return p;
      }, "getP");
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
      const stopThreshold = /* @__PURE__ */ __name(() => bestTrue === Infinity ? Infinity : bestTrue + pGoal - pStart, "stopThreshold");
      const tryMeet = /* @__PURE__ */ __name((idx) => {
        if (distF[idx] === Infinity || distB[idx] === Infinity) return;
        const trueSum = distF[idx] + distB[idx] + pStart - pGoal;
        if (trueSum < bestTrue) {
          bestTrue = trueSum;
          meetingIdx = idx;
        }
      }, "tryMeet");
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
            if (vIdx === void 0 || settledF[vIdx]) continue;
            const pV = getP(vIdx);
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
            if (aIdx === void 0 || settledB[aIdx]) continue;
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
    __name(nbaStarOnView, "nbaStarOnView");
    function bidiDijkstraOnView(view, startId, goalId) {
      if (startId === goalId) {
        return { distance: 0, path: [startId], settled: 0 };
      }
      const distF = /* @__PURE__ */ new Map([[startId, 0]]);
      const distB = /* @__PURE__ */ new Map([[goalId, 0]]);
      const parentF = /* @__PURE__ */ new Map();
      const parentB = /* @__PURE__ */ new Map();
      const settledF = /* @__PURE__ */ new Set();
      const settledB = /* @__PURE__ */ new Set();
      const heapF = new MinHeap();
      const heapB = new MinHeap();
      heapF.push(0, startId);
      heapB.push(0, goalId);
      let best = Infinity;
      let meeting = null;
      const tryMeet = /* @__PURE__ */ __name((u, df, db) => {
        const sum = df + db;
        if (sum < best) {
          best = sum;
          meeting = u;
        }
      }, "tryMeet");
      while (heapF.size > 0 && heapB.size > 0) {
        if (heapF.peek().key + heapB.peek().key >= best) break;
        if (heapF.peek().key <= heapB.peek().key) {
          const { key: d, val: u } = heapF.pop();
          if (settledF.has(u)) continue;
          if (d > (distF.get(u) ?? Infinity)) continue;
          settledF.add(u);
          const db = distB.get(u);
          if (db !== void 0) tryMeet(u, d, db);
          for (const e of view.fwd.get(u) || []) {
            if (settledF.has(e.to)) continue;
            const nd = d + e.cost;
            if (nd < (distF.get(e.to) ?? Infinity)) {
              distF.set(e.to, nd);
              parentF.set(e.to, u);
              heapF.push(nd, e.to);
              const dbTo = distB.get(e.to);
              if (dbTo !== void 0) tryMeet(e.to, nd, dbTo);
            }
          }
        } else {
          const { key: d, val: u } = heapB.pop();
          if (settledB.has(u)) continue;
          if (d > (distB.get(u) ?? Infinity)) continue;
          settledB.add(u);
          const df = distF.get(u);
          if (df !== void 0) tryMeet(u, df, d);
          for (const e of view.rev.get(u) || []) {
            if (settledB.has(e.from)) continue;
            const nd = d + e.cost;
            if (nd < (distB.get(e.from) ?? Infinity)) {
              distB.set(e.from, nd);
              parentB.set(e.from, u);
              heapB.push(nd, e.from);
              const dfFrom = distF.get(e.from);
              if (dfFrom !== void 0) tryMeet(e.from, dfFrom, nd);
            }
          }
        }
      }
      if (meeting === null || !Number.isFinite(best)) {
        return { distance: Infinity, path: [], settled: settledF.size + settledB.size };
      }
      const pathF = [];
      let cur = meeting;
      while (cur !== void 0) {
        pathF.push(cur);
        cur = parentF.get(cur);
      }
      pathF.reverse();
      const pathB = [];
      cur = parentB.get(meeting);
      while (cur !== void 0) {
        pathB.push(cur);
        cur = parentB.get(cur);
      }
      return {
        distance: best,
        path: pathF.concat(pathB),
        settled: settledF.size + settledB.size
      };
    }
    __name(bidiDijkstraOnView, "bidiDijkstraOnView");
    module.exports = {
      TiledRouter: TiledRouter2,
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
  }
});

// lib/cycling/spatial_grid.js
var require_spatial_grid = __commonJS({
  "lib/cycling/spatial_grid.js"(exports, module) {
    "use strict";
    var DEFAULT_CELL_DEG = 5e-3;
    var SpatialGrid = class {
      static {
        __name(this, "SpatialGrid");
      }
      constructor(cellDeg = DEFAULT_CELL_DEG) {
        this.cellDeg = cellDeg;
        this.cells = /* @__PURE__ */ new Map();
        this._size = 0;
      }
      get size() {
        return this._size;
      }
      _key(cx, cy) {
        return `${cx},${cy}`;
      }
      _cellOf(lon, lat) {
        return [Math.floor(lon / this.cellDeg), Math.floor(lat / this.cellDeg)];
      }
      add(id, lon, lat) {
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
        const [cx, cy] = this._cellOf(lon, lat);
        const k = this._key(cx, cy);
        let arr = this.cells.get(k);
        if (!arr) {
          arr = [];
          this.cells.set(k, arr);
        }
        arr.push(id, lon, lat);
        this._size += 1;
      }
      nearest(lon, lat, maxRings = 16) {
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
        const [cx, cy] = this._cellOf(lon, lat);
        let best = null;
        let bestDistSq = Infinity;
        const cosLat = Math.cos(lat * Math.PI / 180);
        const scaleLon = cosLat * 111320;
        const scaleLat = 110540;
        const cellMeters = this.cellDeg * Math.min(scaleLon, scaleLat);
        for (let ring = 0; ring <= maxRings; ring += 1) {
          if (best !== null && ring >= 2) {
            const ringInnerMeters = (ring - 1) * cellMeters;
            if (ringInnerMeters * ringInnerMeters > bestDistSq) break;
          }
          for (let dy = -ring; dy <= ring; dy += 1) {
            for (let dx = -ring; dx <= ring; dx += 1) {
              if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
              const arr = this.cells.get(this._key(cx + dx, cy + dy));
              if (!arr) continue;
              for (let i = 0; i < arr.length; i += 3) {
                const id = arr[i];
                const nlon = arr[i + 1];
                const nlat = arr[i + 2];
                const dxm = (nlon - lon) * scaleLon;
                const dym = (nlat - lat) * scaleLat;
                const d2 = dxm * dxm + dym * dym;
                if (d2 < bestDistSq) {
                  bestDistSq = d2;
                  best = id;
                }
              }
            }
          }
        }
        if (best === null) return null;
        return { id: best, distanceMeters: Math.sqrt(bestDistSq) };
      }
    };
    module.exports = { SpatialGrid, DEFAULT_CELL_DEG };
  }
});

// lib/cycling/tile_binary.js
var require_tile_binary = __commonJS({
  "lib/cycling/tile_binary.js"(exports, module) {
    "use strict";
    var MAGIC = 1162103122;
    var VERSION = 1;
    var VERSION_CH = 2;
    var HEADER_BYTES = 16;
    var NODE_BYTES = 16;
    var NODE_BYTES_V2 = 20;
    var EDGE_BYTES = 28;
    var EDGE_BYTES_V2 = 40;
    var LEVEL_BITS_V2 = 31;
    var CORE_BIT_V2 = 2 ** LEVEL_BITS_V2;
    var LEVEL_MAX_V2 = CORE_BIT_V2 - 1;
    function encodeTile(nodes, edges) {
      const total = HEADER_BYTES + nodes.length * NODE_BYTES + edges.length * EDGE_BYTES;
      const buf = new ArrayBuffer(total);
      const dv = new DataView(buf);
      dv.setUint32(0, MAGIC, true);
      dv.setUint8(4, VERSION);
      dv.setUint8(5, 0);
      dv.setUint16(6, 0, true);
      dv.setUint32(8, nodes.length, true);
      dv.setUint32(12, edges.length, true);
      let off = HEADER_BYTES;
      for (const n of nodes) {
        dv.setFloat64(off, n.id, true);
        dv.setFloat32(off + 8, n.lon, true);
        dv.setFloat32(off + 12, n.lat, true);
        off += NODE_BYTES;
      }
      for (const e of edges) {
        dv.setFloat64(off, e.from, true);
        dv.setFloat64(off + 8, e.to, true);
        dv.setFloat32(off + 16, e.toLon, true);
        dv.setFloat32(off + 20, e.toLat, true);
        dv.setFloat32(off + 24, e.cost, true);
        off += EDGE_BYTES;
      }
      return buf;
    }
    __name(encodeTile, "encodeTile");
    function encodeTileV2(nodes, edges) {
      const total = HEADER_BYTES + nodes.length * NODE_BYTES_V2 + edges.length * EDGE_BYTES_V2;
      const buf = new ArrayBuffer(total);
      const dv = new DataView(buf);
      dv.setUint32(0, MAGIC, true);
      dv.setUint8(4, VERSION_CH);
      dv.setUint8(5, 0);
      dv.setUint16(6, 0, true);
      dv.setUint32(8, nodes.length, true);
      dv.setUint32(12, edges.length, true);
      let off = HEADER_BYTES;
      for (const n of nodes) {
        dv.setFloat64(off, n.id, true);
        dv.setFloat32(off + 8, n.lon, true);
        dv.setFloat32(off + 12, n.lat, true);
        const level = n.level;
        if (!Number.isInteger(level) || level < 0 || level > LEVEL_MAX_V2) {
          throw new Error(
            `v2 encode: level must be integer in [0, ${LEVEL_MAX_V2}], got ${level}`
          );
        }
        const word = level + (n.core ? CORE_BIT_V2 : 0) >>> 0;
        dv.setUint32(off + 16, word, true);
        off += NODE_BYTES_V2;
      }
      for (const e of edges) {
        dv.setFloat64(off, e.from, true);
        dv.setFloat64(off + 8, e.to, true);
        dv.setFloat32(off + 16, e.toLon, true);
        dv.setFloat32(off + 20, e.toLat, true);
        dv.setFloat32(off + 24, e.cost, true);
        dv.setUint32(off + 28, 0, true);
        dv.setFloat64(off + 32, e.viaId || 0, true);
        off += EDGE_BYTES_V2;
      }
      return buf;
    }
    __name(encodeTileV2, "encodeTileV2");
    function decodeTile(arrayBuffer) {
      if (arrayBuffer.byteLength < HEADER_BYTES) {
        throw new Error("tile too small");
      }
      const dv = new DataView(arrayBuffer);
      const magic = dv.getUint32(0, true);
      if (magic !== MAGIC) throw new Error("tile magic mismatch");
      const version = dv.getUint8(4);
      if (version === VERSION) return decodeTileV1(arrayBuffer, dv);
      if (version === VERSION_CH) return decodeTileV2(arrayBuffer, dv);
      throw new Error(`unsupported tile version ${version}`);
    }
    __name(decodeTile, "decodeTile");
    function decodeTileV1(arrayBuffer, dv) {
      const nodeCount = dv.getUint32(8, true);
      const edgeCount = dv.getUint32(12, true);
      const expected = HEADER_BYTES + nodeCount * NODE_BYTES + edgeCount * EDGE_BYTES;
      if (arrayBuffer.byteLength !== expected) {
        throw new Error(
          `tile size mismatch: got ${arrayBuffer.byteLength} expected ${expected}`
        );
      }
      const nodes = new Array(nodeCount);
      let off = HEADER_BYTES;
      for (let i = 0; i < nodeCount; i += 1) {
        nodes[i] = {
          id: dv.getFloat64(off, true),
          lon: dv.getFloat32(off + 8, true),
          lat: dv.getFloat32(off + 12, true),
          level: 0
        };
        off += NODE_BYTES;
      }
      const edges = new Array(edgeCount);
      for (let i = 0; i < edgeCount; i += 1) {
        edges[i] = {
          from: dv.getFloat64(off, true),
          to: dv.getFloat64(off + 8, true),
          toLon: dv.getFloat32(off + 16, true),
          toLat: dv.getFloat32(off + 20, true),
          cost: dv.getFloat32(off + 24, true),
          viaId: 0
        };
        off += EDGE_BYTES;
      }
      return { version: VERSION, nodes, edges };
    }
    __name(decodeTileV1, "decodeTileV1");
    function decodeTileV2(arrayBuffer, dv) {
      const nodeCount = dv.getUint32(8, true);
      const edgeCount = dv.getUint32(12, true);
      const expected = HEADER_BYTES + nodeCount * NODE_BYTES_V2 + edgeCount * EDGE_BYTES_V2;
      if (arrayBuffer.byteLength !== expected) {
        throw new Error(
          `tile v2 size mismatch: got ${arrayBuffer.byteLength} expected ${expected}`
        );
      }
      const nodes = new Array(nodeCount);
      let off = HEADER_BYTES;
      for (let i = 0; i < nodeCount; i += 1) {
        const word = dv.getUint32(off + 16, true);
        nodes[i] = {
          id: dv.getFloat64(off, true),
          lon: dv.getFloat32(off + 8, true),
          lat: dv.getFloat32(off + 12, true),
          level: word >= CORE_BIT_V2 ? word - CORE_BIT_V2 : word,
          core: word >= CORE_BIT_V2 ? 1 : 0
        };
        off += NODE_BYTES_V2;
      }
      const edges = new Array(edgeCount);
      for (let i = 0; i < edgeCount; i += 1) {
        edges[i] = {
          from: dv.getFloat64(off, true),
          to: dv.getFloat64(off + 8, true),
          toLon: dv.getFloat32(off + 16, true),
          toLat: dv.getFloat32(off + 20, true),
          cost: dv.getFloat32(off + 24, true),
          viaId: dv.getFloat64(off + 32, true)
        };
        off += EDGE_BYTES_V2;
      }
      return { version: VERSION_CH, nodes, edges };
    }
    __name(decodeTileV2, "decodeTileV2");
    module.exports = {
      MAGIC,
      VERSION,
      VERSION_CH,
      HEADER_BYTES,
      NODE_BYTES,
      NODE_BYTES_V2,
      EDGE_BYTES,
      EDGE_BYTES_V2,
      LEVEL_BITS_V2,
      LEVEL_MAX_V2,
      CORE_BIT_V2,
      encodeTile,
      encodeTileV2,
      decodeTile
    };
  }
});

// node-built-in-modules:fs
import libDefault from "fs";
var require_fs = __commonJS({
  "node-built-in-modules:fs"(exports, module) {
    module.exports = libDefault;
  }
});

// node-built-in-modules:path
import libDefault2 from "path";
var require_path = __commonJS({
  "node-built-in-modules:path"(exports, module) {
    module.exports = libDefault2;
  }
});

// lib/cycling/tile_loader.js
var require_tile_loader = __commonJS({
  "lib/cycling/tile_loader.js"(exports, module) {
    "use strict";
    var { SpatialGrid } = require_spatial_grid();
    var { decodeTile } = require_tile_binary();
    var DEFAULT_MAX_TILES = 128;
    var DEFAULT_MAX_MISSES = 1024;
    var DEFAULT_LOAD_CONCURRENCY = 8;
    var TileLoader2 = class {
      static {
        __name(this, "TileLoader");
      }
      constructor(fetcher, opts = {}) {
        this.fetcher = fetcher;
        this.opts = opts;
        this.maxTiles = opts.maxTiles ?? DEFAULT_MAX_TILES;
        this.maxMisses = opts.maxMisses ?? DEFAULT_MAX_MISSES;
        this.loadConcurrency = opts.loadConcurrency ?? DEFAULT_LOAD_CONCURRENCY;
        this._reset();
      }
      _reset() {
        this.loaded = /* @__PURE__ */ new Set();
        this.misses = /* @__PURE__ */ new Set();
        this.inflight = /* @__PURE__ */ new Map();
        this.view = {
          nodes: /* @__PURE__ */ new Map(),
          fwd: /* @__PURE__ */ new Map(),
          rev: /* @__PURE__ */ new Map(),
          // CH 用 shortcut edge は **別ストア** に保持し、JS object でなく
          // packed number 配列で持つ。NBA* / A* は shortcut を見ないので
          // fwd/rev には載せず、ここだけ参照されないようにする。
          // 形式: Map<fromId, number[]>。配列は 5 要素 / edge の packed flat:
          //   [to0, cost0, viaId0, toLon0, toLat0, to1, cost1, ...]
          // 1 edge = 40B (JS Object 比 ~60% 減)。Workers 128MB 内に CH を
          // 収めるためのメモリ最適化 (PR #78 で exceededMemory が判明したため)。
          scFwd: /* @__PURE__ */ new Map(),
          scRev: /* @__PURE__ */ new Map(),
          // ノード ID ↔ 連続インデックスの双方向マップ。Dijkstra/A* で
          // Map<nodeId,dist> を Float64Array(N) に置換するために使う。
          nodeIdToIndex: /* @__PURE__ */ new Map(),
          indexToNodeId: [],
          // CH (タイル v2) で各ノードの level を保持。v1 タイルしかロード
          // していなければ空 Map になる。hasCh=true で chQuery を有効化。
          levels: /* @__PURE__ */ new Map(),
          // core ノード集合: partial CH の uncontracted core (top fraction +
          // degree-skipped)。chQueryOnView 側で core-core edge は level 比較
          // skip を許可する (lateral relax 可能) 根拠として参照。
          cores: /* @__PURE__ */ new Set(),
          hasCh: false
        };
        this.grid = new SpatialGrid();
      }
      has(key) {
        return this.loaded.has(key);
      }
      async load(key) {
        if (this.loaded.has(key)) return true;
        if (this.misses.has(key)) return false;
        let p = this.inflight.get(key);
        if (!p) {
          if (this.loaded.size >= this.maxTiles) {
            if (this.inflight.size > 0) return false;
            this._reset();
          }
          p = (async () => {
            try {
              const buf = await this.fetcher(key);
              if (buf == null) {
                if (this.misses.size >= this.maxMisses) {
                  const it = this.misses.values().next();
                  if (!it.done) this.misses.delete(it.value);
                }
                this.misses.add(key);
                return false;
              }
              this._mergeBinary(buf);
              this.loaded.add(key);
              return true;
            } finally {
              this.inflight.delete(key);
            }
          })();
          this.inflight.set(key, p);
        }
        return p;
      }
      async loadMany(keys) {
        const results = new Array(keys.length);
        let next = 0;
        const worker = /* @__PURE__ */ __name(async () => {
          while (true) {
            const i = next++;
            if (i >= keys.length) break;
            results[i] = await this.load(keys[i]);
          }
        }, "worker");
        const pool = Math.min(this.loadConcurrency, Math.max(keys.length, 1));
        await Promise.all(Array.from({ length: pool }, worker));
        return results;
      }
      /**
       * Fetch raw ArrayBuffers for a set of tile keys using the same R2/edge
       * cache pipeline as load()/loadMany(), but **without** merging into view.
       * Returns an array of `{ key, buf }` for tiles that were fetched
       * successfully (skipping null misses). Used by CH CSR builders that need
       * the raw binary to construct an ephemeral typed-array graph without
       * inflating it into JS objects in this.view.
       *
       * Fetches are made through the same fetcher (R2 + edge cache), so
       * subsequent merges via load() will hit the edge cache fast path.
       */
      async loadBuffers(keys) {
        const out = [];
        let next = 0;
        const worker = /* @__PURE__ */ __name(async () => {
          while (true) {
            const i = next++;
            if (i >= keys.length) break;
            const k = keys[i];
            try {
              const buf = await this.fetcher(k);
              if (buf) out.push({ key: k, buf });
            } catch (_) {
            }
          }
        }, "worker");
        const pool = Math.min(this.loadConcurrency, Math.max(keys.length, 1));
        await Promise.all(Array.from({ length: pool }, worker));
        return out;
      }
      _mergeBinary(arrayBuffer) {
        const { nodes, fwd, rev, scFwd, scRev, nodeIdToIndex, indexToNodeId, levels, cores } = this.view;
        const grid = this.grid;
        const registerNode = /* @__PURE__ */ __name((id, lon, lat) => {
          if (nodes.has(id)) return;
          nodes.set(id, [lon, lat]);
          nodeIdToIndex.set(id, indexToNodeId.length);
          indexToNodeId.push(id);
          grid.add(id, lon, lat);
        }, "registerNode");
        const parsed = decodeTile(arrayBuffer);
        const { nodes: tileNodes, edges: tileEdges, version } = parsed;
        const useCh = !!(this.opts && this.opts.enableCh) && version === 2;
        if (useCh) this.view.hasCh = true;
        for (const n of tileNodes) {
          registerNode(n.id, n.lon, n.lat);
          if (useCh && !levels.has(n.id)) {
            levels.set(n.id, n.level);
            if (n.core) cores.add(n.id);
          }
        }
        const pushSc = /* @__PURE__ */ __name((m, key, to, cost, viaId, toLon, toLat) => {
          let a = m.get(key);
          if (!a) {
            a = [];
            m.set(key, a);
          }
          a.push(to, cost, viaId, toLon, toLat);
        }, "pushSc");
        for (const e of tileEdges) {
          const isShortcut = version === 2 && e.viaId && e.viaId !== 0;
          if (!useCh && isShortcut) continue;
          if (useCh && isShortcut) {
            pushSc(scFwd, e.from, e.to, e.cost, e.viaId, e.toLon, e.toLat);
            pushSc(scRev, e.to, e.from, e.cost, e.viaId, e.toLon, e.toLat);
            registerNode(e.to, e.toLon, e.toLat);
            continue;
          }
          let f = fwd.get(e.from);
          if (!f) {
            f = [];
            fwd.set(e.from, f);
          }
          f.push(e);
          let r = rev.get(e.to);
          if (!r) {
            r = [];
            rev.set(e.to, r);
          }
          r.push(e);
          registerNode(e.to, e.toLon, e.toLat);
        }
      }
    };
    var TILE_CACHE_MAX_AGE_S = 7 * 24 * 60 * 60;
    function makeR2Fetcher2(bucket, prefix = "tiles/", cache = null, cacheVersion = "") {
      return async (key) => {
        const cacheUrl = cacheVersion ? `https://cycling-tile-cache.internal/${cacheVersion}/${prefix}${key}.bin` : `https://cycling-tile-cache.internal/${prefix}${key}.bin`;
        const cacheReq = cache ? new Request(cacheUrl, { method: "GET" }) : null;
        if (cacheReq && cache) {
          try {
            const hit = await cache.match(cacheReq);
            if (hit) return hit.arrayBuffer();
          } catch (err) {
            console.warn("tile cache match failed", err);
          }
        }
        const obj = await bucket.get(`${prefix}${key}.bin`);
        if (!obj) return null;
        const buf = await obj.arrayBuffer();
        if (cacheReq && cache) {
          try {
            const cacheable = new Response(buf, {
              headers: {
                "content-type": "application/octet-stream",
                "cache-control": `public, max-age=${TILE_CACHE_MAX_AGE_S}`
              }
            });
            await cache.put(cacheReq, cacheable);
          } catch (err) {
            console.warn("tile cache put failed", err);
          }
        }
        return buf;
      };
    }
    __name(makeR2Fetcher2, "makeR2Fetcher");
    function makeFsFetcher(dir) {
      const fs = require_fs();
      const path = require_path();
      return async (key) => {
        const p = path.join(dir, "tiles", `${key}.bin`);
        if (!fs.existsSync(p)) return null;
        const buf = fs.readFileSync(p);
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      };
    }
    __name(makeFsFetcher, "makeFsFetcher");
    module.exports = {
      TileLoader: TileLoader2,
      makeR2Fetcher: makeR2Fetcher2,
      makeFsFetcher,
      DEFAULT_MAX_TILES,
      DEFAULT_MAX_MISSES,
      DEFAULT_LOAD_CONCURRENCY
    };
  }
});

// lib/cycling/dnf_pack.js
var require_dnf_pack = __commonJS({
  "lib/cycling/dnf_pack.js"(exports, module) {
    "use strict";
    var EARTH_R = 6378137;
    function haversineMeters(aLon, aLat, bLon, bLat) {
      const toRad = Math.PI / 180;
      const dLat = (bLat - aLat) * toRad;
      const dLon = (bLon - aLon) * toRad;
      const lat1 = aLat * toRad;
      const lat2 = bLat * toRad;
      const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
      return 2 * EARTH_R * Math.asin(Math.sqrt(s));
    }
    __name(haversineMeters, "haversineMeters");
    function perpendicularMeters(pLon, pLat, aLon, aLat, bLon, bLat) {
      const lat0 = (aLat + bLat) * 0.5 * (Math.PI / 180);
      const mPerDegLat = 111320;
      const mPerDegLon = mPerDegLat * Math.cos(lat0);
      const ax = aLon * mPerDegLon, ay = aLat * mPerDegLat;
      const bx = bLon * mPerDegLon, by = bLat * mPerDegLat;
      const px = pLon * mPerDegLon, py = pLat * mPerDegLat;
      const dx = bx - ax, dy = by - ay;
      const segLen2 = dx * dx + dy * dy;
      if (segLen2 === 0) return Math.hypot(px - ax, py - ay);
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / segLen2));
      const qx = ax + t * dx;
      const qy = ay + t * dy;
      return Math.hypot(px - qx, py - qy);
    }
    __name(perpendicularMeters, "perpendicularMeters");
    function douglasPeucker2(coords, toleranceMeters) {
      if (!Array.isArray(coords) || coords.length <= 2 || toleranceMeters <= 0) {
        return coords;
      }
      const n = coords.length;
      const keep = new Uint8Array(n);
      keep[0] = 1;
      keep[n - 1] = 1;
      const stack = [[0, n - 1]];
      while (stack.length > 0) {
        const [s, e] = stack.pop();
        if (e - s < 2) continue;
        const [aLon, aLat] = coords[s];
        const [bLon, bLat] = coords[e];
        let maxD = -1;
        let maxIdx = s + 1;
        for (let i = s + 1; i < e; i += 1) {
          const [pLon, pLat] = coords[i];
          const d = perpendicularMeters(pLon, pLat, aLon, aLat, bLon, bLat);
          if (d > maxD) {
            maxD = d;
            maxIdx = i;
          }
        }
        if (maxD > toleranceMeters) {
          keep[maxIdx] = 1;
          stack.push([s, maxIdx]);
          stack.push([maxIdx, e]);
        }
      }
      const out = [];
      for (let i = 0; i < n; i += 1) {
        if (keep[i]) out.push(coords[i]);
      }
      return out;
    }
    __name(douglasPeucker2, "douglasPeucker");
    function routeBBoxWithBuffer2(coords, bufferMeters) {
      if (!Array.isArray(coords) || coords.length === 0) {
        return null;
      }
      let minLon = Infinity, maxLon = -Infinity;
      let minLat = Infinity, maxLat = -Infinity;
      for (const c of coords) {
        if (c[0] < minLon) minLon = c[0];
        if (c[0] > maxLon) maxLon = c[0];
        if (c[1] < minLat) minLat = c[1];
        if (c[1] > maxLat) maxLat = c[1];
      }
      const meanLat = (minLat + maxLat) * 0.5;
      const latBuf = bufferMeters / 111320;
      const lonBuf = bufferMeters / (111320 * Math.max(0.01, Math.cos(meanLat * Math.PI / 180)));
      return {
        minLng: minLon - lonBuf,
        maxLng: maxLon + lonBuf,
        minLat: minLat - latBuf,
        maxLat: maxLat + latBuf
      };
    }
    __name(routeBBoxWithBuffer2, "routeBBoxWithBuffer");
    module.exports = {
      haversineMeters,
      perpendicularMeters,
      douglasPeucker: douglasPeucker2,
      routeBBoxWithBuffer: routeBBoxWithBuffer2
    };
  }
});

// worker.mjs
var import_map_data = __toESM(require_map_data(), 1);
var import_tiled_router = __toESM(require_tiled_router(), 1);
var import_tile_loader = __toESM(require_tile_loader(), 1);
var import_dnf_pack = __toESM(require_dnf_pack(), 1);

// rust-router/pkg/rust_router.js
import * as wasm2 from "./27a1a71683c179107b4f1732994d81261d9b3054-rust_router_bg.wasm";

// rust-router/pkg/rust_router_bg.js
function route_ch(buffers, from_lon, from_lat, to_lon, to_lat, max_snap_meters) {
  const ret = wasm.route_ch(buffers, from_lon, from_lat, to_lon, to_lat, max_snap_meters);
  return ret;
}
__name(route_ch, "route_ch");
var cachedTextDecoder = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
var wasm;
function __wbg_set_wasm(val) {
  wasm = val;
}
__name(__wbg_set_wasm, "__wbg_set_wasm");

// rust-router/pkg/rust_router.js
__wbg_set_wasm(wasm2);
wasm2.__wbindgen_start();

// worker.mjs
var {
  parseSupplyPointFilters,
  buildSupplyPointsQuery,
  toFeatureCollection,
  ValidationError
} = import_map_data.default;
var { TiledRouter } = import_tiled_router.default;
var { TileLoader, makeR2Fetcher } = import_tile_loader.default;
var { douglasPeucker, routeBBoxWithBuffer } = import_dnf_pack.default;
var API_PATH = "/api/supply-points";
var ROUTE_PATH = "/api/route";
var DNF_PACK_PATH = "/api/dnf-pack";
var tileLoaderCache = null;
var NAMED_PLACEHOLDER_RE = /:([A-Za-z_][A-Za-z0-9_]*)/g;
function prepareForD1(db, sql, params) {
  const ordered = [];
  const positionalSql = sql.replace(NAMED_PLACEHOLDER_RE, (_, name) => {
    if (!Object.prototype.hasOwnProperty.call(params, name)) {
      throw new Error(`missing param :${name} for supply-points query`);
    }
    ordered.push(params[name]);
    return "?";
  });
  return db.prepare(positionalSql).bind(...ordered);
}
__name(prepareForD1, "prepareForD1");
function ensureTileLoader(env) {
  if (tileLoaderCache) return tileLoaderCache;
  if (!env.GRAPH) {
    const err = new Error("GRAPH R2 binding is not configured");
    err.code = "no_graph_binding";
    throw err;
  }
  tileLoaderCache = new TileLoader(
    // PR #85: CSR-only モード (TileLoader.view を一切使わない)。
    // - loadBuffers のみで R2 fetch (ArrayBuffer cache、view 非 populate)
    // - 各 request で buildCsr → snapCsr → chQueryCsr → release
    // - persistent な decoded state なし。peak memory ≈ csr ~50MB + bufs ~16MB
    // PR #83 で view + csr ephemeral 構成が exceededMemory だったため、view
    // 自体を捨てる。cache v14。
    makeR2Fetcher(env.GRAPH, "tiles/", caches.default, "v14")
  );
  return tileLoaderCache;
}
__name(ensureTileLoader, "ensureTileLoader");
var TILE_CACHE_TTL_S = 7 * 24 * 60 * 60;
var SUPPLY_POINTS_CACHE_TTL_S = 5 * 60;
var ROUTE_CACHE_TTL_S = 5 * 60;
var DNF_PACK_CACHE_TTL_S = 5 * 60;
var DNF_DEFAULT_BUFFER_M = 500;
var DNF_DEFAULT_TOLERANCE_M = 5;
var DNF_DEFAULT_LIMIT = 200;
var DNF_MAX_BUFFER_M = 2e3;
var DNF_MAX_TOLERANCE_M = 50;
var DNF_MAX_LIMIT = 1e3;
async function withEdgeCache(request, ttlSeconds, build) {
  const cache = caches.default;
  try {
    const hit = await cache.match(request);
    if (hit) return hit;
  } catch (err) {
    console.warn("edge cache match failed", err);
  }
  const fresh = await build();
  const requestedCacheControl = fresh.headers.get("cache-control") || "";
  const optOut = /no-store|no-cache|private/i.test(requestedCacheControl);
  if (fresh.ok && request.method === "GET" && !optOut) {
    try {
      const cacheable = new Response(fresh.clone().body, fresh);
      cacheable.headers.set("cache-control", `public, max-age=${ttlSeconds}`);
      await cache.put(request, cacheable);
    } catch (err) {
      console.warn("edge cache put failed", err);
    }
  }
  return fresh;
}
__name(withEdgeCache, "withEdgeCache");
function parseLonLat(value) {
  if (!value) return null;
  const parts = value.split(",");
  if (parts.length !== 2) return null;
  const lon = Number(parts[0]);
  const lat = Number(parts[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (lon < -180 || lon > 180) return null;
  if (lat < -90 || lat > 90) return null;
  return [lon, lat];
}
__name(parseLonLat, "parseLonLat");
async function handleRoute(url, env) {
  const from = parseLonLat(url.searchParams.get("from"));
  const to = parseLonLat(url.searchParams.get("to"));
  if (!from || !to) {
    return Response.json(
      { error: 'from and to must be in "lon,lat" form' },
      { status: 400 }
    );
  }
  let loader;
  try {
    loader = ensureTileLoader(env);
  } catch (err) {
    if (err && err.code === "no_graph_binding") {
      return Response.json({ error: err.message }, { status: 503 });
    }
    throw err;
  }
  const wasmResult = await tryWasmRoute(loader, from, to);
  let r;
  if (wasmResult) {
    r = wasmResult;
  } else {
    const router = new TiledRouter(loader, { csrOnly: true });
    r = await router.route(from[0], from[1], to[0], to[1]);
  }
  if (r.error) {
    const status = r.error === "unreachable_in_corridor" ? 404 : r.error === "too_far" ? 422 : r.error === "corridor_too_large" ? 422 : r.error === "no_nearby_node_from" || r.error === "no_nearby_node_to" ? 422 : 500;
    return Response.json(r, { status });
  }
  return Response.json(
    {
      type: "Feature",
      geometry: { type: "LineString", coordinates: r.coordinates },
      properties: {
        distance_cost: r.distance_cost,
        node_count: r.node_count,
        settled: r.settled,
        snap_from_m: r.snap_from_m,
        snap_to_m: r.snap_to_m,
        algorithm: r.algorithm
      }
    },
    {
      headers: {
        "content-type": "application/geo+json; charset=utf-8",
        "cache-control": "public, max-age=300"
      }
    }
  );
}
__name(handleRoute, "handleRoute");
async function tryWasmRoute(loader, from, to) {
  try {
    const corridor = corridorKeysWasm(from[0], from[1], to[0], to[1], 1);
    const snapFrom = neighborhoodKeysWasm(from[0], from[1], 1);
    const snapTo = neighborhoodKeysWasm(to[0], to[1], 1);
    const allKeys = Array.from(/* @__PURE__ */ new Set([...corridor, ...snapFrom, ...snapTo]));
    const tileBufs = await loader.loadBuffers(allKeys);
    if (tileBufs.length === 0) return null;
    const u8Bufs = tileBufs.map((t) => new Uint8Array(t.buf));
    const r = route_ch(u8Bufs, from[0], from[1], to[0], to[1], 500);
    if (!r) return { error: "wasm_returned_null" };
    if (r.error) {
      return { error: r.error };
    }
    try {
      console.log(JSON.stringify({
        evt: "route",
        mode: "wasm",
        alg: r.algorithm,
        ch_ms: r.ch_ms,
        fallback_ms: r.fallback_ms,
        csr_build_ms: r.csr_build_ms,
        csr_bytes: r.csr_bytes,
        csr_node_count: r.csr_node_count,
        csr_edge_count: r.csr_edge_count,
        dist: r.distance,
        nodes: r.node_count,
        tiles: allKeys.length,
        from: r.from_id,
        to: r.to_id,
        terminated: r.terminated
      }));
    } catch (_) {
    }
    return {
      distance_cost: r.distance,
      node_count: r.node_count,
      settled: r.settled,
      snap_from_m: r.snap_from_m,
      snap_to_m: r.snap_to_m,
      loaded_tiles: allKeys.length,
      algorithm: r.algorithm,
      coordinates: r.coords
      // [[lon, lat], ...]
    };
  } catch (err) {
    try {
      console.warn("wasm route failed, falling back to JS", err);
    } catch (_) {
    }
    return null;
  }
}
__name(tryWasmRoute, "tryWasmRoute");
var TILE_DEG_WASM = 0.05;
function corridorKeysWasm(fromLon, fromLat, toLon, toLat, padding) {
  const x0 = Math.floor(fromLon / TILE_DEG_WASM);
  const y0 = Math.floor(fromLat / TILE_DEG_WASM);
  const x1 = Math.floor(toLon / TILE_DEG_WASM);
  const y1 = Math.floor(toLat / TILE_DEG_WASM);
  const xMin = Math.min(x0, x1) - padding;
  const xMax = Math.max(x0, x1) + padding;
  const yMin = Math.min(y0, y1) - padding;
  const yMax = Math.max(y0, y1) + padding;
  const out = [];
  for (let x = xMin; x <= xMax; x += 1) {
    for (let y = yMin; y <= yMax; y += 1) {
      out.push(`${x}_${y}`);
    }
  }
  return out;
}
__name(corridorKeysWasm, "corridorKeysWasm");
function neighborhoodKeysWasm(lon, lat, radius) {
  const cx = Math.floor(lon / TILE_DEG_WASM);
  const cy = Math.floor(lat / TILE_DEG_WASM);
  const out = [];
  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      out.push(`${cx + dx}_${cy + dy}`);
    }
  }
  return out;
}
__name(neighborhoodKeysWasm, "neighborhoodKeysWasm");
function parsePositiveNumber(raw, fallback, max) {
  if (raw == null) return fallback;
  const normalized = String(raw).trim();
  if (normalized === "") return fallback;
  const v = Number(normalized);
  if (!Number.isFinite(v) || v <= 0) return fallback;
  return Math.min(v, max);
}
__name(parsePositiveNumber, "parsePositiveNumber");
function parseNonNegativeNumber(raw, fallback, max) {
  if (raw == null) return fallback;
  const normalized = String(raw).trim();
  if (normalized === "") return fallback;
  const v = Number(normalized);
  if (!Number.isFinite(v) || v < 0) return fallback;
  return Math.min(v, max);
}
__name(parseNonNegativeNumber, "parseNonNegativeNumber");
async function handleDnfPack(url, env) {
  const from = parseLonLat(url.searchParams.get("from"));
  const to = parseLonLat(url.searchParams.get("to"));
  if (!from || !to) {
    return Response.json(
      { error: 'from and to must be in "lon,lat" form' },
      { status: 400 }
    );
  }
  const bufferM = parsePositiveNumber(url.searchParams.get("buffer_m"), DNF_DEFAULT_BUFFER_M, DNF_MAX_BUFFER_M);
  const toleranceM = parseNonNegativeNumber(url.searchParams.get("tolerance_m"), DNF_DEFAULT_TOLERANCE_M, DNF_MAX_TOLERANCE_M);
  const limit = parsePositiveNumber(url.searchParams.get("limit"), DNF_DEFAULT_LIMIT, DNF_MAX_LIMIT);
  let loader;
  try {
    loader = ensureTileLoader(env);
  } catch (err) {
    if (err && err.code === "no_graph_binding") {
      return Response.json({ error: err.message }, { status: 503 });
    }
    throw err;
  }
  const router = new TiledRouter(loader, { csrOnly: true });
  const r = await router.route(from[0], from[1], to[0], to[1]);
  if (r.error) {
    const status = r.error === "unreachable_in_corridor" ? 404 : r.error === "too_far" ? 422 : r.error === "corridor_too_large" ? 422 : r.error === "no_nearby_node_from" || r.error === "no_nearby_node_to" ? 422 : 500;
    return Response.json(r, { status });
  }
  const simplified = douglasPeucker(r.coordinates, toleranceM);
  const bbox = routeBBoxWithBuffer(simplified, bufferM);
  let supplyFeatures = [];
  let supplyError = null;
  if (env.DB && bbox) {
    try {
      const params = new URLSearchParams();
      params.set("bbox", `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`);
      params.set("limit", String(Math.floor(limit)));
      const chains = url.searchParams.get("chains");
      if (chains) params.set("chains", chains);
      const filters = parseSupplyPointFilters(params);
      const { sql, params: sqlParams } = buildSupplyPointsQuery(filters);
      const stmt = prepareForD1(env.DB, sql, sqlParams);
      const { results } = await stmt.all();
      const fc = toFeatureCollection(results || []);
      supplyFeatures = fc.features;
    } catch (err) {
      if (err instanceof ValidationError) {
        supplyError = err.message;
      } else {
        console.error("dnf-pack supply-points error", err);
        supplyError = "supply_points_internal";
      }
    }
  }
  return Response.json(
    {
      route: {
        type: "Feature",
        geometry: { type: "LineString", coordinates: simplified },
        properties: {
          distance_cost: r.distance_cost,
          node_count: r.node_count,
          settled: r.settled,
          snap_from_m: r.snap_from_m,
          snap_to_m: r.snap_to_m,
          algorithm: r.algorithm,
          simplified_from: r.coordinates.length,
          simplified_to: simplified.length,
          tolerance_m: toleranceM
        }
      },
      supply_points: {
        type: "FeatureCollection",
        features: supplyFeatures
      },
      meta: {
        bbox: bbox ? [bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat] : null,
        buffer_m: bufferM,
        limit,
        supply_points_count: supplyFeatures.length,
        supply_points_error: supplyError
      }
    },
    {
      headers: {
        "content-type": "application/json; charset=utf-8",
        // supply-points 取得が失敗した部分応答 (D1 障害など) は edge cache
        // に固定すると短期障害でも「空の supply_points で route だけ返す
        // 200」が 5 分間配信され続けるので、no-store で原則 origin に戻す。
        // 正常応答は通常通り 5 分キャッシュ。
        "cache-control": supplyError ? "no-store" : `public, max-age=${DNF_PACK_CACHE_TTL_S}`
      }
    }
  );
}
__name(handleDnfPack, "handleDnfPack");
async function handleSupplyPoints(url, env) {
  const filters = parseSupplyPointFilters(url.searchParams);
  const { sql, params } = buildSupplyPointsQuery(filters);
  const stmt = prepareForD1(env.DB, sql, params);
  const { results } = await stmt.all();
  return Response.json(toFeatureCollection(results || []), {
    headers: {
      "content-type": "application/geo+json; charset=utf-8",
      "cache-control": "public, max-age=60"
    }
  });
}
__name(handleSupplyPoints, "handleSupplyPoints");
function errorResponse(error) {
  if (error instanceof ValidationError) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  console.error("supply-points handler error", error);
  return Response.json({ error: "internal server error" }, { status: 500 });
}
__name(errorResponse, "errorResponse");
function asHeadResponse(response) {
  return new Response(null, { status: response.status, headers: response.headers });
}
__name(asHeadResponse, "asHeadResponse");
var worker_default = {
  /**
   * Cloudflare Workers fetch entry point. Routes /api/supply-points through D1
   * and lets every other path fall through to the static asset binding.
   */
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === API_PATH || url.pathname === ROUTE_PATH || url.pathname === DNF_PACK_PATH) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("method not allowed", { status: 405 });
      }
      let response;
      try {
        if (url.pathname === ROUTE_PATH) {
          response = await withEdgeCache(
            request,
            ROUTE_CACHE_TTL_S,
            () => handleRoute(url, env)
          );
        } else if (url.pathname === DNF_PACK_PATH) {
          response = await withEdgeCache(
            request,
            DNF_PACK_CACHE_TTL_S,
            () => handleDnfPack(url, env)
          );
        } else {
          response = await withEdgeCache(
            request,
            SUPPLY_POINTS_CACHE_TTL_S,
            () => handleSupplyPoints(url, env)
          );
        }
      } catch (error) {
        response = errorResponse(error);
      }
      return request.method === "HEAD" ? asHeadResponse(response) : response;
    }
    return env.ASSETS.fetch(request);
  }
};
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map

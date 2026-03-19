const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');

const {
  ValidationError,
  parseServerArgs,
  parseSupplyPointFilters,
  buildSupplyPointsQuery,
  toFeatureCollection
} = require('../lib/map_data');

const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.gpx': 'application/gpx+xml; charset=utf-8'
};

function printHelp() {
  console.log([
    'Usage:',
    '  node scripts/map_dev_server.js [--db .local/rideoasis-map.db] [--port 8787]',
    '',
    'Serves the frontend and GET /api/supply-points from a local SQLite DB.'
  ].join('\n'));
}

function createApiHandler(database) {
  return function handleSupplyPoints(request, requestUrl, response) {
    try {
      const filters = parseSupplyPointFilters(requestUrl.searchParams);
      const { sql, params } = buildSupplyPointsQuery(filters);
      const rows = database.prepare(sql).all(params);
      const payload = JSON.stringify(toFeatureCollection(rows));
      response.writeHead(200, { 'content-type': 'application/geo+json; charset=utf-8' });
      response.end(request.method === 'HEAD' ? '' : payload);
    } catch (error) {
      const status = error instanceof ValidationError ? 400 : 500;
      response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      response.end(request.method === 'HEAD' ? '' : JSON.stringify({ error: error?.message || String(error) }));
    }
  };
}

function resolveStaticPath(requestPathname) {
  const relative = requestPathname === '/' ? '/index.html' : requestPathname;
  const normalized = path
    .normalize(relative)
    .replace(/^[/\\]+/, '')
    .replace(/^(\.\.[/\\])+/, '');
  return path.join(FRONTEND_DIR, normalized);
}

function serveStaticFile(requestPathname, response) {
  const filePath = resolveStaticPath(requestPathname);
  if (!filePath.startsWith(FRONTEND_DIR)) {
    response.writeHead(403);
    response.end('forbidden');
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    response.writeHead(404);
    response.end('not found');
    return;
  }

  const ext = path.extname(filePath);
  const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
  response.writeHead(200, { 'content-type': mimeType });
  return fs.createReadStream(filePath).pipe(response);
}

function createServer(database) {
  const handleSupplyPoints = createApiHandler(database);

  return http.createServer((request, response) => {
    let requestUrl;
    try {
      requestUrl = new URL(request.url, 'http://localhost');
    } catch (error) {
      response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: error?.message || 'invalid request url' }));
      return;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && requestUrl.pathname === '/api/supply-points') {
      handleSupplyPoints(request, requestUrl, response);
      return;
    }

    if (request.method === 'HEAD') {
      const filePath = resolveStaticPath(requestUrl.pathname);
      if (!filePath.startsWith(FRONTEND_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        response.writeHead(404);
        response.end();
        return;
      }
      const ext = path.extname(filePath);
      const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
      response.writeHead(200, { 'content-type': mimeType });
      response.end();
      return;
    }

    if (request.method === 'GET') {
      serveStaticFile(requestUrl.pathname, response);
      return;
    }

    response.writeHead(405);
    response.end('method not allowed');
  });
}

function main() {
  const args = parseServerArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const database = new DatabaseSync(args.db, { readOnly: true });
  const server = createServer(database);
  server.listen(args.port, () => {
    console.log(`ride-oasis map server listening on http://localhost:${args.port}`);
  });
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error?.message || error);
    process.exit(1);
  }
}

module.exports = {
  FRONTEND_DIR,
  createApiHandler,
  createServer,
  resolveStaticPath
};

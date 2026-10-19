'use strict';

/**
 * A tiny static server for the visual fixture.
 *
 * The fixture imports the real core modules as ES modules, which a `file://`
 * page cannot do. Serving the repository over HTTP keeps the fixture on the
 * same code as the application without adding a dependency.
 */

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const PORT = Number(process.env.EMBER_VISUAL_PORT || 4173);
const HOST = '127.0.0.1';

const TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url || '/', `http://${HOST}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/test/visual/fixture-gallery.html';

  const file = path.resolve(ROOT, `.${pathname}`);
  if (file !== ROOT && !file.startsWith(`${ROOT}${path.sep}`)) {
    response.writeHead(403).end('forbidden');
    return;
  }

  fs.readFile(file, (error, data) => {
    if (error) {
      response.writeHead(404).end('not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    response.end(data);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`visual fixture on http://${HOST}:${PORT}/test/visual/fixture-gallery.html`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

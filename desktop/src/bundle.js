// @ts-check
'use strict';
/**
 * `app://builda/…`: the phone app's exported web bundle (`desktop/web`, built by
 * `scripts/build-web.mjs` from `mobile/`), served from disk (or from inside app.asar once
 * packaged). A real origin rather than `file://`, so the router's paths, localStorage, the Web
 * Locks the token refresh shares across windows, and a Content Security Policy all behave as they
 * do on a website.
 *
 * The export is a single page (`web.output` single): any path that is not a file is the app's
 * `index.html`, and the router reads the path.
 */
const fs = require('node:fs');
const path = require('node:path');

const SCHEME = 'app';
const HOST = 'builda';
const ORIGIN = `${SCHEME}://${HOST}`;

/** @type {Record<string, string>} */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
};

/**
 * The file a request path is served from, or the page for a route. Never outside `root`.
 * @param {string} root  absolute directory of the export
 * @param {string} pathname  the URL's path, still percent-encoded
 * @param {(p: string) => boolean} isFile
 * @returns {string | null}
 */
function fileFor(root, pathname, isFile) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const full = path.normalize(path.join(root, rel));
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  if (isFile(full)) return full;
  if (isFile(`${full}.html`)) return `${full}.html`;
  // A route, not a file: the single page. A missing ASSET (anything with an extension) is a 404,
  // or a typo in the bundle would come back as HTML and fail somewhere far from here.
  if (path.extname(rel)) return null;
  return path.join(root, 'index.html');
}

/**
 * The page's policy. Scripts only from the bundle, plus the wasm CanvasKit and SQLite compile
 * (`wasm-unsafe-eval`, not `unsafe-eval`); styles inline because react-native-web writes them so;
 * requests to the API and images from anywhere a post or a demo lives.
 * @param {string} apiOrigin
 */
function contentSecurityPolicy(apiOrigin) {
  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    `connect-src 'self' ${apiOrigin} https: http://127.0.0.1:* http://localhost:* ws://localhost:*`,
    'img-src * data: blob:',
    'media-src * data: blob:',
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/**
 * @param {import('electron').Protocol} protocol
 * @param {string} root
 * @param {string} apiOrigin
 */
function serveBundle(protocol, root, apiOrigin) {
  const csp = contentSecurityPolicy(apiOrigin);
  const isFile = (/** @type {string} */ p) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  };
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== HOST) return new Response('not found', { status: 404 });
    const file = fileFor(root, url.pathname, isFile);
    if (!file) return new Response('not found', { status: 404 });
    const body = await fs.promises.readFile(file);
    const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    /** @type {Record<string, string>} */
    const headers = { 'content-type': type, 'cache-control': 'no-cache' };
    if (type.startsWith('text/html')) headers['content-security-policy'] = csp;
    return new Response(body, { headers });
  });
}

module.exports = { SCHEME, HOST, ORIGIN, fileFor, contentSecurityPolicy, serveBundle };

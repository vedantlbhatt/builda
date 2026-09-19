// @ts-check
'use strict';
/**
 * The API, reachable from the app's own origin.
 *
 * The page is `app://builda` and the API is somewhere else, so every request is cross-origin, and
 * every one carries `Authorization`, so every one is preflighted. The server's CORS list names its
 * own website (`server/builder/main.py`, `allow_origins=[base_url]`), not this app, and a
 * preflight from an origin it does not name comes back 400 with no `Access-Control-*` header:
 * MEASURED against the local API on the first desktop launch, every screen said "offline".
 *
 * The shell answers for the API instead of asking it to list a desktop origin: the main process
 * takes every request to the API's origin (`protocol.handle` on its scheme), answers a preflight
 * itself (204 with exactly the method and headers the page asked for), and sends the real request
 * on through the network stack with `bypassCustomProtocolHandlers`, adding the allow headers to
 * the answer. Nothing else is touched: a request to any other origin goes straight through.
 */

/**
 * The headers a response to the page carries so the page may read it.
 * @param {string} appOrigin
 * @param {Headers} [request]  the preflight's own headers, echoed back
 */
function allowHeaders(appOrigin, request) {
  return {
    'access-control-allow-origin': appOrigin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': request?.get('access-control-request-method') ?? 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': request?.get('access-control-request-headers') ?? 'authorization, content-type, accept',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}

/**
 * @param {import('electron').Session} ses
 * @param {import('electron').Net} net
 * @param {string} apiOrigin  e.g. `https://api.example.com` or `http://127.0.0.1:8788`
 * @param {string} appOrigin  the page's origin, `app://builda`
 */
function bridgeApi(ses, net, apiOrigin, appOrigin) {
  const api = new URL(apiOrigin);
  const scheme = api.protocol.replace(':', '');
  ses.protocol.handle(scheme, async (request) => {
    const url = new URL(request.url);
    if (url.origin !== api.origin) return net.fetch(request, { bypassCustomProtocolHandlers: true });
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: allowHeaders(appOrigin, request.headers) });
    }
    const upstream = await net.fetch(request, { bypassCustomProtocolHandlers: true });
    const headers = new Headers(upstream.headers);
    for (const [k, v] of Object.entries(allowHeaders(appOrigin))) {
      if (k === 'access-control-allow-methods' || k === 'access-control-allow-headers' || k === 'access-control-max-age') continue;
      headers.set(k, v);
    }
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
  });
}

module.exports = { bridgeApi, allowHeaders };

// @ts-check
'use strict';
/**
 * A URL's origin as `scheme://host[:port]`, for the app's own `app://builda` scheme too.
 *
 * FOUND ON THE PACKAGED APP (2026-09-19): Node's WHATWG `URL` does not know Electron's registered
 * standard schemes, so `new URL('app://builda/now').origin` is the string "null". The sender check
 * on every IPC compared that with `app://builda`, refused the app's own page, and the packaged app
 * could not read its tokens or its machine id: it sat on "Asking for a code" and never sent a
 * request. The navigation guards had the same comparison.
 */

/** @param {string} url */
function originOf(url) {
  const u = new URL(url);
  return u.origin !== 'null' ? u.origin : `${u.protocol}//${u.host}`;
}

/** @param {string} url @param {string} origin */
function sameOrigin(url, origin) {
  try {
    return originOf(url) === origin;
  } catch {
    return false;
  }
}

module.exports = { originOf, sameOrigin };

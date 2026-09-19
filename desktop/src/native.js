// @ts-check
'use strict';
/**
 * Whether the native Mac app is running. Its island is the notch's own (`NSPanel`, SwiftUI, in
 * `Packages/BuilderKit`), and two islands on one notch is one too many: while it runs, this shell
 * shows none. `lsappinfo` asks Launch Services by bundle id; it needs no permission and answers in
 * a few milliseconds, with an ASN line when the app is up and nothing when it is not.
 */
const { execFile } = require('node:child_process');

/** `scripts/make_app.sh` BUNDLE_ID. */
const NATIVE_MAC_APP = 'com.vedantlbhatt.Builder.Mac';

/** @returns {Promise<boolean>} */
function nativeIslandRunning() {
  if (process.platform !== 'darwin') return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile('/usr/bin/lsappinfo', ['find', `bundleid=${NATIVE_MAC_APP}`], { timeout: 1500 }, (err, stdout) => {
      resolve(!err && /ASN:/.test(String(stdout)));
    });
  });
}

module.exports = { nativeIslandRunning, NATIVE_MAC_APP };

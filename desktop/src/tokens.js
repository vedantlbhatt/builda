// @ts-check
'use strict';
/**
 * The page's secure store, in the main process: every value encrypted at rest with Electron's
 * `safeStorage` (the login Keychain on a Mac, DPAPI on Windows, the secret service or kwallet on
 * Linux) in one file under the app's user data. The page reaches it only through the bridge's
 * `secureStore` (`mobile/src/web/secureStore.web.ts`), so no token ever sits in localStorage.
 *
 * Linux without a secret service has no encryption to offer (`safeStorage` falls back to a
 * hard-coded key, `getSelectedStorageBackend() === 'basic_text'`); the file is then 0600 and the
 * README says so, rather than the app pretending.
 */
const fs = require('node:fs');
const path = require('node:path');

/**
 * @param {string} file
 * @param {{ isEncryptionAvailable(): boolean, encryptString(s: string): Buffer, decryptString(b: Buffer): string }} safe
 */
function createTokenStore(file, safe) {
  /** @type {Record<string, string> | null} */
  let cache = null;

  function load() {
    if (cache) return cache;
    try {
      const buf = fs.readFileSync(file);
      const json = safe.isEncryptionAvailable() ? safe.decryptString(buf) : buf.toString('utf8');
      const parsed = JSON.parse(json);
      cache = parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      // No file yet, or one this machine's key cannot open (copied from elsewhere): signed out.
      cache = {};
    }
    return /** @type {Record<string, string>} */ (cache);
  }

  function save() {
    const json = JSON.stringify(cache ?? {});
    const data = safe.isEncryptionAvailable() ? safe.encryptString(json) : Buffer.from(json, 'utf8');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, data, { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  return {
    /** @param {string} key */
    get(key) {
      const v = load()[key];
      return typeof v === 'string' ? v : null;
    },
    /** @param {string} key @param {string} value */
    set(key, value) {
      load()[key] = String(value);
      save();
    },
    /** @param {string} key */
    remove(key) {
      const c = load();
      if (!(key in c)) return;
      delete c[key];
      save();
    },
  };
}

module.exports = { createTokenStore };

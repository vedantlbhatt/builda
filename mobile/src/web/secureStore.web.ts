/**
 * Web stand-in for `expo-secure-store`. Resolved ONLY when Metro bundles for `platform ===
 * 'web'` (see `metro.config.js`); iOS and Android import the real module.
 *
 * `expo-secure-store` ships `ExpoSecureStore.web.js` as `export default {}`, so on web every
 * call throws `UnavailabilityError`. The same three async functions keep `src/data/api.ts`
 * unchanged, over whichever store this page has:
 *
 *   - inside the desktop shell (`desktop/`), the shell's bridge: the main process encrypts each
 *     value with Electron's `safeStorage` (the login Keychain on a Mac, DPAPI on Windows) and
 *     the page never holds anything at rest;
 *   - in a plain browser, localStorage, which is also where a browser has nothing better.
 *
 * Keys are stored verbatim, which is also how an end-to-end run signs a browser page in: set
 * `builder.access` / `builder.refresh` before the app loads and `Api.loadTokens` finds them.
 * The desktop shell takes the same pair from `BUILDA_DEV_ACCESS` / `BUILDA_DEV_REFRESH` at
 * launch for the same purpose (`desktop/src/tokens.ts`).
 *
 * Nothing in this file is compiled into a native build.
 */
import { desktopBridge } from '../desktop/bridge';

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export async function getItemAsync(key: string): Promise<string | null> {
  const bridge = desktopBridge();
  if (bridge) return bridge.secureStore.get(key);
  return store()?.getItem(key) ?? null;
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  const bridge = desktopBridge();
  if (bridge) return bridge.secureStore.set(key, value);
  store()?.setItem(key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  const bridge = desktopBridge();
  if (bridge) return bridge.secureStore.remove(key);
  store()?.removeItem(key);
}

export async function isAvailableAsync(): Promise<boolean> {
  return desktopBridge() !== null || store() !== null;
}

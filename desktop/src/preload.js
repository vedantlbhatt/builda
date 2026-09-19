// @ts-check
'use strict';
/**
 * The bridge: the ONE object the page gets from the shell (`window.builda`), shaped exactly as
 * `mobile/src/desktop/bridge.ts` declares it. Sandboxed and context isolated: the page never sees
 * Node, Electron or `ipcRenderer`, only these functions, each a message to the main process.
 *
 * What this window is (the app or the island), the shell's version and the computer's name
 * arrive as arguments (`additionalArguments`), because a sandboxed preload cannot ask the OS.
 */
const { contextBridge, ipcRenderer } = require('electron');

/** @param {string} name */
function arg(name) {
  const prefix = `--builda-${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

/**
 * @param {string} channel
 * @param {(value: string) => void} cb
 */
function listen(channel, cb) {
  /** @param {unknown} _event @param {unknown} value */
  const handler = (_event, value) => {
    if (typeof value === 'string') cb(value);
  };
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

contextBridge.exposeInMainWorld('builda', {
  version: 1,
  platform: process.platform,
  appVersion: arg('version') ?? '0.0.0',
  window: arg('window') === 'island' ? 'island' : 'main',
  hostName: arg('host') ?? '',
  secureStore: {
    get: (/** @type {string} */ key) => ipcRenderer.invoke('store:get', String(key)),
    set: (/** @type {string} */ key, /** @type {string} */ value) => ipcRenderer.invoke('store:set', String(key), String(value)),
    remove: (/** @type {string} */ key) => ipcRenderer.invoke('store:remove', String(key)),
  },
  machineId: () => ipcRenderer.invoke('machine-id'),
  qr: (/** @type {string} */ text) => ipcRenderer.invoke('qr', String(text)),
  notify: (/** @type {{ title: string, body?: string, url?: string }} */ n) =>
    ipcRenderer.send('notify', { title: String(n?.title ?? ''), body: String(n?.body ?? ''), url: n?.url ? String(n.url) : null }),
  copyText: (/** @type {string} */ text) => ipcRenderer.send('copy', String(text)),
  saveImage: (/** @type {string} */ dataUrl, /** @type {string} */ name) => ipcRenderer.invoke('image:save', String(dataUrl), String(name)),
  saveFiles: (/** @type {{ name: string, bytes: Uint8Array }[]} */ files, /** @type {string} */ folder) =>
    ipcRenderer.invoke(
      'files:save',
      Array.isArray(files) ? files.map((f) => ({ name: String(f?.name ?? ''), bytes: f?.bytes instanceof Uint8Array ? f.bytes : new Uint8Array(0) })) : [],
      String(folder),
    ),
  openExternal: (/** @type {string} */ url) => ipcRenderer.send('open-external', String(url)),
  // Subscribing is also the page saying it is ready: a link that launched the app waits in the
  // main process until something is listening for it.
  onDeepLink: (/** @type {(url: string) => void} */ cb) => {
    const off = listen('deep-link', cb);
    ipcRenderer.send('deep-link:ready');
    return off;
  },
  onCommand: (/** @type {(command: string) => void} */ cb) => listen('command', cb),
  openMain: (/** @type {string | undefined} */ path) => ipcRenderer.send('open-main', path ? String(path) : null),
  island: {
    setFrame: (/** @type {{ hit: { x: number, y: number, width: number, height: number } | null }} */ frame) =>
      ipcRenderer.send('island:frame', frame && frame.hit ? { x: +frame.hit.x, y: +frame.hit.y, width: +frame.hit.width, height: +frame.hit.height } : null),
    setEnabled: (/** @type {boolean} */ on) => ipcRenderer.send('island:enabled', Boolean(on)),
  },
});

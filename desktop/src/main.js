// @ts-check
'use strict';
/**
 * Builda for Mac, Windows and Linux: the main process.
 *
 * The app is the PHONE APP'S OWN BUNDLE, exported for the web from `mobile/` and loaded from disk
 * over `app://builda` (`bundle.js`); in development it is Expo's dev server (`BUILDA_DEV_URL`).
 * The page lays itself out for a desktop (`mobile/src/desktop/`), so every feature is the phone's
 * code and parity is structural. This process adds only what a page cannot do for itself:
 *
 *   - windows: the app (a hidden title bar with the traffic lights inset on a Mac, the standard
 *     frame on Windows and Linux) and the island (`island.js`);
 *   - one instance, and `builder://` links from the OS routed into the app;
 *   - a secure store for the tokens (`tokens.js`, Electron's safeStorage);
 *   - native notifications, the clipboard, the system browser for outside links, and a shared
 *     card saved to Downloads (`image.js`);
 *   - the menu (`menu.js`) and, where there is no menu bar island, a tray;
 *   - the API reachable from the app's origin (`cors.js`).
 *
 * Every page is sandboxed and context isolated; the bridge in `preload.js` is the whole surface.
 */
const { app, BrowserWindow, Menu, Notification, Tray, clipboard, ipcMain, nativeImage, net, protocol, safeStorage, session, shell } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ORIGIN, SCHEME, serveBundle } = require('./bundle');
const { bridgeApi } = require('./cors');
const { isAppLink, isExternalAllowed } = require('./geometry');
const { freePath, pngFromDataUrl, safeName } = require('./image');
const { createIsland } = require('./island');
const { buildMenu } = require('./menu');
const { nativeIslandRunning } = require('./native');
const { qrModules } = require('./qr');
const { createMemoryStore, createTokenStore } = require('./tokens');

const ROOT = path.join(__dirname, '..');
const WEB_DIR = path.join(ROOT, 'web');
const DEV_URL = process.env.BUILDA_DEV_URL || null;
const APP_ORIGIN = DEV_URL ? new URL(DEV_URL).origin : ORIGIN;
const MAC = process.platform === 'darwin';
const BG = '#141210';
/** `BUILDA_DEBUG=1`: what the shell decided, on stdout. */
const debug = (...a) => {
  if (process.env.BUILDA_DEBUG) console.log('[builda]', ...a);
};

// A separate profile for a test run, so it never touches the installed app's tokens.
if (process.env.BUILDA_USER_DATA) app.setPath('userData', path.resolve(process.env.BUILDA_USER_DATA));

/** Where the bundle points, written beside it by `scripts/build-web.mjs`. */
function readBuildInfo() {
  try {
    return JSON.parse(fs.readFileSync(path.join(WEB_DIR, 'builda.json'), 'utf8'));
  } catch {
    return {};
  }
}
const BUILD = readBuildInfo();
const API_BASE = process.env.BUILDA_API_URL || BUILD.apiBaseUrl || 'http://localhost:8000';
const API_ORIGIN = new URL(API_BASE).origin;

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } },
]);

// ------------------------------------------------------------------ one instance, and links

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

/** Links that arrived before the page could take them. */
/** @type {string[]} */
const pendingLinks = [];
let pageListening = false;

function deliverLink(/** @type {string} */ url) {
  debug('link', url, pageListening ? 'to the page' : 'held');
  if (!isAppLink(url)) return;
  const win = showMain();
  if (pageListening && win) win.webContents.send('deep-link', url);
  else pendingLinks.push(url);
}

function registerScheme() {
  if (process.defaultApp && process.argv.length >= 2) {
    // `electron .` in development: register the dev binary with this project as its argument.
    app.setAsDefaultProtocolClient('builder', process.execPath, [path.resolve(process.argv[1] ?? '.')]);
  } else {
    app.setAsDefaultProtocolClient('builder');
  }
}

app.on('open-url', (event, url) => {
  event.preventDefault();
  if (app.isReady()) deliverLink(url);
  else pendingLinks.push(url);
});

app.on('second-instance', (_event, argv) => {
  debug('second instance', argv.slice(1).join(' '));
  const link = argv.find((a) => isAppLink(a));
  if (link) deliverLink(link);
  else showMain();
});

// ------------------------------------------------------------------ the store and the id

/** @type {ReturnType<typeof createTokenStore> | ReturnType<typeof createMemoryStore> | null} */
let store = null;

function machineId() {
  const file = path.join(app.getPath('userData'), 'machine-id');
  let raw = '';
  try {
    raw = fs.readFileSync(file, 'utf8').trim();
  } catch {
    raw = '';
  }
  if (!raw) {
    raw = crypto.randomUUID();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, raw, { mode: 0o600 });
  }
  // Hashed like the Mac agent's (`builder-machine-v1|…`), so the server stores no raw id.
  return crypto.createHash('sha256').update(`builda-desktop-v1|${raw}`).digest('hex');
}

/** A test run can start signed in, the way `scripts/e2e_web.mjs` injects a browser's tokens. */
function seedDevTokens() {
  if (!store) return;
  let access = process.env.BUILDA_DEV_ACCESS || null;
  let refresh = process.env.BUILDA_DEV_REFRESH || null;
  if (process.env.BUILDA_DEV_TOKENS) {
    try {
      const t = JSON.parse(fs.readFileSync(process.env.BUILDA_DEV_TOKENS, 'utf8'));
      access = t.access_token ?? access;
      refresh = t.refresh_token ?? refresh;
    } catch (e) {
      console.error('[builda] BUILDA_DEV_TOKENS could not be read:', e);
    }
  }
  if (access && refresh) {
    store.set('builder.access', access);
    store.set('builder.refresh', refresh);
  }
}

// ------------------------------------------------------------------ windows

/** @type {BrowserWindow | null} */
let main = null;
let quitting = false;

function pageArgs() {
  return [`--builda-version=${app.getVersion()}`, `--builda-host=${os.hostname().replace(/\.local$/, '')}`];
}

function createMain() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: BG,
    title: 'Builda',
    ...(MAC ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 20, y: 18 } } : { autoHideMenuBar: false }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
      // A capture run is unattended: the display may be asleep or the window covered, and a page
      // Chromium thinks nobody can see gets no animation frames, so every entrance stops at its
      // first frame. Only then: a person looking at the window is the point of throttling it.
      backgroundThrottling: !process.env.BUILDA_CAPTURE,
      additionalArguments: ['--builda-window=main', ...pageArgs()],
    },
  });
  win.loadURL(`${APP_ORIGIN}${process.env.BUILDA_START_PATH || '/now'}`);
  win.once('ready-to-show', () => {
    if (process.env.BUILDA_HIDDEN !== '1') win.show();
  });
  // Anything that is not the app opens in the system's browser; the app never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalAllowed(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(APP_ORIGIN)) return;
    event.preventDefault();
    if (isExternalAllowed(url)) void shell.openExternal(url);
  });
  // A new document (a reload, not a route change: those are in page) has to listen again.
  // `did-start-loading` also fires inside a running page (MEASURED: a link held after the page had
  // said it was listening), so only a main-frame navigation that is not in page counts.
  win.webContents.on('did-navigate', () => {
    debug('new document');
    pageListening = false;
  });
  win.on('close', (event) => {
    // Closing the window is not quitting: the island keeps watching (Cmd+Q, or the tray, quits).
    if (!quitting) {
      event.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => {
    main = null;
  });
  return win;
}

function showMain() {
  if (!main || main.isDestroyed()) main = createMain();
  if (main.isMinimized()) main.restore();
  main.show();
  main.focus();
  return main;
}

function send(/** @type {string} */ command) {
  const win = showMain();
  win.webContents.send('command', command);
}

// ------------------------------------------------------------------ the island

const ISLAND_PREF = () => path.join(app.getPath('userData'), 'island.json');
function islandEnabled() {
  if (process.env.BUILDA_ISLAND === '0') return false;
  try {
    return JSON.parse(fs.readFileSync(ISLAND_PREF(), 'utf8')).enabled !== false;
  } catch {
    return true;
  }
}
function setIslandEnabled(/** @type {boolean} */ on) {
  fs.mkdirSync(path.dirname(ISLAND_PREF()), { recursive: true });
  fs.writeFileSync(ISLAND_PREF(), JSON.stringify({ enabled: on }));
  void superviseIsland();
  Menu.setApplicationMenu(menu());
}

const island = createIsland({ preload: path.join(__dirname, 'preload.js'), origin: APP_ORIGIN, args: pageArgs(), env: process.env });

/**
 * The island is up when it is switched on AND the native Mac app is not running (its island owns
 * the notch; `native.js`). Checked at launch and every ten seconds, so quitting the native app
 * hands the notch to this one and launching it takes it back. `BUILDA_ISLAND_FORCE=1` shows it
 * regardless, for a test run beside the native app.
 */
async function superviseIsland() {
  const force = process.env.BUILDA_ISLAND_FORCE === '1';
  const want = islandEnabled() && (force || !(await nativeIslandRunning()));
  if (want) island.open();
  else island.close();
}

// ------------------------------------------------------------------ menu and tray

function pasteLink() {
  const text = clipboard.readText().trim();
  if (!/^https?:\/\//i.test(text)) {
    new Notification({ title: 'Nothing to drop', body: 'Copy a link to a reel or a post first.' }).show();
    return;
  }
  deliverLink(`builder://drop?url=${encodeURIComponent(text)}`);
}

function menu() {
  return buildMenu({
    send,
    pasteLink,
    showMain,
    island: { enabled: islandEnabled, toggle: () => setIslandEnabled(!islandEnabled()) },
  });
}

/** @type {Tray | null} */
let tray = null;
function createTray() {
  // A Mac has the island in the menu bar and the Dock; Windows and Linux get a tray icon, because
  // closing the window leaves the app running for the island.
  if (MAC) return;
  const icon = nativeImage.createFromPath(path.join(ROOT, 'assets', 'icon.png')).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('Builda');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Builda', click: () => showMain() },
      { label: 'Show the island', type: 'checkbox', checked: islandEnabled(), click: () => setIslandEnabled(!islandEnabled()) },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('click', () => showMain());
}

// ------------------------------------------------------------------ the bridge

function registerIpc() {
  ipcMain.handle('store:get', (_e, key) => store?.get(String(key)) ?? null);
  ipcMain.handle('store:set', (e, key, value) => {
    const k = String(key);
    const had = store?.get(k) ?? null;
    store?.set(k, String(value));
    // Signing in from the app window: the island's page reads its tokens once, so it starts over.
    if (k === 'builder.refresh' && had === null && e.sender !== island.window?.webContents) island.reload();
  });
  ipcMain.handle('store:remove', (e, key) => {
    const k = String(key);
    const had = store?.get(k) ?? null;
    store?.remove(k);
    if (k === 'builder.refresh' && had !== null && e.sender !== island.window?.webContents) island.reload();
  });
  ipcMain.handle('machine-id', () => machineId());
  ipcMain.handle('qr', (_e, text) => qrModules(String(text)));
  ipcMain.on('notify', (_e, n) => {
    if (!Notification.isSupported() || !n || !n.title) return;
    const note = new Notification({ title: String(n.title), body: String(n.body ?? ''), silent: false });
    if (n.url) note.on('click', () => deliverLink(String(n.url)));
    else note.on('click', () => showMain());
    note.show();
  });
  ipcMain.on('copy', (_e, text) => clipboard.writeText(String(text)));
  // A card from the share preview: to Downloads, onto the clipboard, and shown where it landed.
  ipcMain.handle('image:save', (_e, dataUrl, name) => {
    const png = pngFromDataUrl(dataUrl);
    if (!png) return null;
    const file = freePath(app.getPath('downloads'), safeName(name), fs.existsSync, path.join);
    fs.writeFileSync(file, png);
    clipboard.writeImage(nativeImage.createFromBuffer(png));
    shell.showItemInFolder(file);
    return file;
  });
  ipcMain.on('open-external', (_e, url) => {
    if (isExternalAllowed(String(url))) void shell.openExternal(String(url));
  });
  ipcMain.on('open-main', (_e, route) => {
    const win = showMain();
    if (typeof route === 'string' && route.startsWith('/')) win.webContents.send('command', `go:${route}`);
  });
  ipcMain.on('deep-link:ready', (e) => {
    debug('page listening', e.sender === main?.webContents ? '(app window)' : '(another window)', pendingLinks.length, 'held');
    if (e.sender !== main?.webContents) return;
    pageListening = true;
    while (pendingLinks.length) {
      const url = pendingLinks.shift();
      if (url) e.sender.send('deep-link', url);
    }
  });
  ipcMain.on('island:frame', (e, hit) => {
    if (e.sender === island.window?.webContents) island.setHit(hit);
  });
  ipcMain.on('island:enabled', (_e, on) => setIslandEnabled(Boolean(on)));
}

// ------------------------------------------------------------------ start

app.whenReady().then(() => {
  // An unattended capture run with its tokens from a file never asks the Keychain (`tokens.js`).
  const unattended = Boolean(process.env.BUILDA_CAPTURE && (process.env.BUILDA_DEV_TOKENS || process.env.BUILDA_DEV_ACCESS));
  store = unattended ? createMemoryStore() : createTokenStore(path.join(app.getPath('userData'), 'tokens.bin'), safeStorage);
  seedDevTokens();
  if (!DEV_URL) serveBundle(protocol, WEB_DIR, API_ORIGIN);
  bridgeApi(session.defaultSession, net, API_ORIGIN, APP_ORIGIN);
  registerScheme();
  registerIpc();
  Menu.setApplicationMenu(menu());
  createTray();
  main = createMain();
  void superviseIsland();
  setInterval(() => void superviseIsland(), 10_000);
  // A test run: capture every screen and the island from inside the app (`capture.js`).
  if (process.env.BUILDA_CAPTURE) require('./capture').run({ main, island, send, dir: process.env.BUILDA_CAPTURE, origin: APP_ORIGIN });
  // A link that launched the app (Windows and Linux put it in argv).
  const launchLink = process.argv.find((a) => isAppLink(a));
  if (launchLink) pendingLinks.push(launchLink);
});

app.on('activate', () => showMain());
app.on('before-quit', () => {
  quitting = true;
});
app.on('window-all-closed', () => {
  // The island is a window too; with every window gone there is nothing left to show.
  if (!MAC) app.quit();
});

// @ts-check
'use strict';
/**
 * The island's window: the page `/island` from the same bundle, on a frameless, transparent,
 * always-on-top window at the top centre of the primary screen (`geometry.islandGeometry`).
 *
 * It never takes focus (`focusable: false`, a panel on a Mac), never shows in the taskbar or the
 * app switcher, follows you across Spaces and over full-screen apps, and lets every click through
 * EXCEPT over the pill: the page reports the pill's box (`island:frame`) and a 30 Hz look at the
 * pointer turns mouse events on while it is over that box and off when it leaves. Forwarded
 * mouse moves (`forward: true`) are what let the page see the pointer arrive before that.
 *
 * On a notched Mac the window sits at the very top, over the menu bar, and the page is told the
 * notch's size (`?nw=&nh=`) so its pill grows out of the notch rather than beside it.
 */
const { BrowserWindow, screen } = require('electron');

const { islandGeometry, overPill } = require('./geometry');

const POINTER_MS = 33;

/**
 * @param {{ preload: string, origin: string, args: string[], env: NodeJS.ProcessEnv }} o
 */
function createIsland(o) {
  /** @type {BrowserWindow | null} */
  let win = null;
  /** @type {{ x: number, y: number, width: number, height: number } | null} */
  let hit = null;
  let interactive = false;
  /** @type {NodeJS.Timeout | null} */
  let timer = null;

  function place() {
    if (!win || win.isDestroyed()) return null;
    const g = islandGeometry(screen.getPrimaryDisplay(), process.platform, o.env);
    win.setBounds({ x: g.x, y: g.y, width: g.width, height: g.height });
    return g;
  }

  function urlFor(g) {
    const q = new URLSearchParams();
    if (g.notch) {
      q.set('nw', String(g.notch.width));
      q.set('nh', String(g.notch.height));
    }
    if (o.env.BUILDA_ISLAND_SAMPLE) q.set('sample', o.env.BUILDA_ISLAND_SAMPLE);
    if (o.env.BUILDA_ISLAND_EXPAND === '1') q.set('expand', '1');
    const qs = q.toString();
    return `${o.origin}/island${qs ? `?${qs}` : ''}`;
  }

  function open() {
    if (win && !win.isDestroyed()) return win;
    const g = islandGeometry(screen.getPrimaryDisplay(), process.platform, o.env);
    const mac = process.platform === 'darwin';
    win = new BrowserWindow({
      x: g.x,
      y: g.y,
      width: g.width,
      height: g.height,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false,
      alwaysOnTop: true,
      show: false,
      // Allowed over the menu bar, where the notch is.
      enableLargerThanScreen: true,
      // A panel on a Mac floats without activating the app; a toolbar window on Windows stays out
      // of Alt+Tab. Linux keeps the default type: its window managers read 'toolbar' differently.
      ...(mac ? { type: 'panel' } : process.platform === 'win32' ? { type: 'toolbar' } : {}),
      title: 'Builda island',
      webPreferences: {
        preload: o.preload,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        additionalArguments: ['--builda-window=island', ...o.args],
      },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    win.setIgnoreMouseEvents(true, { forward: true });
    win.loadURL(urlFor(g));
    win.once('ready-to-show', () => {
      if (!win || win.isDestroyed()) return;
      // A notched Mac's menu bar is where the island lives: put it back up there once shown.
      place();
      win.showInactive();
    });
    win.on('closed', () => {
      win = null;
      hit = null;
      interactive = false;
    });

    timer = setInterval(() => {
      if (!win || win.isDestroyed()) return;
      const over = overPill(screen.getCursorScreenPoint(), win.getBounds(), hit);
      if (over !== interactive) {
        interactive = over;
        win.setIgnoreMouseEvents(!over, { forward: true });
      }
    }, POINTER_MS);

    const replace = () => place();
    screen.on('display-metrics-changed', replace);
    screen.on('display-added', replace);
    screen.on('display-removed', replace);
    win.on('closed', () => {
      if (timer) clearInterval(timer);
      timer = null;
      screen.removeListener('display-metrics-changed', replace);
      screen.removeListener('display-added', replace);
      screen.removeListener('display-removed', replace);
    });
    return win;
  }

  return {
    open,
    close() {
      if (win && !win.isDestroyed()) win.close();
    },
    reload() {
      if (win && !win.isDestroyed()) win.webContents.reload();
    },
    /** @param {{ x: number, y: number, width: number, height: number } | null} next */
    setHit(next) {
      hit = next && [next.x, next.y, next.width, next.height].every((n) => Number.isFinite(n)) ? next : null;
    },
    get window() {
      return win;
    },
  };
}

module.exports = { createIsland };

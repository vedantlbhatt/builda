// @ts-check
'use strict';
/**
 * Where the island window goes, and whether it grows out of a notch. Pure (no Electron), so
 * `test/geometry.test.js` holds every rule with `node --test`.
 *
 * THE NOTCH. Electron does not say whether a screen has one (AppKit's `safeAreaInsets` and
 * `auxiliaryTopLeftArea` are not exposed), but it does say how tall the menu bar is: the work
 * area starts that far below the screen's top. A notched MacBook's built-in screen has a 37 or 38
 * point menu bar (the notch's own height, so the bar can hold it); every screen without one has
 * 24 or 25. So a built-in screen whose menu bar is 32 points or more has a notch, and the island
 * sits ON it, at the very top, the notch's own black grown sideways and down. Elsewhere on a Mac
 * it sits just under the menu bar; on Windows and Linux at the top of the work area (under a
 * top taskbar, if there is one).
 *
 * The notch's WIDTH is not measurable from here either. Apple's own numbers for the 14 and 16
 * inch MacBook Pro and the 13 and 15 inch MacBook Air at their default scaling put it at 185 to
 * 200 points; 200 errs on the side of ears that clear it. `BUILDA_NOTCH_WIDTH` overrides it.
 */

/** The island window: wide enough for the expanded pill (420) and its shadow, tall enough for four rows. */
const WINDOW = { width: 500, height: 240 };
/** A menu bar at least this tall is holding a notch. */
const NOTCH_MENU_BAR = 32;
const NOTCH_WIDTH = 200;
/** Gap under the menu bar or the work area's top, where there is no notch. */
const GAP = 6;

/**
 * @param {{ bounds: { x: number, y: number, width: number, height: number },
 *           workArea: { x: number, y: number, width: number, height: number },
 *           internal?: boolean }} display
 * @param {string} platform  process.platform
 * @param {{ BUILDA_NOTCH_WIDTH?: string, BUILDA_NOTCH?: string }} [env]
 * @returns {{ x: number, y: number, width: number, height: number,
 *             notch: { width: number, height: number } | null }}
 */
function islandGeometry(display, platform, env = {}) {
  const { bounds, workArea } = display;
  const menuBar = Math.max(0, workArea.y - bounds.y);
  const forced = env.BUILDA_NOTCH === '1' ? true : env.BUILDA_NOTCH === '0' ? false : null;
  const hasNotch = platform === 'darwin' && (forced ?? (display.internal !== false && menuBar >= NOTCH_MENU_BAR));
  const notchWidth = Number(env.BUILDA_NOTCH_WIDTH) > 0 ? Number(env.BUILDA_NOTCH_WIDTH) : NOTCH_WIDTH;
  const notch = hasNotch ? { width: notchWidth, height: menuBar >= NOTCH_MENU_BAR ? menuBar : 37 } : null;
  const x = Math.round(bounds.x + (bounds.width - WINDOW.width) / 2);
  const y = notch ? bounds.y : platform === 'darwin' ? bounds.y + menuBar + GAP : workArea.y + GAP;
  return { x, y, width: WINDOW.width, height: WINDOW.height, notch };
}

/**
 * Whether a screen point is over the pill, given the window's bounds and the pill's box inside it
 * (`hit`, in window points, reported by the page).
 * @param {{ x: number, y: number }} p
 * @param {{ x: number, y: number }} origin
 * @param {{ x: number, y: number, width: number, height: number } | null} hit
 */
function overPill(p, origin, hit) {
  if (!hit) return false;
  const x = p.x - origin.x;
  const y = p.y - origin.y;
  return x >= hit.x && x <= hit.x + hit.width && y >= hit.y && y <= hit.y + hit.height;
}

/**
 * The route a `builder://` link opens in the main window: the phone's link shapes, without the
 * scheme. The page applies the phone's own rewrites (`app/+native-intent.ts`) to what it gets.
 * @param {string} url
 */
function isAppLink(url) {
  return typeof url === 'string' && /^builder:\/\//i.test(url.trim());
}

/**
 * Only these leave the app for the system's browser; anything else a page asks to open is dropped.
 * @param {string} url
 */
function isExternalAllowed(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:';
  } catch {
    return false;
  }
}

module.exports = { islandGeometry, overPill, isAppLink, isExternalAllowed, WINDOW, NOTCH_MENU_BAR, NOTCH_WIDTH };

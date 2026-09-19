/**
 * The desktop shell's bridge, as the web bundle sees it.
 *
 * `desktop/src/preload.ts` exposes one object, `window.builda`, through Electron's
 * `contextBridge`, and nothing else from Node or Electron ever reaches the page. This file is
 * the ONLY place the app reads it, so a screen asks `desktopBridge()` and gets either the whole
 * typed surface or null (a phone, or a plain browser tab). Every method is a message to the
 * main process; none of them blocks.
 *
 * The shape is versioned by `DESKTOP_BRIDGE_VERSION`; the preload stamps its own, and a bundle
 * that meets a shell of another version still gets the bridge (the methods below are additive)
 * but can say so.
 */

export const DESKTOP_BRIDGE_VERSION = 1;

/** Which window this page is: the app, or the island pill at the top of the screen. */
export type DesktopWindowKind = 'main' | 'island';

export interface DesktopNotification {
  title: string;
  body?: string;
  /** A `builder://` link opened in the main window when the notification is clicked. */
  url?: string;
}

/** What the island window asks of its own frame. */
export interface IslandFrame {
  /** The pill's box in window points, the one region that takes the mouse; everything else clicks through. */
  hit: { x: number; y: number; width: number; height: number } | null;
}

export interface DesktopBridge {
  version: number;
  platform: 'darwin' | 'win32' | 'linux';
  appVersion: string;
  window: DesktopWindowKind;
  /** Tokens, encrypted at rest with Electron's `safeStorage` (the Keychain on a Mac, DPAPI on Windows). */
  secureStore: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
  };
  /** A stable per-install id, sha256 hex: the device grant's `machine_id`. */
  machineId(): Promise<string>;
  notify(n: DesktopNotification): void;
  copyText(text: string): void;
  openExternal(url: string): void;
  /** `builder://` links from the OS (a click in another app, a second launch), and notification clicks. */
  onDeepLink(cb: (url: string) => void): () => void;
  /** Menu items and global shortcuts the main process owns: `tab:now`, `search`, `settings`, … */
  onCommand(cb: (command: string) => void): () => void;
  /** Show and focus the main window, optionally at a route (`/session/…`). */
  openMain(path?: string): void;
  island: {
    setFrame(frame: IslandFrame): void;
    /** Hide the island window until the next launch (Settings, or the pill's own menu). */
    setEnabled(on: boolean): void;
  };
}

declare global {
  interface Window {
    builda?: DesktopBridge;
  }
}

/** The bridge when this page runs inside the desktop shell, null anywhere else. */
export function desktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;
  const b = window.builda;
  return b && typeof b === 'object' && typeof b.version === 'number' ? b : null;
}

/** True inside the desktop shell. */
export function isDesktopShell(): boolean {
  return desktopBridge() !== null;
}

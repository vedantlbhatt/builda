/**
 * On a desktop, a toast in a window behind other apps is a word said to an empty room. When the
 * app window is not in front, the offer goes to the system's notifications through the shell
 * instead (`desktop/src/main.js` `notify`, whose click opens `url` in the app window). One or the
 * other, never both.
 *
 * What it does not cover, found in review: a window CLOSED to the tray is hidden, and the root poll
 * that makes offers stops while the page is hidden, so the offer waits until the window is shown
 * again and is then a toast. The case this serves is the window open behind the editor.
 */
import { desktopBridge } from '../desktop/bridge';

export function desktopNoticeInstead(title: string, body: string, url: string): boolean {
  const bridge = desktopBridge();
  if (!bridge || bridge.window !== 'main' || typeof document === 'undefined') return false;
  if (document.visibilityState === 'visible' && document.hasFocus()) return false;
  bridge.notify({ title, body, url });
  return true;
}

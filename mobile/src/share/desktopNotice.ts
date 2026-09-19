/**
 * On a desktop, where the app keeps running with its window hidden (the tray, the island), a toast
 * in the page is a word said to an empty room. When the window is not in front, the offer goes to
 * the system's notifications through the shell instead (`desktop/src/main.js` `notify`, whose click
 * opens `url` in the app window). One or the other, never both.
 */
import { desktopBridge } from '../desktop/bridge';

export function desktopNoticeInstead(title: string, body: string, url: string): boolean {
  const bridge = desktopBridge();
  if (!bridge || bridge.window !== 'main' || typeof document === 'undefined') return false;
  if (document.visibilityState === 'visible' && document.hasFocus()) return false;
  bridge.notify({ title, body, url });
  return true;
}

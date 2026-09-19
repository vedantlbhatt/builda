/**
 * Which desktop window this page is. The shell says so through its bridge; a plain browser tab
 * pointed at `/island` (the dev loop, and the screenshot harness) is the island too.
 */
import { desktopBridge } from './bridge';

export function isIslandWindow(): boolean {
  const b = desktopBridge();
  if (b) return b.window === 'island';
  if (typeof window === 'undefined' || !window.location || typeof window.location.pathname !== 'string') return false;
  return window.location.pathname === '/island' || window.location.pathname.startsWith('/island/');
}

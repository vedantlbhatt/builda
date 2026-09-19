/**
 * Web twin of `clipboard.ts` (Metro picks this file for `platform === 'web'`; iOS keeps the
 * other). React Native's clipboard module is a native module, and on web reaching for it by its
 * file pulls `react-native` itself into the bundle, which throws `__fbBatchedBridgeConfig is not
 * set` the moment any screen imports this (MEASURED: /projects and /you red on 2026-09-19).
 *
 * The desktop shell's bridge writes through Electron's own clipboard, which needs no
 * permission and no focused document; a plain browser uses the async Clipboard API.
 */
import { desktopBridge } from '../desktop/bridge';

export function copyText(text: string): boolean {
  const bridge = desktopBridge();
  if (bridge) {
    bridge.copyText(text);
    return true;
  }
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return false;
    void navigator.clipboard.writeText(text).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

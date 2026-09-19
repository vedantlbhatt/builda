/**
 * A share card as a PNG on a desktop or in a browser.
 *
 * view-shot's own `captureRef` cannot run here: it resolves the ref with `findNodeHandle`, which
 * React Native for Web does not support, so every Save threw before drawing anything. Its web
 * half is html2canvas on the DOM node, and the node is what a View's ref already is on the web, so
 * this calls html2canvas on it directly, at the scale that makes a 360 point card 1080 pixels wide.
 *
 * Then the shell's `saveImage` (Downloads, the clipboard, and the file shown in Finder or
 * Explorer: `desktop/src/image.js`) when there is a shell, else a browser download.
 */
import html2canvas from 'html2canvas';

import { desktopBridge } from '../desktop/bridge';

/** The image's width in pixels by default: a 360 point card at 3x, the phone's own. */
const CARD_PX = 1080;

/**
 * The card under `node` saved as `px` pixels wide. Resolves to the line to show once it is saved,
 * or null when it could not be made or the shell refused it.
 */
export async function saveCard(node: unknown, title: string, px: number = CARD_PX): Promise<string | null> {
  const el = node as HTMLElement | null;
  if (!el || typeof el.getBoundingClientRect !== 'function') return null;
  const w = el.getBoundingClientRect().width || 360;
  let canvas: HTMLCanvasElement;
  try {
    canvas = await html2canvas(el, { scale: px / w, backgroundColor: null, logging: false });
  } catch {
    return null;
  }
  const dataUrl = canvas.toDataURL('image/png');
  const bridge = desktopBridge();
  if (bridge?.saveImage) {
    const file = await bridge.saveImage(dataUrl, title);
    return file ? SAVED_LINE : null;
  }
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'builda'}.png`;
  a.click();
  return 'Downloaded.';
}

const SAVED_LINE = 'Saved to Downloads and copied. Paste it anywhere.';

// @ts-check
'use strict';
/**
 * A card the page drew, kept as a file.
 *
 * On a phone, Share hands the card's PNG to the share sheet. A desktop has no share sheet that
 * takes an image from a web page, so the page sends the PNG here as a data URL (view-shot on the
 * web draws the card with html2canvas, Skia's canvases included) and the shell saves it to
 * Downloads, puts it on the clipboard and shows it in Finder or Explorer: pasting it into a
 * message and dragging the file are the two ways a desktop shares an image.
 *
 * Only a PNG is accepted, and only up to `MAX_BYTES`: the page is sandboxed, but it is still a
 * page, and this is a door onto the disk.
 */

/** A 1080 by 1350 card is under 1 MB; eight is room without being an open door. */
const MAX_BYTES = 8 * 1024 * 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PREFIX = 'data:image/png;base64,';

/**
 * The PNG inside a data URL, or null when it is not one.
 * @param {unknown} dataUrl
 * @returns {Buffer | null}
 */
function pngFromDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(PREFIX)) return null;
  // Base64 is four characters for three bytes; refuse before decoding, not after.
  if (((dataUrl.length - PREFIX.length) * 3) / 4 > MAX_BYTES) return null;
  const buf = Buffer.from(dataUrl.slice(PREFIX.length), 'base64');
  if (buf.length < PNG_MAGIC.length || !buf.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) return null;
  return buf;
}

/**
 * A file name from the page's name for the card: letters, digits and single dashes, never a path.
 * @param {unknown} name
 */
function safeName(name) {
  const base = String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || 'builda';
}

/**
 * `dir/name.png`, or `dir/name 2.png` and upwards when that is taken, the way a browser names a
 * second download.
 * @param {string} dir
 * @param {string} name  already `safeName`d
 * @param {(p: string) => boolean} exists
 * @param {(...parts: string[]) => string} join
 */
function freePath(dir, name, exists, join) {
  let p = join(dir, `${name}.png`);
  for (let n = 2; exists(p) && n < 1000; n++) p = join(dir, `${name} ${n}.png`);
  return p;
}

module.exports = { MAX_BYTES, pngFromDataUrl, safeName, freePath };

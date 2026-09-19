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

/**
 * A ship kit's picked files (the demo video, the stills), for the kit's Save on a desktop: the
 * same door, wider. Only the four types a kit holds, each checked by its first bytes and not by
 * its name, at most `KIT_MAX_FILES` of them and `KIT_MAX_BYTES` together (a 30 second 1080p kit
 * video is about 20 MB).
 */
const KIT_MAX_FILES = 20;
const KIT_MAX_BYTES = 400 * 1024 * 1024;
/** @type {Record<string, (b: Buffer) => boolean>} */
const KIT_TYPES = {
  png: (b) => b.length >= 8 && b.subarray(0, 8).equals(PNG_MAGIC),
  jpg: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  gif: (b) => b.length >= 6 && b.subarray(0, 4).toString('latin1') === 'GIF8',
  // An MP4 opens with a box whose type, bytes 4 to 8, is `ftyp`.
  mp4: (b) => b.length >= 12 && b.subarray(4, 8).toString('latin1') === 'ftyp',
};

/**
 * The files to write, or null when any of them is not what it says. Each comes back with a safe
 * name that keeps its (checked) extension.
 * @param {unknown} files
 * @returns {{ name: string, bytes: Buffer }[] | null}
 */
function kitFiles(files) {
  if (!Array.isArray(files) || files.length === 0 || files.length > KIT_MAX_FILES) return null;
  let total = 0;
  /** @type {{ name: string, bytes: Buffer }[]} */
  const out = [];
  const seen = new Set();
  for (const f of files) {
    if (!f || typeof f.name !== 'string' || !(f.bytes instanceof Uint8Array)) return null;
    const bytes = Buffer.from(f.bytes.buffer, f.bytes.byteOffset, f.bytes.byteLength);
    total += bytes.length;
    if (total > KIT_MAX_BYTES) return null;
    const dot = f.name.lastIndexOf('.');
    const ext = (dot >= 0 ? f.name.slice(dot + 1) : '').toLowerCase().replace('jpeg', 'jpg');
    const check = KIT_TYPES[ext];
    if (!check || !check(bytes)) return null;
    let name = `${safeName(dot >= 0 ? f.name.slice(0, dot) : f.name)}.${ext}`;
    for (let n = 2; seen.has(name); n++) name = `${safeName(f.name.slice(0, dot))}-${n}.${ext}`;
    seen.add(name);
    out.push({ name, bytes });
  }
  return out;
}

/**
 * `dir/name`, or `dir/name 2` and upwards: a folder for one save, never merged into another.
 * @param {string} dir
 * @param {string} name
 * @param {(p: string) => boolean} exists
 * @param {(...parts: string[]) => string} join
 */
function freeDir(dir, name, exists, join) {
  let p = join(dir, name);
  for (let n = 2; exists(p) && n < 1000; n++) p = join(dir, `${name} ${n}`);
  return p;
}

/**
 * Write `data` to `dir/name.ext`, or `name 2.ext` and upwards, creating the file and never
 * replacing one: the open itself refuses an existing name (`wx`), so nothing between a check and
 * a write can make it overwrite, and a dangling symlink is not followed. FOUND IN REVIEW: past
 * `name 999` the name search gave up and the write replaced it.
 * @param {typeof import('node:fs')} fsx
 * @param {(...parts: string[]) => string} join
 * @param {string} dir @param {string} name @param {string} ext @param {Buffer} data
 */
function writeFresh(fsx, join, dir, name, ext, data) {
  for (let n = 1; n < 10000; n++) {
    const file = join(dir, n === 1 ? `${name}.${ext}` : `${name} ${n}.${ext}`);
    try {
      fsx.writeFileSync(file, data, { flag: 'wx' });
      return file;
    } catch (e) {
      if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'EEXIST') throw e;
    }
  }
  throw new Error('no free name');
}

/**
 * A folder that did not exist a moment ago: `dir/name`, or `dir/name 2` and upwards, made without
 * `recursive` so an existing one is refused rather than written into.
 * @param {typeof import('node:fs')} fsx
 * @param {(...parts: string[]) => string} join
 * @param {string} dir @param {string} name
 */
function mkdirFresh(fsx, join, dir, name) {
  for (let n = 1; n < 10000; n++) {
    const p = join(dir, n === 1 ? name : `${name} ${n}`);
    try {
      fsx.mkdirSync(p);
      return p;
    } catch (e) {
      if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'EEXIST') throw e;
    }
  }
  throw new Error('no free name');
}

module.exports = { MAX_BYTES, pngFromDataUrl, safeName, freePath, kitFiles, freeDir, writeFresh, mkdirFresh, KIT_MAX_FILES };

'use strict';
/**
 * The pixel surfaces, drawn the way the app draws them.
 *
 * A band is the app's `insights/Band.tsx` shader cell for cell: one ink, a solid block, then a
 * 36 point dissolve where the density falls from 1 to 0 and a cell is ink only while its ordered
 * dither threshold (`b8`, the shader's arithmetic Bayer) sits under that density. Nothing is a
 * gradient and nothing is at partial opacity: every cell is ink or ground (design/tokens.json
 * forbids a gradient on an identity hue). Cells arrive in one of the app's eight orders
 * (`pixelMotion.cellOrder`), the same function the phone runs, so a band in a trailer prints in
 * exactly as the band on the project's page did.
 *
 * Everything is drawn at CELL resolution into a small canvas and scaled up with smoothing off, so
 * a 1080 x 1920 frame's thirty thousand cells cost one `drawImage`, and every cell lands on whole
 * device pixels as it does on the phone.
 */
const { createCanvas } = require('@napi-rs/canvas');
const { pixelMotion } = require('./house');
const { clamp } = require('./time');

/** The shader's arithmetic Bayer, `b8`, on whole cell coordinates. */
function b2(x, y) {
  const v = Math.floor(x) * 0.5 + Math.floor(y) * Math.floor(y) * 0.75;
  return v - Math.floor(v);
}
function b8(x, y) {
  return b2(x * 0.25, y * 0.25) * 0.0625 + b2(x * 0.5, y * 0.5) * 0.25 + b2(x, y);
}

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A grid of cells drawn into a canvas one pixel a cell, blitted up to the frame. */
class Cells {
  constructor(cols, rows) {
    this.cols = Math.max(1, cols | 0);
    this.rows = Math.max(1, rows | 0);
    this.canvas = createCanvas(this.cols, this.rows);
    this.ctx = this.canvas.getContext('2d');
    this.img = this.ctx.createImageData(this.cols, this.rows);
  }
  clear() {
    this.img.data.fill(0);
  }
  set(i, j, c, a = 255) {
    const o = (j * this.cols + i) * 4;
    const d = this.img.data;
    d[o] = c[0];
    d[o + 1] = c[1];
    d[o + 2] = c[2];
    d[o + 3] = a;
  }
  /** Draw the grid with its top left at (x, y), each cell `cell` pixels. */
  blit(ctx, x, y, cell) {
    this.ctx.putImageData(this.img, 0, 0);
    const prev = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.canvas, Math.round(x), Math.round(y), Math.round(this.cols * cell), Math.round(this.rows * cell));
    ctx.imageSmoothingEnabled = prev;
  }
}

const pool = new Map();
function cellsFor(cols, rows, slot = 'a') {
  const k = `${slot}:${cols}x${rows}`;
  let c = pool.get(k);
  if (!c) {
    c = new Cells(cols, rows);
    pool.set(k, c);
  }
  return c;
}

/**
 * A band: `solid` pixels of ink from the top of `rect`, then `fringe` pixels of dissolve, printed
 * `reveal` (0 to 1) of the way in `mode` (a PIXEL_MOTIONS name). `seed` shifts the scatter so two
 * bands in one frame do not scatter alike; `origin` is a ripple's centre as a fraction.
 * `flip` dissolves upward instead (a band whose ground is above it).
 */
function band(ctx, { x, y, w, solid, fringe, cell, ink, reveal = 1, mode = 'rain', seed = 0, origin, flip = false, slot = 'band' }) {
  const cols = Math.ceil(w / cell);
  const rows = Math.ceil((solid + fringe) / cell);
  if (reveal <= 0 || cols <= 0 || rows <= 0) return;
  const cells = cellsFor(cols, rows, slot);
  cells.clear();
  const c = rgb(ink);
  const full = reveal >= 1;
  for (let j = 0; j < rows; j++) {
    const jj = flip ? rows - 1 - j : j;
    const yy = (jj + 0.5) * cell;
    const d = yy < solid ? 1 : clamp(1 - (yy - solid) / Math.max(0.001, fringe));
    if (d <= 0) continue;
    for (let i = 0; i < cols; i++) {
      if (d < 1 && !(b8(i, jj) < d * 0.999)) continue;
      if (!full && !(pixelMotion.cellOrder(mode, i, jj, cols, rows, seed, origin) < reveal * 1.02)) continue;
      cells.set(i, j, c);
    }
  }
  cells.blit(ctx, x, flip ? y - fringe : y, cell);
}

/**
 * One of the app's creatures (a 16 x 16 frame of strings, `b` for ink), printed `reveal` of the way
 * in `mode`. Whole pixels per cell, as the app requires: `size` is rounded down to a multiple of 16.
 */
function creature(ctx, frame, x, y, size, ink, { reveal = 1, mode = 'rain', seed = 3 } = {}) {
  const c = Math.max(1, Math.floor(size / 16));
  ctx.fillStyle = ink;
  for (let j = 0; j < 16; j++) {
    const row = frame[j];
    for (let i = 0; i < 16; i++) {
      if (row[i] === '.') continue;
      if (reveal < 1 && !(pixelMotion.cellOrder(mode, i, j, 16, 16, seed) < reveal * 1.02)) continue;
      ctx.fillRect(Math.round(x + i * c), Math.round(y + j * c), c, c);
    }
  }
  return c * 16;
}

/**
 * The react-bits PixelTransition the app's prints use: `draw` paints the picture inside `rect`, and
 * the cells that have not arrived yet are covered in `wait` (the band's ink, so a print waiting on
 * a band is invisible on it until it develops). `reveal` 0 is all wait, 1 all picture.
 */
function develop(ctx, rect, reveal, { cell, wait, mode = 'blocks', seed = 5, draw }) {
  if (reveal > 0) draw();
  if (reveal >= 1) return;
  const cols = Math.ceil(rect.w / cell);
  const rows = Math.ceil(rect.h / cell);
  const cells = cellsFor(cols, rows, 'develop');
  cells.clear();
  const c = rgb(wait);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      if (pixelMotion.cellOrder(mode, i, j, cols, rows, seed) < reveal * 1.02) continue;
      cells.set(i, j, c);
    }
  }
  ctx.save();
  if (rect.r) {
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.w, rect.h, rect.r);
    ctx.clip();
  }
  cells.blit(ctx, rect.x, rect.y, cell);
  ctx.restore();
}

/**
 * A scalar field drawn in the 1-bit dither: cell (i, j) is `ink` where `density(i, j)` (0 to 1) is
 * over its Bayer threshold, and ground elsewhere. How ink, fluid and data all read as pixels.
 */
function field(ctx, { x, y, cols, rows, cell, ink, density, slot = 'field' }) {
  const cells = cellsFor(cols, rows, slot);
  cells.clear();
  const c = typeof ink === 'string' ? rgb(ink) : null;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const d = density(i, j);
      if (d <= 0 || !(b8(i, j) < d * 0.999)) continue;
      cells.set(i, j, c ?? rgb(ink(i, j)));
    }
  }
  cells.blit(ctx, x, y, cell);
}

module.exports = { b8, rgb, Cells, cellsFor, band, creature, develop, field };

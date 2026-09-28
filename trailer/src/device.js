'use strict';
/**
 * The device the demo was filmed on, drawn at its own shape.
 *
 * The shape is the row's (spec/devices.v1.json): its aspect is its points, its corner its measured
 * radius, its Dynamic Island only where the row has one, so the phone in a trailer is the phone the
 * app ran on and never "a weird elongated phone" (the flaw the ship kit was built to fix). The bezel
 * is the ship kit's (`capture/shipkit/frame.py` BEZEL_INK, 2.6% of the screen's width on a phone,
 * 1.2% on a Mac window), so a trailer and a kit video show the same object.
 *
 * Three things move, and they never move the same layer:
 *   lean    the whole device turns about its vertical axis in true perspective (drawn in strips)
 *   punch   the PICTURE scales about a tap, inside a screen that never moves, with the status bar
 *           and the island held still over it, as on a real phone (FOUND ON THE RIDEGT KIT: zoomed
 *           about a tap near the bottom, the island slid 57 pixels up and off the screen's edge)
 *   tap     a ring of cells rippling out from where the finger landed, in the app's pixels
 */
const { createCanvas } = require('@napi-rs/canvas');
const { SURFACE } = require('./house');
const { clamp, ease, seg } = require('./time');
const { field } = require('./pixels');

const BEZEL_INK = '#0B0A09';
/** The Dynamic Island's size and place on the phones that have one, in points (Apple's HIG). */
const ISLAND = { w: 126, h: 37, top: 11 };

const scratch = new Map();
function canvasFor(key, w, h) {
  const k = `${key}:${w}x${h}`;
  let c = scratch.get(k);
  if (!c) {
    c = createCanvas(Math.max(1, w), Math.max(1, h));
    scratch.set(k, c);
  }
  return c;
}

/**
 * Draw the picture `img` into the screen rect `s`, scaled `zoom` about the fraction (fx, fy) of the
 * screen, with the top `bar` pixels (the status bar and island) left unzoomed over it.
 */
function drawPicture(ctx, img, s, { zoom = 1, fx = 0.5, fy = 0.5, bar = 0 }) {
  if (!img) return;
  const iw = img.width, ih = img.height;
  // Cover: the demo's pixels are the row's, so this is an exact fit for a matched capture.
  const k = Math.max(s.w / iw, s.h / ih);
  const dw = iw * k, dh = ih * k;
  const dx = s.x + (s.w - dw) / 2, dy = s.y + (s.h - dh) / 2;
  if (zoom === 1 || bar <= 0) {
    ctx.save();
    ctx.translate(s.x + s.w * fx, s.y + s.h * fy);
    ctx.scale(zoom, zoom);
    ctx.translate(-(s.x + s.w * fx), -(s.y + s.h * fy));
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(s.x, s.y + bar, s.w, s.h - bar);
  ctx.clip();
  ctx.translate(s.x + s.w * fx, s.y + s.h * fy);
  ctx.scale(zoom, zoom);
  ctx.translate(-(s.x + s.w * fx), -(s.y + s.h * fy));
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();
  // The system's strip, still.
  const srcBar = bar / k;
  ctx.drawImage(img, 0, (dy - s.y) / -k, iw, srcBar, s.x, s.y, s.w, bar);
}

/**
 * The flat device (no lean) into `c` at (ox, oy): body, screen, island. `paint(ctx, screenRect)`
 * draws what is on the screen.
 */
function flat(c, ox, oy, d, row, paint) {
  const b = d.bezel;
  const R = d.radius;
  c.fillStyle = BEZEL_INK;
  c.beginPath();
  c.roundRect(ox - b, oy - b, d.w + b * 2, d.h + b * 2, R + b);
  c.fill();
  const s = { x: ox, y: oy, w: d.w, h: d.h };
  c.save();
  c.beginPath();
  c.roundRect(s.x, s.y, s.w, s.h, R);
  c.clip();
  c.fillStyle = SURFACE.bg;
  c.fillRect(s.x, s.y, s.w, s.h);
  paint(c, s);
  c.restore();
  if (row && row.dynamic_island) {
    const k = d.scale;
    const iw = ISLAND.w * k, ih = ISLAND.h * k;
    c.fillStyle = '#000000';
    c.beginPath();
    c.roundRect(ox + (d.w - iw) / 2, oy + ISLAND.top * k, iw, ih, ih / 2);
    c.fill();
  }
}

/**
 * The device at `d` (layout.device), leaning `lean` radians about its vertical axis (positive turns
 * its right edge away), with a soft shadow on the ground under it (tokens `shadow`: y 12, blur 32,
 * black at 0.5, the one shadow the app allows, for a floating thing). `alpha` fades the whole.
 */
function drawDevice(ctx, d, row, paint, { lean = 0, lift = 0, alpha = 1, scale = 1, shadow = true } = {}) {
  if (alpha <= 0) return;
  const pad = d.bezel + 2;
  const cw = Math.ceil(d.w + pad * 2), ch = Math.ceil(d.h + pad * 2);
  const cx = d.x + d.w / 2, cy = d.y + d.h / 2 - lift;
  if (Math.abs(lean) < 0.002) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.translate(-d.w / 2, -d.h / 2);
    if (shadow) shade(ctx, 0, 0, d, alpha);
    flat(ctx, 0, 0, d, row, paint);
    ctx.restore();
    return;
  }
  const off = canvasFor('device', cw, ch);
  const oc = off.getContext('2d');
  oc.clearRect(0, 0, cw, ch);
  flat(oc, pad, pad, d, row, paint);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  if (shadow) shade(ctx, -d.w / 2, -d.h / 2, d, alpha * (1 - Math.min(0.4, Math.abs(lean))));
  // Perspective about the vertical axis, in strips: each column of the device is placed and scaled
  // by where it lands at depth, so edges converge as they do through a lens.
  const strips = 72;
  const depth = cw * 2.6;
  const sin = Math.sin(lean), cos = Math.cos(lean);
  const X = (u) => (u * cos) / (1 + (u * sin) / depth);
  const S = (u) => 1 / (1 + (u * sin) / depth);
  for (let k = 0; k < strips; k++) {
    const sx0 = (k / strips) * cw, sx1 = ((k + 1) / strips) * cw;
    const u0 = sx0 - cw / 2, u1 = sx1 - cw / 2;
    const x0 = X(u0), x1 = X(u1);
    const sc = (S(u0) + S(u1)) / 2;
    const h = ch * sc;
    ctx.drawImage(off, sx0, 0, sx1 - sx0, ch, x0, -h / 2, Math.max(0.5, x1 - x0 + 0.6), h);
  }
  ctx.restore();
}

function shade(ctx, x, y, d, a) {
  ctx.save();
  ctx.shadowColor = `rgba(0,0,0,${0.5 * a})`;
  ctx.shadowBlur = 32 * d.scale;
  ctx.shadowOffsetY = 12 * d.scale;
  ctx.fillStyle = BEZEL_INK;
  ctx.beginPath();
  ctx.roundRect(x - d.bezel, y - d.bezel, d.w + d.bezel * 2, d.h + d.bezel * 2, d.radius + d.bezel);
  ctx.fill();
  ctx.restore();
}

/**
 * A tap: a ring of cells rippling out from (px, py) over 0.5 s, `t` seconds after the finger landed.
 * Drawn in the ground's text colour at the cell size of the frame, so it reads as the app's pixels.
 */
function tapRing(ctx, px, py, t, cell, radius) {
  if (t < 0 || t > 0.6) return;
  const u = ease(seg(t, 0, 0.5));
  const r = radius * (0.35 + 0.65 * u);
  const width = radius * 0.22 * (1 - u * 0.6);
  const fade = 1 - seg(t, 0.32, 0.6);
  const n = Math.ceil((r + width) / cell) + 1;
  field(ctx, {
    x: px - n * cell,
    y: py - n * cell,
    cols: n * 2,
    rows: n * 2,
    cell,
    ink: SURFACE.text,
    slot: 'tap',
    density: (i, j) => {
      const dx = (i + 0.5 - n) * cell, dy = (j + 0.5 - n) * cell;
      const dist = Math.abs(Math.hypot(dx, dy) - r);
      return clamp(1 - dist / width) * fade;
    },
  });
}

module.exports = { drawDevice, drawPicture, tapRing, BEZEL_INK, ISLAND };

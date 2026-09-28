'use strict';
/**
 * Where things sit, for any canvas. Pure (the tests read it).
 *
 * A trailer is rendered once per social format of spec/devices.v1.json, and each is LAID OUT for
 * its shape, never cropped out of another: a 9:16 stacks the band, the device and the words; a
 * 16:9 puts the device on the left third and the words beside it; 1:1 and 4:5 sit between. The
 * rule is one number, the canvas's aspect, so a format added to the table later lays itself out.
 *
 * Sizes are in the app's points. A point is the canvas's short side over 393 (the design width of
 * the phone the app is drawn for), so a caption is the same size in every format, as it is the
 * same size on every phone. The pixel cell is the app's 3 points, rounded to whole pixels so every
 * cell lands on the grid.
 *
 * The device is the demo's own row of the device table: its aspect is the row's points, its corner
 * the row's radius in points, and it is fitted into its stage whole, never stretched.
 */

/** Stacked below this aspect (a phone's portrait canvases), side by side from it. */
const SIDE_FROM = 0.95;

function fit(aspect, box) {
  // The largest rect of `aspect` (w / h) inside `box`, centred in it.
  let w = box.w, h = w / aspect;
  if (h > box.h) {
    h = box.h;
    w = h * aspect;
  }
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

/**
 * The layout of one format. `row` is the device row (null: no device, a terminal or stills of no
 * known device, drawn as a card of the stills' own aspect `aspect`).
 */
function layout(W, H, row, aspect = null) {
  const pt = Math.min(W, H) / 393;
  const cell = Math.max(2, Math.round(3 * pt));
  const gutter = 20 * pt;
  const side = W / H >= SIDE_FROM;
  const devAspect = row ? row.points[0] / row.points[1] : aspect ?? 9 / 19.5;
  const landscapeDevice = devAspect > 1;
  const corner = row ? row.corner_radius : 18;

  let stage, words, band;
  if (!side) {
    // Stacked: the band behind the device's top, the words under the device.
    const wordsH = Math.max(150 * pt, H * 0.2);
    stage = { x: gutter, y: H * 0.075, w: W - gutter * 2, h: H - H * 0.075 - wordsH - 12 * pt };
    words = { x: gutter + 4 * pt, y: stage.y + stage.h + 18 * pt, w: W - gutter * 2 - 8 * pt, h: wordsH - 18 * pt };
    band = { x: 0, y: 0, w: W, solid: H * 0.36, fringe: 36 * pt };
  } else {
    // Side by side: the device on the left, the words on the right.
    const devW = landscapeDevice ? W * 0.56 : W * (W / H > 1.3 ? 0.34 : 0.44);
    stage = { x: gutter * (W / H > 1.3 ? 2.2 : 1), y: H * 0.07, w: devW, h: H * 0.86 };
    const wx = stage.x + stage.w + 28 * pt;
    words = { x: wx, y: H * 0.14, w: W - wx - gutter * 1.6, h: H * 0.72 };
    band = { x: 0, y: 0, w: W, solid: H * 0.34, fringe: 36 * pt };
  }
  const device = fit(devAspect, stage);
  // Whole pixels, and an even width so the screen's centre is a pixel edge.
  device.x = Math.round(device.x);
  device.y = Math.round(device.y);
  device.w = Math.round(device.w / 2) * 2;
  device.h = Math.round(device.w / devAspect);
  const scale = row ? device.w / row.points[0] : device.w / 393;
  const radius = corner * scale;
  const bezel = Math.max(3, Math.round(5 * scale));

  // The opening title: set in the band, on its lower part, as large as fits.
  const title = side
    ? { x: gutter * 2, y: H * 0.18, w: W * 0.72, h: H * 0.34 }
    : { x: gutter, y: H * 0.13, w: W - gutter * 2, h: H * 0.2 };

  return {
    W,
    H,
    pt,
    cell,
    gutter,
    side,
    band,
    stage,
    device: { ...device, radius, bezel, scale, aspect: devAspect },
    words,
    title,
    center: { x: W / 2, y: H / 2 },
  };
}

module.exports = { layout, fit, SIDE_FROM };

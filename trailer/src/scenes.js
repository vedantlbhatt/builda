'use strict';
/**
 * The scenes a cut is made of. Each one draws itself at a time `t` seconds into the scene, for any
 * format (`env.lay`), and may name its CONTAINER (`anchor`): the rectangle a morph grows from or
 * into (docs/motion.md: one object grows to say more). Content draws with a `presence`
 * ({opacity, scale, rise}) so a morph can carry it out and in.
 *
 * What is on screen comes from the facts and the cut, never from here: a scene with nothing to show
 * (no number, no commit) is left out of the cut by capture/trailer/cut.py, not drawn empty.
 *
 * The house rules every scene keeps (docs/motion.md, CLAUDE.md, the owner's word on 2026-09-19):
 * the pixels stay and each surface arrives in its own order; one number moves per screen and the
 * rest are set still; no glow, no gradient on a hue, no accent filled button; far less text, and
 * never the pattern of a big figure over a small grey caption (the unit rides the figure's own
 * baseline, in the figure's colour); captions are lower case; no dash anywhere.
 */
const { createCanvas } = require('@napi-rs/canvas');
const house = require('./house');
const { SURFACE, ON_HUE, motion, pixelMotion } = house;
const { clamp, lerp, seg, ease, glide, spring, noise1 } = require('./time');
const T = require('./type');
const px = require('./pixels');
const { drawDevice, drawPicture, tapRing } = require('./device');
const { videoTime } = require('./timeline');
const { Fluid, scalar, rng } = require('./fluid');

const FULL = { opacity: 1, scale: 1, rise: 0 };

function withPresence(ctx, pr, cx, cy, draw) {
  if (pr.opacity <= 0.002) return;
  ctx.save();
  ctx.globalAlpha = pr.opacity;
  if (pr.scale !== 1 || pr.rise) {
    ctx.translate(cx, cy + (pr.rise || 0));
    ctx.scale(pr.scale, pr.scale);
    ctx.translate(-cx, -cy);
  }
  draw();
  ctx.restore();
}

/** The creature's loop: the app's frames at an unhurried beat, offset so two never sync. */
function creatureFrame(env, t, state = 'idle') {
  const frames = house.creatureFrames(env.cut.creature, state) ?? house.creatureFrames('bit', 'idle');
  const beat = env.cut.creature === 'bit' ? 0.42 : 0.55;
  return frames[Math.floor((t + env.seed * 0.137) / beat) % frames.length];
}

// ------------------------------------------------------------------------------------ open

function openBand(env) {
  const { lay } = env;
  const solid = lay.side ? lay.H * 0.62 : lay.H * 0.58;
  return { x: 0, y: 0, w: lay.W, solid, fringe: 36 * lay.pt };
}

const open = {
  anchor(env) {
    const b = openBand(env);
    return { x: 0, y: 0, w: b.w, h: b.solid, r: 0, fill: env.hue.ink };
  },
  draw(ctx, env, scene, t, pr = FULL, { container = true } = {}) {
    const { lay, cut, pace } = env;
    const b = openBand(env);
    const mode = scene.spec.arrival;
    // A slow push in over the scene: the whole band breathes forward, never back.
    const push = 1 + 0.018 * ease(seg(t, 0, scene.t1 - scene.t0));
    if (container) {
      const reveal = ease(seg(t, 0.04, 0.04 + 0.56 / pace));
      ctx.save();
      ctx.translate(lay.W / 2, b.solid / 2);
      ctx.scale(push, push);
      ctx.translate(-lay.W / 2, -b.solid / 2);
      px.band(ctx, { ...b, cell: lay.cell, ink: env.hue.ink, reveal, mode, seed: env.seed % 97, origin: { x: 0.12, y: 0.9 } });
      ctx.restore();
    }
    const titleT = t - (0.04 + 0.24) / pace;
    const size = titleSize(ctx, env, cut.title.text, lay.side ? lay.W * 0.62 : lay.W - lay.gutter * 2.4);
    const baseY = b.solid - (lay.side ? 64 : 56) * lay.pt - (cut.line ? 30 * lay.pt : 0);
    withPresence(ctx, pr, lay.W / 2, b.solid / 2, () => {
      T.letters(ctx, cut.title.text, lay.gutter * 1.2, baseY, titleT, { size, color: ON_HUE, pace });
      if (cut.line) {
        T.words(ctx, cut.line.text, lay.gutter * 1.2 + 2 * lay.pt, baseY + 34 * lay.pt, titleT - 0.12 / pace, {
          size: 17 * lay.pt, weight: 600, color: ON_HUE, pt: lay.pt, pace, track: -0.2 * lay.pt,
        });
      }
      // The creature prints in its own order at the band's top right, whole cells.
      const cs = Math.floor(((lay.side ? 112 : 104) * lay.pt) / 16) * 16;
      const cr = ease(seg(t, 0.18 / pace, 0.18 / pace + 0.5 / pace));
      px.creature(ctx, creatureFrame(env, t), lay.W - lay.gutter * 1.2 - cs, (lay.side ? 44 : 40) * lay.pt, cs, ON_HUE, {
        reveal: cr, mode: pixelMotion.motionFor(`creature:${cut.creature}`), seed: 11,
      });
    });
  },
};

function titleSize(ctx, env, s, width) {
  const { lay } = env;
  const max = (lay.side ? 104 : 96) * lay.pt;
  return T.fitSize(ctx, T.plain(s), width, max, 30 * lay.pt, { weight: 800, track: (z) => -Math.round(z * 0.03 * 10) / 10 });
}

// ------------------------------------------------------------------------------------ screens

function screenRect(env) {
  const d = env.lay.device;
  return { x: d.x, y: d.y, w: d.w, h: d.h, r: d.radius };
}

const screens = {
  anchor(env) {
    const s = screenRect(env);
    return { ...s, fill: env.hue.ink };
  },
  needs(env, scene, t) {
    const vt = videoTime(scene.plan, t);
    return vt == null ? [] : [vt];
  },
  draw(ctx, env, scene, t, pr = FULL, { developFrom = null } = {}) {
    const { lay, pace, cut } = env;
    const d = lay.device;
    const plan = scene.plan;
    const beatIdx = Math.max(0, plan.findIndex((b) => t < b.s1));
    const beat = plan[beatIdx === -1 ? plan.length - 1 : beatIdx] ?? plan[plan.length - 1];
    // The band behind the device's top, printed in its own order once the device is there.
    const bandIn = ease(seg(t, 0.1 / pace, 0.1 / pace + 0.56 / pace));
    const bb = lay.band;
    withPresence(ctx, { opacity: pr.opacity, scale: 1, rise: 0 }, lay.W / 2, lay.H / 2, () => {
      px.band(ctx, { ...bb, cell: lay.cell, ink: env.hue.ink, reveal: bandIn, mode: 'scan', seed: 3, slot: 'screensBand' });
    });
    // The camera: a drift that never repeats, or a lean that settles toward the viewer at each beat.
    const camera = scene.spec.camera ?? 'drift';
    let lean = 0, lift = 0;
    if (camera === 'drift') {
      lean = 0.075 * noise1(t * 0.23 + env.seed) + 0.03;
      lift = 5 * lay.pt * noise1(t * 0.31 + 4.2);
    } else if (camera === 'lean') {
      const since = beat ? t - beat.s0 : t;
      const settle = spring(since, motion.ISLAND, pace);
      lean = lerp(0.2 * (beatIdx % 2 ? -1 : 1), 0.045 * (beatIdx % 2 ? -1 : 1), clamp(settle, 0, 1.2));
    }
    // The punch in: the picture grows 5% about the tap, on the CONTENT spring, and lets go at the
    // next beat.
    let zoom = 1, fx = 0.5, fy = 0.5;
    if (beat && beat.tapAt != null && beat.tap) {
      const u = spring(t - beat.tapAt, motion.CONTENT, pace);
      zoom = 1 + 0.05 * clamp(u, 0, 1.15);
      [fx, fy] = beat.tap;
    }
    const img = env.picture;
    const bar = lay.device.scale * (env.row?.safe_area?.top ?? 0) * (env.row && env.row.family === 'iphone' ? 1 : 0);
    const paint = (c, s) => {
      if (developFrom) {
        px.develop(c, { ...s, r: 0 }, developFrom.reveal, {
          cell: lay.cell, wait: env.hue.ink, mode: 'blocks', seed: 9,
          draw: () => drawPicture(c, img, s, { zoom, fx, fy, bar }),
        });
      } else drawPicture(c, img, s, { zoom, fx, fy, bar });
    };
    const cx = d.x + d.w / 2, cy = d.y + d.h / 2;
    withPresence(ctx, pr, cx, cy, () => {
      drawDevice(ctx, d, env.row, paint, { lean, lift, scale: 1 });
      // The ring, on the screen, where the finger landed (after the lean, so it is approximate on a
      // leaning device; it only shows on a drift of a few degrees).
      if (beat && beat.tapAt != null && beat.tap) {
        tapRing(ctx, d.x + d.w * beat.tap[0], d.y + d.h * beat.tap[1] - lift, t - beat.tapAt, Math.max(2, Math.round(lay.cell * 0.75)), 26 * lay.pt);
      }
    });
    // The beats' words as a wheel: the one on screen now in full, the ones before it above, smaller
    // and in the dim ink, rolling up on the WHEEL spring. At most three, and only a beat's own label.
    withPresence(ctx, { opacity: pr.opacity, scale: 1, rise: pr.rise }, lay.W / 2, lay.H / 2, () => {
      wheel(ctx, env, plan.map((b) => b.label).filter(Boolean), plan, t);
    });
  },
};

function wheel(ctx, env, labels, plan, t) {
  const { lay, pace } = env;
  if (!labels.length) return;
  const w = lay.words;
  const size = (lay.side ? 26 : 22) * lay.pt;
  const lineH = size * 1.32;
  const current = Math.max(0, plan.findIndex((b) => t < b.s1));
  const idx = current === -1 ? plan.length - 1 : current;
  const since = t - (plan[idx]?.s0 ?? 0);
  const roll = clamp(spring(since, motion.WHEEL, pace), 0, 1.1);
  const baseY = lay.side ? w.y + w.h * 0.62 : w.y + size * 1.1;
  const x = w.x;
  for (let k = Math.max(0, idx - 2); k <= idx; k++) {
    const label = plan[k]?.label;
    if (!label) continue;
    const back = idx - k; // 0 is current
    const y = baseY - (back - (1 - roll)) * lineH * (lay.side ? 1.05 : 1);
    const isCur = back === 0;
    const a = isCur ? clamp(roll * 1.2) : clamp(1 - back * 0.34);
    const lines = T.wrap(ctx, label.toLowerCase(), w.w, { size: isCur ? size : size * 0.82, weight: isCur ? 700 : 600 });
    if (lay.side) {
      lines.slice(0, 2).forEach((ln, li) => T.text(ctx, ln, x, y + li * lineH * 0.9 - (back ? 0 : 0), { size: isCur ? size : size * 0.82, weight: isCur ? 700 : 600, color: isCur ? SURFACE.text : SURFACE.textDim, a, track: -0.3 * lay.pt }));
    } else {
      // Stacked: only the current label and the one before it, below the device.
      if (back > 1) continue;
      const yy = w.y + size * 1.2 + (isCur ? lineH * 0.95 : 0) + (1 - roll) * lineH * (isCur ? 0.8 : 1) - (isCur ? 0 : roll * lineH * 0.2);
      lines.slice(0, 2).forEach((ln, li) => T.text(ctx, ln, x, yy + li * lineH * 0.92, { size: isCur ? size : size * 0.82, weight: isCur ? 700 : 600, color: isCur ? SURFACE.text : SURFACE.textDim, a: isCur ? a : a * (1 - roll * 0.25), track: -0.3 * lay.pt }));
    }
  }
}

// ------------------------------------------------------------------------------------ figure

/** A figure's words: the value and its unit, both from the facts, never composed here. */
function figureWords(env, which) {
  const f = env.facts.numbers?.[which];
  if (!f) return null;
  return { value: f.value, final: f.text, unit: f.unit };
}

const plumeCache = new Map();
/** The ink rising behind a figure: a buoyant plume from the frame's foot, pre-simulated per frame. */
function plume(env, scene) {
  const key = `${env.fmtId}:${scene.index}`;
  if (plumeCache.has(key)) return plumeCache.get(key);
  const { lay } = env;
  const cols = Math.ceil(lay.W / lay.cell), rows = Math.ceil(lay.H / lay.cell);
  const nx = Math.round(cols / 2), ny = Math.round(rows / 2);
  const fl = new Fluid(nx, ny);
  const dye = scalar(fl);
  const frames = Math.ceil((scene.t1 - scene.t0 + 1.2) * env.fps) + 2;
  const r = rng(env.seed + scene.index * 31);
  const W = nx + 2;
  const out = [];
  for (let k = 0; k < frames; k++) {
    // Sources along the foot, wandering, pushing up; a curl or two for the eye to follow.
    if (k < frames * 0.8) {
      for (let s = 0; s < 5; s++) {
        const cx = Math.round(nx * (0.1 + 0.8 * ((s + 0.5) / 5) + 0.07 * noise1(k * 0.05 + s * 3)));
        for (let j = ny - 4; j <= ny; j++) {
          for (let i = cx - 4; i <= cx + 4; i++) {
            if (i < 1 || i > nx) continue;
            dye.field[i + W * j] = Math.min(2.2, dye.field[i + W * j] + 0.5);
            fl.v[i + W * j] -= 1.1;
          }
        }
      }
    }
    if (k % 9 === 0) fl.swirl(1 + r() * nx, ny * (0.45 + r() * 0.5), Math.min(nx, ny) * 0.12, (r() - 0.5) * 2.2);
    fl.step(1.4, { vorticity: 3.6, damping: 0.992, carry: [dye] });
    for (let q = 0; q < dye.field.length; q++) dye.field[q] *= 0.998;
    out.push(Float32Array.from(dye.field));
  }
  const res = { fl, out, cols, rows, nx, ny };
  plumeCache.set(key, res);
  return res;
}

const figure = {
  draw(ctx, env, scene, t, pr = FULL) {
    const { lay, pace } = env;
    const which = scene.spec.figure;
    const fw = figureWords(env, which);
    if (!fw) return;
    // The ink, rising, in the 1-bit dither.
    const P = plume(env, scene);
    const k = clamp(Math.floor(t * env.fps), 0, P.out.length - 1);
    const dens = P.out[k];
    const sx = P.nx / P.cols, sy = P.ny / P.rows;
    // Density past about 0.6 prints solid: the plume has a body, and only its edges dither. Its top
    // climbs over the scene, so the ink reaches the figure's foot first and its words last.
    const dur = scene.t1 - scene.t0;
    const ceil = lerp(0.95, lay.side ? 0.3 : 0.34, ease(seg(t, 0, dur * 0.85)));
    const edge = 0.16;
    const inkDensity = (i, j) => {
      const yf = ((j + 0.5) * lay.cell) / lay.H;
      const env2 = clamp((yf - ceil) / edge);
      return env2 <= 0 ? 0 : clamp(P.fl.sample(dens, 0.5 + (i + 0.5) * sx, 0.5 + (j + 0.5) * sy) * 1.7 + env2 * 0.45) * env2;
    };
    ctx.save();
    ctx.globalAlpha = pr.opacity;
    px.field(ctx, { x: 0, y: 0, cols: P.cols, rows: P.rows, cell: lay.cell, ink: env.hue.ink, density: inkDensity, slot: 'plume' });
    ctx.restore();
    // The number, arriving one of the app's four ways, and its unit on its own baseline.
    const numMotion = pixelMotion.numMotionFor(`${env.key}:${which}`);
    const p = ease(seg(t, 0.15 / pace, 0.15 / pace + 0.95 / pace));
    const shown = T.numberAt(numMotion, fw.final, fw.value, p, Math.floor(t * env.fps), (v) => formatLike(fw.final, v));
    const maxW = lay.side ? lay.W * 0.62 : lay.W - lay.gutter * 2.2;
    const unitSize = (lay.side ? 44 : 34) * lay.pt;
    const unitW = T.measure(ctx, ` ${fw.unit}`, { size: unitSize, weight: 800 });
    let size = (lay.side ? 190 : 170) * lay.pt;
    while (size > 40 * lay.pt && T.figureWidth(ctx, fw.final, size) > maxW) size -= 2 * lay.pt;
    void unitW;
    const x = lay.side ? lay.W * 0.08 : lay.gutter * 1.2;
    const y = lay.side ? lay.H * 0.52 : lay.H * 0.5;
    const rise = (1 - clamp(spring(t - 0.1 / pace, motion.CONTENT, pace))) * 18 * lay.pt;
    const draw = (c, color) => {
      figureWithUnit(c, env, { x, y: y + rise, size, shown, final: fw.final, unit: fw.unit, unitSize, t, a: pr.opacity, maxW, color, delay: 0.55 });
    };
    draw(ctx, SURFACE.text);
    // Where the ink runs behind the figure, the figure is set in the ink's own ON_HUE, cell by cell:
    // a knockout, as a band's words are dark on its hue.
    knockout(ctx, env, P.cols, P.rows, inkDensity, (c) => draw(c, ON_HUE));
  },
};

/** Redraw `paint` in only the cells where `density` dithers on. */
function knockout(ctx, env, cols, rows, density, paint) {
  const { lay } = env;
  const W = lay.W, H = lay.H;
  const k = `ko:${W}x${H}`;
  if (!knockout.c || knockout.k !== k) {
    knockout.c = createCanvas(W, H);
    knockout.m = createCanvas(W, H);
    knockout.k = k;
  }
  const c = knockout.c.getContext('2d');
  c.clearRect(0, 0, W, H);
  paint(c);
  const m = knockout.m.getContext('2d');
  m.clearRect(0, 0, W, H);
  px.field(m, { x: 0, y: 0, cols, rows, cell: lay.cell, ink: '#FFFFFF', density, slot: 'komask' });
  c.globalCompositeOperation = 'destination-in';
  c.drawImage(knockout.m, 0, 0);
  c.globalCompositeOperation = 'source-over';
  ctx.drawImage(knockout.c, 0, 0);
}

/** A counted value written the way the final figure is written (commas, decimals). */
function formatLike(final, v) {
  const dec = (final.split('.')[1] ?? '').replace(/[^0-9]/g, '').length;
  const n = dec ? v.toFixed(dec) : String(Math.round(v));
  const [a, b] = n.split('.');
  const withCommas = final.includes(',') ? a.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : a;
  return b ? `${withCommas}.${b}` : withCommas;
}

// ------------------------------------------------------------------------------------ figures

/**
 * A figure and its unit, the unit on the figure's own baseline in the figure's colour when it fits
 * beside it, else on the lines under it at the unit's size (never a smaller grey caption). Returns
 * the y under the last line.
 */
function figureWithUnit(ctx, env, { x, y, size, shown, final, unit, unitSize, t, a = 1, maxW, color = SURFACE.text, delay = 0.5 }) {
  const { lay, pace } = env;
  const w = T.figure(ctx, shown, x, y, size, color, { a });
  const fw = T.figureWidth(ctx, final, size);
  const beside = T.measure(ctx, ` ${unit}`, { size: unitSize, weight: 800 });
  const track = -Math.round(unitSize * 0.03 * 10) / 10;
  if (fw + beside <= maxW) {
    T.words(ctx, unit, x + fw + unitSize * 0.28, y, t - delay / pace, { size: unitSize, weight: 800, color, pt: lay.pt, pace, track, a });
    return y + unitSize * 0.6;
  }
  const lines = T.wrap(ctx, unit, maxW, { size: unitSize, weight: 800, track });
  lines.forEach((ln, i) => T.words(ctx, ln, x + 3 * lay.pt, y + unitSize * 1.22 * (i + 1), t - delay / pace - i * 0.08, { size: unitSize, weight: 800, color, pt: lay.pt, pace, track, a }));
  void w;
  return y + unitSize * 1.22 * lines.length + unitSize * 0.4;
}

// ------------------------------------------------------------------------------------ days

const days = {
  draw(ctx, env, scene, t, pr = FULL) {
    const { lay, pace } = env;
    const cal = env.facts.days;
    if (!cal || !cal.levels?.length) return;
    const weeks = Math.ceil(cal.levels.length / 7);
    // Weeks run across a wide frame and down a tall one, so the calendar always fills its frame.
    const across = lay.side;
    const nCol = across ? weeks : 7, nRow = across ? 7 : weeks;
    const gap = Math.max(2, Math.round(lay.cell * 0.5));
    const areaW = across ? lay.W * 0.5 : lay.W - lay.gutter * 2.4;
    const areaH = across ? lay.H * 0.62 : lay.H * 0.5;
    const unit = Math.min((areaW - gap * (nCol - 1)) / nCol, (areaH - gap * (nRow - 1)) / nRow);
    const block = Math.max(lay.cell, Math.floor(unit / lay.cell) * lay.cell);
    const gridW = nCol * block + (nCol - 1) * gap;
    const gridH = nRow * block + (nRow - 1) * gap;
    const x0 = across ? lay.W - lay.gutter * 2 - gridW : (lay.W - gridW) / 2;
    const y0 = across ? (lay.H - gridH) / 2 : lay.H - lay.gutter * 2.2 - gridH;
    const mode = scene.spec.arrival;
    const reveal = seg(t, 0.1 / pace, 0.1 / pace + 1.2 / pace);
    const per = Math.max(1, Math.round(block / lay.cell));
    ctx.save();
    ctx.globalAlpha = pr.opacity;
    for (let d = 0; d < cal.levels.length; d++) {
      const wk = Math.floor(d / 7), dow = d % 7;
      const col = across ? wk : dow, row = across ? dow : wk;
      if (!(pixelMotion.cellOrder(mode, col, row, nCol, nRow, 2) < reveal * 1.02)) continue;
      const lvl = cal.levels[d];
      const bx = x0 + col * (block + gap), by = y0 + row * (block + gap);
      // A day not built is the raised ground; a built day prints its level as the dither's density.
      const dens = lvl <= 0 ? 1 : 0.3 + (lvl / 5) * 0.7;
      px.field(ctx, { x: bx, y: by, cols: per, rows: per, cell: lay.cell, ink: lvl <= 0 ? SURFACE.raised : env.hue.ink, slot: 'day', density: () => dens });
    }
    ctx.restore();
    const n = env.facts.numbers?.days_built;
    if (n) {
      const size = (across ? 132 : 120) * lay.pt;
      const fx = across ? lay.W * 0.07 : lay.gutter * 1.2;
      const fy = across ? lay.H * 0.46 : lay.H * 0.2;
      const p = ease(seg(t, 0.2 / pace, 1.1 / pace));
      const shown = T.numberAt(pixelMotion.numMotionFor(`${env.key}:days`), n.text, n.value, p, Math.floor(t * env.fps), (v) => formatLike(n.text, v));
      const under = figureWithUnit(ctx, env, { x: fx, y: fy, size, shown, final: n.text, unit: n.unit, unitSize: (across ? 40 : 36) * lay.pt, t, a: pr.opacity, maxW: across ? lay.W * 0.36 : lay.W - lay.gutter * 2.4, delay: 0.6 });
      if (cal.since) T.words(ctx, cal.since, fx + 3 * lay.pt, under + 26 * lay.pt, t - 0.9 / pace, { size: 20 * lay.pt, weight: 600, color: SURFACE.textDim, pt: lay.pt, pace, a: pr.opacity });
    }
  },
};

// ------------------------------------------------------------------------------------ changelog

/** At most this many commits on screen: the owner's "far less text". */
const CHANGELOG_MAX = 4;

const changelog = {
  draw(ctx, env, scene, t, pr = FULL) {
    const { lay, pace } = env;
    const log = (env.facts.changelog ?? []).slice(0, CHANGELOG_MAX);
    if (!log.length) return;
    const dur = scene.t1 - scene.t0;
    const size = (lay.side ? 30 : 26) * lay.pt;
    const lineH = size * 1.24;
    const x = lay.side ? lay.W * 0.42 : lay.gutter * 1.2;
    const markW = Math.round(lay.cell * 1.25);
    const textX = x + markW + 16 * lay.pt;
    const maxW = (lay.side ? lay.W * 0.52 : lay.W - lay.gutter * 1.2) - (textX - x) - lay.gutter;
    // The heading: the count, set still (one number moves per screen, and on this one the list is
    // what moves), its unit beside it or under it.
    const head = env.facts.numbers?.commits_since ?? env.facts.numbers?.commits_latest;
    let top = lay.side ? lay.H * 0.2 : lay.H * 0.14;
    if (head) {
      const hs = (lay.side ? 132 : 112) * lay.pt;
      const hx = lay.side ? lay.W * 0.07 : x;
      const hy = lay.side ? lay.H * 0.44 : top + hs * 0.8;
      const a = clamp(spring(t, motion.CONTENT, pace)) * pr.opacity;
      const under = figureWithUnit(ctx, env, { x: hx, y: hy, size: hs, shown: head.text, final: head.text, unit: head.unit, unitSize: (lay.side ? 36 : 32) * lay.pt, t, a, maxW: lay.side ? lay.W * 0.3 : lay.W - lay.gutter * 2.4, delay: 0.2 });
      if (!lay.side) top = under + 44 * lay.pt;
    }
    // The lines arrive one after another on the WHEEL spring; the newest arrival is in full.
    const per = Math.min(0.5 / pace, (dur * 0.62) / log.length);
    let y = top + size;
    const newest = Math.min(log.length - 1, Math.floor(Math.max(0, t - 0.35 / pace) / per));
    log.forEach((c, i) => {
      const t0 = 0.35 / pace + i * per;
      const u = clamp(spring(t - t0, motion.WHEEL, pace), 0, 1.1);
      const lines = T.wrap(ctx, c, maxW, { size, weight: 600 });
      const shown = lines.length > 2 ? [lines[0], `${lines[1].replace(/[,.;:]$/, '')}\u2026`] : lines;
      if (u > 0.001) {
        const dy = (1 - Math.min(1, u)) * lineH * 0.7;
        const cur = i === newest;
        const a = Math.min(1, u) * pr.opacity;
        ctx.globalAlpha = a;
        ctx.fillStyle = house.tokens.mark.commit.dark;
        ctx.fillRect(Math.round(x), Math.round(y + dy - size * 0.66), markW, markW);
        ctx.globalAlpha = 1;
        shown.forEach((ln, li) => T.text(ctx, ln, textX, y + dy + li * lineH, { size, weight: cur ? 700 : 600, color: cur ? SURFACE.text : SURFACE.textDim, a, track: -0.3 * lay.pt }));
      }
      y += shown.length * lineH + size * 0.72;
    });
  },
};

// ------------------------------------------------------------------------------------ stack

/** Each language's share of the bar is the project's hue at a lower dither density, by rank. */
const STACK_DENSITY = [1, 0.62, 0.4, 0.26, 0.16];

const stack = {
  draw(ctx, env, scene, t, pr = FULL) {
    const { lay, pace } = env;
    const langs = (env.facts.languages ?? []).slice(0, STACK_DENSITY.length);
    if (!langs.length) return;
    const x = lay.side ? lay.W * 0.1 : lay.gutter * 1.2;
    const w = lay.side ? lay.W * 0.8 : lay.W - lay.gutter * 2.4;
    const cols = Math.floor(w / lay.cell);
    const rows = Math.round(((lay.side ? 150 : 190) * lay.pt) / lay.cell);
    const y = lay.side ? lay.H * 0.26 : lay.H * 0.3;
    // Where each language's run of columns starts, in cells, by its share.
    const edges = [0];
    for (const l of langs) edges.push(Math.min(cols, edges[edges.length - 1] + Math.max(1, Math.round(cols * l.share))));
    const which = (i) => {
      for (let k = 0; k < langs.length; k++) if (i < edges[k + 1]) return k;
      return -1;
    };
    const reveal = ease(seg(t, 0.1 / pace, 0.1 / pace + 0.9 / pace));
    const mode = scene.spec.arrival;
    ctx.save();
    ctx.globalAlpha = pr.opacity;
    px.field(ctx, {
      x, y, cols, rows, cell: lay.cell, ink: env.hue.ink, slot: 'stack',
      density: (i, j) => {
        const k = which(i);
        if (k < 0) return 0;
        // A column between two languages is ground: the runs read as separate without a line.
        if (i === edges[k + 1] - 1 && k < langs.length - 1) return 0;
        return pixelMotion.cellOrder(mode, i, j, cols, rows, 4) < reveal * 1.02 ? STACK_DENSITY[k] : 0;
      },
    });
    ctx.restore();
    // The legend: a swatch printed at its language's density, the name, its share, one colour.
    const size = (lay.side ? 26 : 24) * lay.pt;
    const rowH = size * 1.6;
    const sw = Math.round((size * 0.8) / lay.cell) * lay.cell || lay.cell;
    const ly = y + rows * lay.cell + 52 * lay.pt;
    // Side by side the legend flows along a line and wraps; stacked it is one language a line.
    let lx = x, yy = ly;
    langs.forEach((l, k) => {
      const label = `${l.name.toLowerCase()}  ${Math.round(l.share * 100)}%`;
      const lw = sw + 14 * lay.pt + T.measure(ctx, label, { size, weight: 700, track: -0.3 * lay.pt });
      if (lay.side && k > 0) {
        if (lx + lw > x + w) {
          lx = x;
          yy += rowH;
        }
      } else if (!lay.side && k > 0) {
        yy += rowH;
      }
      const u = clamp(spring(t - 0.5 / pace - k * (motion.STAGGER_MS / 1000) / pace, motion.CONTENT, pace));
      if (u > 0.001) {
        const a = Math.min(1, u) * pr.opacity;
        ctx.save();
        ctx.globalAlpha = a;
        const n = Math.max(1, Math.round(sw / lay.cell));
        px.field(ctx, { x: lx, y: yy - sw, cols: n, rows: n, cell: lay.cell, ink: env.hue.ink, slot: `sw${k}`, density: () => STACK_DENSITY[k] });
        ctx.restore();
        T.text(ctx, label, lx + sw + 14 * lay.pt, yy + (1 - Math.min(1, u)) * 8 * lay.pt, { size, weight: 700, color: SURFACE.text, a, track: -0.3 * lay.pt });
      }
      if (lay.side) lx += lw + 44 * lay.pt;
    });
  },
};

// ------------------------------------------------------------------------------------ end

const end = {
  anchor(env) {
    return { x: 0, y: 0, w: env.lay.W, h: env.lay.H, r: 0, fill: env.hue.ink };
  },
  draw(ctx, env, scene, t, pr = FULL, { container = true } = {}) {
    const { lay, cut, pace } = env;
    if (container) {
      const reveal = ease(seg(t, 0, 0.5 / pace));
      px.band(ctx, { x: 0, y: 0, w: lay.W, solid: lay.H, fringe: 0.001, cell: lay.cell, ink: env.hue.ink, reveal, mode: scene.spec.arrival, seed: 41, origin: { x: 0.5, y: 0.5 } });
    }
    withPresence(ctx, pr, lay.W / 2, lay.H / 2, () => {
      const cs = Math.floor((lay.side ? lay.H * 0.24 : Math.min(lay.H * 0.17, 160 * lay.pt)) / 16) * 16;
      const cyC = lay.side ? lay.H * 0.14 : lay.H * 0.24;
      px.creature(ctx, creatureFrame(env, t, env.cut.creature === 'bit' ? 'celebrating' : 'idle'), lay.W / 2 - cs / 2, cyC, cs, ON_HUE, {
        reveal: ease(seg(t, 0.12 / pace, 0.6 / pace)), mode: 'spiral', seed: 5,
      });
      const width = lay.W - lay.gutter * 3;
      const size = Math.min(titleSize(ctx, env, cut.title.text, width), lay.H * (lay.side ? 0.2 : 0.09));
      const ty = cyC + cs + 34 * lay.pt + size * 0.78;
      const tw = T.measure(ctx, T.plain(cut.title.text), { size, weight: 800, track: -Math.round(size * 0.03 * 10) / 10 });
      T.letters(ctx, cut.title.text, lay.W / 2 - tw / 2, ty, t - 0.22 / pace, { size, color: ON_HUE, pace });
      if (cut.cta) {
        T.words(ctx, cut.cta.text, lay.W / 2, ty + 48 * lay.pt, t - 0.45 / pace, { size: 22 * lay.pt, weight: 700, color: ON_HUE, pt: lay.pt, pace, align: 'center', track: -0.3 * lay.pt });
      }
      // The maker's mark at the foot: a solid square and the wordmark, the share card's (RecapCard).
      const mk = ease(seg(t, 0.7 / pace, 1.1 / pace));
      if (mk > 0) {
        const ms = 13 * lay.pt;
        const label = 'made with Builda';
        const lw = T.measure(ctx, label, { size: 15 * lay.pt, weight: 700 });
        const mx = lay.W / 2 - (ms + 8 * lay.pt + lw) / 2, my = lay.H - 44 * lay.pt;
        ctx.globalAlpha = mk * pr.opacity;
        ctx.fillStyle = ON_HUE;
        ctx.fillRect(Math.round(mx), Math.round(my - ms), Math.round(ms), Math.round(ms));
        ctx.globalAlpha = 1;
        T.text(ctx, label, mx + ms + 8 * lay.pt, my - 1 * lay.pt, { size: 15 * lay.pt, weight: 700, color: ON_HUE, a: mk * pr.opacity });
      }
    });
  },
};

module.exports = { open, screens, figure, days, changelog, stack, end, FULL, formatLike, knockout };

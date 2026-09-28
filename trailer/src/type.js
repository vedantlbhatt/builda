'use strict';
/**
 * Words, the way the app sets them.
 *
 * The app uses the system font (SF Pro) and ships no font file. A render on any machine needs a
 * font it may carry, so the trailer uses Inter (OFL), the closest open cut to SF Pro's metrics,
 * and JetBrains Mono (OFL) for machine data, as SPEC.md for the first Builda reel settled.
 *
 * Every figure is TABULAR (the app sets `tabular-nums` on every number): canvas cannot turn on
 * Inter's `tnum`, so `figure` sets each digit centred in a cell the width of the widest digit, which
 * is what a tabular figure is. Figures are weight 800 with tracking -3.5% of their size, the app's
 * `figure(size)` formula (mobile/src/insights/kit.tsx).
 *
 * Text never carries a dash: `plain` strips the four the app refuses (em, en, the horizontal bar,
 * the minus sign), rewriting a dash between words as a middle dot, the app's separator.
 */
const { GlobalFonts } = require('@napi-rs/canvas');
const { clamp, ease, seg, spring } = require('./time');
const { motion } = require('./house');

let registered = false;
function registerFonts() {
  if (registered) return;
  for (const w of [400, 500, 600, 700, 800]) {
    GlobalFonts.registerFromPath(require.resolve(`@fontsource/inter/files/inter-latin-${w}-normal.woff2`), 'Inter');
  }
  for (const w of [500, 700]) {
    GlobalFonts.registerFromPath(require.resolve(`@fontsource/jetbrains-mono/files/jetbrains-mono-latin-${w}-normal.woff2`), 'Mono');
  }
  registered = true;
}

const DASHES = /\s*[—–―−]\s*/g;
/** The app's one dash rule, applied at the last moment a word could reach a frame. */
function plain(s) {
  return String(s ?? '').replace(DASHES, ' · ').replace(/\s+/g, ' ').trim();
}

function font(size, weight = 400, mono = false) {
  return `${weight} ${Math.max(1, size).toFixed(2)}px ${mono ? 'Mono' : 'Inter'}`;
}

/** Draw text; returns its width. `a` is opacity. */
function text(ctx, s, x, y, { size = 17, weight = 400, color = '#F5F1EA', align = 'left', track = 0, mono = false, a = 1, base = 'alphabetic' } = {}) {
  if (a <= 0) return 0;
  ctx.font = font(size, weight, mono);
  ctx.letterSpacing = `${track}px`;
  ctx.textAlign = align;
  ctx.textBaseline = base;
  ctx.globalAlpha = a;
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
  ctx.globalAlpha = 1;
  const w = ctx.measureText(s).width;
  ctx.letterSpacing = '0px';
  return w;
}

function measure(ctx, s, { size = 17, weight = 400, track = 0, mono = false } = {}) {
  ctx.font = font(size, weight, mono);
  ctx.letterSpacing = `${track}px`;
  const w = ctx.measureText(s).width;
  ctx.letterSpacing = '0px';
  return w;
}

/** The largest size in [min, max] at which `s` fits `width` on one line (measured, not guessed). */
function fitSize(ctx, s, width, max, min, opts = {}) {
  let lo = min, hi = max;
  if (measure(ctx, s, { ...opts, size: max, track: trackFor(max, opts) }) <= width) return max;
  for (let k = 0; k < 18; k++) {
    const mid = (lo + hi) / 2;
    if (measure(ctx, s, { ...opts, size: mid, track: trackFor(mid, opts) }) <= width) lo = mid;
    else hi = mid;
  }
  return Math.floor(lo);
}
function trackFor(size, opts) {
  return opts.track === undefined ? -Math.round(size * 0.035 * 10) / 10 : typeof opts.track === 'function' ? opts.track(size) : opts.track;
}

/** Break `s` into lines no wider than `width`. */
function wrap(ctx, s, width, opts) {
  const words = plain(s).split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (line && measure(ctx, next, opts) > width) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * A tabular figure: every digit in a cell as wide as the widest digit, weight 800, the app's
 * tracking. Returns the width. `chars` may be a partial string (a scramble or a typed arrival).
 */
function figure(ctx, s, x, y, size, color, { align = 'left', a = 1, weight = 800 } = {}) {
  ctx.font = font(size, weight);
  ctx.letterSpacing = '0px';
  let dw = 0;
  for (const d of '0123456789') dw = Math.max(dw, ctx.measureText(d).width);
  const track = -Math.round(size * 0.035 * 10) / 10;
  const widths = [...s].map((ch) => (/[0-9]/.test(ch) ? dw : ctx.measureText(ch).width) + track);
  const total = widths.reduce((p, q) => p + q, 0) - track;
  let cx = align === 'left' ? x : align === 'right' ? x - total : x - total / 2;
  ctx.globalAlpha = a;
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  [...s].forEach((ch, i) => {
    const w = widths[i] - track;
    ctx.textAlign = 'center';
    ctx.fillText(ch, cx + w / 2, y);
    cx += widths[i];
  });
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
  return total;
}

function figureWidth(ctx, s, size, weight = 800) {
  ctx.font = font(size, weight);
  let dw = 0;
  for (const d of '0123456789') dw = Math.max(dw, ctx.measureText(d).width);
  const track = -Math.round(size * 0.035 * 10) / 10;
  return [...s].reduce((p, ch) => p + (/[0-9]/.test(ch) ? dw : ctx.measureText(ch).width) + track, 0) - track;
}

/**
 * Words that rise 10 points while they fade in, one after another (the app's `Words`: WORD_MS apart,
 * on the CONTENT spring). `t` is seconds since the line started. Returns the width drawn.
 */
function words(ctx, s, x, y, t, { size, weight = 600, color, pt, pace = 1, align = 'left', track = 0, a = 1, gap } = {}) {
  const parts = plain(s).split(' ');
  ctx.font = font(size, weight);
  ctx.letterSpacing = `${track}px`;
  const space = ctx.measureText(' ').width;
  const widths = parts.map((p) => ctx.measureText(p).width);
  ctx.letterSpacing = '0px';
  const total = widths.reduce((p, q) => p + q, 0) + space * (parts.length - 1);
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  const step = gap ?? motion.WORD_MS / 1000;
  parts.forEach((p, i) => {
    const u = clamp(spring(t - i * step / pace, motion.CONTENT, pace));
    if (u > 0.001) text(ctx, p, cx, y + (1 - u) * 10 * pt, { size, weight, color, track, a: Math.min(1, u) * a });
    cx += widths[i] + space;
  });
  return total;
}

/**
 * A name arriving a letter at a time (react-bits SplitText, as the project door sets it): each
 * letter rises from 60% of the line height below and fades in on the CONTENT spring, 32 ms apart.
 */
function letters(ctx, s, x, y, t, { size, weight = 800, color, pace = 1, a = 1, track } = {}) {
  const tr = track ?? -Math.round(size * 0.03 * 10) / 10;
  ctx.font = font(size, weight);
  ctx.letterSpacing = '0px';
  let cx = x;
  const chars = [...plain(s)];
  chars.forEach((ch, i) => {
    const u = clamp(spring(t - (i * 0.032) / pace, motion.CONTENT, pace), 0, 1.2);
    const w = ctx.measureText(ch).width;
    if (u > 0.001) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, u) * a;
      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(ch, cx, y + (1 - Math.min(1, u)) * size * 0.6);
      ctx.restore();
    }
    cx += w + tr;
  });
  return cx - x - tr;
}

/**
 * A number arriving one of the app's four ways (pixelMotion NUM_MOTIONS): counting, a split flap
 * scramble settling left to right, typed, or ticking over in tenths. Returns the string to draw at
 * `p` (0 to 1, already eased) of the arrival.
 */
function numberAt(motionName, final, value, p, frame, formatter) {
  if (p >= 1) return final;
  if (motionName === 'count') return formatter(value * p);
  if (motionName === 'tick') return formatter(value * Math.floor(p * 10) / 10);
  const code = { scramble: 1, type: 2 }[motionName] ?? 1;
  return require('./house').pixelMotion.numFrame(code, final, p, frame);
}

module.exports = { registerFonts, plain, font, text, measure, fitSize, wrap, figure, figureWidth, words, letters, numberAt, seg, ease };

'use strict';
/**
 * Time in a trailer is seconds on the cut's clock. Everything that moves reads it through these,
 * so a trailer moves by the app's own physics: `spring` is `mobile/src/motion/spec.ts springAt`,
 * the closed form of the same springs Reanimated runs on the phone, scaled by the cut's pace.
 *
 * `morph` is docs/motion.md's one object growing to say more, as numbers: ONE progress on the
 * ISLAND spring drives the container (size and radius interpolate off it together, so corners
 * never wobble against the size), the outgoing content is gone by 0.28 and scales UP as it leaves,
 * and the incoming content starts at 0.34 on the stiffer CONTENT spring, rising 5 points and
 * growing from 0.92. Pure: the tests read it.
 */
const { motion } = require('./house');

const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
/** Where `t` sits between `a` and `b`, clamped to 0..1. */
const seg = (t, a, b) => (b === a ? (t >= b ? 1 : 0) : clamp((t - a) / (b - a)));

function bezier(p1x, p1y, p2x, p2y) {
  const cx = 3 * p1x, bx = 3 * (p2x - p1x) - cx, ax = 1 - cx - bx;
  const cy = 3 * p1y, by = 3 * (p2y - p1y) - cy, ay = 1 - cy - by;
  const sx = (t) => ((ax * t + bx) * t + cx) * t;
  const sy = (t) => ((ay * t + by) * t + cy) * t;
  const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  function solve(x) {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x;
      if (Math.abs(e) < 1e-7) return t;
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0, hi = 1;
    t = x;
    for (let i = 0; i < 40; i++) {
      const v = sx(t);
      if (Math.abs(v - x) < 1e-7) break;
      if (x > v) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  }
  return (x) => (x <= 0 ? 0 : x >= 1 ? 1 : sy(solve(x)));
}

/** The house ease (mobile/src/insights/motion.ts): cubic-bezier(0.23, 1, 0.32, 1). */
const ease = bezier(0.23, 1, 0.32, 1);
/** Symmetric, for a camera that has to leave as gently as it arrived. */
const glide = bezier(0.65, 0, 0.35, 1);
const easeIn = (x) => x * x * x;

/** A spring released from 0 toward 1, `t` seconds after release, at the cut's pace. */
function spring(t, spec = motion.ISLAND, pace = 1) {
  return motion.springAt(t * 1000 * pace, spec);
}

/**
 * docs/motion.md's morph at `t` seconds after it began. `box` is the container's progress (it passes
 * 1 and comes back), `out` the outgoing content's opacity and scale, `in` the incoming content's.
 */
function morph(t, pace = 1) {
  const box = spring(t, motion.ISLAND, pace);
  const [o0, o1] = motion.CONTENT_OUT;
  const [i0] = motion.CONTENT_IN;
  const lin = clamp(box);
  const outU = seg(lin, o0, o1);
  const outOpacity = 1 - outU;
  const outScale = lerp(1, motion.OUT_SCALE, outU);
  // The incoming content's own clock starts when the box first passes CONTENT_IN[0].
  const tIn = firstPass(i0, pace);
  const inU = t < tIn ? 0 : spring(t - tIn, motion.CONTENT, pace);
  return {
    box,
    out: { opacity: outOpacity, scale: outScale },
    in: { opacity: clamp(inU), scale: lerp(motion.IN_SCALE, 1, clamp(inU)), rise: (1 - clamp(inU)) * motion.IN_RISE },
  };
}

const passCache = new Map();
/** The first time the ISLAND spring reaches `level`, in seconds, at `pace`. */
function firstPass(level, pace = 1) {
  const key = `${level}:${pace}`;
  if (passCache.has(key)) return passCache.get(key);
  let t = 0;
  while (t < 3 && spring(t, motion.ISLAND, pace) < level) t += 0.001;
  passCache.set(key, t);
  return t;
}

/** A staggered entrance: item `i` starts `i` steps late, capped as the app caps it. */
function stagger(i, stepMs = motion.STAGGER_MS) {
  return motion.staggerDelay(i, stepMs) / 1000;
}

/** Deterministic noise, so every worker draws the same frame. */
function hash(n) {
  const v = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return v - Math.floor(v);
}
function noise1(x) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return lerp(hash(i), hash(i + 1), u) * 2 - 1;
}

module.exports = { clamp, lerp, seg, bezier, ease, glide, easeIn, spring, morph, firstPass, stagger, hash, noise1 };

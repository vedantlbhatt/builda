'use strict';
// Timing toolkit: CSS-accurate cubic-bezier solver, named curves, springs, keyframes.

function bezier(p1x, p1y, p2x, p2y) {
  const cx = 3 * p1x, bx = 3 * (p2x - p1x) - cx, ax = 1 - cx - bx;
  const cy = 3 * p1y, by = 3 * (p2y - p1y) - cy, ay = 1 - cy - by;
  const sx = t => ((ax * t + bx) * t + cx) * t;
  const sy = t => ((ay * t + by) * t + cy) * t;
  const dx = t => (3 * ax * t + 2 * bx) * t + cx;
  function solve(x) {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x;
      if (Math.abs(e) < 1e-7) return t;
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0, hi = 1; t = x;
    for (let i = 0; i < 40; i++) {
      const v = sx(t);
      if (Math.abs(v - x) < 1e-7) break;
      if (x > v) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  }
  return x => (x <= 0 ? 0 : x >= 1 ? 1 : sy(solve(x)));
}

const E = {
  linear: x => x,
  outCubic: x => 1 - Math.pow(1 - x, 3),
  inCubic: x => x * x * x,
  inOutCubic: x => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  outQuart: x => 1 - Math.pow(1 - x, 4),
  outQuint: x => 1 - Math.pow(1 - x, 5),
  inQuint: x => x * x * x * x * x,
  inOutQuint: x => (x < 0.5 ? 16 * x ** 5 : 1 - Math.pow(-2 * x + 2, 5) / 2),
  outExpo: x => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  inExpo: x => (x <= 0 ? 0 : Math.pow(2, 10 * x - 10)),
  inOutExpo: x => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2),
  outSine: x => Math.sin((x * Math.PI) / 2),
  inOutSine: x => -(Math.cos(Math.PI * x) - 1) / 2,
  // signature curves
  snap: bezier(0.7, 0, 0.12, 1),        // hard in, silky out
  swift: bezier(0.16, 1, 0.3, 1),       // expo-like out
  glide: bezier(0.65, 0, 0.35, 1),      // symmetric in-out
  push: bezier(0.83, 0, 0.17, 1),       // quint in-out
  back: bezier(0.34, 1.56, 0.64, 1),    // overshoot out
  backIn: bezier(0.36, 0, 0.66, -0.56), // anticipation in
  bezier,
};

const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const seg = (f, a, b) => clamp((f - a) / (b - a));
const tw = (f, a, b, from, to, ease = E.glide) => lerp(from, to, ease(seg(f, a, b)));

// Damped spring step response, t in frames. Overshoots when zeta < 1.
function spring(t, { freq = 2.2, zeta = 0.42, fps = 60 } = {}) {
  if (t <= 0) return 0;
  const s = t / fps, w = 2 * Math.PI * freq;
  if (zeta >= 1) return 1 - Math.exp(-w * s) * (1 + w * s);
  const wd = w * Math.sqrt(1 - zeta * zeta);
  return 1 - Math.exp(-zeta * w * s) * (Math.cos(wd * s) + (zeta * w / wd) * Math.sin(wd * s));
}

// Keyframes: [[f0, v0], [f1, v1, ease], ...]; ease is the curve used to arrive at that key.
function keys(f, ks) {
  if (f <= ks[0][0]) return ks[0][1];
  for (let i = 1; i < ks.length; i++) {
    const [f1, v1, ez] = ks[i];
    if (f <= f1) {
      const [f0, v0] = ks[i - 1];
      const u = (ez || E.glide)(seg(f, f0, f1));
      return Array.isArray(v0) ? v0.map((a, j) => lerp(a, v1[j], u)) : lerp(v0, v1, u);
    }
  }
  return ks[ks.length - 1][1];
}

// Deterministic hash noise
function hash(n) { n = Math.sin(n * 127.1 + 311.7) * 43758.5453123; return n - Math.floor(n); }
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1e9) / 1e9; }; }
function noise1(x) { const i = Math.floor(x), fr = x - i, u = fr * fr * (3 - 2 * fr); return lerp(hash(i), hash(i + 1), u) * 2 - 1; }

module.exports = { E, bezier, clamp, lerp, seg, tw, spring, keys, hash, rng, noise1 };

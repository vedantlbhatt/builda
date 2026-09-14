/**
 * The seven background programs in JavaScript, line for line, so the tests can hold what the GPU
 * draws against what the design says, cell by cell (the same pattern as `ditherMask` in
 * `src/ui/dithering.ts`). Doubles here, 32 bit floats on the GPU: a cell whose value lands within
 * a hair of its Bayer threshold can differ, which is why the tests compare with a tolerance and
 * never a screenshot.
 *
 * Ported from react-bits `Backgrounds/*` (Dither, PixelBlast, Silk, Grainient, Radar, DotGrid,
 * Topography) by David Haz.
 * react-bits is MIT + Commons Clause (Copyright (c) 2026 David Haz): the notice is kept here
 * as the licence asks, and the ports are used as part of this application only; they are not
 * to be redistributed as components.
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a copy of this
 *   software and associated documentation files (the "Software"), to deal in the Software
 *   without restriction, including without limitation the rights to use, copy, modify,
 *   merge, publish, and distribute the Software as part of an application, website, or
 *   product, subject to the following conditions: The above copyright notice and this
 *   permission notice shall be included in all copies or substantial portions of the
 *   Software. Commons Clause Restriction: You may use this Software, including for any
 *   commercial purpose, so long as you do not sell, sublicense, or redistribute the
 *   components themselves, whether alone, in a bundle, or as a ported version.
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
 *
 * What changed in the port: nothing beyond `shaders.ts`; this is that file's arithmetic.
 */
import { bayer8 } from '../../dithering';
import { DEAD_ZONE, dotEnvelope } from './spec';
import type { BackgroundName } from './shaders';

/** 0 paper, 1 partner, 2 ink, 3 a DotGrid dot at rest (`base`). */
export type ToneIndex = 0 | 1 | 2 | 3;

/** A uniform bag as the components send it: numbers and short number arrays. */
export type UniformBag = Readonly<Record<string, number | readonly number[]>>;

const fract = (x: number) => x - Math.floor(x);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const mix = (a: number, b: number, k: number) => a + (b - a) * k;
function smoothstep(e0: number, e1: number, x: number): number {
  const k = clamp((x - e0) / (e1 - e0), 0, 1);
  return k * k * (3 - 2 * k);
}
const num = (u: UniformBag, k: string) => {
  const v = u[k];
  if (typeof v !== 'number') throw new Error(`twin: uniform ${k} is not a number`);
  return v;
};
const vec = (u: UniformBag, k: string) => {
  const v = u[k];
  if (typeof v === 'number' || v === undefined) throw new Error(`twin: uniform ${k} is not a vector`);
  return v;
};

// ─── the prelude ─────────────────────────────────────────────────────────────────────────

/** Dave Hoskins' `hash12`, the SkSL prelude's, in doubles. */
export function hash12(x: number, y: number): number {
  let a = fract(x * 0.1031);
  let b = fract(y * 0.1031);
  let c = fract(x * 0.1031);
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d;
  b += d;
  c += d;
  return fract((a + b) * c);
}

/** Under half a Bayer step a value is paper (the prelude's dead zone). */
export const TONE_DEAD_ZONE = DEAD_ZONE;

/** The three level tone (`tone` in the prelude): 0 paper, 1 partner, 2 ink. */
export function toneIndex(v: number, b: number, levels: number): 0 | 1 | 2 {
  if (v < TONE_DEAD_ZONE) return 0;
  if (levels < 2.5) return v > b ? 2 : 0;
  const s = v * 2;
  if (s <= 1) return s > b ? 1 : 0;
  return s - 1 > b ? 2 : 1;
}

/** The frame at a cell centre: develop, edge fade, the cleared rect. */
export function frameAt(u: UniformBag, cx: number, cy: number): number {
  const [w, h] = vec(u, 'size') as [number, number];
  let k = num(u, 'reveal');
  const edge = num(u, 'edge');
  if (edge > 0) {
    const nx = cx / w;
    const ny = cy / h;
    k *= smoothstep(0, edge, Math.min(Math.min(nx, ny), Math.min(1 - nx, 1 - ny)));
  }
  const [rx, ry, rw, rh] = vec(u, 'clearRect') as [number, number, number, number];
  if (rw > 0 && cx >= rx && cx <= rx + rw && cy >= ry && cy <= ry + rh) k = 0;
  return k;
}

// ─── 1. the Dither wave ──────────────────────────────────────────────────────────────────

const mod289 = (x: number) => x - Math.floor(x * (1 / 289)) * 289;
const permute = (x: number) => mod289((x * 34 + 1) * x);
const taylorInvSqrt = (r: number) => 1.79284291400159 - 0.85373472095314 * r;
const fade = (q: number) => q * q * q * (q * (q * 6 - 15) + 10);

/** Gustavson's classic 2D Perlin noise, react-bits Dither's `cnoise`, x 2.3. */
export function cnoise(px: number, py: number): number {
  const pi = [Math.floor(px), Math.floor(py), Math.floor(px) + 1, Math.floor(py) + 1].map(mod289) as [number, number, number, number];
  const pf = [fract(px), fract(py), fract(px) - 1, fract(py) - 1] as const;
  const ix = [pi[0], pi[2], pi[0], pi[2]];
  const iy = [pi[1], pi[1], pi[3], pi[3]];
  const fx = [pf[0], pf[2], pf[0], pf[2]];
  const fy = [pf[1], pf[1], pf[3], pf[3]];
  const i = ix.map((x, k) => permute(permute(x) + iy[k]!));
  let gx = i.map((v) => fract(v * (1 / 41)) * 2 - 1);
  const gy = gx.map((v) => Math.abs(v) - 0.5);
  gx = gx.map((v) => v - Math.floor(v + 0.5));
  const g = [0, 1, 2, 3].map((k) => [gx[k]!, gy[k]!] as [number, number]);
  // norm order in the original: g00 (0), g01 (2), g10 (1), g11 (3)
  const n = [0, 1, 2, 3].map((k) => taylorInvSqrt(g[k]![0] * g[k]![0] + g[k]![1] * g[k]![1]));
  const dots = [0, 1, 2, 3].map((k) => (g[k]![0] * fx[k]! + g[k]![1] * fy[k]!) * n[k]!);
  const [n00, n10, n01, n11] = dots as [number, number, number, number];
  const fxy = [fade(pf[0]), fade(pf[1])] as const;
  const nx0 = mix(n00, n10, fxy[0]);
  const nx1 = mix(n01, n11, fxy[0]);
  return 2.3 * mix(nx0, nx1, fxy[1]);
}

function waveFbm(u: UniformBag, x: number, y: number): number {
  const freq = num(u, 'waveFrequency');
  const gain = num(u, 'waveAmplitude');
  const octaves = num(u, 'octaves');
  let value = 0;
  let amp = 1;
  for (let i = 0; i < 4; i++) {
    if (i >= octaves) break;
    value += amp * Math.abs(cnoise(x, y));
    x *= freq;
    y *= freq;
    amp *= gain;
  }
  return value;
}

function waveUv(u: UniformBag, cx: number, cy: number): [number, number] {
  const [w, h] = vec(u, 'size') as [number, number];
  const z = num(u, 'zoom');
  const ref = num(u, 'ref');
  return [(cx - w / 2) / ref / z, -((cy - h / 2) / ref) / z];
}

export function ditherWaveField(u: UniformBag, cx: number, cy: number): number {
  const [x, y] = waveUv(u, cx, cy);
  const d = num(u, 't') * num(u, 'waveSpeed');
  const inner = waveFbm(u, x - d, y - d);
  let f = waveFbm(u, x + inner, y + inner);
  const touch = vec(u, 'touch');
  if (touch[2]! > 0) {
    const [mx, my] = waveUv(u, touch[0]!, touch[1]!);
    const dist = Math.hypot(x - mx, y - my);
    f -= 0.5 * (1 - smoothstep(0, num(u, 'touchRadius'), dist)) * touch[2]!;
  }
  return f - mix(0.2, 0, smoothstep(0.45, 0.8, f));
}

// ─── 2. PixelBlast ───────────────────────────────────────────────────────────────────────

function hash11(n: number): number {
  n = fract(n * 0.1031);
  n *= n + 33.33;
  n *= n + n;
  return fract(n);
}

export function vnoise(x: number, y: number, z: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const h = (dx: number, dy: number, dz: number) => hash11((ix + dx) * 1 + (iy + dy) * 57 + (iz + dz) * 113);
  const w = (f: number) => f * f * f * (f * (f * 6 - 15) + 10);
  const wx = w(fx);
  const wy = w(fy);
  const wz = w(fz);
  const x00 = mix(h(0, 0, 0), h(1, 0, 0), wx);
  const x10 = mix(h(0, 1, 0), h(1, 1, 0), wx);
  const x01 = mix(h(0, 0, 1), h(1, 0, 1), wx);
  const x11 = mix(h(0, 1, 1), h(1, 1, 1), wx);
  return mix(mix(x00, x10, wy), mix(x01, x11, wy), wz) * 2 - 1;
}

function blastUv(u: UniformBag, px: number, py: number): [number, number] {
  const [w, h] = vec(u, 'size') as [number, number];
  const z = num(u, 'zoom');
  const ref = num(u, 'ref');
  return [(px - w / 2) / ref / z, -((py - h / 2) / ref) / z];
}

export function pixelBlastField(u: UniformBag, cx: number, cy: number): number {
  const cell = num(u, 'cell');
  const block = num(u, 'block');
  const corner = [Math.floor(Math.floor(cx / cell) / block) * block * cell, Math.floor(Math.floor(cy / cell) / block) * block * cell];
  const [x, y] = blastUv(u, corner[0]!, corner[1]!);
  const s = num(u, 'patternScale');
  const tt = num(u, 't') * 0.05;
  const octaves = num(u, 'octaves');
  let sum = 1;
  let freq = 1;
  for (let i = 0; i < 5; i++) {
    if (i >= octaves) break;
    sum += vnoise(x * s * freq, y * s * freq, tt * freq);
    freq *= 1.25;
  }
  let feed = (sum * 0.5 + 0.5) * 0.5 - 0.65 + (num(u, 'density') - 0.5) * 0.3;
  const now = num(u, 'now');
  for (const k of ['tap0', 'tap1', 'tap2', 'tap3']) {
    const tap = vec(u, k);
    if (!(tap[3]! > 0)) continue;
    const age = Math.max((now - tap[2]!) * num(u, 'rippleRate'), 0);
    const [tx, ty] = blastUv(u, tap[0]!, tap[1]!);
    const r = Math.hypot(x - tx, y - ty);
    const wave = (r - num(u, 'rippleSpeed') * age) / num(u, 'rippleThickness');
    feed = Math.max(feed, Math.exp(-wave * wave) * Math.exp(-age) * Math.exp(-10 * r) * num(u, 'rippleIntensity'));
  }
  return feed;
}

// ─── 3. Silk ─────────────────────────────────────────────────────────────────────────────

export function silkField(u: UniformBag, cx: number, cy: number): number {
  const h = (vec(u, 'size') as [number, number])[1];
  const ref = num(u, 'ref');
  const z = num(u, 'zoom');
  const a = num(u, 'rotation');
  const vx = cx / ref / z;
  const vy = (h - cy) / ref / z;
  const cs = Math.cos(a);
  const sn = Math.sin(a);
  const tx = (cs * vx + sn * vy) / z;
  let ty = (-sn * vx + cs * vy) / z;
  const o = 5 * num(u, 't');
  ty += 0.03 * Math.sin(8 * tx - o);
  const pattern = 0.6 + 0.4 * Math.sin(5 * (tx + ty + Math.cos(3 * tx + 5 * ty) + 0.02 * o) + Math.sin(20 * (tx + ty - 0.1 * o)));
  const cell = num(u, 'cell');
  return pattern * num(u, 'brightness') - (hash12(Math.floor(cx / cell), Math.floor(cy / cell)) / 15) * num(u, 'noiseIntensity');
}

// ─── 4. Grainient ────────────────────────────────────────────────────────────────────────

function hash22(x: number, y: number): [number, number] {
  let a = fract(x * 0.1031);
  let b = fract(y * 0.103);
  let c = fract(x * 0.0973);
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d;
  b += d;
  c += d;
  return [fract((a + b) * c), fract((a + c) * b)];
}

function gnoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const g = (dx: number, dy: number) => {
    const [hx, hy] = hash22(ix + dx, iy + dy);
    return (-1 + 2 * hx) * (fx - dx) + (-1 + 2 * hy) * (fy - dy);
  };
  return 0.5 + 0.5 * mix(mix(g(0, 0), g(1, 0), ux), mix(g(0, 1), g(1, 1), ux), uy);
}

/** `v * rot(a)` with `rot(a) = float2x2(cos, -sin, sin, cos)`, a row vector times the matrix. */
function rowRot(x: number, y: number, a: number): [number, number] {
  const cs = Math.cos(a);
  const sn = Math.sin(a);
  return [x * cs - y * sn, x * sn + y * cs];
}

export function grainientField(u: UniformBag, cx: number, cy: number): number {
  const [w, h] = vec(u, 'size') as [number, number];
  const tt = num(u, 't') * num(u, 'timeSpeed');
  const ratio = w / h;
  const [ox, oy] = vec(u, 'center') as [number, number];
  const zoom = Math.max(num(u, 'zoom'), 0.001);
  let x = (cx / w - 0.5 + ox) / zoom;
  let y = ((h - cy) / h - 0.5 + oy) / zoom;
  const degree = gnoise(tt * 0.1 * num(u, 'noiseScale'), x * y * num(u, 'noiseScale'));
  y *= 1 / ratio;
  [x, y] = rowRot(x, y, ((degree - 0.5) * num(u, 'rotationAmount') + 180) * (Math.PI / 180));
  y *= ratio;
  const amplitude = num(u, 'warpAmplitude') / Math.max(num(u, 'warpStrength'), 0.001);
  const warpTime = tt * num(u, 'warpSpeed');
  const f = num(u, 'warpFrequency');
  x += Math.sin(y * f + warpTime) / amplitude;
  y += Math.sin(x * (f * 1.5) + warpTime) / (amplitude * 0.5);
  const s = Math.max(num(u, 'blendSoftness'), 0);
  const b = num(u, 'colorBalance');
  const blendX = rowRot(x, y, num(u, 'blendAngle') * (Math.PI / 180))[0];
  const across = smoothstep(-0.3 - b - s, 0.2 - b + s, blendX);
  const down = 1 - smoothstep(-0.3 - b - s, 0.5 - b + s, y);
  let v = mix(0.5 * across, 0.5 + 0.5 * across, down);
  const cell = num(u, 'cell');
  v += (hash12(Math.floor(cx / cell), Math.floor(cy / cell)) - 0.5) * num(u, 'grainAmount');
  return (v - 0.5) * num(u, 'contrast') + 0.5;
}

// ─── 5. Radar ────────────────────────────────────────────────────────────────────────────

export function radarField(u: UniformBag, cx: number, cy: number): number {
  const [ox, oy] = vec(u, 'center') as [number, number];
  const reach = num(u, 'reach');
  const cell = num(u, 'cell');
  const t = num(u, 't');
  const sx = (cx - ox) / reach;
  const sy = -((cy - oy) / reach);
  const dist = Math.hypot(sx, sy);
  const theta = Math.atan2(sy, sx);
  const rings = num(u, 'ringCount');
  const ringHalf = Math.max(num(u, 'ringThickness'), (0.75 * cell * rings) / reach);
  const ringGlow = 1 - smoothstep(0, ringHalf, Math.abs(fract(dist * rings - t) - 0.5));
  const tau = 6.28318530718;
  const spokes = num(u, 'spokeCount');
  const spokeAngle = (Math.abs(fract((theta * spokes) / tau + 0.5) - 0.5) * tau) / spokes;
  const spokeHalf = Math.max(num(u, 'spokeThickness'), (0.75 * cell) / reach);
  const spokeGlow = (1 - smoothstep(0, spokeHalf, spokeAngle * dist)) * smoothstep(0, 0.1, dist);
  const sweep = Math.pow(Math.max(0.5 * Math.sin(num(u, 'sweepLobes') * theta + t * num(u, 'sweepSpeed')) + 0.5, 0), num(u, 'sweepWidth'));
  const fadeOut = (1 - smoothstep(0.85, 1.05, dist)) * Math.pow(Math.max(1 - dist, 0), num(u, 'falloff'));
  return (ringGlow + spokeGlow + sweep) * fadeOut * num(u, 'brightness');
}

// ─── 6. Topography ───────────────────────────────────────────────────────────────────────

function bez(x: number, k: readonly number[]): number {
  const w = 6.2831853 * x;
  return 0.5 * (k[0]! * Math.sin(w) + k[1]! * Math.cos(w) + k[2]! * Math.sin(2 * w) + k[3]! * Math.cos(2 * w));
}

function topoHeight(u: UniformBag, cx: number, cy: number): number {
  const [w, h] = vec(u, 'size') as [number, number];
  const zoom = Math.max(num(u, 'zoom'), 0.001);
  const sx = (cx / w - 0.5) / zoom + 0.5;
  const sy = ((h - cy) / h - 0.5) / zoom + 0.5;
  const ax = bez(sx, vec(u, 'ctrlA'));
  const ay = bez(sx, vec(u, 'ctrlB'));
  const bx = bez(sy, vec(u, 'ctrlC'));
  const by = bez(sy, vec(u, 'ctrlD'));
  let v = Math.hypot(ax - bx, ay - by);
  const touch = vec(u, 'touch');
  if (touch[2]! > 0) {
    const dx = (cx - touch[0]!) / h;
    const dy = (cy - touch[1]!) / h;
    const r = num(u, 'touchRadius');
    v += Math.exp(-(dx * dx + dy * dy) / (r * r)) * num(u, 'touchStrength') * touch[2]!;
  }
  return v;
}

export function topographyField(u: UniformBag, cx: number, cy: number): number {
  const cell = num(u, 'cell');
  const bands = num(u, 'bands');
  const hgt = topoHeight(u, cx, cy);
  const k = hgt * bands;
  const kx = topoHeight(u, cx + cell, cy) * bands;
  const ky = topoHeight(u, cx, cy + cell) * bands;
  const slope = Math.max(Math.abs(kx - k) + Math.abs(ky - k), 0.0001);
  const fr = fract(k);
  const d = Math.min(fr, 1 - fr);
  const lineD = 0.5 * num(u, 'lineWidth') * slope;
  const elev = clamp(hgt / (num(u, 'morph') * 2.5 + 0.001), 0, 1);
  const mode = num(u, 'mode');
  let lineV = 1;
  if (mode < 0.5) lineV = 0.5 + 0.5 * elev;
  else if (mode > 1.5) lineV = Math.floor(k) - 2 * Math.floor(Math.floor(k) / 2) > 0.5 ? 1 : 0.5;
  const glow = num(u, 'glow');
  let v = 0;
  if (d < lineD) v = lineV;
  else if (glow > 0) v = Math.pow((1 - smoothstep(lineD, lineD + glow * 0.5, d)) * 0.55, num(u, 'contrast')) * lineV;
  return Math.max(v, num(u, 'fill') * elev);
}

// ─── 7. DotGrid ──────────────────────────────────────────────────────────────────────────

function shove(u: UniformBag, s: readonly number[], dx: number, dy: number): [number, number, number] {
  if (!(s[3]! > 0)) return [0, 0, 0];
  const age = num(u, 'now') - s[2]!;
  if (age < 0 || age >= num(u, 'rise') + num(u, 'settle')) return [0, 0, 0];
  const vx = dx - s[0]!;
  const vy = dy - s[1]!;
  const r = Math.hypot(vx, vy);
  const reach = num(u, 'reach');
  if (r >= reach || r < 0.001) return [0, 0, 0];
  const x = r / reach;
  const m = 4 * x * (1 - x);
  const e = dotEnvelope(age, num(u, 'rise'), num(u, 'settle'));
  const k = m * m * num(u, 'push') * s[3]! * e;
  return [(vx / r) * k, (vy / r) * k, s[3]! * (1 - x) * Math.min(Math.abs(e) * 1.5, 1)];
}

/** The DotGrid program for one cell: 0 paper, 1 partner, 2 ink, 3 a dot at rest. */
export function dotGridTone(u: UniformBag, ix: number, iy: number): ToneIndex {
  const cell = num(u, 'cell');
  const k = frameAt(u, (ix + 0.5) * cell, (iy + 0.5) * cell);
  if (k <= 0) return 0;
  const [ox, oy] = vec(u, 'origin') as [number, number];
  const [cols, rows] = vec(u, 'grid') as [number, number];
  const pitch = num(u, 'pitch');
  const dot = num(u, 'dotCells');
  const nx = Math.floor((ix - ox) / pitch + 0.5);
  const ny = Math.floor((iy - oy) / pitch + 0.5);
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 3; i++) {
      const gx = nx + i - 1;
      const gy = ny + j - 1;
      if (gx < 0 || gy < 0 || gx >= cols || gy >= rows) continue;
      const b = bayer8(gx, gy);
      if (k <= b) continue;
      const hx = ox + gx * pitch;
      const hy = oy + gy * pitch;
      const cx = (hx + dot * 0.5) * cell;
      const cy = (hy + dot * 0.5) * cell;
      const shocks = ['shock0', 'shock1', 'shock2', 'shock3'].map((s) => shove(u, vec(u, s), cx, cy));
      const offX = shocks.reduce((a, s) => a + s[0], 0);
      const offY = shocks.reduce((a, s) => a + s[1], 0);
      const ax = hx + Math.floor(offX + 0.5);
      const ay = hy + Math.floor(offY + 0.5);
      if (ix >= ax && iy >= ay && ix < ax + dot && iy < ay + dot) {
        let e = Math.max(...shocks.map((s) => s[2]));
        const touch = vec(u, 'touch');
        if (touch[2]! > 0) e = Math.max(e, touch[2]! * Math.max(0, 1 - Math.hypot(cx - touch[0]!, cy - touch[1]!) / num(u, 'proximity')));
        const t = toneIndex(clamp(e, 0, 1), b, num(u, 'levels'));
        return t === 0 ? 3 : t;
      }
    }
  }
  return 0;
}

// ─── any program, one cell ───────────────────────────────────────────────────────────────

const FIELDS: Readonly<Record<Exclude<BackgroundName, 'DotGrid'>, (u: UniformBag, cx: number, cy: number) => number>> = {
  FieldDither: ditherWaveField,
  PixelBlast: pixelBlastField,
  Silk: silkField,
  Grainient: grainientField,
  Radar: radarField,
  Topography: topographyField,
};

/** What `name`'s program draws in cell (`ix`, `iy`), as a tone index. The shader's `main`. */
export function cellTone(name: BackgroundName, u: UniformBag, ix: number, iy: number): ToneIndex {
  if (name === 'DotGrid') return dotGridTone(u, ix, iy);
  const cell = num(u, 'cell');
  const cx = (ix + 0.5) * cell;
  const cy = (iy + 0.5) * cell;
  const k = frameAt(u, cx, cy);
  if (k <= 0) return 0;
  return toneIndex(clamp(FIELDS[name](u, cx, cy), 0, 1) * k, bayer8(ix, iy), num(u, 'levels'));
}

/** The raw field value at a cell centre, before the frame and the tone: for tuning and tests. */
export function fieldValue(name: Exclude<BackgroundName, 'DotGrid'>, u: UniformBag, cx: number, cy: number): number {
  return FIELDS[name](u, cx, cy);
}

'use strict';
/**
 * The score: synthesised from the cut's own cues, so a sound lands on the frame it belongs to and
 * a re-cut re-scores itself. Quiet on purpose; it sits under the picture and never announces it.
 *
 *   pad       three voices of a chord in a key the hue picks, slowly opening, swelling into each
 *             scene; the whole piece sits on one chord and its neighbour, like the app's idle loops
 *   bell      a struck partial at every scene, a fifth apart from the last
 *   pour      band-passed noise sweeping up under each ink wipe, as long as the wipe
 *   morph     a low sine falling a fourth as a container grows
 *   tap       a short high click where a finger lands in the demo
 *   end       the chord, struck, left to ring
 *
 * `drive` adds a soft pulse at 96 bpm under the pad. `none` writes nothing: render.js lays silence.
 * Loudness is normalised by ffmpeg's two pass loudnorm at mux (-14 LUFS, -1 dBTP), the social
 * platforms' target, so the mix here only has to be balanced, not loud.
 */
const fs = require('fs');
const { HUES } = require('./house');

const SR = 48000;
/** A root per hue, semitones above A2, so two projects' trailers are in different keys. */
const ROOTS = { amber: 5, brass: 7, tide: 5, cobalt: 3, iris: 1, heather: 8, orchid: 10, coral: 0, ember: 2 };

function hz(semi) {
  return 110 * Math.pow(2, semi / 12);
}

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1e9) / 1e9 * 2 - 1;
  };
}

function render(tl, cut) {
  const seconds = tl.seconds + 1.2;
  const n = Math.ceil(seconds * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  const root = ROOTS[cut.hue] ?? 5;
  const drive = cut.mood === 'drive';
  // The chord: root, fifth, ninth, and the third an octave up; the neighbour chord a fourth up.
  const chordA = [0, 7, 14, 16].map((x) => hz(root + x));
  const chordB = [5, 12, 17, 21].map((x) => hz(root + x));
  const sceneStarts = tl.scenes.map((s) => s.t0);
  const swap = (t) => (sceneStarts.filter((s) => s <= t).length % 2 === 0 ? 1 : 0);
  // Pad: sines with a little second partial, each voice detuned and drifting, through a gentle
  // amplitude envelope that swells into every scene.
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const mix = 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, (t - lastBefore(sceneStarts, t)) / 0.9)));
    const b = swap(t);
    let v = 0;
    for (let k = 0; k < 4; k++) {
      const f = (b ? chordA[k] : chordB[k]) * (1 + 0.0016 * Math.sin(t * (0.3 + k * 0.07)));
      const f2 = (b ? chordB[k] : chordA[k]) * (1 + 0.0016 * Math.sin(t * (0.3 + k * 0.07)));
      const ph = 2 * Math.PI * t;
      const a = Math.sin(ph * f) + 0.18 * Math.sin(ph * f * 2);
      const c = Math.sin(ph * f2) + 0.18 * Math.sin(ph * f2 * 2);
      v += (a * mix + c * (1 - mix)) * (k === 3 ? 0.5 : 1);
    }
    const fadeIn = Math.min(1, t / 1.2), fadeOut = Math.min(1, Math.max(0, (seconds - t) / 1.4));
    const swell = 0.75 + 0.25 * Math.sin(t * 0.9);
    lp += (v - lp) * 0.08;
    const s = lp * 0.05 * fadeIn * fadeOut * swell;
    L[i] += s;
    R[i] += s * 0.96;
  }
  const noise = rng(97);
  for (const c of tl.cues) {
    const at = Math.round(c.t * SR);
    if (c.kind.startsWith('scene:')) {
      const idx = sceneStarts.findIndex((s) => Math.abs(s - c.t) < 1e-6);
      bell(L, R, at, hz(root + 24 + [0, 7, 12, 14, 19, 16, 12][idx % 7]), 0.08, 2.4, idx % 2 ? 0.35 : -0.35);
    } else if (c.kind === 'into:fluid') {
      pour(L, R, Math.round((c.t - c.len / 2) * SR), Math.round(c.len * SR * 1.3), noise, 0.07);
    } else if (c.kind === 'into:morph') {
      whum(L, R, Math.round((c.t - c.len / 2) * SR), hz(root - 12), 0.22, 0.9);
    } else if (c.kind === 'tap') {
      click(L, R, at, noise, 0.05);
    } else if (c.kind === 'end') {
      for (const [k, f] of chordA.entries()) bell(L, R, Math.round((c.t - 2.2) * SR) + k * 900, f * 2, 0.05, 3.2, (k - 1.5) * 0.3);
    }
  }
  if (drive) {
    const beat = 60 / 96;
    for (let t = 0.5; t < tl.seconds - 0.4; t += beat) kick(L, R, Math.round(t * SR), 0.22);
  }
  return { L, R };
}

function lastBefore(starts, t) {
  let s = 0;
  for (const x of starts) if (x <= t) s = x;
  return s;
}

function bell(L, R, at, f, amp, decay, pan) {
  const len = Math.round(decay * SR);
  for (let i = 0; i < len && at + i < L.length; i++) {
    if (at + i < 0) continue;
    const t = i / SR;
    const env = Math.exp(-t * (3 / decay)) * Math.min(1, t * 400);
    const v = (Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(2 * Math.PI * f * 2.76 * t) * Math.exp(-t * 6) + 0.12 * Math.sin(2 * Math.PI * f * 5.4 * t) * Math.exp(-t * 14)) * env * amp;
    L[at + i] += v * (1 - Math.max(0, pan));
    R[at + i] += v * (1 + Math.min(0, pan));
  }
}

function pour(L, R, at, len, noise, amp) {
  // Noise through a band pass whose centre rises over the pour: liquid moving past the ear.
  let b0 = 0, b1 = 0;
  for (let i = 0; i < len && at + i < L.length; i++) {
    if (at + i < 0) continue;
    const u = i / len;
    const fc = 300 + 2600 * u * u;
    const q = 0.9;
    const w = (2 * Math.PI * fc) / SR;
    const alpha = Math.sin(w) / (2 * q);
    const x = noise();
    // A cheap state variable band pass.
    b1 += w * (x - b1 - q * b0);
    b0 += w * b1;
    const env = Math.sin(Math.PI * u) ** 1.5;
    const v = b0 * env * amp * (1 + alpha * 0);
    L[at + i] += v;
    R[at + i] += v * 0.9;
  }
}

function whum(L, R, at, f, amp, dur) {
  const len = Math.round(dur * SR);
  let ph = 0;
  for (let i = 0; i < len && at + i < L.length; i++) {
    if (at + i < 0) continue;
    const u = i / len;
    ph += (2 * Math.PI * f * (1 - 0.25 * u)) / SR;
    const env = Math.sin(Math.PI * Math.min(1, u * 1.6)) * (1 - u);
    const v = Math.sin(ph) * env * amp;
    L[at + i] += v;
    R[at + i] += v;
  }
}

function click(L, R, at, noise, amp) {
  let prev = 0;
  for (let i = 0; i < 360 && at + i < L.length; i++) {
    if (at + i < 0) continue;
    const x = noise();
    const hp = x - prev;
    prev = x;
    const v = hp * Math.exp(-i / 60) * amp;
    L[at + i] += v;
    R[at + i] += v;
  }
}

function kick(L, R, at, amp) {
  let ph = 0;
  for (let i = 0; i < 9000 && at + i < L.length; i++) {
    const t = i / SR;
    ph += (2 * Math.PI * (48 + 90 * Math.exp(-t * 30))) / SR;
    const v = Math.sin(ph) * Math.exp(-t * 9) * amp;
    L[at + i] += v;
    R[at + i] += v;
  }
}

function writeWav(file, L, R) {
  const n = L.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 4, 40);
  let peak = 1e-9;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const g = Math.min(1, 0.89 / peak);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * g)) * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * g)) * 32767), 46 + i * 4);
  }
  fs.writeFileSync(file, buf);
}

function writeScore(tl, cut, file) {
  const { L, R } = render(tl, cut);
  writeWav(file, L, R);
  return file;
}

module.exports = { writeScore, render, SR, ROOTS, _hues: HUES };

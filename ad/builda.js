'use strict';
// Builda: 9:16 demo. One build session, followed from the first prompt to the recap card, drawn
// with the app's own design system (design/tokens.json, mobile/src): dark ground, full-bleed
// hue bands that print in 3 pt dither cells, 16x16 pixel creatures, the session strip.
// All copy and numbers are the app's own sample data (see SPEC.md, "computed" strings).
const { E, clamp, lerp, seg, hash, spring } = require('./lib/ease');
const { GlobalFonts, Path2D, loadImage } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');
GlobalFonts.registerFromPath(path.join(__dirname, 'fonts', 'inter.ttf'), 'InterT');
GlobalFonts.registerFromPath(path.join(__dirname, 'fonts', 'mono.ttf'), 'JBM');

const W = 1080, H = 1920, S = W / 393, P = v => v * S;
const D = 860;   // the trailer chapter (direct, shapes, release, star), cut in after the card
const FRAMES = 3600 + D;
// Builda's colours, all from design/tokens.json (the one place they live), dark scheme.
const TOK = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'design', 'tokens.json')));
const dark = (x) => x.dark;
const T = {
  bg: dark(TOK.surface.bg), card: dark(TOK.surface.card), raised: dark(TOK.surface.raised), border: dark(TOK.surface.border),
  text: dark(TOK.surface.text), dim: dark(TOK.surface.textDim), faint: dark(TOK.surface.textFaint),
  // Ink on any hue fill: the light scheme's text colour, which is what the phone prints on a band.
  ink: TOK.surface.text.light,
  amber: dark(TOK.surface.accent), idle: dark(TOK.strip.idle), prompt: dark(TOK.strip.prompting), agent: dark(TOK.strip.agent),
  edit: dark(TOK.strip.human_edit), add: dark(TOK.data.add), del: dark(TOK.data.del),
};
const HUE = Object.fromEntries(Object.entries(TOK.spectrum.hues).filter(([k, v]) => !k.startsWith('_') && v && v.dark).map(([k, v]) => [k, [v.dark, v.partner]]));
const CREATURE_HUE = Object.fromEntries(Object.entries(TOK.spectrum.creature).filter(([k]) => !k.startsWith('_')));
// Things that are not Builda, drawn as they look: the macOS window and its lights, the iOS lock
// screen's glass, a phone's bezel and the paper a QR code sits on. Not app colours, so not tokens.
const WORLD = {
  window: '#0E0D0C', red: '#FF5F57', yellow: '#FEBC2E', green: '#28C840', white: '#FFFFFF',
  night: ['#0B0A09', '#1A1612', '#2A1F12', '#141210', '#0E0D0C'], lock: ['#1F1714', '#0B0A09'],
  glass: '#2B2825', bezel: '#0A0908', rim: '#3A3632', desk: ['#2A2622', '#16130F'], track: '#2F2B27',
};
const FR = JSON.parse(fs.readFileSync(path.join(__dirname, 'assets/data/creature_frames.json')));
const STRIP = JSON.parse(fs.readFileSync(path.join(__dirname, 'assets/data/sample_strip.json')));
const IMG = {};
async function init() {
  IMG.icon = await loadImage(fs.readFileSync(path.join(__dirname, 'assets/app/icon.png')));
  IMG.claude = await loadImage(fs.readFileSync(path.join(__dirname, 'assets/harness/claude-color.svg')));
}
const BAYER = (() => { const m = [[0, 32, 8, 40, 2, 34, 10, 42], [48, 16, 56, 24, 50, 18, 58, 26], [12, 44, 4, 36, 14, 46, 6, 38], [60, 28, 52, 20, 62, 30, 54, 22], [3, 35, 11, 43, 1, 33, 9, 41], [51, 19, 59, 27, 49, 17, 57, 25], [15, 47, 7, 39, 13, 45, 5, 37], [63, 31, 55, 23, 61, 29, 53, 21]]; return (i, j) => (m[j & 7][i & 7] + 0.5) / 64; })();

// ------------------------------------------------------------------ type
function txt(ctx, s, x, y, { size = 17, w = 400, col = T.text, align = 'left', track = 0, mono = false, a = 1, base = 'alphabetic' } = {}) {
  ctx.font = `${mono ? Math.min(800, w) : Math.round(w / 100) * 100} ${size}px ${mono ? 'JBM' : 'InterT'}`;
  ctx.letterSpacing = `${track}px`; ctx.textAlign = align; ctx.textBaseline = base;
  ctx.globalAlpha = a; ctx.fillStyle = col; ctx.fillText(s, x, y); ctx.globalAlpha = 1;
  const m = ctx.measureText(s).width; ctx.letterSpacing = '0px'; return m;
}
// words rise 10 pt while fading, 90 ms stagger (motion.ts)
function words(ctx, s, x, y, f, f0, o = {}) {
  const parts = s.split(' '); let cx = x;
  ctx.font = `${Math.round((o.w || 800) / 100) * 100} ${o.size}px InterT`; ctx.letterSpacing = `${o.track || 0}px`;
  const widths = parts.map(p => ctx.measureText(p + ' ').width);
  if (o.align === 'center') cx = x - widths.reduce((a, b) => a + b, 0) / 2;
  parts.forEach((p, i) => {
    const u = E.outCubic(seg(f, f0 + i * 5.4, f0 + i * 5.4 + 25));
    if (u > 0) txt(ctx, p, cx, y + (1 - u) * P(10), { ...o, align: 'left', a: u * (o.a ?? 1) });
    cx += widths[i];
  });
}
// ------------------------------------------------------------------ bands and dither
// A full-bleed hue block that prints its 3 pt cells in random, top-biased order, then a 36 pt
// ordered-dither dissolve into the ground (Band.tsx).
function band(ctx, x, y, w, h, hue, u = 1, fringe = 36, seed = 1) {
  const [ink, partner] = HUE[hue] || [hue, hue];
  const c = P(3), cols = Math.ceil(w / c), rows = Math.ceil(h / c), fr = Math.ceil(P(fringe) / c);
  if (u >= 1) { ctx.fillStyle = ink; ctx.fillRect(x, y, w, h); }
  else {
    ctx.fillStyle = ink;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const th = hash(i * 12.9898 + j * 78.233 + seed) * 0.72 + (j / rows) * 0.28;
      if (th < u * 1.02) ctx.fillRect(x + i * c, y + j * c, c + 0.5, c + 0.5);
    }
  }
  for (let j = 0; j < fr; j++) {
    const dens = 1 - (j + 0.5) / fr;
    for (let i = 0; i < cols; i++) {
      const b = BAYER(i, j + rows);
      if (b > dens) continue;
      const th = hash(i * 3.1 + (j + rows) * 7.7 + seed) * 0.72 + 0.28;
      if (th > u * 1.02) continue;
      ctx.fillStyle = b > dens * 0.55 ? partner : ink;
      ctx.fillRect(x + i * c, y + h + j * c, c + 0.5, c + 0.5);
    }
  }
}
// 16x16 one-ink creature; cells print in scanline-ish random order
function creature(ctx, frame, x, y, size, col, u = 1, seed = 3) {
  const c = size / 16;
  ctx.fillStyle = col;
  for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) {
    const ch = frame[j][i]; if (ch === '.') continue;
    if (u < 1 && hash(i * 5.3 + j * 9.1 + seed) * 0.8 + (j / 16) * 0.2 > u) continue;
    ctx.fillRect(Math.round(x + i * c), Math.round(y + j * c), Math.ceil(c), Math.ceil(c));
  }
}
const bitFrame = (state, f) => { const fr = FR.bit[state]; return fr[Math.floor(f / 18) % fr.length]; };
const animal = (name, f) => { const fr = FR.animals[name]; return fr[Math.floor(f / 22) % fr.length]; };

// ------------------------------------------------------------------ the strip
const COLS = STRIP.columns;   // [class, density] x 1024
const CLASS_COL = [T.idle, T.prompt, T.agent, T.edit];
const DENS = [0.34, 0.58, 0.80, 1.0];
function strip(ctx, x, y, w, trace = 1, hero = true) {
  const moves = P(hero ? 12 : 5), gap = P(hero ? 5 : 3), act = P(hero ? 46 : 21), bar = P(hero ? 3 : 2);
  const n = Math.round(w / bar), fy = y + moves + gap + act;
  ctx.fillStyle = T.idle; ctx.fillRect(x, fy, w * E.outCubic(trace), P(1));
  for (let k = 0; k < n; k++) {
    const t0 = k / n; if (t0 > trace) break;
    const [cl, d] = COLS[Math.min(1023, Math.floor((k + 0.5) / n * 1024))];
    if (cl === 0) continue;
    const grow = E.back(clamp((trace - t0) * 7));
    const h = (cl === 1 ? act : Math.max(P(2), act * DENS[d])) * grow;
    ctx.fillStyle = CLASS_COL[cl]; ctx.fillRect(x + k * bar, fy - h, bar + 0.6, h);
  }
  for (const [ms, kind] of STRIP.marks_raw) {
    const t0 = ms / STRIP.span_ms; if (t0 > trace - 0.02) continue;
    ctx.fillStyle = kind === 2 ? T.faint : kind === 1 ? T.edit : T.text;
    ctx.fillRect(Math.min(x + w - P(3), x + t0 * w), y, P(hero ? 3 : 1.5), moves);
  }
}

// ------------------------------------------------------------------ captions (plain lines)
function caption(ctx, f, f0, f1, lines, { y = 1650, col = T.text, acc = T.amber, scrim = true } = {}) {
  const inU = seg(f, f0, f0 + 16), outU = seg(f, f1 - 12, f1);
  if (inU <= 0 || outU >= 1) return;
  const fade = 1 - E.inCubic(outU);
  if (scrim) {
    const g = ctx.createLinearGradient(0, y - 240, 0, 1920);
    g.addColorStop(0, 'rgba(20,18,16,0)'); g.addColorStop(0.35, `rgba(20,18,16,${0.8 * fade * E.outCubic(inU)})`); g.addColorStop(1, `rgba(20,18,16,${0.94 * fade})`);
    ctx.fillStyle = g; ctx.fillRect(0, y - 240, W, 1920 - y + 240);
  }
  let wi = 0;
  lines.forEach((ln, li) => {
    const ly = y + li * 88 - (lines.length - 1) * 88;
    let x = 72;
    for (const raw of ln.split(' ')) {
      const em = /^\{.*\}[.,!?]?$/.test(raw), word = raw.replace(/[{}]/g, '');
      ctx.font = `800 76px InterT`; ctx.letterSpacing = '-2px';
      const w = ctx.measureText(word + ' ').width;
      const u = E.outCubic(seg(f, f0 + wi * 3.2, f0 + 16 + wi * 3.2));
      if (u > 0) {
        ctx.save(); ctx.globalAlpha = u * fade;
        if (u < 1) ctx.filter = `blur(${((1 - u) * 9).toFixed(1)}px)`;
        txt(ctx, word, x, ly + (1 - u) * 24, { size: 76, w: 800, col: em ? acc : col, track: -2 });
        ctx.restore();
      }
      x += w; wi++;
    }
  });
}

// ------------------------------------------------------------------ iOS notification banner
function banner(ctx, u, title, body, y0 = 120) {
  if (u <= 0) return;
  const x = 24, w = W - 48, h = 212, r = 64, y = lerp(-h - 40, y0, u);
  ctx.save();
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 50; ctx.shadowOffsetY = 14; ctx.fillStyle = 'rgba(0,0,0,0.01)'; ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill(); ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.clip();
  try { ctx.filter = 'blur(30px) saturate(1.5)'; ctx.drawImage(ctx.canvas, 0, 0); } catch (e) {}
  ctx.filter = 'none'; ctx.fillStyle = 'rgba(58,56,62,0.72)'; ctx.fillRect(x, y, w, h); ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.roundRect(x + 38, y + 54, 104, 104, 23); ctx.clip(); ctx.drawImage(IMG.icon, x + 38, y + 54, 104, 104); ctx.restore();
  txt(ctx, title, x + 178, y + 92, { size: 40, w: 600, col: WORLD.white });
  txt(ctx, 'now', x + w - 40, y + 90, { size: 32, w: 400, col: 'rgba(255,255,255,0.55)', align: 'right' });
  txt(ctx, body, x + 178, y + 146, { size: 40, w: 400, col: 'rgba(255,255,255,0.9)' });
  ctx.restore();
}

// ------------------------------------------------------------------ scenes
// 1. hello: the accent band prints, Bit prints, the headline arrives word by word
function sceneHello(ctx, f) {
  const u = clamp(f / 36);
  band(ctx, 0, 0, W, 1180, 'amber', u, 36, 11);
  // PixelBlast-ish: partner-tone dither that drifts inside the band
  ctx.fillStyle = HUE.amber[1];
  const c = P(3);
  for (let j = 0; j < 1180 / c; j += 1) for (let i = 0; i < W / c; i += 1) {
    const v = 0.5 + 0.5 * Math.sin(i * 0.19 + f * 0.05) * Math.cos(j * 0.13 - f * 0.04);
    if (BAYER(i, j) < v * 0.22 * u && hash(i * 7 + j * 13) < u) ctx.fillRect(i * c, j * c, c + 0.5, c + 0.5);
  }
  creature(ctx, bitFrame(f < 90 ? 'waving' : 'idle', f), W / 2 - P(64), 250, P(128), T.ink, clamp((f - 14) / 30), 5);
  words(ctx, 'Your build sessions,', 72, 860, f, 44, { size: 104, w: 800, col: T.ink, track: -3 });
  words(ctx, 'read back to you.', 72, 972, f, 62, { size: 104, w: 800, col: T.ink, track: -3 });
  const rl = ['Claude Code', 'Codex', 'Cursor', 'Gemini CLI'][Math.floor(clamp((f - 80) / 90) * 3.99)];
  if (f > 80) txt(ctx, 'from ' + rl, 72, 1082, { size: 44, w: 600, col: T.ink, a: 0.75 * E.outCubic(seg(f, 80, 96)) });
  txt(ctx, 'Builda reads what your coding agents write', 72, 1330, { size: 40, w: 400, col: T.dim, a: E.outCubic(seg(f, 96, 118)) });
  txt(ctx, 'and tells you how every session went.', 72, 1384, { size: 40, w: 400, col: T.dim, a: E.outCubic(seg(f, 100, 122)) });
}
// 2. the Mac: builder sessions, straight from the README
function sceneTerminal(ctx, f) {
  ctx.fillStyle = T.bg; ctx.fillRect(0, 0, W, H);
  const u = E.swift(seg(f, 0, 18));
  const x = 30, y = lerp(560, 470, u), w = W - 60, h = 820;
  ctx.save(); ctx.globalAlpha = u;
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 60; ctx.shadowOffsetY = 20;
  ctx.fillStyle = WORLD.window; ctx.beginPath(); ctx.roundRect(x, y, w, h, 26); ctx.fill(); ctx.restore();
  ctx.strokeStyle = T.border; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(x, y, w, h, 26); ctx.stroke();
  [WORLD.red, WORLD.yellow, WORLD.green].forEach((c, i) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x + 44 + i * 36, y + 40, 11, 0, Math.PI * 2); ctx.fill(); });
  txt(ctx, 'builder', x + w / 2, y + 50, { size: 26, w: 600, col: T.faint, align: 'center', mono: true });
  const cmd = '$ builder sessions --limit 1', n = Math.floor(cmd.length * seg(f, 16, 52));
  const tx = x + 40, lh = 52; let ty = y + 140;
  txt(ctx, cmd.slice(0, n), tx, ty, { size: 34, w: 500, col: T.text, mono: true });
  if (n < cmd.length && Math.floor(f / 8) % 2 === 0) { ctx.font = '500 34px JBM'; ctx.fillStyle = T.amber; ctx.fillRect(tx + ctx.measureText(cmd.slice(0, n)).width + 4, ty - 30, 18, 38); }
  const o = seg(f, 60, 70);
  if (o > 0) {
    ctx.globalAlpha = u * o; ty += lh * 2;
    txt(ctx, 'Fri 7 Aug 09:03', tx, ty, { size: 30, w: 500, col: T.dim, mono: true });
    txt(ctx, 'gt-transit', tx + 330, ty, { size: 30, w: 700, col: T.text, mono: true });
    txt(ctx, '+2,101 lines', x + w - 40, ty, { size: 30, w: 700, col: T.add, mono: true, align: 'right' });
    ty += lh;
    const cnt = Math.floor(lerp(0, 317, E.outCubic(seg(f, 70, 110))));
    txt(ctx, `${Math.floor(cnt / 60)}h ${String(cnt % 60).padStart(2, '0')}m active of 6h 48m`, tx, ty, { size: 28, w: 500, col: T.text, mono: true });
    ty += lh;
    txt(ctx, '52 prompts   215 tools   194.4M tokens', tx, ty, { size: 28, w: 500, col: T.dim, mono: true });
    ty += lh + 10;
    // the ANSI strip, drawn char by char
    const sline = '▐███▁▅▁·······▐██▅▁▁▁·····▐█▅▁▁·····▐███▁▅▅▁▁···▐█▁▅';
    const k = Math.floor(sline.length * E.outCubic(seg(f, 80, 124)));
    ctx.font = '500 30px JBM'; let cx = tx;
    for (let i = 0; i < k; i++) {
      const ch = sline[i]; ctx.fillStyle = ch === '▐' ? T.text : ch === '·' ? T.faint : ch === '▁' ? T.edit : T.amber;
      ctx.fillText(ch, cx, ty); cx += ctx.measureText(ch).width;
    }
  }
  ctx.restore();
}
// 3. the session as a landscape: fly along the strip. Amber towers = the agent working,
// bone pillars = you prompting, teal = your edits, idle = empty ground.
const WORLD_BARS = (() => {
  const out = [];
  for (let i = 0; i < 1024; i += 4) {
    const [cl, d] = COLS[i]; if (cl === 0) continue;
    out.push({ x: i * 0.62, h: cl === 1 ? 17 : 13 * DENS[d], col: CLASS_COL[cl], cl, w: 2.2 });
  }
  return out;
})();
const COMMITS = [0.13, 0.22, 0.38, 0.47, 0.63, 0.74, 0.97].map(t => t * 1024 * 0.62);
function project(cam, x, y, z) {
  const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z;
  const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
  const fwd = dx * cy + dy * sy, side = dx * sy - dy * cy;
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const depth = fwd * cp + dz * sp, up = -fwd * sp + dz * cp;
  if (depth < 0.5) return null;
  return [W / 2 + side / depth * cam.F, cam.oy - up / depth * cam.F, depth];
}
function sceneFly(ctx, f, n, hud = true) {
  // sky: warm near-black with a faint amber horizon
  const g = ctx.createLinearGradient(0, 0, 0, H);
  [0, 0.42, 0.5, 0.58, 1].forEach((at, i) => g.addColorStop(at, WORLD.night[i]));
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const L = 1024 * 0.62, u = E.inOutSine(clamp(f / n));
  // pace: slow past each mark (prompts, commits) so the camera can swing round it, fast between
  const marksX = [...STRIP.marks_raw.map(([ms]) => ms / STRIP.span_ms * L), ...COMMITS];
  const PACE = (() => { if (sceneFly.P) return sceneFly.P; const N = 800, c = new Float64Array(N + 1); for (let i = 1; i <= N; i++) { const x = lerp(-40, L + 20, i / N); let k = 1; for (const m of marksX) k += 2.2 * Math.exp(-(((x + 40) - m) ** 2) / 300); c[i] = c[i - 1] + k; } for (let i = 0; i <= N; i++) c[i] /= c[N]; return (sceneFly.P = c); })();
  let lo = 0, hi = 800; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (PACE[m] < u) lo = m; else hi = m; }
  const camX = lerp(-40, L + 20, lo / 800);
  let near = 0; for (const m of marksX) near = Math.max(near, Math.exp(-((camX + 40 - m) ** 2) / 500));
  const cam = { x: camX, y: -46 + 8 * Math.sin(f * 0.02) + 18 * near, z: 16 + 4 * Math.sin(f * 0.013) - 5 * near, yaw: 0.5 + 0.08 * Math.sin(f * 0.011) + 0.45 * near, pitch: -0.2 + 0.06 * near, F: 900, oy: 980 };
  // floor dither grid lines
  ctx.strokeStyle = 'rgba(255,179,0,0.08)'; ctx.lineWidth = 2;
  for (let gx = Math.floor((camX - 20) / 12) * 12; gx < camX + 400; gx += 12) {
    const a = project(cam, gx, -60, 0), b = project(cam, gx, 60, 0);
    if (a && b) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
  }
  for (let gy = -60; gy <= 60; gy += 12) {
    ctx.beginPath(); let st = false;
    for (let gx = camX - 10; gx < camX + 400; gx += 10) { const p = project(cam, gx, gy, 0); if (!p) continue; if (st) ctx.lineTo(p[0], p[1]); else { ctx.moveTo(p[0], p[1]); st = true; } }
    ctx.stroke();
  }
  // floor line of the strip
  const fl = [];
  for (let gx = Math.max(0, camX - 10); gx < Math.min(L, camX + 500); gx += 6) { const p = project(cam, gx, 0, 0); if (p) fl.push(p); }
  ctx.strokeStyle = T.idle; ctx.lineWidth = 4; ctx.beginPath(); fl.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke();
  // bars as boxes, far to near
  const vis = WORLD_BARS.filter(b => b.x > camX - 5 && b.x < camX + 480).sort((a, b) => b.x - a.x);
  for (const b of vis) {
    const d = b.x - camX, fog = clamp((d - 120) / 360);
    const grow = E.back(clamp((camX + 330 - b.x) / 60));
    if (grow <= 0) continue;
    const h = b.h * grow, x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, y0 = -1.6, y1 = 1.6;
    const face = (pts, col, k) => { const q = pts.map(p => project(cam, ...p)); if (q.some(v => !v)) return; ctx.fillStyle = col; ctx.globalAlpha = (1 - fog * 0.85) * k; ctx.beginPath(); q.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1; };
    face([[x0, y0, 0], [x1, y0, 0], [x1, y0, h], [x0, y0, h]], b.col, 1);
    face([[x0, y0, 0], [x0, y1, 0], [x0, y1, h], [x0, y0, h]], shadeHex(b.col, 0.7), 1);
    face([[x0, y0, h], [x1, y0, h], [x1, y1, h], [x0, y1, h]], shadeHex(b.col, 1.15), 1);
  }
  // marks: prompts as tall bone flags, commits as teal diamonds that burst
  for (const [ms, kind] of STRIP.marks_raw) {
    const mx = ms / STRIP.span_ms * L; if (mx < camX - 5 || mx > camX + 400) continue;
    const a = project(cam, mx, 3, 0), b = project(cam, mx, 3, 26); if (!a || !b) continue;
    ctx.strokeStyle = kind === 2 ? T.faint : T.text; ctx.lineWidth = Math.max(2, 900 / a[2] * 0.4);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    const s = 900 / b[2];
    if (s > 3) { const label = kind === 2 ? 'context compacted' : 'you prompted'; ctx.font = `700 ${Math.round(clamp(s * 1.6, 18, 40))}px InterT`; const tw = ctx.measureText(label).width + s * 1.8;
      ctx.fillStyle = kind === 2 ? T.raised : T.prompt; ctx.beginPath(); ctx.roundRect(b[0] - 2, b[1] - s * 3, tw, s * 3, s * 0.6); ctx.fill();
      ctx.fillStyle = kind === 2 ? T.dim : T.ink; ctx.textBaseline = 'middle'; ctx.fillText(label, b[0] + s * 0.9, b[1] - s * 1.5); ctx.textBaseline = 'alphabetic'; }
  }
  COMMITS.forEach((cx, i) => {
    if (cx < camX - 5 || cx > camX + 400) return;
    const p = project(cam, cx, -5, 14 + Math.sin(f * 0.1 + i)); if (!p) return;
    const s = 900 / p[2] * 2.2, pop = E.back(clamp((camX + 160 - cx) / 30));
    ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(Math.PI / 4); ctx.scale(pop, pop); ctx.fillStyle = T.edit; ctx.fillRect(-s / 2, -s / 2, s, s); ctx.restore();
    if (pop > 0.9 && s > 8) txt(ctx, 'commit', p[0] + s, p[1] + s * 0.3, { size: Math.round(clamp(s * 0.9, 18, 36)), w: 700, col: T.edit });
  });
  if (!hud) return;
  // HUD: clock and the numbers building
  const ms = u * STRIP.span_ms, t0 = 9 * 60 + 12, mm = t0 + Math.floor(ms / 60000);
  const hh = Math.floor(mm / 60), m2 = mm % 60, ap = hh >= 12 ? 'pm' : 'am', h12 = ((hh + 11) % 12) + 1;
  txt(ctx, `${h12}:${String(m2).padStart(2, '0')}${ap}`, 60, 150, { size: 44, w: 600, col: T.dim, mono: true });
  const act = Math.floor(317 * u);
  txt(ctx, `${Math.floor(act / 60)}h ${String(act % 60).padStart(2, '0')}m`, 60, 290, { size: 140, w: 800, col: T.text, track: -5 });
  txt(ctx, 'active', 64, 350, { size: 40, w: 600, col: T.dim });
  const leg = [['agent working', T.agent, 67], ['you prompting', T.prompt, 3], ['your edits', T.edit, 8], ['idle', T.idle, 22]];
  leg.forEach(([l, c, p], i) => {
    const a = E.outCubic(seg(f, 30 + i * 10, 50 + i * 10));
    const y = 430 + i * 58;
    ctx.globalAlpha = a; ctx.fillStyle = c; ctx.fillRect(64, y - 26, 26, 26); ctx.globalAlpha = 1;
    txt(ctx, l, 108, y, { size: 34, w: 500, col: T.dim, a });
    txt(ctx, `${Math.round(p * u)}%`, 440, y, { size: 34, w: 700, col: T.text, a, align: 'right' });
  });
}
function shadeHex(h, k) { const n = parseInt(h.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255; const f = v => Math.max(0, Math.min(255, Math.round(v * k))); return `rgb(${f(r)},${f(g)},${f(b)})`; }

// 4. Lock Screen: the Live Activity
function sceneLock(ctx, f) {
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, WORLD.lock[0]); g.addColorStop(1, WORLD.lock[1]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // wallpaper: the user's creature, huge and faint
  creature(ctx, animal('fox', 0), W / 2 - 360, 700, 720, 'rgba(249,131,62,0.08)');
  // Dynamic Island: expands into the Live Activity, then settles compact (creature + elapsed)
  const ex = E.inOutCubic(seg(f, 150, 172)) * (1 - E.inOutCubic(seg(f, 214, 236))), cp = E.outCubic(seg(f, 60, 80));
  const iw = lerp(P(126) + cp * P(90), P(372), ex), ih = lerp(P(37), P(150), ex), ix = W / 2 - iw / 2, iy = P(11);
  ctx.fillStyle = '#000'; ctx.beginPath(); ctx.roundRect(ix, iy, iw, ih, Math.min(ih / 2, P(40))); ctx.fill();
  if (ex < 0.5 && cp > 0) {
    ctx.globalAlpha = cp * (1 - ex * 2);
    creature(ctx, animal('whale', f), ix + P(10), iy + P(5), P(26), HUE.tide[0]);
    txt(ctx, `${12 + Math.floor(seg(f, 30, 250) * 3)}m`, ix + iw - P(14), iy + P(25), { size: P(16), w: 700, col: HUE.tide[0], align: 'right' });
    ctx.globalAlpha = 1;
  }
  if (ex > 0.5) {
    const a = (ex - 0.5) * 2; ctx.globalAlpha = a;
    creature(ctx, animal('whale', f), ix + P(20), iy + P(20), P(16), HUE.tide[0]);
    txt(ctx, 'tramline', ix + P(44), iy + P(33), { size: P(15), w: 600, col: WORLD.white, mono: true, a });
    txt(ctx, '12m', ix + iw - P(20), iy + P(33), { size: P(18), w: 700, col: HUE.tide[0], align: 'right', a });
    txt(ctx, 'Rewriting a source file, third attempt', ix + P(20), iy + P(70), { size: P(15), w: 600, col: WORLD.white, a });
    ctx.fillStyle = WORLD.track; ctx.beginPath(); ctx.roundRect(ix + P(20), iy + P(96), P(84), P(6), P(3)); ctx.fill();
    ctx.fillStyle = HUE.tide[0]; ctx.beginPath(); ctx.roundRect(ix + P(20), iy + P(96), P(84) * 0.6, P(6), P(3)); ctx.fill();
    txt(ctx, 'about 9m left', ix + P(114), iy + P(103), { size: P(13), w: 500, col: T.dim, a });
    ctx.globalAlpha = 1;
  }
  txt(ctx, 'Friday, August 7', W / 2, 250, { size: 44, w: 600, col: 'rgba(255,255,255,0.8)', align: 'center' });
  txt(ctx, '11:34', W / 2, 520, { size: 260, w: 700, col: 'rgba(255,255,255,0.92)', align: 'center', track: -6 });
  const u = E.back(seg(f, 20, 44));
  const x = 36, w = W - 72, h = 330, y = lerp(1500, 1180, u);
  ctx.save(); ctx.globalAlpha = clamp(u);
  ctx.fillStyle = 'rgba(20,18,16,0.86)'; ctx.beginPath(); ctx.roundRect(x, y, w, h, 64); ctx.fill();
  // ring: elapsed of typical, in the session hue, creature inside
  const rc = [x + 38 + P(26), y + h / 2], rr = P(24), prog = 0.2 + 0.4 * seg(f, 30, 150);
  ctx.lineWidth = P(4); ctx.strokeStyle = T.border; ctx.beginPath(); ctx.arc(rc[0], rc[1], rr, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = HUE.tide[0]; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(rc[0], rc[1], rr, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2); ctx.stroke();
  creature(ctx, animal('whale', f), rc[0] - P(16), rc[1] - P(16), P(32), HUE.tide[0]);
  const tx = x + 38 + P(52) + P(12);
  txt(ctx, 'tramline', tx, y + 86, { size: 40, w: 600, col: T.text, mono: true });
  ctx.drawImage(IMG.claude, tx + 200, y + 56, 38, 38);
  txt(ctx, 'Claude Code', tx + 250, y + 86, { size: 36, w: 500, col: T.dim });
  const m = 12 + Math.floor(seg(f, 30, 150) * 3);
  txt(ctx, `${m}:${String(Math.floor((f * 1.7) % 60)).padStart(2, '0')}`, x + w - 40, y + 86, { size: 44, w: 600, col: T.text, align: 'right' });
  txt(ctx, 'Rewriting a source file, third attempt', tx, y + 160, { size: 44, w: 600, col: T.text });
  txt(ctx, 'done around 4:09pm · converging · 3 files changed', tx, y + 222, { size: 36, w: 500, col: T.dim });
  ctx.restore();
}
// 5. Now tab: mission control
const TILES = [
  { v: 'lead', h: 'Claude Code', repo: 'lantern', s: 'Waiting on you for four minutes', st: 'needs you', fig: '47m', files: '23 files', cr: 'octopus' },
  { v: 'half', h: 'Codex', repo: 'tramline', s: 'Stuck on the same failing command for six minutes', st: 'circling', fig: '28m', files: '11 files', cr: 'dog' },
  { v: 'half', h: 'Cursor', repo: 'private repo', s: 'Editing four files it has not read yet', st: 'lost', fig: '19m', files: '17 files', cr: 'bee' },
  { v: 'half', h: 'Claude Code', repo: 'tramline', s: 'Rewriting a source file, third attempt', st: 'converging', fig: '12m', files: '9 files', cr: 'whale' },
  { v: 'half', h: 'Gemini CLI', repo: 'lantern', s: 'Reading the docs', st: 'starting', fig: '3m', files: '4 files', cr: 'fox' },
];
function wrapLines(ctx, s, maxW) { const out = []; let cur = ''; for (const w of s.split(' ')) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > maxW && cur) { out.push(cur); cur = w; } else cur = t; } if (cur) out.push(cur); return out; }
function sceneNow(ctx, f, scroll = 0) {
  ctx.fillStyle = T.bg; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.translate(0, -scroll);
  txt(ctx, 'Now', P(16), 230, { size: P(34), w: 700, col: T.text });
  ctx.fillStyle = T.border; ctx.fillRect(0, 262, W, 2);
  band(ctx, 0, 266, W, 470, 'ember', clamp(f / 30), 36, 7);
  txt(ctx, 'Mission control', P(20), 266 + P(22) + 40, { size: P(15), w: 700, col: T.ink });
  const n1 = E.outCubic(seg(f, 18, 34));
  txt(ctx, '1 needs you', P(20), 266 + 220, { size: 150, w: 800, col: T.ink, track: -5, a: n1 });
  txt(ctx, '5 running', P(20), 266 + 290, { size: P(17), w: 600, col: T.ink, a: n1 });
  ['octopus', 'dog', 'bee', 'whale', 'fox'].forEach((c, i) => creature(ctx, animal(c, f + i * 7), P(20) + i * P(40), 266 + 340, P(32), T.ink, clamp((f - 26 - i * 4) / 16), i));
  // tiles
  let y = 266 + 470 + P(36) + 20; const g = P(12), full = W - P(32), half = (full - g) / 2;
  TILES.forEach((t, i) => {
    const w = t.v === 'lead' ? full : half, h = t.v === 'lead' ? P(210) : P(188);
    const x = t.v === 'lead' ? P(16) : P(16) + ((i - 1) % 2) * (half + g);
    if (i >= 1 && (i - 1) % 2 === 0 && i > 1) y += P(188) + g;
    const u = clamp((f - 30 - i * 8) / 26);
    if (u <= 0) return;
    band(ctx, x, y, w, h, CREATURE_HUE[t.cr], u, 0, i * 3);
    if (u < 0.6) return;
    const a = E.outCubic((u - 0.6) / 0.4), pad = t.v === 'lead' ? P(18) : P(14);
    ctx.globalAlpha = a;
    ctx.fillStyle = T.ink; ctx.beginPath(); ctx.roundRect(x + pad, y + pad, P(22), P(22), P(6)); ctx.fill();
    if (t.h === 'Claude Code') ctx.drawImage(IMG.claude, x + pad + P(3), y + pad + P(3), P(16), P(16));
    txt(ctx, t.repo, x + pad + P(30), y + pad + P(16), { size: P(t.v === 'lead' ? 15 : 13), w: 600, col: T.ink, mono: true, a });
    ctx.font = `800 ${Math.round(P(t.v === 'lead' ? 26 : 17))}px InterT`;
    wrapLines(ctx, t.s, w - pad * 2).slice(0, 3).forEach((ln, k) => txt(ctx, ln, x + pad, y + pad + P(t.v === 'lead' ? 60 : 50) + k * P(t.v === 'lead' ? 30 : 21), { size: P(t.v === 'lead' ? 26 : 17), w: t.v === 'lead' ? 800 : 700, col: T.ink, a }));
    txt(ctx, t.st, x + pad, y + h - pad - P(t.v === 'lead' ? 50 : 40), { size: P(t.v === 'lead' ? 17 : 14), w: 800, col: T.ink, a });
    txt(ctx, t.fig, x + pad, y + h - pad, { size: P(t.v === 'lead' ? 44 : 30), w: 800, col: T.ink, a, track: -1 });
    creature(ctx, animal(t.cr, f + i * 9), x + w - pad - P(t.v === 'lead' ? 80 : 48), y + h - pad - P(t.v === 'lead' ? 80 : 48), P(t.v === 'lead' ? 80 : 48), T.ink, 1, i);
    ctx.globalAlpha = 1;
    if (i === 0) { // the comet round the needs-you tile
      const per = 2 * (w + h), pos = ((f * 18) % per);
      const pt = pos < w ? [x + pos, y] : pos < w + h ? [x + w, y + pos - w] : pos < 2 * w + h ? [x + w - (pos - w - h), y + h] : [x, y + h - (pos - 2 * w - h)];
      ctx.fillStyle = T.text; ctx.beginPath(); ctx.arc(pt[0], pt[1], P(3), 0, Math.PI * 2); ctx.fill();
    }
  });
  ctx.restore();
}
// 6. the session page: hero band, the shape of it, what landed
function sceneSession(ctx, f) {
  ctx.fillStyle = T.bg; ctx.fillRect(0, 0, W, H);
  const hue = 'tide';
  band(ctx, 0, 0, W, 880, hue, clamp(f / 30), 36, 21);
  const pad = P(20);
  txt(ctx, 'Yesterday at 9:12am', pad, 190, { size: P(15), w: 700, col: T.ink, a: E.outCubic(seg(f, 18, 30)) });
  words(ctx, 'Shipped changes to', pad, 190 + P(40), f, 22, { size: P(31), w: 800, col: T.ink, track: -2 });
  words(ctx, 'nine source files', pad, 190 + P(74), f, 30, { size: P(31), w: 800, col: T.ink, track: -2 });
  creature(ctx, animal('whale', f), W - pad - P(96), 150, P(96), T.ink, clamp((f - 16) / 30), 9);
  const cnt = Math.floor(317 * E.outCubic(seg(f, 30, 30 + 57)));
  txt(ctx, `${Math.floor(cnt / 60)}h ${String(cnt % 60).padStart(2, '0')}m`, pad - 6, 190 + P(74) + P(120), { size: P(104), w: 800, col: T.ink, track: -P(3.6), a: E.outCubic(seg(f, 28, 40)) });
  txt(ctx, 'active of 6h 48m elapsed', pad, 190 + P(74) + P(150), { size: P(17), w: 600, col: T.ink, a: E.outCubic(seg(f, 40, 54)) });
  ctx.drawImage(IMG.claude, pad, 190 + P(74) + P(170), P(18), P(18));
  txt(ctx, 'Claude Code', pad + P(26), 190 + P(74) + P(184), { size: P(15), w: 500, col: T.ink, a: 0.8 });
  txt(ctx, 'tramline (sample)', pad + P(120), 190 + P(74) + P(184), { size: P(15), w: 500, col: T.ink, a: 0.8, mono: true });
  // route
  let y = 880 + P(36) + P(26);
  txt(ctx, 'the shape of it', pad, y, { size: P(12), w: 600, col: T.dim });
  strip(ctx, pad, y + P(12), W - 2 * pad, E.inOutCubic(seg(f, 40, 100)));
  txt(ctx, '9:12am', pad, y + P(12) + P(72) + P(18), { size: P(13), w: 500, col: T.dim, mono: true });
  txt(ctx, '4:00pm', W - pad, y + P(12) + P(72) + P(18), { size: P(13), w: 500, col: T.dim, mono: true, align: 'right' });
  // what landed
  y += P(150);
  txt(ctx, 'what landed', pad, y, { size: P(12), w: 600, col: T.dim, a: E.outCubic(seg(f, 70, 84)) });
  const rows = [['+2,101', T.add, 'lines added', 2101], ['-186', T.del, 'lines removed', 186], ['7', HUE[hue][0], 'commits landed', 7], ['52', HUE[hue][0], 'prompts you sent', 52]];
  rows.forEach(([v, c, l, n], i) => {
    const f0 = 80 + i * 10, a = E.outCubic(seg(f, f0, f0 + 16)), yy = y + P(20) + P(64) * (i + 1) - P(14);
    const shown = Math.round(n * E.outCubic(seg(f, f0, f0 + 50)));
    const s = (v.startsWith('+') ? '+' : v.startsWith('-') ? '-' : '') + shown.toLocaleString('en-US');
    const vw = txt(ctx, s, pad, yy, { size: P(48), w: 800, col: c, track: -P(1.7), a });
    txt(ctx, l, pad + Math.max(vw, P(120)) + P(10), yy, { size: P(17), w: 600, col: T.text, a });
    if (i < 3) { ctx.fillStyle = T.border; ctx.globalAlpha = a; ctx.fillRect(pad, yy + P(18), W - 2 * pad, 2); ctx.globalAlpha = 1; }
  });
}
// 7. the recap card, 16:9, turned toward the lens
function sceneCard(ctx, f) {
  ctx.fillStyle = T.bg; ctx.fillRect(0, 0, W, H);
  const cw = 1000, ch = cw * 9 / 16, s = cw / 1600;
  const u = E.swift(seg(f, 0, 30)), tilt = lerp(0.5, 0.06, u) + 0.03 * Math.sin(f * 0.03);
  ctx.save(); ctx.translate(W / 2, 820); ctx.transform(1, lerp(0.18, 0.02, u), 0, 1, 0, 0); ctx.scale(lerp(0.7, 1, u), lerp(0.7, 1, u) * (1 - tilt * 0.3));
  ctx.translate(-cw / 2, -ch / 2);
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 60; ctx.shadowOffsetY = 30; ctx.fillStyle = T.card; ctx.beginPath(); ctx.roundRect(0, 0, cw, ch, 48); ctx.fill(); ctx.restore();
  const p = 76 * s;
  txt(ctx, 'tramline (sample)', p, p + 30 * s, { size: 30 * s, w: 600, col: T.text, mono: true });
  txt(ctx, 'Saturday, August 29', p + 330 * s, p + 30 * s, { size: 26 * s, w: 500, col: T.dim });
  ctx.drawImage(IMG.claude, cw - p - 330 * s, p, 32 * s, 32 * s);
  txt(ctx, 'Claude Code', cw - p - 290 * s, p + 28 * s, { size: 26 * s, w: 600, col: T.text });
  txt(ctx, '  Opus 5', cw - p - 120 * s, p + 28 * s, { size: 26 * s, w: 500, col: T.dim });
  words(ctx, '9 of every 10 lines came', p, p + 190 * s, f, 18, { size: 84 * s, w: 800, col: T.text, track: -2.94 * s });
  words(ctx, 'from Opus 5, at least', p, p + 281 * s, f, 28, { size: 84 * s, w: 800, col: T.text, track: -2.94 * s });
  strip(ctx, p, p + 330 * s, cw - 2 * p, E.inOutCubic(seg(f, 30, 80)));
  txt(ctx, '9:12am', p, p + 330 * s + P(72) + 30 * s, { size: 24 * s, w: 500, col: T.dim, mono: true });
  txt(ctx, '5h 17m active · 6h 48m elapsed', cw / 2, p + 330 * s + P(72) + 30 * s, { size: 24 * s, w: 500, col: T.dim, mono: true, align: 'center' });
  txt(ctx, '4:00pm', cw - p, p + 330 * s + P(72) + 30 * s, { size: 24 * s, w: 500, col: T.dim, mono: true, align: 'right' });
  const stats = [['5h 17m', 'active'], ['7', 'commits'], ['+2,101', 'lines'], ['38', 'files'], ['52', 'prompts'], ['194.1M', 'tokens']];
  const sy = ch - p - 90 * s;
  stats.forEach(([v, l], i) => { const x = p + i * (cw - 2 * p) / 6, a = E.outCubic(seg(f, 50 + i * 5, 66 + i * 5)); txt(ctx, v, x, sy, { size: 44 * s, w: 800, col: T.text, track: -1.54 * s, a }); txt(ctx, l, x, sy + 34 * s, { size: 22 * s, w: 500, col: T.dim, a }); });
  ctx.fillStyle = HUE.ember[0]; ctx.fillRect(p, ch - p - 16 * s, 16 * s, 16 * s);
  txt(ctx, 'Builda', p + 26 * s, ch - p, { size: 26 * s, w: 800, col: T.text, track: -0.3 * s });
  txt(ctx, 'your build sessions, read back to you', cw - p, ch - p, { size: 22 * s, w: 500, col: T.dim, mono: true, align: 'right' });
  // sheen
  const sx = lerp(-400, cw + 400, seg(f, 34, 70)); const g = ctx.createLinearGradient(sx - 160, 0, sx + 160, ch);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.08)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(0, 0, cw, ch, 48); ctx.fill();
  ctx.restore();
}
// 8. analysis: the streak, the contribution graph filling on a diagonal wave
const GRAPH = ['o o o o 4 3 2 0', 'o o o 1 5 4 0 2', 'o o o 3 4 4 2 1', 'o o o 4 3 4 0 0', 'o o o 4 3 2 1 3', 'o o o 3 1 1 0 5', 'o o o 2 1 2 0 2'].map(r => r.split(' '));
const RAMP = TOK.graph.levels.dark;
sceneGraph.threeD = true;
function sceneGraph(ctx, f) {
  ctx.fillStyle = T.bg; ctx.fillRect(0, 0, W, H);
  band(ctx, 0, 0, W, 620, 'amber', clamp(f / 26), 36, 31);
  const pad = P(20);
  txt(ctx, '02', pad, 180, { size: P(13), w: 600, col: 'rgba(28,25,23,0.62)', mono: true });
  txt(ctx, 'Time', pad + P(28), 180, { size: P(15), w: 700, col: T.ink });
  const n = Math.round(11 * E.outCubic(seg(f, 14, 50)));
  txt(ctx, String(n), pad - 8, 180 + P(104), { size: P(104), w: 800, col: T.ink, track: -P(3.6) });
  txt(ctx, 'days straight', pad + P(80), 180 + P(96), { size: P(24), w: 700, col: T.ink });
  txt(ctx, '20 days in all had a commit and a session with you there.', pad, 180 + P(140), { size: P(15), w: 500, col: T.ink, a: 0.8 * E.outCubic(seg(f, 30, 44)) });
  txt(ctx, 'every day, by hours at it', pad, 620 + P(36) + P(20), { size: P(12), w: 600, col: T.dim });
  const gap = P(6), cell = Math.floor((W - 2 * pad - gap * 7) / 8), gy = 620 + P(36) + P(40);
  if (sceneGraph.threeD) { graph3D(ctx, f, pad, gy - 40, W - 2 * pad, 7 * (cell + gap) + 80); return; }
  GRAPH.forEach((row, j) => row.forEach((v, i) => {
    const t0 = 24 + (i + j) * 3.5, a = E.back(seg(f, t0, t0 + 16));
    const x = pad + i * (cell + gap), y = gy + j * (cell + gap);
    ctx.save(); ctx.translate(x + cell / 2, y + cell / 2); ctx.scale(a, a);
    if (v === 'o') { ctx.strokeStyle = T.border; ctx.lineWidth = 3; ctx.strokeRect(-cell / 2 + 2, -cell / 2 + 2, cell - 4, cell - 4); }
    else { ctx.fillStyle = RAMP[+v]; ctx.fillRect(-cell / 2, -cell / 2, cell, cell); }
    ctx.restore();
  }));
  txt(ctx, 'Aug', pad, gy - P(8), { size: P(11), w: 600, col: T.faint });
  txt(ctx, 'Sep', pad + 5 * (cell + gap), gy - P(8), { size: P(11), w: 600, col: T.faint });
}
// 8b. the same graph, extruded: each day a bar as tall as its hours, the camera swinging round
function graph3D(ctx, f, x0, y0, w, h) {
  const ang = lerp(0, 0.75, E.inOutCubic(seg(f, 60, 130))) + 0.08 * Math.sin(f * 0.02), tilt = lerp(1.35, 0.72, E.inOutCubic(seg(f, 60, 130)));
  const cx = x0 + w / 2, cy = y0 + h * 0.52, sc = w / 11;
  const pr = (gx, gy, z) => { const X = (gx - 3.5) * Math.cos(ang) - (gy - 3) * Math.sin(ang), Y = (gx - 3.5) * Math.sin(ang) + (gy - 3) * Math.cos(ang); return [cx + X * sc, cy + Y * sc * Math.cos(tilt) - z * sc * Math.sin(tilt)]; };
  const cells = [];
  GRAPH.forEach((row, j) => row.forEach((v, i) => cells.push({ i, j, v })));
  cells.sort((a, b) => { const d = c => (c.i - 3.5) * Math.sin(ang) + (c.j - 3) * Math.cos(ang); return d(a) - d(b); });
  for (const c of cells) {
    const t0 = 20 + (c.i + c.j) * 3.5, a = E.back(seg(f, t0, t0 + 16)); if (a <= 0) continue;
    const lvl = c.v === 'o' ? 0 : +c.v, z = lvl * 0.55 * E.outCubic(seg(f, 70 + (c.i + c.j) * 2, 110 + (c.i + c.j) * 2)), g = 0.44 * a;
    const q = (dz) => [pr(c.i - g, c.j - g, dz), pr(c.i + g, c.j - g, dz), pr(c.i + g, c.j + g, dz), pr(c.i - g, c.j + g, dz)];
    const poly = (pts, col) => { ctx.fillStyle = col; ctx.beginPath(); pts.forEach((p, k) => k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); ctx.fill(); };
    if (c.v === 'o') { const pts = q(0); ctx.strokeStyle = T.border; ctx.lineWidth = 3; ctx.beginPath(); pts.forEach((p, k) => k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); ctx.stroke(); continue; }
    const col = RAMP[lvl], lo = q(0), hi = q(z);
    if (z > 0.01) for (let e = 0; e < 4; e++) { const k2 = (e + 1) % 4; poly([lo[e], lo[k2], hi[k2], hi[e]], shadeHex(col, 0.62 + 0.14 * e)); }
    poly(hi, col);
  }
}
// 9. Wrapped: which kind of builder are you?
const DECK = [['Your longest single session?', '3h 06m', 'The longest of 132 sessions with you there.', 'iris', 'octopus'], ['How much did you ship?', '50,177 lines', '232 of 247 commits landed during a session.', 'brass', 'bee']];
function wrapCard(ctx, x, y, w, h, [q, a, sent, hue, cr], f, idx) {
  ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, w, h, P(28)); ctx.clip();
  band(ctx, x, y, w, h, hue, 1, 0);
  txt(ctx, String(idx).padStart(2, '0'), x + P(24), y + P(46), { size: P(15), w: 600, col: 'rgba(28,25,23,0.62)', mono: true });
  txt(ctx, q, x + P(24), y + P(110), { size: P(26), w: 800, col: T.ink, track: -1.2 });
  txt(ctx, a, x + P(24), y + P(260), { size: P(52), w: 800, col: T.ink, track: -P(1.6) });
  txt(ctx, sent, x + P(24), y + P(300), { size: P(15), w: 500, col: T.ink, a: 0.82 });
  creature(ctx, animal(cr, f), x + w / 2 - P(70), y + h - P(200), P(140), T.ink);
  ctx.restore();
}
function sceneWrapped(ctx, f) {
  ctx.fillStyle = T.bg; ctx.fillRect(0, 0, W, H);
  if (f < 100) {
    sceneWrapped(ctx, 100 + (f - 100) * 0.001);    // the builder-type card waits underneath
    // the deck: each card is flung off to the left, turning, to show the next
    const x = P(16), y = 230, w = W - P(32), h = 1360;
    for (let k = DECK.length - 1; k >= 0; k--) {
      const out = E.inCubic(seg(f, 34 + k * 42, 58 + k * 42)); if (out >= 1) continue;
      ctx.save(); ctx.translate(W / 2 - out * W * 1.2, y + h / 2); ctx.rotate(-0.35 * out); ctx.scale(1 - k * 0.04 + 0.04 * seg(f, 34 + (k - 1) * 42, 58 + (k - 1) * 42), 1);
      ctx.translate(-W / 2, -(y + h / 2)); wrapCard(ctx, x, y + k * 26, w, h, DECK[k], f, 4 + k * 3); ctx.restore();
    }
    return;
  }
  f -= 100;
  const u = 1;
  const x = P(16), y = lerp(400, 230, u), w = W - P(32), h = 1360;
  ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, w, h, P(28)); ctx.clip();
  band(ctx, x, y, w, h, 'coral', 1, 0, 41);
  txt(ctx, '01', x + P(24), y + P(46), { size: P(15), w: 600, col: 'rgba(28,25,23,0.62)', mono: true });
  words(ctx, 'Which kind of builder', x + P(24), y + P(110), f, 12, { size: P(30), w: 800, col: T.ink, track: -1.5 });
  words(ctx, 'are you?', x + P(24), y + P(146), f, 20, { size: P(30), w: 800, col: T.ink, track: -1.5 });
  // split-flap answer
  const ans = 'Quality guardian', ch = '!ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  let s = ''; for (let i = 0; i < ans.length; i++) { const lock = 40 + i * 2.2; s += f >= lock || ans[i] === ' ' ? ans[i] : ch[Math.floor(hash(i * 7 + Math.floor(f / 2)) * ch.length)]; }
  if (f > 34) txt(ctx, s, x + P(24), y + P(250), { size: P(44), w: 800, col: T.ink, track: -P(1.2) });
  txt(ctx, 'At least 4.9 test runs an hour, at least one', x + P(24), y + P(292), { size: P(17), w: 500, col: T.ink, a: 0.82 * E.outCubic(seg(f, 76, 92)) });
  txt(ctx, 'every 12 minutes.', x + P(24), y + P(316), { size: P(17), w: 500, col: T.ink, a: 0.82 * E.outCubic(seg(f, 80, 96)) });
  creature(ctx, animal('crab', f), x + w / 2 - P(70), y + h - P(150), P(140), T.ink, clamp((f - 50) / 30), 13);
  ctx.restore();
}
// 10. the end: Bit prints, the wordmark, the line
function sceneEnd(ctx, f) {
  ctx.fillStyle = T.bg; ctx.fillRect(0, 0, W, H);
  const s = P(180);
  creature(ctx, bitFrame(f > 70 ? 'celebrating' : 'idle', f), W / 2 - s / 2, 560, s, T.amber, clamp(f / 34), 99);
  const a = E.outCubic(seg(f, 30, 50));
  ctx.font = '800 150px InterT'; ctx.letterSpacing = '-4px'; const tw = ctx.measureText('Builda').width; ctx.letterSpacing = '0px';
  const x0 = W / 2 - (tw + 110) / 2;
  ctx.globalAlpha = a; ctx.fillStyle = HUE.ember[0]; ctx.fillRect(x0, 1205 - 88, 88, 88); ctx.globalAlpha = 1;
  txt(ctx, 'Builda', x0 + 110, 1205, { size: 150, w: 800, col: T.text, track: -4, a });
  PICK.forEach((name, i) => {
    const a = E.back(seg(f, 50 + i * 5, 66 + i * 5)); if (a <= 0) return;
    const x = W / 2 - 4 * P(40) + i * P(40) + P(4), y = 1500 - Math.abs(Math.sin((f + i * 9) * 0.18)) * P(6);
    creature(ctx, animal(name, f + i * 11), x, y, P(32) * a, HUE[CREATURE_HUE[name]][0]);
  });
  txt(ctx, 'your build sessions, read back to you', W / 2, 1310, { size: 38, w: 500, col: T.dim, mono: true, align: 'center', a: E.outCubic(seg(f, 46, 64)) });
}

// ------------------------------------------------------------------ a phone in space
// Draw an image onto an arbitrary quad with perspective, by subdividing into small triangles
// and giving each its own affine map.
function texQuad(ctx, img, q, n = 10) {
  const [a, b, c, d] = q, iw = img.width, ih = img.height;
  // homography-free bilinear sampling of the quad (fine for a phone-sized plane)
  const at = (u, v) => [lerp(lerp(a[0], b[0], u), lerp(d[0], c[0], u), v), lerp(lerp(a[1], b[1], u), lerp(d[1], c[1], u), v)];
  for (let j = 0; j < n * 2; j++) for (let i = 0; i < n; i++) {
    const u0 = i / n, u1 = (i + 1) / n, v0 = j / (n * 2), v1 = (j + 1) / (n * 2);
    const P00 = at(u0, v0), P10 = at(u1, v0), P01 = at(u0, v1), P11 = at(u1, v1);
    for (const tri of [[[P00, [u0, v0]], [P10, [u1, v0]], [P01, [u0, v1]]], [[P10, [u1, v0]], [P11, [u1, v1]], [P01, [u0, v1]]]]) {
      const [[s0, t0], [s1, t1], [s2, t2]] = tri;
      const x0 = t0[0] * iw, y0 = t0[1] * ih, x1 = t1[0] * iw, y1 = t1[1] * ih, x2 = t2[0] * iw, y2 = t2[1] * ih;
      const den = x0 * (y1 - y2) + x1 * (y2 - y0) + x2 * (y0 - y1); if (!den) continue;
      const m11 = (s0[0] * (y1 - y2) + s1[0] * (y2 - y0) + s2[0] * (y0 - y1)) / den, m12 = (s0[0] * (x2 - x1) + s1[0] * (x0 - x2) + s2[0] * (x1 - x0)) / den;
      const m21 = (s0[1] * (y1 - y2) + s1[1] * (y2 - y0) + s2[1] * (y0 - y1)) / den, m22 = (s0[1] * (x2 - x1) + s1[1] * (x0 - x2) + s2[1] * (x1 - x0)) / den;
      const dx = s0[0] - m11 * x0 - m12 * y0, dy = s0[1] - m21 * x0 - m22 * y0;
      ctx.save(); ctx.beginPath();
      const cx = (s0[0] + s1[0] + s2[0]) / 3, cy = (s0[1] + s1[1] + s2[1]) / 3, g = 0.9;
      const e = p => [p[0] + (p[0] - cx) * 0.012 + Math.sign(p[0] - cx) * g, p[1] + (p[1] - cy) * 0.012 + Math.sign(p[1] - cy) * g];
      const E0 = e(s0), E1 = e(s1), E2 = e(s2);
      ctx.moveTo(E0[0], E0[1]); ctx.lineTo(E1[0], E1[1]); ctx.lineTo(E2[0], E2[1]); ctx.closePath(); ctx.clip();
      ctx.setTransform(m11, m21, m12, m22, dx, dy); ctx.drawImage(img, 0, 0); ctx.restore();
    }
  }
}
const { createCanvas } = require('@napi-rs/canvas');
let PHONE = null;
// The session page, rendered on a phone that hangs in the strip world while the camera orbits it.
function scenePhone(ctx, f, n) {
  if (!PHONE) PHONE = createCanvas(W, H);
  const pc = PHONE.getContext('2d'); pc.setTransform(1, 0, 0, 1, 0, 0);
  sceneSession(pc, f * 1.0);
  // backdrop: the strip world, far and dim, still drifting
  sceneFly(ctx, 380 + f * 0.25, 440, false);
  ctx.fillStyle = 'rgba(14,13,12,0.3)'; ctx.fillRect(0, 0, W, H);
  const u = E.inOutCubic(clamp(f / 110)), ang = lerp(0.75, -0.16, u) + 0.04 * Math.sin(f * 0.02), tilt = lerp(0.25, 0.05, u);
  const cx = W / 2, cy = 900, sw = lerp(560, 700, u), sh = sw * 16 / 9;
  const pz = (x, y, z) => { const X = x * Math.cos(ang) + z * Math.sin(ang), Z = -x * Math.sin(ang) + z * Math.cos(ang) + 2400; const Y = y * Math.cos(tilt) - Z * 0 ; const k = 2400 / Z; return [cx + X * k, cy + (Y - x * Math.sin(ang) * tilt * 0.3) * k]; };
  const hw = sw / 2, hh = sh / 2, bz = 28;
  const q = [pz(-hw, -hh, 0), pz(hw, -hh, 0), pz(hw, hh, 0), pz(-hw, hh, 0)];
  // body: a thick bezel and a side edge
  const side = [pz(hw, -hh, 0), pz(hw, -hh, bz), pz(hw, hh, bz), pz(hw, hh, 0)];
  ctx.fillStyle = WORLD.glass; ctx.beginPath(); side.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); ctx.fill();
  const bez = [pz(-hw - 26, -hh - 26, 0), pz(hw + 26, -hh - 26, 0), pz(hw + 26, hh + 26, 0), pz(-hw - 26, hh + 26, 0)];
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 80; ctx.shadowOffsetY = 40;
  ctx.fillStyle = WORLD.bezel; ctx.beginPath(); bez.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); ctx.fill(); ctx.restore();
  texQuad(ctx, PHONE, q, 12);
  ctx.strokeStyle = WORLD.bezel; ctx.lineJoin = 'round'; ctx.lineWidth = 34; ctx.beginPath(); q.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); ctx.stroke();
  ctx.strokeStyle = WORLD.rim; ctx.lineWidth = 4; ctx.beginPath(); bez.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); ctx.stroke();
  // glass sheen
  const g = ctx.createLinearGradient(q[0][0], q[0][1], q[2][0], q[2][1]);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(clamp(0.3 + 0.4 * Math.sin(f * 0.02)), 'rgba(255,255,255,0.07)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.beginPath(); q.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); ctx.fill();
  // dynamic island
  const di = [pz(-60, -hh + 34, 0), pz(60, -hh + 34, 0)]; ctx.strokeStyle = '#000'; ctx.lineCap = 'round'; ctx.lineWidth = 34 * (2400 / 2400); ctx.beginPath(); ctx.moveTo(di[0][0], di[0][1]); ctx.lineTo(di[1][0], di[1][1]); ctx.stroke();
}

// ------------------------------------------------------------------ onboarding: pick your creature
const PICK = ['cat', 'dog', 'fox', 'owl', 'bee', 'whale', 'octopus', 'crab'];
function scenePicker(ctx, f) {
  ctx.fillStyle = T.bg; ctx.fillRect(0, 0, W, H);
  // the selection hops across a few, then settles on the fox
  const hops = [0, 1, 4, 6, 2], hi = Math.min(hops.length - 1, Math.floor(clamp((f - 30) / 110) * hops.length)), sel = hops[hi];
  const hue = CREATURE_HUE[PICK[sel]], settle = f > 142;
  band(ctx, 0, 0, W, 520, hue, clamp(f / 24), 36, 51 + (settle ? 0 : hi));
  txt(ctx, 'pick your creature', P(20), 190, { size: P(15), w: 700, col: T.ink });
  txt(ctx, settle ? 'Vedant, the fox' : PICK[sel], P(20), 190 + P(56), { size: P(40), w: 800, col: T.ink, track: -2 });
  txt(ctx, 'Builda wears your creature’s colour.', P(20), 190 + P(90), { size: P(17), w: 600, col: T.ink, a: E.outCubic(seg(f, 150, 170)) });
  const gx = P(16), gy = 620, cw = (W - 2 * gx - P(12) * 3) / 4, ch = cw * 1.22;
  PICK.forEach((name, i) => {
    const c = i % 4, r = Math.floor(i / 4), x = gx + c * (cw + P(12)), y = gy + r * (ch + P(12));
    const a = E.back(seg(f, 8 + i * 4, 26 + i * 4)); if (a <= 0) return;
    const on = i === sel, pop = on ? 1 + 0.06 * Math.max(0, Math.sin(clamp((f - 30 - hi * 22) / 12) * Math.PI)) : 1;
    ctx.save(); ctx.translate(x + cw / 2, y + ch / 2); ctx.scale(a * pop, a * pop); ctx.translate(-(x + cw / 2), -(y + ch / 2));
    ctx.fillStyle = T.raised; ctx.beginPath(); ctx.roundRect(x, y, cw, ch, P(18)); ctx.fill();
    if (on) { ctx.strokeStyle = HUE[CREATURE_HUE[name]][0]; ctx.lineWidth = P(3); ctx.beginPath(); ctx.roundRect(x + P(1.5), y + P(1.5), cw - P(3), ch - P(3), P(17)); ctx.stroke(); }
    creature(ctx, animal(name, f + i * 5), x + cw / 2 - P(32), y + P(18), P(64), HUE[CREATURE_HUE[name]][0]);
    txt(ctx, name, x + cw / 2, y + ch - P(16), { size: P(13), w: 600, col: on ? T.text : T.dim, align: 'center' });
    ctx.restore();
  });
  txt(ctx, `${sel + 1} of 8`, W / 2, gy + 2 * ch + P(12) + P(46), { size: P(13), w: 600, col: T.faint, align: 'center', mono: true });
}
// ------------------------------------------------------------------ pairing: the camera reads the Mac's code
function qr(ctx, x, y, n, cell, seed) {
  ctx.fillStyle = WORLD.white; ctx.beginPath(); ctx.roundRect(x - cell * 2, y - cell * 2, (n + 4) * cell, (n + 4) * cell, cell); ctx.fill();
  ctx.fillStyle = '#111';
  const finder = (fx, fy) => { ctx.fillRect(x + fx * cell, y + fy * cell, 7 * cell, 7 * cell); ctx.fillStyle = '#FFF'; ctx.fillRect(x + (fx + 1) * cell, y + (fy + 1) * cell, 5 * cell, 5 * cell); ctx.fillStyle = '#111'; ctx.fillRect(x + (fx + 2) * cell, y + (fy + 2) * cell, 3 * cell, 3 * cell); };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    if ((i < 8 && j < 8) || (i > n - 9 && j < 8) || (i < 8 && j > n - 9)) continue;
    if (hash(i * 31.7 + j * 11.3 + seed) < 0.5) ctx.fillRect(x + i * cell, y + j * cell, cell + 0.4, cell + 0.4);
  }
  finder(0, 0); finder(n - 7, 0); finder(0, n - 7);
}
function scenePair(ctx, f) {
  // the camera's view: a Mac screen, slightly off-axis, drifting as a hand would
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, WORLD.desk[0]); g.addColorStop(1, WORLD.desk[1]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const dx = 14 * Math.sin(f * 0.05), dy = 10 * Math.sin(f * 0.037 + 1);
  ctx.save(); ctx.translate(W / 2 + dx, 820 + dy); ctx.rotate(-0.04); ctx.transform(1, 0.03, -0.02, 1, 0, 0);
  ctx.fillStyle = WORLD.window; ctx.beginPath(); ctx.roundRect(-470, -420, 940, 700, 30); ctx.fill();
  ctx.fillStyle = T.bg; ctx.beginPath(); ctx.roundRect(-440, -390, 880, 640, 14); ctx.fill();
  txt(ctx, 'Connect your phone', -380, -300, { size: 40, w: 700, col: T.text });
  qr(ctx, -150, -230, 29, 10.5, 7);
  txt(ctx, 'HX7K-29QP', 0, 175, { size: 56, w: 600, col: T.text, align: 'center', mono: true, track: 4 });
  txt(ctx, 'Open Builder on your phone → Settings → Scan code', 0, 225, { size: 24, w: 400, col: T.dim, align: 'center' });
  ctx.restore();
  // the phone's framing square: white, then amber once it reads the code
  const ok = f > 80, s = P(220), fx = W / 2 - s / 2, fy = 820 - 70 - s / 2 + 40;
  const pulse = ok ? E.back(seg(f, 80, 96)) : 1;
  ctx.save(); ctx.translate(W / 2, fy + s / 2); ctx.scale(pulse, pulse); ctx.translate(-W / 2, -(fy + s / 2));
  ctx.strokeStyle = ok ? T.amber : 'rgba(255,255,255,0.8)'; ctx.lineWidth = P(2); ctx.beginPath(); ctx.roundRect(fx, fy, s, s, P(18)); ctx.stroke(); ctx.restore();
  // bottom panel
  ctx.fillStyle = T.bg; ctx.fillRect(0, 1480, W, H - 1480);
  const msg = ok ? 'Paired with Vedant’s MacBook.' : f > 50 ? 'Pairing HX7K-29QP…' : 'Point the camera at the code on your Mac.';
  txt(ctx, msg, P(16), 1480 + P(40), { size: P(17), w: 400, col: T.text });
  if (ok) creature(ctx, bitFrame('celebrating', f), W - P(16) - P(48), 1480 + P(12), P(48), T.amber, clamp((f - 84) / 14), 77);
  txt(ctx, 'Type it instead', P(16), 1480 + P(80), { size: P(15), w: 600, col: T.amber, a: ok ? 0 : 1 });
}

// ------------------------------------------------------------------ social: the feed, kudos, the faction board
function rowStrip(ctx, x, y, w, h, seed = 0) {
  const n = Math.round(w / 3);
  for (let k = 0; k < n; k++) {
    const [cl, d] = COLS[Math.min(1023, Math.floor(((k + seed * 37) % n + 0.5) / n * 1024))];
    ctx.globalAlpha = cl === 0 ? 1 : [0.72, 0.84, 0.92, 1][d]; ctx.fillStyle = CLASS_COL[cl]; ctx.fillRect(x + k * 3, y, 3.2, h);
  }
  ctx.globalAlpha = 1;
}
const POSTS = [
  { who: 'Vedant', ago: '4m', repo: 'tramline', dur: '5h 17m', head: 'Shipped changes to nine source files', sum: 'Seven commits landed while you worked.', k: 3, c: 2, seed: 0, mine: true },
  { who: 'Maya', ago: '38m', repo: 'lantern', dur: '1h 42m', head: 'Agent run finished', sum: 'ran 1h 42m unattended · +420 lines', k: 11, c: 4, seed: 3 },
  { who: 'Theo', ago: '2h', repo: 'private repo', dur: '3h 06m', head: 'Longest session yet', sum: '5 commits · 52 prompts', k: 7, c: 1, seed: 5 },
];
function sceneFeed(ctx, f) {
  ctx.fillStyle = T.bg; ctx.fillRect(0, 0, W, H);
  txt(ctx, 'Feed', P(16), 230, { size: P(34), w: 700, col: T.text });
  ctx.fillStyle = T.border; ctx.fillRect(0, 262, W, 2);
  let y = 300;
  POSTS.forEach((p, i) => {
    const a = E.outCubic(seg(f, 6 + i * 8, 30 + i * 8)); if (a <= 0) return;
    const x = P(16), w = W - P(32), h = P(208);
    ctx.save(); ctx.globalAlpha = a; ctx.translate(0, (1 - a) * 40);
    ctx.fillStyle = T.card; ctx.beginPath(); ctx.roundRect(x, y, w, h, P(12)); ctx.fill();
    const px = x + P(16); let lx = px;
    lx += txt(ctx, p.who, lx, y + P(30), { size: P(14), w: 600, col: T.text });
    lx += txt(ctx, ` · ${p.ago} · ${p.repo}`, lx, y + P(30), { size: P(12), w: 400, col: T.dim });
    txt(ctx, p.dur, x + w - P(16), y + P(30), { size: P(14), w: 700, col: T.text, align: 'right' });
    rowStrip(ctx, px, y + P(42), w - P(32), P(12), p.seed);
    txt(ctx, p.head, px, y + P(90), { size: P(17), w: 700, col: T.text });
    txt(ctx, p.sum, px, y + P(112), { size: P(13), w: 400, col: T.dim });
    // kudos: the first post gets one, live
    const given = p.mine && f > 96, pop = given ? E.back(seg(f, 96, 110)) : 1, ky = y + P(140);
    const kl = given ? `Kudos given · ${p.k + 1}` : `Kudos · ${p.k}`;
    ctx.font = `600 ${P(14)}px InterT`; const kw = ctx.measureText(kl).width + P(32);
    ctx.save(); ctx.translate(px + kw / 2, ky + P(16)); ctx.scale(pop, pop); ctx.translate(-(px + kw / 2), -(ky + P(16)));
    if (given) { ctx.fillStyle = T.amber; ctx.beginPath(); ctx.roundRect(px, ky, kw, P(32), P(16)); ctx.fill(); }
    else { ctx.strokeStyle = T.border; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(px, ky, kw, P(32), P(16)); ctx.stroke(); }
    txt(ctx, kl, px + P(16), ky + P(21), { size: P(14), w: 600, col: given ? T.ink : T.text });
    ctx.restore();
    if (p.mine && f > 90 && f < 120) { const u = seg(f, 90, 110); ctx.fillStyle = `rgba(245,241,234,${0.3 * (1 - u)})`; ctx.beginPath(); ctx.arc(px + kw / 2, ky + P(16), P(10) + P(30) * u, 0, Math.PI * 2); ctx.fill(); }
    ctx.strokeStyle = T.border; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(px + kw + P(16), ky, P(120), P(32), P(16)); ctx.stroke();
    txt(ctx, `${p.c} comments`, px + kw + P(32), ky + P(21), { size: P(14), w: 600, col: T.text });
    ctx.restore();
    y += h + P(8);
  });
}
const BOARD = [['Maya', '14h 20m', 9, '3h 11m'], ['Theo', '12h 05m', 6, '3h 06m'], ['Vedant', '11h 48m', 8, '5h 17m'], ['Priya', '9h 32m', 5, '2h 40m'], ['Sam', '7h 10m', 4, '1h 55m']];
function sceneBoard(ctx, f) {
  ctx.fillStyle = T.bg; ctx.fillRect(0, 0, W, H);
  band(ctx, 0, 0, W, 520, 'cobalt', clamp(f / 24), 36, 61);
  txt(ctx, 'Night shift', P(20), 190, { size: P(15), w: 700, col: T.ink });
  txt(ctx, '/night-shift · 5 members · you admin', P(20), 190 + P(24), { size: P(13), w: 500, col: T.ink, a: 0.75 });
  words(ctx, 'This week, ranked by', P(20), 190 + P(80), f, 8, { size: P(30), w: 800, col: T.ink, track: -1.5 });
  words(ctx, 'hours with you there.', P(20), 190 + P(114), f, 16, { size: P(30), w: 800, col: T.ink, track: -1.5 });
  const x = P(16), y0 = 520 + P(60), w = W - P(32);
  ctx.fillStyle = T.card; ctx.beginPath(); ctx.roundRect(x, y0, w, P(330), P(18)); ctx.fill();
  const hx = [x + P(16), x + P(48), x + P(190), x + P(262), x + w - P(16)];
  ['#', 'builder', 'attended', 'sess.', 'longest'].forEach((h, i) => txt(ctx, h, hx[i], y0 + P(34), { size: P(12), w: 700, col: T.dim, align: i === 4 ? 'right' : 'left' }));
  // Vedant's hours tick up past Theo and Maya; rows swap places as the order changes
  const mine = lerp(11 * 60 + 48, 15 * 60 + 2, E.inOutCubic(seg(f, 60, 150)));
  const rows = BOARD.map(r => ({ r, mins: r[0] === 'Vedant' ? mine : +r[1].split('h ')[0] * 60 + parseInt(r[1].split('h ')[1]) }));
  const order = rows.slice().sort((a, b) => b.mins - a.mins);
  rows.forEach(row => {
    const rank = order.indexOf(row);
    if (row.pos === undefined) row.pos = rank;
    // soft rank: rows glide past each other instead of snapping
    const rankF = rows.reduce((acc, o) => o === row ? acc : acc + 1 / (1 + Math.exp(-(o.mins - row.mins) / 5)), 0);
    const ry = y0 + P(60) + rankF * P(52);
    const me = row.r[0] === 'Vedant';
    const yy = me ? ry : ry;
    if (me) { ctx.fillStyle = 'rgba(83,163,242,0.14)'; ctx.fillRect(x + 2, yy - P(8), w - 4, P(52)); }
    ctx.fillStyle = T.border; ctx.fillRect(x + P(16), yy - P(8), w - P(32), 2);
    const hm = me ? `${Math.floor(mine / 60)}h ${String(Math.floor(mine % 60)).padStart(2, '0')}m` : row.r[1];
    [String(rank + 1), row.r[0], hm, String(row.r[2]), row.r[3]].forEach((v, i) => txt(ctx, v, hx[i], yy + P(24), { size: P(13), w: me ? 800 : 500, col: T.text, align: i === 4 ? 'right' : 'left' }));
  });
}

// ------------------------------------------------------------------ money and burn
function sceneMoney(ctx, f) {
  ctx.fillStyle = T.bg; ctx.fillRect(0, 0, W, H);
  band(ctx, 0, 0, W, 640, 'ember', clamp(f / 24), 36, 71);
  const pad = P(20);
  txt(ctx, '06', pad, 180, { size: P(13), w: 600, col: 'rgba(28,25,23,0.62)', mono: true });
  txt(ctx, 'Money and burn', pad + P(28), 180, { size: P(15), w: 700, col: T.ink });
  const v = Math.round(2952 * E.outCubic(seg(f, 14, 70)));
  txt(ctx, '$' + v.toLocaleString('en-US'), pad - 6, 180 + P(110), { size: P(104), w: 800, col: T.ink, track: -P(3.6) });
  txt(ctx, 'at API list prices, read Sep 6', pad, 180 + P(140), { size: P(17), w: 600, col: T.ink, a: E.outCubic(seg(f, 30, 46)) });
  txt(ctx, 'On a subscription you pay your plan, not this.', pad, 180 + P(164), { size: P(15), w: 500, col: T.ink, a: 0.8 * E.outCubic(seg(f, 40, 56)) });
  const rows = [['Opus 5', 2484, '147 sessions · $12.59 a commit'], ['Fable 5', 457, ''], ['Fable 5.1', 10.98, '']];
  let y = 640 + P(36) + P(30);
  txt(ctx, 'by model', pad, y, { size: P(12), w: 600, col: T.dim });
  rows.forEach(([m, d, note], i) => {
    const yy = y + P(30) + i * P(70), a = E.outCubic(seg(f, 50 + i * 8, 70 + i * 8)), w = (W - 2 * pad) * (d / 2484) * E.outCubic(seg(f, 56 + i * 8, 96 + i * 8));
    txt(ctx, m, pad, yy, { size: P(17), w: 600, col: T.text, a, mono: false });
    txt(ctx, '$' + (d < 100 ? d.toFixed(2) : Math.round(d).toLocaleString('en-US')), W - pad, yy, { size: P(17), w: 800, col: T.text, a, align: 'right' });
    ctx.fillStyle = HUE.ember[0]; ctx.globalAlpha = a; ctx.fillRect(pad, yy + P(10), Math.max(P(3), w), P(8)); ctx.globalAlpha = 1;
    if (note) txt(ctx, note, pad, yy + P(38), { size: P(13), w: 400, col: T.dim, a });
  });
  y += P(30) + 3 * P(70) - P(30);
  const tk = (4170.5 * E.outCubic(seg(f, 80, 130))).toFixed(1);
  txt(ctx, `${Number(tk).toLocaleString('en-US', { minimumFractionDigits: 1 })}M`, pad, y + P(40), { size: P(44), w: 800, col: HUE.ember[0], track: -1.5 });
  txt(ctx, 'tokens, 99% cache reads', pad, y + P(66), { size: P(17), w: 600, col: T.text });
}

// ------------------------------------------------------------------ the trailer chapter
// A project's own trailer, cut on the Mac from its demo, changed by a note typed on the phone,
// rendered in every shape a feed takes, and the release it rides out in. The trailer inside these
// scenes is laid out the way trailer/ lays one out (its band carrying the name, the app in its
// device, side by side when the frame is wider than 0.95 of its height, stacked when taller), and
// the pour between two versions is the phone's own fluid: `wipePhases` and `wipeCell` from
// mobile/src/motion/fluid.ts, the same phases InkWipe and the renderer read.
const { wipePhases, wipeCell } = require(path.join(__dirname, '..', 'mobile', 'src', 'motion', 'fluid.ts'));
const V1 = { hue: 'tide', secs: 20, v: 1 }, V2 = { hue: 'ember', secs: 15, v: 2 };
const PINK = HUE.tide;   // the sample project's own hue: the note's rule and the star are in it
let SESS_CV = null;
function sessionPage(sf) {
  if (!SESS_CV) SESS_CV = createCanvas(W, H);
  const c = SESS_CV.getContext('2d'); c.setTransform(1, 0, 0, 1, 0, 0); sceneSession(c, sf); return SESS_CV;
}
// A hue block printing in cell by cell, its dithered fringe on the edge that faces the device:
// the bottom when stacked (s 0), the right when side by side (s 1).
function inkRect(ctx, x, y, w, h, hue, u, s, seed) {
  const [ink, partner] = HUE[hue], c = 8, cols = Math.ceil(w / c), rows = Math.ceil(h / c), fr = 5, side = s > 0.5;
  if (u <= 0) return;
  ctx.fillStyle = ink;
  if (u >= 1) ctx.fillRect(x, y, cols * c, rows * c);
  else for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const th = hash(i * 12.9898 + j * 78.233 + seed) * 0.72 + (side ? i / cols : j / rows) * 0.28;
    if (th < u * 1.02) ctx.fillRect(x + i * c, y + j * c, c, c);
  }
  for (let k = 0; k < fr; k++) {
    const dens = 1 - (k + 0.5) / fr, n = side ? rows : cols;
    for (let m = 0; m < n; m++) {
      const i = side ? cols + k : m, j = side ? m : rows + k, b = BAYER(i, j);
      if (b > dens || hash(i * 3.1 + j * 7.7 + seed) * 0.72 + 0.28 > u * 1.02) continue;
      ctx.fillStyle = b > dens * 0.55 ? partner : ink; ctx.fillRect(x + i * c, y + j * c, c, c);
    }
  }
}
function film(ctx, x, y, w, h, ft, V) {
  ft = Math.max(0, ft);
  const k = Math.min(w, h) / 393, s = E.inOutCubic(clamp((w / h - 0.86) / 0.16));
  ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, w, h, 14); ctx.clip();
  ctx.fillStyle = T.bg; ctx.fillRect(x, y, w, h);
  const bw = lerp(w, w * 0.54, s), bh = lerp(h * 0.42, h, s), pad = 22 * k;
  inkRect(ctx, x, y, bw, bh, V.hue, E.outCubic(clamp(ft / 26)), s, 5 + V.v);
  const a = E.outCubic(seg(ft, 12, 32)), ty = lerp(y + bh - 34 * k, y + h / 2 + 10 * k, s);
  txt(ctx, 'tramline', x + pad, ty + (1 - a) * 12 * k, { size: 44 * k, w: 800, col: T.ink, track: -1.6 * k, a });
  txt(ctx, 'live arrivals, every stop', x + pad, ty + 26 * k, { size: 14 * k, w: 600, col: T.ink, a: a * 0.8 });
  creature(ctx, animal('whale', ft), x + bw - pad - 54 * k, y + pad, 54 * k, T.ink, clamp((ft - 6) / 24), 9 + V.v);
  // the app in its device, rising into place
  const dh = lerp(h * 0.5, h * 0.84, s), dw = dh * 0.5, dr = dw * 0.17;
  const dx = lerp(x + w / 2 - dw / 2, x + w * 0.77 - dw / 2, s), dy = lerp(y + h * 0.47, y + h / 2 - dh / 2, s) + (1 - E.swift(seg(ft, 8, 46))) * 120 * k;
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 26 * k; ctx.shadowOffsetY = 10 * k;
  ctx.fillStyle = WORLD.bezel; ctx.beginPath(); ctx.roundRect(dx, dy, dw, dh, dr); ctx.fill(); ctx.restore();
  const ins = dw * 0.045, sx = dx + ins, sy = dy + ins, sw = dw - 2 * ins, sh = dh - 2 * ins;
  ctx.save(); ctx.beginPath(); ctx.roundRect(sx, sy, sw, sh, dr - ins); ctx.clip();
  ctx.fillStyle = T.bg; ctx.fillRect(sx, sy, sw, sh);
  ctx.imageSmoothingQuality = 'high'; ctx.drawImage(sessionPage(Math.min(150, 24 + ft)), sx, sy, sw, sw * H / W);
  ctx.fillStyle = '#000'; ctx.beginPath(); ctx.roundRect(dx + dw / 2 - dw * 0.14, sy + dw * 0.04, dw * 0.28, dw * 0.08, dw * 0.04); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = WORLD.rim; ctx.lineWidth = Math.max(1, 1.2 * k); ctx.beginPath(); ctx.roundRect(dx, dy, dw, dh, dr); ctx.stroke();
  ctx.restore();
}
// Two versions of a film and the ink between them: every cell is the old version, ink, or the new.
let POUR = null, PA = null, PB = null;
const POUR_FRAMES = 48;
function pour(ctx, x, y, w, h, p, drawA, drawB, hue) {
  const c = 9, cols = Math.ceil(w / c), rows = Math.ceil(h / c);
  if (!POUR) POUR = wipePhases({ cols, rows, dir: [0.2, -0.98], frames: POUR_FRAMES, seed: 29 });
  if (!PA) { PA = createCanvas(Math.ceil(w), Math.ceil(h)); PB = createCanvas(Math.ceil(w), Math.ceil(h)); }
  const a = PA.getContext('2d'), b = PB.getContext('2d');
  for (const [cv, draw] of [[a, drawA], [b, drawB]]) { cv.setTransform(1, 0, 0, 1, 0, 0); cv.clearRect(0, 0, PA.width, PA.height); draw(cv, 0, 0, w, h); }
  const kf = clamp(p) * POUR_FRAMES, k0 = Math.floor(kf), fr = kf - k0, P0 = POUR.phaseAt(k0), P1 = POUR.phaseAt(k0 + 1);
  const rev = [], edge = [], deep = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const cc = wipeCell(lerp(POUR.read(P0, i, j), POUR.read(P1, i, j), fr), p), th = BAYER(i, j);
    if (cc.revealed > th) rev.push(i, j); else if (cc.ink > th) (cc.depth > 0.55 + th * 0.4 ? deep : edge).push(i, j);
  }
  ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, w, h, 14); ctx.clip();
  ctx.drawImage(PA, x, y);
  if (rev.length) { ctx.save(); ctx.beginPath(); for (let q = 0; q < rev.length; q += 2) ctx.rect(x + rev[q] * c, y + rev[q + 1] * c, c, c); ctx.clip(); ctx.drawImage(PB, x, y); ctx.restore(); }
  const [ink, partner] = HUE[hue];
  ctx.fillStyle = ink; for (let q = 0; q < edge.length; q += 2) ctx.fillRect(x + edge[q] * c, y + edge[q + 1] * c, c, c);
  ctx.fillStyle = partner; for (let q = 0; q < deep.length; q += 2) ctx.fillRect(x + deep[q] * c, y + deep[q + 1] * c, c, c);
  ctx.restore();
}

// 11. direct it: a note typed on the phone, the Mac cuts it, the new version pours in
const NOTE = 'make it shorter and orange';
const DIR = { type: 22, send: 90, cut: 122, pour: 170, done: 206 };
const FILM = (() => { const x = P(20), w = W - 2 * P(20); return [x, 262, w, Math.round(w * 9 / 16)]; })();
function sceneDirect(ctx, f) {
  ctx.fillStyle = T.bg; ctx.fillRect(0, 0, W, H);
  const pad = P(20), [fx, fy, fw, fh] = FILM;
  txt(ctx, 'tramline (sample)', pad, 150, { size: P(13), w: 500, col: T.dim, mono: true });
  txt(ctx, 'Ship kit', pad, 214, { size: P(24), w: 800, col: T.text, track: -1 });
  let tx = W - pad;
  ['Recording', 'Trailer'].forEach((l, i) => {
    ctx.font = `600 ${P(14)}px InterT`; const tw = ctx.measureText(l).width; tx -= tw;
    txt(ctx, l, tx, 212, { size: P(14), w: 600, col: i ? T.text : T.dim });
    if (i) { ctx.fillStyle = PINK[0]; ctx.fillRect(tx, 212 + P(8), tw, P(2)); }
    tx -= P(18);
  });
  // the film: version 1 playing, then version 2 poured in over it
  const v1 = (c, x, y, w, h) => film(c, x, y, w, h, f + 250, V1), v2 = (c, x, y, w, h) => film(c, x, y, w, h, f - 190, V2);
  const pu = seg(f, DIR.pour, DIR.pour + POUR_FRAMES);
  if (f < DIR.pour) v1(ctx, fx, fy, fw, fh); else if (pu < 1) pour(ctx, fx, fy, fw, fh, pu, v1, v2, V2.hue); else v2(ctx, fx, fy, fw, fh);
  const later = f >= DIR.pour + 20, V = later ? V2 : V1, ft = later ? Math.max(0, f - 190) : f + 250, played = ((ft / 60) % V.secs) / V.secs;
  const py = fy + fh + P(10);
  ctx.fillStyle = T.border; ctx.fillRect(fx, py, fw, P(1.5)); ctx.fillStyle = T.text; ctx.fillRect(fx, py, fw * played, P(1.5));
  txt(ctx, `0:${String(Math.floor(played * V.secs)).padStart(2, '0')} / 0:${V.secs}`, fx, py + P(22), { size: P(12), w: 500, col: T.dim, mono: true });
  txt(ctx, `version ${V.v}`, fx + fw, py + P(22), { size: P(12), w: 500, col: T.dim, mono: true, align: 'right' });
  // the conversation
  const y0 = py + P(74);
  txt(ctx, 'Direct it', pad, y0, { size: P(22), w: 800, col: T.text, track: -0.8 });
  if (f >= DIR.send) {
    const a = E.swift(seg(f, DIR.send, DIR.send + 18)), ny = y0 + P(40) + (1 - a) * P(12);
    txt(ctx, NOTE, pad, ny, { size: P(16), w: 700, col: T.text, a });
    const ay = ny + P(14), lx = pad + P(14), done = f >= DIR.done;
    const rh = f < DIR.cut ? P(24) : !done ? lerp(P(24), P(44), E.swift(seg(f, DIR.cut, DIR.cut + 14))) : lerp(P(44), P(70), E.swift(seg(f, DIR.done, DIR.done + 16)));
    ctx.globalAlpha = a; ctx.fillStyle = done ? PINK[0] : T.raised; ctx.fillRect(pad, ay, P(3), rh); ctx.globalAlpha = 1;
    if (f < DIR.cut) {
      // waiting: three cells in the project's hue rising in turn
      for (let i = 0; i < 3; i++) { ctx.fillStyle = PINK[0]; ctx.globalAlpha = a; ctx.fillRect(lx + i * P(8), ay + P(12) - P(4) * Math.max(0, Math.sin(f * 0.2 - i * 0.9)), P(5), P(5)); }
      ctx.globalAlpha = 1;
      const w1 = txt(ctx, 'Waiting for your Mac', lx + P(32), ay + P(17), { size: P(13), w: 500, col: T.dim, a });
      txt(ctx, 'take back', lx + P(32) + w1 + P(10), ay + P(17), { size: P(13), w: 600, col: T.dim, a });
    } else if (!done) {
      // cutting: a field of cells stirred by a swirl that crosses it like a render's playhead
      const u = E.outCubic(seg(f, DIR.cut, DIR.cut + 10)), head = ((f - DIR.cut) * 0.34) % 26 - 3;
      for (let j = 0; j < 3; j++) for (let i = 0; i < 20; i++) {
        const glow = Math.exp(-((i - head) ** 2) / 7) * (0.7 + 0.3 * Math.sin(f * 0.3 + j)), base = 0.18 + 0.2 * hash(i * 7.1 + j * 3.3 + Math.floor(f / 6));
        ctx.globalAlpha = u * Math.min(1, base + glow); ctx.fillStyle = hash(i * 1.7 + j * 9.2) > 0.5 ? PINK[0] : PINK[1];
        ctx.fillRect(lx + i * P(5), ay + P(2) + j * P(5), P(4), P(4));
      }
      ctx.globalAlpha = 1;
      txt(ctx, 'Your Mac is cutting it', lx, ay + P(36), { size: P(13), w: 500, col: T.dim, a: u });
    } else {
      words(ctx, '20 s became 15 s', lx, ay + P(16), f, DIR.done, { size: P(13), w: 500, col: T.text });
      words(ctx, 'the colour is ember now', lx, ay + P(38), f, DIR.done + 7, { size: P(13), w: 500, col: T.text });
      txt(ctx, 'version 2', lx, ay + P(60), { size: P(12), w: 500, col: T.dim, mono: true, a: E.outCubic(seg(f, DIR.done + 16, DIR.done + 30)) });
    }
  }
  // the field, typed into, and Send
  const yF = 1360, hF = P(44), bw = P(74), wF = W - 2 * pad - bw - P(10);
  const typed = f < DIR.send ? NOTE.slice(0, Math.floor(clamp((f - DIR.type) / (1.6 * NOTE.length)) * NOTE.length)) : '';
  ctx.fillStyle = T.card; ctx.beginPath(); ctx.roundRect(pad, yF, wF, hF, P(10)); ctx.fill();
  ctx.strokeStyle = typed ? T.dim : T.border; ctx.lineWidth = 2; ctx.stroke();
  const tw = typed ? txt(ctx, typed, pad + P(14), yF + P(28), { size: P(15), w: 500, col: T.text }) : txt(ctx, 'What should change?', pad + P(14), yF + P(28), { size: P(15), w: 500, col: T.faint });
  if (f > DIR.type - 20 && f < DIR.send && (typed.length < NOTE.length || Math.floor(f / 15) % 2 === 0)) { ctx.fillStyle = T.amber; ctx.fillRect(pad + P(14) + (typed ? tw : 0) + 3, yF + P(13), P(1.5), P(20)); }
  const bx = W - pad - bw, press = 1 - 0.07 * Math.sin(Math.PI * seg(f, DIR.send - 5, DIR.send + 7)), ok = typed.length > 0;
  ctx.save(); ctx.translate(bx + bw / 2, yF + hF / 2); ctx.scale(press, press); ctx.translate(-(bx + bw / 2), -(yF + hF / 2));
  ctx.fillStyle = ok ? T.raised : T.bg; ctx.beginPath(); ctx.roundRect(bx, yF, bw, hF, P(10)); ctx.fill(); ctx.strokeStyle = ok ? T.dim : T.border; ctx.lineWidth = 2; ctx.stroke();
  const sending = f >= DIR.send && f < DIR.send + 16;
  txt(ctx, sending ? 'Sending' : 'Send', bx + bw / 2, yF + P(28), { size: P(14), w: 600, col: ok || sending ? T.text : T.faint, align: 'center' });
  ctx.restore();
  if (f >= DIR.send - 2 && f < DIR.send + 26) { const u = seg(f, DIR.send - 2, DIR.send + 26); ctx.fillStyle = `rgba(245,241,234,${0.22 * (1 - u)})`; ctx.beginPath(); ctx.arc(bx + bw / 2, yF + hF / 2, P(12) + P(46) * E.outCubic(u), 0, Math.PI * 2); ctx.fill(); }
  const st = ['make it shorter', 'open on the app', 'hard cuts', 'no music'].join(' · ');
  txt(ctx, st, pad, yF + hF + P(28), { size: P(13), w: 500, col: T.dim });
}

// 12. every shape: the same cut, laid out again for each feed it goes to
const SHAPES = [
  { label: '16:9', r: 16 / 9, for: 'X, YouTube, Bluesky, a README', at: 12, lit: ['X', 'Bluesky'] },
  { label: '9:16', r: 9 / 16, for: 'Reels, TikTok, YouTube Shorts, Stories', at: 62, lit: ['TikTok'] },
  { label: '4:5', r: 4 / 5, for: 'Instagram and LinkedIn feed, Threads', at: 110, lit: ['Instagram', 'Reddit', 'Facebook', 'LinkedIn', 'Threads'] },
  { label: '1:1', r: 1, for: 'anywhere a square crops least', at: 158, lit: ['GitHub'] },
];
const CHIPS = [['X', 'Bluesky', 'TikTok', 'Instagram', 'Reddit'], ['Facebook', 'LinkedIn', 'Threads', 'GitHub']];
function sceneShapes(ctx, f) {
  ctx.fillStyle = T.bg; ctx.fillRect(0, 0, W, H);
  const pad = P(20), BOX = [W - 2 * pad, 880], CY = 700;
  const fit = r => { let w = BOX[0], h = w / r; if (h > BOX[1]) { h = BOX[1]; w = h * r; } return [W / 2 - w / 2, CY - h / 2, w, h]; };
  let rc = FILM.slice();
  for (const s of SHAPES) { const u = spring(f - s.at, { freq: 1.45, zeta: 0.66 }), tg = fit(s.r); rc = rc.map((v, i) => lerp(v, tg[i], u)); }
  const [x, y, w, h] = rc;
  film(ctx, x, y, w, h, f + AT.shapes - AT.direct - 190, V2);
  // crop marks, the editor's corners
  const m = P(7), l = P(12), a0 = E.outCubic(seg(f, 10, 30));
  ctx.strokeStyle = T.faint; ctx.lineWidth = 3; ctx.globalAlpha = a0; ctx.beginPath();
  for (const [cx, cy, sx, sy] of [[x - m, y - m, 1, 1], [x + w + m, y - m, -1, 1], [x - m, y + h + m, 1, -1], [x + w + m, y + h + m, -1, -1]]) { ctx.moveTo(cx, cy + sy * l); ctx.lineTo(cx, cy); ctx.lineTo(cx + sx * l, cy); }
  ctx.stroke(); ctx.globalAlpha = 1;
  // the shape's name and where it goes
  const cur = SHAPES.reduce((acc, s, i) => (f >= s.at - 2 ? i : acc), 0), S0 = SHAPES[cur], nx = SHAPES[cur + 1];
  const fade = 1 - (nx ? E.inCubic(seg(f, nx.at - 12, nx.at - 2)) : 0), ly = CY + BOX[1] / 2 + P(50);
  words(ctx, S0.label, W / 2, ly, f, S0.at, { size: P(40), w: 800, col: T.text, track: -1.5, align: 'center', a: fade });
  words(ctx, S0.for, W / 2, ly + P(28), f, S0.at + 6, { size: P(14), w: 500, col: T.dim, align: 'center', a: fade });
  // the platforms, lit by the shape each one's post shows best (spec/shipkit.v1.json)
  const ch = P(26), gap = P(8), [ink] = HUE[V2.hue];
  CHIPS.forEach((row, ri) => {
    ctx.font = `600 ${P(13)}px InterT`;
    const ws = row.map(n => ctx.measureText(n).width + P(24)), tot = ws.reduce((p, q) => p + q, 0) + gap * (row.length - 1);
    let cx = W / 2 - tot / 2; const cy = ly + P(62) + ri * (ch + P(10));
    row.forEach((name, i) => {
      const s = SHAPES.find(q => q.lit.includes(name)), on = f >= s.at + 10, now = on && s === S0, n = ri * 5 + i;
      const a = E.outCubic(seg(f, 6 + n * 2, 22 + n * 2)), pop = now ? 1 + 0.14 * Math.sin(Math.PI * seg(f, s.at + 10, s.at + 24)) : 1;
      ctx.save(); ctx.translate(cx + ws[i] / 2, cy + ch / 2); ctx.scale(pop, pop); ctx.translate(-(cx + ws[i] / 2), -(cy + ch / 2)); ctx.globalAlpha = a;
      ctx.beginPath(); ctx.roundRect(cx, cy, ws[i], ch, ch / 2);
      if (now) { ctx.fillStyle = ink; ctx.fill(); } else { ctx.strokeStyle = on ? ink : T.border; ctx.lineWidth = 2; ctx.stroke(); }
      txt(ctx, name, cx + P(12), cy + ch * 0.68, { size: P(13), w: 600, col: now ? T.ink : on ? T.text : T.dim, a });
      ctx.restore(); cx += ws[i] + gap;
    });
  });
}

// 13. the release: the Mac drafted it after a run of commits, the owner publishes it
const REL_TITLE = 'Live arrivals at every stop';
const REL_POINTS = ['arrival times from the live feed', 'stops sorted by the walk to them', 'a 15 second trailer, version 2'];
const PUB = 116;
function sceneRelease(ctx, f) {
  ctx.fillStyle = T.bg; ctx.fillRect(0, 0, W, H);
  const pad = P(20);
  band(ctx, 0, 0, W, 700, 'tide', clamp(f / 26), 36, 83);
  txt(ctx, 'tramline · release draft', pad, 400, { size: P(15), w: 700, col: T.ink, a: E.outCubic(seg(f, 14, 28)) });
  words(ctx, 'Live arrivals', pad, 400 + P(46), f, 18, { size: P(34), w: 800, col: T.ink, track: -2 });
  words(ctx, 'at every stop', pad, 400 + P(84), f, 26, { size: P(34), w: 800, col: T.ink, track: -2 });
  creature(ctx, animal('whale', f), W - pad - P(84), 400 - P(40), P(84), T.ink, clamp((f - 10) / 30), 9);
  let y = 700 + P(36) + P(26);
  txt(ctx, 'drafted by your Mac after 12 commits', pad, y, { size: P(13), w: 500, col: T.dim, mono: true, a: E.outCubic(seg(f, 30, 46)) });
  // the rule builds cell by cell, then the highlights beside it
  y += P(30);
  const cells = Math.floor(22 * E.outCubic(seg(f, 36, 76)));
  ctx.fillStyle = PINK[0]; for (let i = 0; i < cells; i++) ctx.fillRect(pad, y + i * P(4), P(3), P(3.4));
  REL_POINTS.forEach((pt, i) => words(ctx, pt, pad + P(16), y + P(20) + i * P(30), f, 46 + i * 9, { size: P(17), w: 600, col: T.text }));
  // Publish
  const by = 1380, bh = P(52), press = 1 - 0.05 * Math.sin(Math.PI * seg(f, PUB - 5, PUB + 8)), out = f >= PUB + 4;
  const ba = E.outCubic(seg(f, 60, 80));
  ctx.save(); ctx.globalAlpha = ba; ctx.translate(W / 2, by + bh / 2); ctx.scale(press, press); ctx.translate(-W / 2, -(by + bh / 2));
  ctx.fillStyle = out ? PINK[0] : T.text; ctx.beginPath(); ctx.roundRect(pad, by, W - 2 * pad, bh, P(12)); ctx.fill();
  txt(ctx, out ? 'Published' : 'Publish', W / 2, by + bh / 2 + P(6), { size: P(17), w: 700, col: out ? T.ink : T.bg, align: 'center', a: ba });
  ctx.restore();
  if (f >= PUB - 2 && f < PUB + 30) { const u = seg(f, PUB - 2, PUB + 30); ctx.fillStyle = `rgba(245,241,234,${0.2 * (1 - u)})`; ctx.beginPath(); ctx.arc(W / 2, by + bh / 2, P(16) + P(120) * E.outCubic(u), 0, Math.PI * 2); ctx.fill(); }
  txt(ctx, 'out to everyone who starred it', W / 2, by + bh + P(30), { size: P(13), w: 500, col: T.dim, mono: true, align: 'center', a: E.outCubic(seg(f, PUB + 10, PUB + 26)) });
  banner(ctx, E.back(seg(f, 0, 22)) * (1 - E.inCubic(seg(f, 56, 72))), 'A release draft is waiting', REL_TITLE);
}

// 14. a follower hears it, stars it, and the README says so
const STAR = ['...X...', '..XXX..', 'XXXXXXX', '.XXXXX.', '..XXX..', '.XX.XX.', '.X...X.'];
function pixelStar(ctx, x, y, cell, ink, fill) {
  ctx.fillStyle = ink;
  STAR.forEach((row, r) => [...row].forEach((ch, c) => {
    if (ch !== 'X') return;
    const edge = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].some(([rr, cc]) => !(STAR[rr] && STAR[rr][cc] === 'X'));
    const u = edge ? 1 : clamp(fill * 1.6 - hash(r * 7 + c * 3) * 0.6);
    if (u >= 0.5) ctx.fillRect(x + c * cell, y + r * cell, cell, cell);
  }));
}
function badge(ctx, x, y, k, stars) {
  // server/builder/badge.py, drawn at k times its 20 pt height
  const cell = 2 * k, hgt = 20 * k, pad = 6 * k, ink = PINK[0], ground = T.bg;
  ctx.font = `400 ${11 * k}px InterT`; const lw = pad + 7 * cell + 5 * k + ctx.measureText('builda').width + pad;
  const right = `${stars} stars · released sep 28`, rw = pad + ctx.measureText(right).width + pad, fw = 4 * cell;
  ctx.fillStyle = ground; ctx.fillRect(x, y, lw + fw, hgt);
  pixelStar(ctx, x + pad, y + (hgt - 7 * cell) / 2, cell, ink, 1);
  txt(ctx, 'builda', x + pad + 7 * cell + 5 * k, y + 14 * k, { size: 11 * k, w: 400, col: T.text });
  for (let c = 0; c < 4; c++) for (let r = 0; r < 10; r++) if ((c + 0.5) / 4 > BAYER(c, r)) { ctx.fillStyle = ink; ctx.fillRect(x + lw + c * cell, y + r * cell, cell, cell); }
  ctx.fillStyle = ink; ctx.fillRect(x + lw + fw, y, rw, hgt);
  txt(ctx, right, x + lw + fw + pad, y + 14 * k, { size: 11 * k, w: 400, col: ground });
  return lw + fw + rw;
}
const TAP = 78;
function sceneStar(ctx, f) {
  ctx.fillStyle = T.bg; ctx.fillRect(0, 0, W, H);
  const pad = P(20), [ink, partner] = PINK;
  txt(ctx, 'Vedant released tramline', pad, 200, { size: P(14), w: 500, col: T.dim, a: E.outCubic(seg(f, 4, 18)) });
  words(ctx, REL_TITLE, pad, 200 + P(40), f, 8, { size: P(26), w: 800, col: T.text, track: -1 });
  // the star: an outline, tapped, filling in, a burst of its own pixels
  const cell = P(3.6), sx = W - pad - 7 * cell, sy = 200 + P(8), on = f >= TAP, cxs = sx + 3.5 * cell, cys = sy + 3.5 * cell;
  const press = 1 - 0.12 * Math.sin(Math.PI * seg(f, TAP - 5, TAP + 7));
  ctx.save(); ctx.translate(cxs, cys); ctx.scale(press, press); ctx.translate(-cxs, -cys);
  pixelStar(ctx, sx, sy, cell, on ? ink : T.dim, on ? E.outCubic(seg(f, TAP, TAP + 14)) : 0);
  ctx.restore();
  if (f >= TAP && f < TAP + 44) {
    const u = (f - TAP) / 44;
    for (let i = 0; i < 18; i++) {
      const ang = (i / 18) * Math.PI * 2 + hash(i * 3.7) * 0.5, sp = P(34) + hash(i * 9.1) * P(40), tt = E.outCubic(u);
      ctx.globalAlpha = 1 - u; ctx.fillStyle = i % 3 ? ink : partner;
      ctx.fillRect(cxs + Math.cos(ang) * sp * tt, cys + Math.sin(ang) * sp * tt + P(18) * u * u, cell * 0.8, cell * 0.8);
    }
    ctx.globalAlpha = 1;
  }
  // the count rolls from 12 to 13
  const my = 200 + P(72), roll = E.swift(seg(f, TAP + 4, TAP + 22));
  const mw = txt(ctx, 'today · carries a trailer · ', pad, my, { size: P(13), w: 500, col: T.faint, mono: true, a: E.outCubic(seg(f, 14, 28)) });
  ctx.save(); ctx.beginPath(); ctx.rect(pad + mw - 2, my - P(16), P(120), P(22)); ctx.clip();
  txt(ctx, '12 stars', pad + mw, my - roll * P(18), { size: P(13), w: 500, col: T.faint, mono: true, a: (1 - roll) * E.outCubic(seg(f, 14, 28)) });
  if (roll > 0) txt(ctx, '13 stars', pad + mw, my + (1 - roll) * P(18), { size: P(13), w: 600, col: T.text, mono: true, a: roll });
  ctx.restore();
  // the film, playing
  const fw = W - 2 * pad, fh = Math.round(fw * 9 / 16), fy = 200 + P(96);
  film(ctx, pad, fy, fw, fh, f + 70, V2);
  // the README, its badge
  const ry = lerp(H + 40, fy + fh + P(40), E.swift(seg(f, 118, 150))), rh = P(132);
  if (f >= 116) {
    ctx.fillStyle = T.card; ctx.beginPath(); ctx.roundRect(pad, ry, fw, rh, P(14)); ctx.fill();
    txt(ctx, 'README.md', pad + P(16), ry + P(26), { size: P(12), w: 500, col: T.dim, mono: true });
    ctx.fillStyle = T.border; ctx.fillRect(pad, ry + P(38), fw, 2);
    txt(ctx, 'tramline', pad + P(16), ry + P(74), { size: P(24), w: 800, col: T.text, track: -1 });
    badge(ctx, pad + P(16), ry + P(88), 3.1, f >= TAP ? 13 : 12);
  }
  banner(ctx, E.back(seg(f, 0, 22)) * (1 - E.inCubic(seg(f, 50, 66))), 'Vedant released tramline', REL_TITLE);
}

// ------------------------------------------------------------------ timeline
const SHIFT = 360;
const SC = [
  ['hello', 0, 260], ['picker', 250, 440], ['pair', 430, 620], ['term', 610, 860], ['fly', 810, 1260], ['lock', 1250, 1500], ['now', 1460, 1720],
  ['phone', 1710, 2010], ['card', 2000, 2220],
  ['direct', 2210, 2510], ['shapes', 2500, 2720], ['release', 2710, 2890], ['star', 2880, 2210 + D + 10],
  ['feed', 2210 + D, 2400 + D], ['board', 2390 + D, 2570 + D], ['graph', 2560 + D, 2790 + D], ['money', 2780 + D, 2980 + D], ['wrapped', 2970 + D, 3320 + D], ['end', 3310 + D, FRAMES],
];
const AT = Object.fromEntries(SC.map(([n, a]) => [n, a]));
function drawScene(ctx, name, f, n) {
  if (name === 'hello') sceneHello(ctx, f); else if (name === 'picker') scenePicker(ctx, f); else if (name === 'pair') scenePair(ctx, f); else if (name === 'term') sceneTerminal(ctx, f); else if (name === 'fly') sceneFly(ctx, f, n);
  else if (name === 'lock') sceneLock(ctx, f); else if (name === 'now') sceneNow(ctx, f + 34, 0); else if (name === 'session') sceneSession(ctx, f); else if (name === 'phone') scenePhone(ctx, f, n);
  else if (name === 'card') sceneCard(ctx, f); else if (name === 'direct') sceneDirect(ctx, f); else if (name === 'shapes') sceneShapes(ctx, f); else if (name === 'release') sceneRelease(ctx, f); else if (name === 'star') sceneStar(ctx, f); else if (name === 'feed') sceneFeed(ctx, f); else if (name === 'money') sceneMoney(ctx, f); else if (name === 'board') sceneBoard(ctx, f); else if (name === 'graph') sceneGraph(ctx, f); else if (name === 'wrapped') sceneWrapped(ctx, f); else sceneEnd(ctx, f);
}
// transitions: the incoming scene dissolves in through 8x8 dither cells
function render(ctx, t) {
  t = Math.max(0, Math.min(FRAMES - 0.01, t));   // blur samples can step just outside the cut
  const live = SC.filter(([, a, b]) => t >= a && t < b);
  const [n0, a0, b0] = live[0];
  drawScene(ctx, n0, t - a0, b0 - a0);
  if (live[1]) {
    const [n1, a1, b1] = live[1];
    const u = clamp((t - a1) / (b0 - a1));
    const off = require('@napi-rs/canvas').createCanvas(W, H), c2 = off.getContext('2d');
    drawScene(c2, n1, t - a1, b1 - a1);
    if (n0 === 'term' && n1 === 'fly') {
      // push into the ANSI strip until it becomes the landscape
      const e = E.inCubic(u), cur = require('@napi-rs/canvas').createCanvas(W, H), c3 = cur.getContext('2d');
      drawScene(c3, n0, t - a0, b0 - a0);
      ctx.drawImage(off, 0, 0); ctx.save(); ctx.globalAlpha = 1 - E.inOutCubic(clamp((u - 0.35) / 0.65));
      const fx = W * 0.42, fy = 1040, k = 1 + 9 * e; ctx.translate(fx, fy); ctx.scale(k, k); ctx.translate(-fx, -fy); ctx.drawImage(cur, 0, 0); ctx.restore();
      return overlays(ctx, t);
    }
    if (n0 === 'lock' && n1 === 'now') {
      // the Live Activity card grows to fill the screen and opens onto mission control
      const e = E.inOutCubic(u), x = lerp(36, 0, e), y = lerp(1180, 0, e), w = lerp(W - 72, W, e), h = lerp(330, H, e), r = lerp(64, 0, e);
      c2.setTransform(1, 0, 0, 1, 0, 0); drawScene(c2, n1, t - a1, b1 - a1);
      ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.clip(); ctx.globalAlpha = E.inOutCubic(clamp(u * 1.6)); ctx.drawImage(off, 0, 0); ctx.restore();
      return overlays(ctx, t);
    }
    if (n0 === 'direct' && n1 === 'shapes') {
      // the film is drawn in the same place by both: the director's page falls away around it
      ctx.save(); ctx.globalAlpha = E.inOutCubic(u); ctx.drawImage(off, 0, 0); ctx.restore();
      return overlays(ctx, t);
    }
    ctx.save(); ctx.beginPath(); const c = P(3) * 4;
    for (let j = 0; j < H / c; j++) for (let i = 0; i < W / c; i++) if (BAYER(i, j) < u * 1.02) ctx.rect(i * c, j * c, c, c);
    ctx.clip(); ctx.drawImage(off, 0, 0); ctx.restore();
  }
  overlays(ctx, t);
}
function overlays(ctx, t0) {
  const t = t0 - SHIFT;
  { const g = ctx.createRadialGradient(W / 2, H * 0.45, H * 0.36, W / 2, H * 0.5, H * 0.8); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.28)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
  caption(ctx, t0, 262, 430, ['Pick your {creature.}'], { y: 1780 });
  caption(ctx, t0, 440, 612, ['Pair your {Mac.}', 'Once.'], { y: 250, scrim: false });
  // captions over the scenes
  caption(ctx, t, 470, 700, ['It reads the logs', 'your {agents} write.']);
  caption(ctx, t, 700, 890, ['Every session', 'gets a {shape.}']);
  caption(ctx, t, 930, 1100, ['Live on your', '{lock screen.}'], { y: 1060, scrim: false });
  caption(ctx, t, 1180, 1350, ['Know when an agent', '{needs you.}']);
  caption(ctx, t, 1440, 1640, ['The story of', 'every {session.}']);
  caption(ctx, t, 1680, 1850, ['A card worth', '{sharing.}']);
  // the trailer chapter, on its own clock
  caption(ctx, t0, AT.direct + 30, AT.direct + 292, ['Ask for a change.', 'It {renders} again.'], { y: 1830 });
  caption(ctx, t0, AT.shapes + 22, AT.shapes + 214, ['Cut for every {feed.}'], { y: 1830 });
  caption(ctx, t0, AT.release + 78, AT.release + 176, ['Your Mac drafts it.', 'You {publish.}'], { y: 1830 });
  caption(ctx, t0, AT.star + 22, AT.star + 214, ['Star a project.', 'Hear every {release.}'], { y: 1830 });
  caption(ctx, t, 1860 + D, 2030 + D, ['Post it.', 'Get {kudos.}']);
  caption(ctx, t, 2040 + D, 2200 + D, ['Your faction,', 'ranked by {hours.}']);
  caption(ctx, t, 2250 + D, 2420 + D, ['Streaks, records,', 'your {whole year.}']);
  caption(ctx, t, 2440 + D, 2610 + D, ['What the tokens', '{would cost.}'], { y: 1830 });
  // pushes
  banner(ctx, E.back(seg(t, 1120, 1146)) * (1 - E.inCubic(seg(t, 1250, 1270))), 'lantern needs you', 'Waiting on you for four minutes');
  banner(ctx, E.back(seg(t, 1356, 1380)) * (1 - E.inCubic(seg(t, 1440, 1460))), 'Session finished: 5h 17m in tramline', '+2,101 lines · 52 prompts');
}
function mbAt(t, n) { return (t > 820 && t < 1260) ? Math.max(n, 6) : n; }
function cues() {
  return { beats: { total: FRAMES / 60, scenes: SC.map(([n, a]) => [n, a / 60]), pushes: [(1120 + SHIFT) / 60, (1356 + SHIFT) / 60, (AT.release + 12) / 60, (AT.star + 12) / 60] } };
}
module.exports = { W, H, FRAMES, render, init, mbAt, cues, CUTS: [0, 1060, 2040, 3060, FRAMES] };

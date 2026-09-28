'use strict';
// Frame harness: subframe motion blur (linear-light accumulation), post FX, previews, chunk encode.
//   node render.js png 0,30,60 [--mb 8]
//   node render.js sheet 0:120:10 [--mb 1] [--cols 6] [--scale 0.25] [--name sheet]
//   node render.js chunk 0 150 out/chunk0.mkv [--mb 8]
const { createCanvas } = require('@napi-rs/canvas');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const reel = require(process.env.REEL ? require('path').resolve(process.env.REEL) : './builda');

const W = reel.W, H = reel.H, N = W * H;
const FFMPEG = require('./lib/ffmpeg')();
const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');

const toLin = new Float32Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; toLin[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
const LUTN = 16384, toSrgb = new Uint8Array(LUTN + 1);
for (let i = 0; i <= LUTN; i++) { const l = i / LUTN; const c = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055; toSrgb[i] = Math.max(0, Math.min(255, Math.round(c * 255))); }

// subtle optical vignette, precomputed
const vig = new Float32Array(N);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const dx = (x - W / 2) / (W / 2), dy = (y - H / 2) / (H / 2);
  const r2 = dx * dx * 0.9 + dy * dy * 0.55;
  vig[y * W + x] = 1 - 0.13 * Math.pow(r2 / 1.45, 1.6);
}

const acc = new Float32Array(N * 3);
const out = Buffer.alloc(N * 3);
const tmp = Buffer.alloc(N * 3);

function draw(f) {
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  reel.render(ctx, f);
  ctx.restore();
  return canvas.data();
}
function addAcc(buf) { for (let i = 0, j = 0; i < N * 4; i += 4, j += 3) { acc[j] += toLin[buf[i]]; acc[j + 1] += toLin[buf[i + 1]]; acc[j + 2] += toLin[buf[i + 2]]; } }
function copyRGB(buf) { for (let i = 0, j = 0; i < N * 4; i += 4, j += 3) { out[j] = buf[i]; out[j + 1] = buf[i + 1]; out[j + 2] = buf[i + 2]; } }

function frame(f, nmb, shutter = 0.5) {
  const mb = reel.mbAt ? reel.mbAt(f, nmb) : nmb;
  if (mb <= 1) copyRGB(draw(f));
  else {
    const ts = Array.from({ length: mb }, (_, k) => f + ((k + 0.5) / mb - 0.5) * shutter);
    const first = Buffer.from(draw(ts[0]));
    const last = draw(ts[mb - 1]);
    if (first.equals(last)) copyRGB(last);
    else {
      acc.fill(0); addAcc(first); addAcc(last);
      for (let k = 1; k < mb - 1; k++) addAcc(draw(ts[k]));
      const k = LUTN / mb;
      for (let j = 0; j < N * 3; j++) { const v = acc[j] * k; out[j] = toSrgb[v >= LUTN ? LUTN : v | 0]; }
    }
  }
  post(f);
  return out;
}

function post(f) {
  const fx = reel.post ? reel.post(f) : {};
  const ca = fx.ca || 0;
  if (ca > 0.05) { // radial chromatic aberration: R pushed out, B pulled in
    out.copy(tmp);
    const cx = W / 2, cy = H / 2, kr = ca / 900, kb = -ca / 900;
    for (let y = 0; y < H; y++) {
      const dy = y - cy;
      const yr = Math.round(cy + dy * (1 + kr)), yb = Math.round(cy + dy * (1 + kb));
      const yrc = yr < 0 ? 0 : yr >= H ? H - 1 : yr, ybc = yb < 0 ? 0 : yb >= H ? H - 1 : yb;
      for (let x = 0; x < W; x++) {
        const dx = x - cx;
        let xr = Math.round(cx + dx * (1 + kr)), xb = Math.round(cx + dx * (1 + kb));
        xr = xr < 0 ? 0 : xr >= W ? W - 1 : xr; xb = xb < 0 ? 0 : xb >= W ? W - 1 : xb;
        const o = (y * W + x) * 3;
        out[o] = tmp[(yrc * W + xr) * 3];
        out[o + 2] = tmp[(ybc * W + xb) * 3 + 2];
      }
    }
  }
  for (let p = 0, j = 0; p < N; p++, j += 3) { const v = vig[p]; out[j] = out[j] * v; out[j + 1] = out[j + 1] * v; out[j + 2] = out[j + 2] * v; }
}

function toCanvas(buf) {
  const c = createCanvas(W, H), x = c.getContext('2d');
  const img = x.createImageData(W, H);
  for (let p = 0, j = 0, i = 0; p < N; p++, j += 3, i += 4) { img.data[i] = buf[j]; img.data[i + 1] = buf[j + 1]; img.data[i + 2] = buf[j + 2]; img.data[i + 3] = 255; }
  x.putImageData(img, 0, 0);
  return c;
}

function arg(name, def) { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; }

async function main() {
  if (reel.init) await reel.init();
  const mode = process.argv[2];
  const mb = +arg('mb', mode === 'chunk' ? 8 : 1);
  const outDir = path.join(__dirname, 'out');
  if (mode === 'png') {
    for (const f of process.argv[3].split(',').map(Number)) {
      const c = toCanvas(frame(f, mb));
      fs.writeFileSync(path.join(outDir, `f_${String(f).padStart(4, '0')}.png`), c.toBuffer('image/png'));
    }
  } else if (mode === 'sheet') {
    const [a, b, s] = process.argv[3].split(':').map(Number);
    const frames = []; for (let f = a; f <= b; f += s) frames.push(f);
    const cols = +arg('cols', 6), sc = +arg('scale', 0.25);
    const tw = Math.round(W * sc), th = Math.round(H * sc), rows = Math.ceil(frames.length / cols);
    const sheet = createCanvas(cols * (tw + 6) + 6, rows * (th + 30) + 6), sx = sheet.getContext('2d');
    sx.fillStyle = '#444'; sx.fillRect(0, 0, sheet.width, sheet.height);
    frames.forEach((f, i) => {
      const c = toCanvas(frame(f, mb));
      const x = 6 + (i % cols) * (tw + 6), y = 6 + Math.floor(i / cols) * (th + 30);
      sx.drawImage(c, x, y, tw, th);
      sx.fillStyle = '#fff'; sx.font = '18px DejaVu Sans'; sx.fillText('f' + f, x + 4, y + th + 20);
    });
    fs.writeFileSync(path.join(outDir, (arg('name', 'sheet')) + '.png'), sheet.toBuffer('image/png'));
  } else if (mode === 'chunk') {
    const a = +process.argv[3], b = +process.argv[4], file = process.argv[5];
    const ff = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-r', '60', '-i', '-', '-c:v', 'ffv1', '-level', '3', '-pix_fmt', 'gbrp', file], { stdio: ['pipe', 'inherit', 'inherit'] });
    const t0 = Date.now();
    for (let f = a; f < b; f++) {
      const buf = frame(f, mb);
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
      if ((f - a) % 10 === 0) process.stderr.write(`[${a}-${b}] f${f} ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
    }
    ff.stdin.end();
    await new Promise(r => ff.on('close', r));
  }
}
main().catch(e => { console.error(e); process.exit(1); });

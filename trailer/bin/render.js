#!/usr/bin/env node
'use strict';
/**
 * Render a trailer.
 *
 *   node trailer/bin/render.js --facts F --cut C --out DIR [--formats vertical,feed,landscape,square]
 *        [--workers N] [--blur 4] [--no-audio] [--gif] [--scale 0.5]
 *   node trailer/bin/render.js frames --facts F --cut C --format vertical --at 0,1.5,6 --out DIR
 *   node trailer/bin/render.js sheet  --facts F --cut C --format vertical --every 0.5 --out FILE.png
 *
 * A render writes, per format, `trailer-<format>.mp4` (H.264 High, yuv420p, BT.709, +faststart,
 * AAC at -14 LUFS), `poster-<format>.jpg`, and `render.json` (what was made and how long it took).
 * With --gif, `trailer.gif` from the square format at the device table's loop size and rate.
 *
 * Frames are split across workers (child processes of this file) by range; each draws its range
 * with motion blur (sub frame samples averaged in linear light, the shutter half the frame) into a
 * lossless FFV1 file, and the pieces are joined and encoded once. Every frame is a pure function of
 * its time, so a range drawn by any worker is the same pixels.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { createCanvas } = require('@napi-rs/canvas');

const house = require('../src/house');
const { buildEnv } = require('../src/env');
const { Composer } = require('../src/compose');
const { ffmpeg } = require('../src/media');

const argv = process.argv.slice(2);
const mode = ['frames', 'sheet', 'worker'].includes(argv[0]) ? argv.shift() : 'render';
const arg = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : d;
};
const flag = (n) => argv.includes(`--${n}`);

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// Linear light accumulation, so a blurred edge between two colours is the colour light would make.
const toLin = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  toLin[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
const LUT = 16384;
const toSrgb = new Uint8Array(LUT + 1);
for (let i = 0; i <= LUT; i++) {
  const l = i / LUT;
  const c = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
  toSrgb[i] = Math.max(0, Math.min(255, Math.round(c * 255)));
}

async function frameRGB(comp, ctx, canvas, f, fps, blur, acc, out) {
  const N = canvas.width * canvas.height;
  if (blur <= 1) {
    await comp.prepare(f / fps);
    comp.draw(ctx, f / fps);
    const d = canvas.data();
    for (let i = 0, j = 0; i < N * 4; i += 4, j += 3) {
      out[j] = d[i];
      out[j + 1] = d[i + 1];
      out[j + 2] = d[i + 2];
    }
    return out;
  }
  acc.fill(0);
  let first = null;
  let same = true;
  for (let k = 0; k < blur; k++) {
    const t = (f + ((k + 0.5) / blur - 0.5) * 0.5) / fps;
    await comp.prepare(Math.max(0, t));
    comp.draw(ctx, Math.max(0, t));
    const d = canvas.data();
    if (k === 0) first = Buffer.from(d);
    else if (same && !first.equals(d)) same = false;
    for (let i = 0, j = 0; i < N * 4; i += 4, j += 3) {
      acc[j] += toLin[d[i]];
      acc[j + 1] += toLin[d[i + 1]];
      acc[j + 2] += toLin[d[i + 2]];
    }
  }
  if (same) {
    for (let i = 0, j = 0; i < N * 4; i += 4, j += 3) {
      out[j] = first[i];
      out[j + 1] = first[i + 1];
      out[j + 2] = first[i + 2];
    }
    return out;
  }
  const s = LUT / blur;
  for (let j = 0; j < N * 3; j++) {
    const v = acc[j] * s;
    out[j] = toSrgb[v >= LUT ? LUT : v | 0];
  }
  return out;
}

async function setup(format) {
  const facts = readJson(arg('facts'));
  const cut = readJson(arg('cut'));
  const work = arg('work', path.join(path.dirname(path.resolve(arg('out', '.'))), 'trailer-work'));
  fs.mkdirSync(work, { recursive: true });
  const env = await buildEnv({ facts, cut, format, work, scale: Number(arg('scale', '1')) });
  const canvas = createCanvas(env.lay.W, env.lay.H);
  const ctx = canvas.getContext('2d');
  return { env, canvas, ctx, comp: new Composer(env) };
}

async function worker() {
  const format = arg('format');
  const a = Number(arg('from')), b = Number(arg('to'));
  const file = arg('file');
  const blur = Number(arg('blur', '4'));
  const { env, canvas, ctx, comp } = await setup(format);
  const W = env.lay.W, H = env.lay.H;
  const ff = spawn(ffmpeg(), ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-r', String(env.fps), '-i', '-', '-c:v', 'ffv1', '-level', '3', '-pix_fmt', 'gbrp', file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const acc = new Float32Array(W * H * 3);
  const out = Buffer.alloc(W * H * 3);
  for (let f = a; f < b; f++) {
    const buf = await frameRGB(comp, ctx, canvas, f, env.fps, blur, acc, out);
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
}

async function frames() {
  const format = arg('format', 'vertical');
  const out = arg('out');
  fs.mkdirSync(out, { recursive: true });
  const { env, canvas, ctx, comp } = await setup(format);
  const blur = Number(arg('blur', '1'));
  const acc = new Float32Array(env.lay.W * env.lay.H * 3);
  const rgb = Buffer.alloc(env.lay.W * env.lay.H * 3);
  for (const s of arg('at', '0').split(',').map(Number)) {
    const f = Math.round(s * env.fps);
    const t0 = Date.now();
    await frameRGB(comp, ctx, canvas, f, env.fps, blur, acc, rgb);
    const c = createCanvas(env.lay.W, env.lay.H);
    const x = c.getContext('2d');
    const img = x.createImageData(env.lay.W, env.lay.H);
    for (let p = 0, j = 0, i = 0; p < env.lay.W * env.lay.H; p++, j += 3, i += 4) {
      img.data[i] = rgb[j];
      img.data[i + 1] = rgb[j + 1];
      img.data[i + 2] = rgb[j + 2];
      img.data[i + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    const file = path.join(out, `${format}-${s.toFixed(2)}.png`);
    fs.writeFileSync(file, c.toBuffer('image/png'));
    process.stderr.write(`${file} ${Date.now() - t0} ms\n`);
  }
}

async function sheet() {
  const format = arg('format', 'vertical');
  const every = Number(arg('every', '0.5'));
  const { env, canvas, ctx, comp } = await setup(format);
  const times = [];
  for (let t = 0; t <= env.tl.seconds - 0.01; t += every) times.push(t);
  const cols = Number(arg('cols', format === 'landscape' ? '5' : '8'));
  const scale = Number(arg('scale', String(format === 'landscape' ? 0.16 : 0.14)));
  const tw = Math.round(env.lay.W * scale), th = Math.round(env.lay.H * scale);
  const rows = Math.ceil(times.length / cols);
  const sh = createCanvas(cols * (tw + 8) + 8, rows * (th + 30) + 8);
  const sx = sh.getContext('2d');
  sx.fillStyle = '#2a2a2a';
  sx.fillRect(0, 0, sh.width, sh.height);
  for (let i = 0; i < times.length; i++) {
    await comp.prepare(times[i]);
    comp.draw(ctx, times[i]);
    const x = 8 + (i % cols) * (tw + 8), y = 8 + Math.floor(i / cols) * (th + 30);
    sx.drawImage(canvas, x, y, tw, th);
    sx.fillStyle = '#ddd';
    sx.font = '16px Inter';
    sx.fillText(`${times[i].toFixed(1)}s`, x + 2, y + th + 20);
  }
  fs.writeFileSync(arg('out'), sh.toBuffer('image/png'));
}

function run(cmd, args, opts = {}) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'], ...opts });
    p.on('close', (c) => (c === 0 ? res() : rej(new Error(`${path.basename(cmd)} exited ${c}`))));
  });
}

async function render() {
  const t0 = Date.now();
  const out = path.resolve(arg('out'));
  fs.mkdirSync(out, { recursive: true });
  const work = path.join(out, 'work');
  fs.mkdirSync(work, { recursive: true });
  const formats = arg('formats', house.devices.formats.map((f) => f.id).join(',')).split(',');
  const workers = Number(arg('workers', String(Math.max(2, Math.min(8, os.cpus().length)))));
  const blur = arg('blur', '4');
  const facts = readJson(arg('facts'));
  const cut = readJson(arg('cut'));
  const { timeline } = require('../src/timeline');
  const tl = timeline(cut, facts);
  const made = [];
  // The score first (it is the same for every format), then each format's frames.
  const audio = path.join(work, 'score.wav');
  const wantAudio = !flag('no-audio') && cut.mood !== 'none';
  if (wantAudio) require('../src/score').writeScore(tl, cut, audio);
  // Decode the recording once before the workers start, so they do not race to decode it.
  if (facts.demo?.video) {
    const { buildEnv } = require('../src/env');
    await buildEnv({ facts, cut, format: formats[0], work });
  }
  for (const format of formats) {
    const f0 = Date.now();
    const n = tl.frames;
    const per = Math.ceil(n / workers);
    const jobs = [];
    const parts = [];
    for (let k = 0; k < workers; k++) {
      const a = k * per, b = Math.min(n, (k + 1) * per);
      if (a >= b) continue;
      const file = path.join(work, `${format}-${k}.mkv`);
      parts.push(file);
      jobs.push(run(process.execPath, [__filename, 'worker', '--facts', arg('facts'), '--cut', arg('cut'), '--work', work, '--format', format, '--from', String(a), '--to', String(b), '--file', file, '--blur', blur, '--scale', arg('scale', '1')]));
    }
    await Promise.all(jobs);
    const list = path.join(work, `${format}.txt`);
    fs.writeFileSync(list, parts.map((p) => `file '${p}'`).join('\n') + '\n');
    const mp4 = path.join(out, `trailer-${format}.mp4`);
    const a = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list];
    if (wantAudio) a.push('-i', audio);
    else a.push('-f', 'lavfi', '-t', String(tl.seconds), '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
    a.push('-map', '0:v', '-map', '1:a',
      '-vf', 'scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv420p',
      '-c:v', 'libx264', '-preset', arg('preset', 'slow'), '-crf', arg('crf', '19'), '-profile:v', 'high', '-level:v', '4.2',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      '-r', String(tl.fps), '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-t', String(tl.seconds), '-movflags', '+faststart', mp4);
    if (wantAudio) {
      const af = loudnorm(audio);
      a.splice(a.indexOf('-c:a'), 0, '-af', af);
    }
    await run(ffmpeg(), a);
    // The poster: the end card settled, which says what the thing is and whose.
    const poster = path.join(out, `poster-${format}.jpg`);
    const pt = Math.max(0, tl.seconds - 0.35);
    spawnSync(ffmpeg(), ['-y', '-v', 'error', '-ss', String(pt), '-i', mp4, '-frames:v', '1', '-q:v', '2', poster]);
    made.push({ format, file: path.basename(mp4), poster: path.basename(poster), bytes: fs.statSync(mp4).size, seconds: tl.seconds, ms: Date.now() - f0 });
    process.stderr.write(`${format}: ${mp4} in ${((Date.now() - f0) / 1000).toFixed(1)} s\n`);
  }
  if (flag('gif') && formats.includes('square')) {
    const loop = house.devices.loop;
    const gif = path.join(out, 'trailer.gif');
    for (const [fps, size] of [[loop.fps, loop.size[0]], [10, 480], [8, 400]]) {
      spawnSync(ffmpeg(), ['-y', '-v', 'error', '-i', path.join(out, 'trailer-square.mp4'), '-vf', `fps=${fps},scale=${size}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3`, gif]);
      if (fs.existsSync(gif) && fs.statSync(gif).size <= loop.max_bytes) break;
    }
    if (fs.existsSync(gif)) made.push({ format: 'loop', file: 'trailer.gif', bytes: fs.statSync(gif).size });
  }
  fs.writeFileSync(path.join(out, 'render.json'), JSON.stringify({ version: house.spec.version, cut: cut.version, seconds: tl.seconds, fps: tl.fps, made, ms: Date.now() - t0 }, null, 2));
  if (!flag('keep-work')) fs.rmSync(work, { recursive: true, force: true });
}

function loudnorm(wav) {
  const r = spawnSync(ffmpeg(), ['-hide_banner', '-i', wav, '-af', 'loudnorm=I=-14:TP=-1.0:LRA=11:print_format=json', '-f', 'null', '-'], { encoding: 'utf8' });
  const log = r.stderr;
  const j = JSON.parse(log.slice(log.lastIndexOf('{'), log.lastIndexOf('}') + 1));
  if (!isFinite(Number(j.input_i))) return 'aresample=48000';
  return `loudnorm=I=-14:TP=-1.0:LRA=11:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true,aresample=48000`;
}

const main = { frames, sheet, worker, render }[mode];
main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});

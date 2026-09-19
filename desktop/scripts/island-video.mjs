#!/usr/bin/env node
/**
 * The island's recording, encoded: the frames a capture run wrote (`BUILDA_CAPTURE`,
 * `src/capture.js`: `island-frames/<n>-<ms>.png`, transparent) played at their own timestamps
 * over a stand-in for the top of a screen, as an MP4 and a contact sheet.
 *
 *   node scripts/island-video.mjs <capture dir> <out dir> [--notch 200x37] [--scale 2]
 *
 * The backdrop is drawn, not captured (an unattended run cannot record the screen): a warm dark
 * ground and, with --notch, the notch itself in black at the top centre, so the pill can be seen
 * growing out of it. Needs ffmpeg on PATH.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [capArg, outArg] = process.argv.slice(2);
const capDir = capArg && path.resolve(capArg);
const outDir = outArg && path.resolve(outArg);
if (!capDir || !outDir) {
  console.error('usage: island-video.mjs <capture dir> <out dir> [--notch WxH] [--scale N]');
  process.exit(2);
}
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
};
const scale = Number(arg('--scale') ?? 2);
const notch = arg('--notch')?.split('x').map(Number) ?? null;

const framesDir = path.join(capDir, 'island-frames');
const frames = fs
  .readdirSync(framesDir)
  .filter((f) => /^\d+-\d+\.png$/.test(f))
  .map((f) => ({ f, t: Number(f.split('-')[1].replace('.png', '')) }))
  .sort((a, b) => a.t - b.t);
if (frames.length < 2) {
  console.error('no frames');
  process.exit(1);
}

// Each frame shows until the next one arrived: the recording plays at the speed it happened.
fs.mkdirSync(outDir, { recursive: true });
const list = path.join(outDir, 'frames.txt');
const lines = [];
frames.forEach((fr, i) => {
  const next = frames[i + 1]?.t ?? fr.t + 33;
  lines.push(`file '${path.join(framesDir, fr.f)}'`, `duration ${((next - fr.t) / 1000).toFixed(4)}`);
});
lines.push(`file '${path.join(framesDir, frames[frames.length - 1].f)}'`);
fs.writeFileSync(list, lines.join('\n'));

const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path.join(framesDir, frames[0].f)], { encoding: 'utf8' });
const [w, h] = probe.stdout.trim().split(',').map(Number);
const ground = '0x1d1b19';
const notchBox = notch ? `,drawbox=x=${(w - notch[0] * scale) / 2}:y=0:w=${notch[0] * scale}:h=${notch[1] * scale}:color=black:t=fill` : '';
const filter = `color=c=${ground}:s=${w}x${h}:r=60${notchBox}[bg];[bg][0:v]overlay=shortest=1:format=auto,format=yuv420p`;
const mp4 = path.join(outDir, 'island-expand.mp4');
const enc = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-filter_complex', filter, '-r', '60', '-c:v', 'libx264', '-crf', '18', '-movflags', '+faststart', mp4], { stdio: 'inherit' });
if (enc.status !== 0) process.exit(enc.status ?? 1);

// A contact sheet: twelve moments across the recording.
const sheet = path.join(outDir, 'island-expand-sheet.png');
spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', mp4, '-vf', `fps=${(12 / ((frames.at(-1).t - frames[0].t) / 1000)).toFixed(3)},scale=${w / 2}:-1,tile=3x4:padding=6:color=black`, '-frames:v', '1', sheet], { stdio: 'inherit' });
fs.rmSync(list);
console.log(`${mp4}\n${sheet}\n${frames.length} frames over ${frames.at(-1).t - frames[0].t} ms`);

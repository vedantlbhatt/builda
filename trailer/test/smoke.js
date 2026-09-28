#!/usr/bin/env node
'use strict';
/**
 * A trailer rendered end to end at a quarter of its size: a synthetic recording (ffmpeg's test
 * pattern at the default phone's pixels), every scene kind, both transitions, the score, two
 * formats and the GIF. Checks each file exists, is the format's shape, and runs the cut's length.
 * CI's trailer job runs it; a machine with ffmpeg runs it with `node trailer/test/smoke.js`.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const house = require('../src/house');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trailer-smoke-'));
const row = house.device(house.devices.default_phone);
const video = path.join(dir, 'demo.mp4');
const ff = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=${row.pixels[0] / 3}x${row.pixels[1] / 3}:rate=30`, '-t', '6', '-pix_fmt', 'yuv420p', video]);
if (ff.status !== 0) throw new Error(`ffmpeg: ${ff.stderr}`);
const facts = {
  version: 1,
  project_key: 'cd'.repeat(32),
  demo: {
    device: row.id,
    video,
    stills: [],
    beats: [
      { start: 0, end: 3, tap: [0.5, 0.4], change: 1.5, label: 'the first screen' },
      { start: 3, end: 6, tap: null, change: null, label: 'the second screen' },
    ],
  },
  numbers: {
    commits: { value: 42, text: '42', unit: 'commits' },
    days_built: { value: 9, text: '9', unit: 'days built' },
    commits_since: { value: 3, text: '3', unit: 'commits since the last demo' },
  },
  days: { levels: Array.from({ length: 28 }, (_, i) => (i * 7) % 6), since: 'since sep 1' },
  changelog: ['Add the first screen', 'Make the second screen faster', 'Fix the third thing'],
  languages: [{ name: 'TypeScript', share: 0.7 }, { name: 'Python', share: 0.3 }],
};
const cut = {
  version: 1, seconds: 12, pace: 1.2, hue: 'iris', creature: 'octopus', mood: 'drive', transition: 'morph',
  title: { text: 'Smoke Test', source: 'person' }, line: { text: 'every scene, once', source: 'person' }, cta: { text: 'nowhere yet', source: 'person' },
  scenes: [
    { kind: 'open', weight: 1, arrival: 'ripple' },
    { kind: 'screens', weight: 2, arrival: 'scan', camera: 'lean', beats: [0, 1] },
    { kind: 'figure', weight: 1, arrival: 'rise', figure: 'commits' },
    { kind: 'days', weight: 1, arrival: 'wipe' },
    { kind: 'changelog', weight: 1, arrival: 'scan' },
    { kind: 'stack', weight: 0.8, arrival: 'blocks' },
    { kind: 'end', weight: 1, arrival: 'spiral' },
  ],
};
fs.writeFileSync(path.join(dir, 'facts.json'), JSON.stringify(facts));
fs.writeFileSync(path.join(dir, 'cut.json'), JSON.stringify(cut));
const out = path.join(dir, 'out');
const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'render.js'), '--facts', path.join(dir, 'facts.json'), '--cut', path.join(dir, 'cut.json'), '--out', out, '--formats', 'vertical,square', '--scale', '0.25', '--blur', '1', '--workers', '2', '--preset', 'veryfast', '--gif'], { stdio: 'inherit' });
if (r.status !== 0) throw new Error('render failed');
for (const [f, w, h] of [['vertical', 270, 480], ['square', 270, 270]]) {
  const p = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', path.join(out, `trailer-${f}.mp4`)], { encoding: 'utf8' });
  const j = JSON.parse(p.stdout);
  const v = j.streams.find((s) => s.codec_type === 'video');
  if (v.width !== w || v.height !== h) throw new Error(`${f}: ${v.width}x${v.height}, not ${w}x${h}`);
  if (!j.streams.some((s) => s.codec_type === 'audio')) throw new Error(`${f}: no audio track`);
  const d = Number(j.format.duration);
  if (Math.abs(d - cut.seconds) > 0.2) throw new Error(`${f}: ${d} s, not ${cut.seconds}`);
  if (!fs.existsSync(path.join(out, `poster-${f}.jpg`))) throw new Error(`${f}: no poster`);
}
if (!fs.existsSync(path.join(out, 'trailer.gif'))) throw new Error('no GIF');
console.log(`smoke: ok (${out})`);

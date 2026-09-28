'use strict';
// Full build: cue sheet -> score -> 4 parallel motion-blurred chunks -> mastered H.264 + AAC.
//   node run.js [--mb 8] [--out out/reel.mp4] [--frames 600]
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const FF = require('./lib/ffmpeg')();
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const MB = arg('mb', '8'), CRF = arg('crf', '16'), GRAIN = arg('grain', '5'), OUT = arg('out', 'out/builda.mp4'), REEL = arg('reel', './builda'), AUDIO = arg('audio', 'audio.py'), WORKERS = 4;
const dir = __dirname, tmp = path.join(dir, 'out', 'build');
fs.mkdirSync(tmp, { recursive: true });
const run = (cmd, args, opts = {}) => new Promise((res, rej) => {
  const p = spawn(cmd, args, { cwd: dir, stdio: ['ignore', 'inherit', 'inherit'], ...opts });
  p.on('close', c => (c === 0 ? res() : rej(new Error(`${cmd} exited ${c}`))));
});

(async () => {
  const t0 = Date.now();
  process.env.REEL = REEL;
  const reel = require(path.resolve(dir, REEL));
  const FRAMES = +arg('frames', reel.FRAMES || 600);
  fs.writeFileSync(path.join(dir, 'cues.json'), JSON.stringify(reel.cues()));
  const MUX_ONLY = process.argv.includes('--mux-only');   // chunks and audio already on disk
  const audio = MUX_ONLY ? Promise.resolve() : run('python3', [AUDIO, path.join(tmp, 'audio_raw.wav')]);
  // balance chunks: later chapters are heavier (particles), so split unevenly
  const cuts = reel.CUTS || [0, 170, 300, 440, FRAMES].map(x => Math.min(x, FRAMES));
  const jobs = [];
  for (let k = 0; k < WORKERS; k++) {
    if (cuts[k] >= cuts[k + 1]) continue;
    if (MUX_ONLY) { jobs.push(Promise.resolve()); continue; }
    jobs.push(run('node', ['render.js', 'chunk', String(cuts[k]), String(cuts[k + 1]), path.join(tmp, `chunk${k}.mkv`), '--mb', MB], { stdio: ['ignore', 'ignore', 'inherit'] }));
  }
  await Promise.all([audio, ...jobs]);
  console.log(`rendered in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  fs.writeFileSync(path.join(tmp, 'list.txt'), jobs.map((_, k) => `file 'chunk${k}.mkv'`).join('\n') + '\n');
  // loudness: two-pass EBU R128 to -14 LUFS / -1 dBTP (streaming/social standard)
  const res = spawn(FF, ['-hide_banner', '-i', path.join(tmp, 'audio_raw.wav'), '-af', 'loudnorm=I=-14:TP=-1.0:LRA=11:print_format=json', '-f', 'null', '-']);
  let log = ''; res.stderr.on('data', d => (log += d));
  await new Promise(r => res.on('close', r));
  const j = JSON.parse(log.slice(log.lastIndexOf('{'), log.lastIndexOf('}') + 1));
  console.log('loudness in', j.input_i, 'LUFS, tp', j.input_tp);
  const af = `loudnorm=I=-14:TP=-1.0:LRA=11:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true,aresample=48000`;
  await run(FF, ['-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'concat', '-safe', '0', '-i', path.join(tmp, 'list.txt'), '-i', path.join(tmp, 'audio_raw.wav'),
    '-map', '0:v', '-map', '1:a',
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv420p,noise=c0s=' + GRAIN + ':c0f=t+u',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', CRF, '-profile:v', 'high', '-level:v', '4.2', '-x264-params', 'aq-mode=3',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-r', '60', '-af', af, '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-t', String(FRAMES / 60),
    '-movflags', '+faststart', OUT]);
  console.log(`done ${OUT} in ${((Date.now() - t0) / 1000).toFixed(0)}s, ${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB`);
})().catch(e => { console.error(e); process.exit(1); });

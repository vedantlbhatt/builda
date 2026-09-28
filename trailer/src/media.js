'use strict';
/**
 * The demo's pictures, ready to draw.
 *
 * The recording is decoded ONCE, by ffmpeg, into numbered JPEG frames beside the render
 * (`work/frames/`), at its own frame rate and never above the size the largest format draws it at;
 * every worker then reads the frame nearest the time it needs through a small cache. Decoding per
 * frame per worker would decode the same video eight times over.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { loadImage } = require('@napi-rs/canvas');

function ffmpeg() {
  return process.env.BUILDER_FFMPEG || 'ffmpeg';
}

function probe(file) {
  const r = spawnSync(process.env.BUILDER_FFPROBE || 'ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate,duration', '-of', 'json', file], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffprobe could not read ${file}: ${r.stderr}`);
  const s = JSON.parse(r.stdout).streams[0];
  const [n, d] = s.r_frame_rate.split('/').map(Number);
  return { width: s.width, height: s.height, fps: n / (d || 1), duration: Number(s.duration) };
}

/** Decode `video` into `dir` (idempotent): frames at the source rate, capped at 60, `maxH` tall at most. */
function extract(video, dir, maxH = 1600) {
  const meta = probe(video);
  const fps = Math.min(60, Math.round(meta.fps));
  const done = path.join(dir, 'frames.json');
  if (fs.existsSync(done)) {
    const m = JSON.parse(fs.readFileSync(done, 'utf8'));
    if (m.video === path.resolve(video) && m.mtime === fs.statSync(video).mtimeMs) return m;
  }
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.jpg')) fs.unlinkSync(path.join(dir, f));
  const h = Math.min(maxH, meta.height - (meta.height % 2));
  const r = spawnSync(ffmpeg(), ['-v', 'error', '-y', '-i', video, '-vf', `fps=${fps},scale=-2:${h}:flags=lanczos`, '-q:v', '3', path.join(dir, 'f%05d.jpg')], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg could not decode ${video}: ${r.stderr}`);
  const count = fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')).length;
  const m = { video: path.resolve(video), mtime: fs.statSync(video).mtimeMs, fps, count, width: meta.width, height: meta.height, duration: meta.duration };
  fs.writeFileSync(done, JSON.stringify(m));
  return m;
}

/** A reader over extracted frames: `at(seconds)` resolves to the nearest decoded frame. */
class Frames {
  constructor(dir, meta, keep = 16) {
    this.dir = dir;
    this.meta = meta;
    this.keep = keep;
    this.cache = new Map();
  }
  indexAt(t) {
    return Math.max(1, Math.min(this.meta.count, Math.round(t * this.meta.fps) + 1));
  }
  async at(t) {
    return this.load(this.indexAt(t));
  }
  async load(k) {
    if (this.cache.has(k)) {
      const img = this.cache.get(k);
      this.cache.delete(k);
      this.cache.set(k, img);
      return img;
    }
    const img = await loadImage(fs.readFileSync(path.join(this.dir, `f${String(k).padStart(5, '0')}.jpg`)));
    this.cache.set(k, img);
    while (this.cache.size > this.keep) this.cache.delete(this.cache.keys().next().value);
    return img;
  }
}

async function loadStill(file) {
  return loadImage(fs.readFileSync(file));
}

module.exports = { ffmpeg, probe, extract, Frames, loadStill };

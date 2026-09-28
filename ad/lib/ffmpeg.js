'use strict';
// Locate an ffmpeg with libx264: $FFMPEG, else the static build shipped by the imageio-ffmpeg pip package, else PATH.
const { execFileSync } = require('child_process');
let cached;
module.exports = function ffmpeg() {
  if (cached) return cached;
  if (process.env.FFMPEG) return (cached = process.env.FFMPEG);
  try {
    cached = execFileSync('python3', ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (cached) return cached;
  } catch { /* fall through */ }
  return (cached = 'ffmpeg');
};

'use strict';
/**
 * Everything a frame needs, for one format: the layout, the clock, the hue, the pictures.
 *
 * `facts.json` is written by the Mac (capture/trailer/facts.py) and holds only what the project
 * gave: its title (a public name, or words its owner typed), the demo's recording and stills with
 * their beats, its numbers with the words each is said with, its days, its commits since the last
 * demo. `cut.json` is the cut (spec/trailer.v1.json `Cut`). Nothing here invents a word or a number.
 */
const fs = require('fs');
const path = require('path');
const house = require('./house');
const { layout } = require('./layout');
const { timeline } = require('./timeline');
const { extract, Frames, loadStill } = require('./media');
const T = require('./type');

async function buildEnv({ facts, cut, format, work, scale = 1 }) {
  T.registerFonts();
  const fmt = house.format(format);
  // A draft or a test renders smaller; the layout is in points, so it is the same film at any size.
  if (scale !== 1) {
    fmt.w = Math.max(2, Math.round((fmt.w * scale) / 2) * 2);
    fmt.h = Math.max(2, Math.round((fmt.h * scale) / 2) * 2);
  }
  const row = facts.demo?.device ? house.device(facts.demo.device) : null;
  let stillAspect = null;
  const stills = [];
  for (const s of facts.demo?.stills ?? []) {
    if (!s.file || !fs.existsSync(s.file)) continue;
    const img = await loadStill(s.file);
    stills.push(img);
    stillAspect = stillAspect ?? img.width / img.height;
  }
  const lay = layout(fmt.w, fmt.h, row, stillAspect);
  const tl = timeline(cut, facts);
  let frames = null;
  if (facts.demo?.video && fs.existsSync(facts.demo.video)) {
    const dir = path.join(work, 'frames');
    const meta = extract(facts.demo.video, dir, Math.max(1200, Math.ceil(lay.device.h * 1.1)));
    frames = new Frames(dir, meta);
  }
  const key = facts.project_key ?? 'project';
  return {
    fmtId: fmt.id,
    lay,
    facts,
    cut,
    tl,
    fps: tl.fps,
    pace: tl.pace,
    hue: house.HUES[cut.hue],
    row,
    frames,
    stills,
    key,
    seed: house.pixelMotion.fnv(key) % 1000,
  };
}

module.exports = { buildEnv };

'use strict';
/**
 * Everything the trailer borrows from the app, read from the app's own sources and never copied:
 * the springs and their morph windows (mobile/src/motion/spec.ts), the eight pixel arrival orders
 * and four number arrivals (mobile/src/motion/pixelMotion.ts), the creatures (mobile/src/pixel),
 * the colours (design/tokens.json, the only place a colour lives), the device table and the social
 * canvases (spec/devices.v1.json), and the trailer's own spec (spec/trailer.v1.json).
 *
 * Node 22.18 and later load the TypeScript modules by stripping their types; they are pure (no
 * React Native import), so the numbers a trailer moves by are the numbers the phone moves by. A
 * change to a spring on the phone changes every trailer rendered after it, which is the point.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const motion = require(path.join(ROOT, 'mobile/src/motion/spec.ts'));
const pixelMotion = require(path.join(ROOT, 'mobile/src/motion/pixelMotion.ts'));
const animals = require(path.join(ROOT, 'mobile/src/pixel/animals.ts'));
const sprites = require(path.join(ROOT, 'mobile/src/pixel/sprites.ts'));

const tokens = readJson('design/tokens.json');
const devices = readJson('spec/devices.v1.json');
const spec = readJson('spec/trailer.v1.json');

const dark = (group) => Object.fromEntries(Object.entries(group).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [k, typeof v === 'object' && v && 'dark' in v ? v.dark : v]));

/** The dark surfaces: every trailer is on the warm near-black ground, as the app is. */
const SURFACE = dark(tokens.surface);
/** The nine identity hues: `ink` is the fill a band prints in, `partner` the dither's middle tone. */
const HUES = Object.fromEntries(
  Object.entries(tokens.spectrum.hues).map(([name, h]) => [name, { ink: h.dark, partner: h.partner }]),
);
/** Ink on any hue fill. */
const ON_HUE = tokens.surface.text.light;
/** 8x8 Bayer thresholds, the app's own matrix. */
const BAYER = tokens.dither.bayer8;
/** The crew ring a project's creature is dealt from when nobody names one (never Bit). */
const CREW = tokens.spectrum.crew.ring;

/** A creature's frames by name: Bit's states, or one of the eight animals' loops. */
function creatureFrames(name, state = 'idle') {
  if (name === 'bit') return sprites.framesFor(state);
  return animals.ANIMAL_FRAMES[name];
}

/** The hue a creature wears (design/tokens.json `spectrum.creature`). */
function creatureHue(name) {
  return tokens.spectrum.creature[name];
}

function format(id) {
  const f = devices.formats.find((x) => x.id === id);
  if (!f) throw new Error(`no format ${id} in spec/devices.v1.json`);
  return { id: f.id, w: f.size[0], h: f.size[1], label: f.label };
}

function device(id) {
  return devices.devices.find((d) => d.id === id) ?? null;
}

module.exports = {
  ROOT,
  motion,
  pixelMotion,
  animals,
  sprites,
  tokens,
  devices,
  spec,
  SURFACE,
  HUES,
  ON_HUE,
  BAYER,
  CREW,
  creatureFrames,
  creatureHue,
  format,
  device,
};

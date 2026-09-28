'use strict';
/**
 * The trailer's pure parts, held to the rules that make a render trustworthy without watching it.
 * `node --test trailer/test/` (CI's trailer job).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const house = require('../src/house');
const { layout } = require('../src/layout');
const { timeline, at, screensPlan, videoTime, MAX_SPEED, MIN_SPEED } = require('../src/timeline');
const { wipePhases, wipeCell, Fluid } = require('../src/fluid');
const { spring, morph } = require('../src/time');

const FACTS = {
  project_key: 'ab'.repeat(32),
  demo: {
    device: 'iphone-17-pro',
    video: '/nowhere/demo.mp4',
    beats: [
      { start: 0, end: 2, tap: [0.5, 0.2], change: 1.2, label: 'where to?' },
      { start: 2, end: 7, tap: [0.9, 0.8], change: 6.5, label: 'the fastest bus' },
      { start: 7, end: 9, tap: null, change: null, label: 'the stops' },
    ],
    stills: [],
  },
};
const CUT = {
  version: 1, seconds: 20, pace: 1, hue: 'tide', creature: 'fox', mood: 'quiet', transition: 'fluid',
  title: { text: 'RideGT', source: 'facts' }, line: null, cta: null,
  scenes: [
    { kind: 'open', weight: 1, arrival: 'ripple' },
    { kind: 'screens', weight: 3, arrival: 'scan', camera: 'drift', beats: null },
    { kind: 'end', weight: 1, arrival: 'spiral' },
  ],
};

test('the house is the app: the springs and orders are the phone modules themselves', () => {
  assert.deepEqual(house.motion.ISLAND, { damping: 17, stiffness: 210, mass: 1 });
  assert.equal(house.pixelMotion.PIXEL_MOTIONS.length, 8);
  assert.deepEqual(house.spec.enums.arrival, [...house.pixelMotion.PIXEL_MOTIONS]);
  // The ISLAND spring overshoots about 10% near 268 ms (docs/motion.md); the trailer's clock agrees.
  assert.ok(Math.abs(spring(0.268) - 1.103) < 0.01);
});

test('every social format lays the device out at its own row aspect, never stretched', () => {
  for (const f of house.devices.formats) {
    for (const row of house.devices.devices.filter((d) => d.family === 'iphone' || d.family === 'mac' || d.family === 'ipad')) {
      const lay = layout(f.size[0], f.size[1], row);
      const want = row.points[0] / row.points[1];
      const got = lay.device.w / lay.device.h;
      assert.ok(Math.abs(got - want) / want < 0.005 + 1 / lay.device.h, `${row.id} in ${f.id}: ${got} vs ${want}`);
      assert.ok(lay.device.x >= 0 && lay.device.y >= 0, `${row.id} in ${f.id} starts on the canvas`);
      assert.ok(lay.device.x + lay.device.w <= f.size[0] && lay.device.y + lay.device.h <= f.size[1], `${row.id} in ${f.id} ends on it`);
      assert.equal(lay.device.w % 2, 0, 'an even width');
    }
  }
});

test('a portrait canvas stacks and a wide one sits side by side', () => {
  const row = house.device('iphone-17-pro');
  assert.equal(layout(1080, 1920, row).side, false);
  assert.equal(layout(1080, 1350, row).side, false);
  assert.equal(layout(1080, 1080, row).side, true);
  assert.equal(layout(1920, 1080, row).side, true);
});

test('the timeline spends exactly the cut seconds, in order, with transitions on the boundaries', () => {
  const tl = timeline(CUT, FACTS);
  assert.equal(tl.seconds, 20);
  assert.equal(tl.frames, 600);
  assert.equal(tl.scenes[0].t0, 0);
  assert.ok(Math.abs(tl.scenes[tl.scenes.length - 1].t1 - 20) < 1e-9);
  for (let i = 1; i < tl.scenes.length; i++) {
    const s = tl.scenes[i];
    assert.ok(Math.abs(s.t0 - tl.scenes[i - 1].t1) < 1e-9, 'no gap between scenes');
    assert.ok(s.into.t0 < s.t0 && s.into.t1 > s.t0, 'a transition straddles its boundary');
  }
  // Mid transition, two scenes are on screen; well inside a scene, one.
  const s1 = tl.scenes[1];
  assert.ok(at(tl, s1.t0).to);
  assert.equal(at(tl, (s1.t0 + s1.t1) / 2).to, null);
});

test('a morph is chosen only where both sides have a container', () => {
  const tl = timeline({ ...CUT, transition: 'morph', scenes: [...CUT.scenes.slice(0, 2), { kind: 'figure', weight: 1, arrival: 'rise', figure: 'commits' }, CUT.scenes[2]] }, FACTS);
  assert.deepEqual(tl.scenes.slice(1).map((s) => s.into.kind), ['morph', 'fluid', 'fluid']);
});

test('a beat never plays faster than MAX_SPEED or slower than MIN_SPEED, and a trimmed beat keeps its tap', () => {
  const beats = FACTS.demo.beats.map((b, i) => ({ ...b, kind: 'video', pos: i }));
  for (const d of [1.5, 4, 8, 20]) {
    const plan = screensPlan(beats, d);
    for (const b of plan) {
      assert.ok(b.speed <= MAX_SPEED + 1e-9 && b.speed >= MIN_SPEED - 1e-9, `speed ${b.speed} at ${d}s`);
      assert.ok(b.v0 >= b.start - 1e-9 && b.v1 <= b.end + 1e-9, 'inside its own beat');
    }
    // The 5 s beat with its tap at 6.5: trimmed on a short scene, it still holds the tap.
    const long = plan[1];
    if (long.v1 - long.v0 < 5) assert.ok(long.v0 <= 6.5 && long.v1 >= 6.5, `tap kept at ${d}s`);
  }
  const plan = screensPlan(beats, 8);
  assert.equal(videoTime(plan, 0), plan[0].v0);
  assert.ok(videoTime(plan, 7.99) <= plan[2].v1);
});

test('an ink wipe passes every cell: all of the last scene is gone at the end, none of it at the start', () => {
  const cols = 40, rows = 70, frames = 27;
  for (const dir of [[1, 0], [0, 1], [Math.SQRT1_2, Math.SQRT1_2], [-0.3, 0.95]]) {
    const w = wipePhases({ cols, rows, dir, frames, seed: 3 });
    const end = w.phaseAt(frames), start = w.phaseAt(0);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        assert.equal(wipeCell(w.read(end, i, j), 1).revealed, 1, `cell ${i},${j} revealed at the end`);
        assert.equal(wipeCell(w.read(start, i, j), 0).revealed, 0);
        assert.equal(wipeCell(w.read(start, i, j), 0).ink, 0, 'no ink before the wipe starts');
      }
    }
    // Halfway, the ink is a thick band: most of the frame is under solid ink.
    const mid = w.phaseAt(Math.round(frames / 2));
    let covered = 0;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) covered += wipeCell(w.read(mid, i, j), 0.5).ink >= 1 ? 1 : 0;
    assert.ok(covered / (cols * rows) > 0.55, `the ink covers ${covered / (cols * rows)} mid wipe`);
  }
});

test('a projection lowers the divergence to the grid residue, and the flow is deterministic', () => {
  const run = () => {
    const f = new Fluid(24, 40);
    f.swirl(12, 20, 5, 1.5);
    f.push(0.1, 0.3);
    for (let k = 0; k < 10; k++) f.step(1);
    return f;
  };
  const a = run(), b = run();
  assert.deepEqual(Array.from(a.u), Array.from(b.u));
  const total = (f) => {
    let sum = 0;
    const W = f.nx + 2;
    for (let j = 2; j < f.ny; j++) for (let i = 2; i < f.nx; i++) {
      const k = i + W * j;
      sum += Math.abs(0.5 * (f.u[k + 1] - f.u[k - 1] + f.v[k + W] - f.v[k - W]));
    }
    return sum;
  };
  a.push(0.2, -0.1);
  a.swirl(6, 8, 4, 2);
  const before = total(a);
  a.project();
  const after = total(a);
  assert.ok(after < before * 0.85, `divergence ${before} -> ${after}`);
  // More sweeps do not move the residue: it is the grid's, not the solver's (fluid.js project).
  const c = run();
  c.push(0.2, -0.1);
  c.swirl(6, 8, 4, 2);
  c.project(400);
  assert.ok(Math.abs(total(c) - after) / after < 0.1, 'the residue is the grid scale');
});

test('a morph lets the outgoing content go by 0.28 and brings the incoming in from 0.34', () => {
  let outGone = null, inStarts = null;
  for (let t = 0; t < 1; t += 0.001) {
    const m = morph(t);
    if (outGone === null && m.out.opacity <= 0) outGone = m.box;
    if (inStarts === null && m.in.opacity > 0) inStarts = m.box;
  }
  assert.ok(Math.abs(outGone - 0.28) < 0.03, `out gone at ${outGone}`);
  assert.ok(Math.abs(inStarts - 0.34) < 0.03, `in starts at ${inStarts}`);
});

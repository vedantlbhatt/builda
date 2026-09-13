/**
 * Bit's motion: the timing tables, the cadences, and the cross-fade scheduler.
 *
 * The `Animated` runtime itself does not run under bun — there is no native driver and
 * no frame clock — so what is tested is everything the runtime is told: how long each
 * beat lasts, when a blink may fall, which pixels are lifted out of a frame to move on
 * their own, and which layer shows which frame at a given clock time. The visual proof
 * is the web run (`scripts/e2e_mascot.mjs`).
 */
import { describe, expect, test } from 'bun:test';

import { EYES, countGlyphs, eyesOpen, isValidFrame } from '../src/pixel/frames';
import {
  CUT,
  MOTION,
  backOvershoot,
  beatAt,
  blinkGapMs,
  blinks,
  bodyCount,
  clampTempo,
  closeEyes,
  components,
  crossfadeFor,
  decompose,
  initLayers,
  layerFrames,
  layerOpacities,
  runCrossfade,
  settleFor,
  splitFrames,
  staggered,
  stepLayers,
  timelineFor,
  timelineLengthMs,
} from '../src/pixel/motion';
import { SPRITES, SPRITE_STATES, framesFor } from '../src/pixel/sprites';

/** A deterministic "random" source that walks a fixed list. */
function seq(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]!;
}

describe('the motion table', () => {
  test('idle life: the drawn loop, and blinks in [3, 6] s with a 120 ms closed frame', () => {
    // Rest 2 s, breath 1 s, rest 2 s, antenna tip 1 s: the family's loop (`animals.ts`,
    // rule 7). It replaced a 1.03 scale breath and a 2.5 degree tilt, both of which ran
    // forever and kept the sprite off whole pixels.
    expect(MOTION.idle).toEqual({ beatMs: 500, holds: [4, 2, 4, 2] });
    expect(MOTION.blink).toEqual({ minGapMs: 3000, maxGapMs: 6000, closedMs: 120 });
    expect('breath' in MOTION).toBe(false);
    expect('gesture' in MOTION).toBe(false);
  });

  test('frame changes cross-fade in 60–90 ms; state changes settle in 220 ms from 0.94', () => {
    expect(MOTION.crossfade.ms).toBeGreaterThanOrEqual(60);
    expect(MOTION.crossfade.ms).toBeLessThanOrEqual(90);
    expect(MOTION.settle).toEqual({ ms: 220, fromScale: 0.94, easing: 'out' });
  });

  test('per-state clocks are the ones in the spec', () => {
    expect(MOTION.building.beatMs).toBe(380);
    expect(MOTION.building.strikeHoldMs).toBe(40);
    expect(MOTION.building.impactCells).toBe(1);
    expect(MOTION.building.sparkFadeMs).toBe(240);
    expect(MOTION.thinking).toEqual({ dotLoopMs: 1200, dotStaggerMs: 150, dotLow: 0.3 });
    expect(MOTION.sleeping).toEqual({ zRiseMs: 1800, zStaggerMs: 600, zRiseCells: 4 });
    expect(MOTION.celebrating.riseMs).toBe(600);
    expect(MOTION.celebrating.confettiMs).toBe(1400);
    expect(MOTION.celebrating.idleAfterMs).toBe(3000);
    expect(MOTION.waving.beatMs).toBe(260);
    expect(MOTION.waving.wavesPerBurst).toBe(2);
    expect(MOTION.waving.restMs).toBe(2000);
    expect(MOTION.waving.crossfade.easing).toBe('inOut');
  });

  test('the celebration overshoot stays under 4 %; the stock back() would be 10 %', () => {
    expect(backOvershoot(MOTION.celebrating.backS)).toBeLessThanOrEqual(MOTION.celebrating.maxOvershoot);
    expect(backOvershoot(MOTION.celebrating.backS)).toBeGreaterThan(0.02); // still a visible rise
    expect(backOvershoot(1.70158)).toBeCloseTo(0.1, 2);
    expect(settleFor('celebrating')).toEqual({ ms: 600, fromScale: 0.94, easing: 'outBack' });
    expect(settleFor('idle')).toEqual(MOTION.settle);
  });
});

describe('tempo', () => {
  test('clamps to [0.5, 2] and treats nonsense as 1', () => {
    expect(clampTempo(undefined)).toBe(1);
    expect(clampTempo(Number.NaN)).toBe(1);
    expect(clampTempo(0)).toBe(1);
    expect(clampTempo(-3)).toBe(1);
    expect(clampTempo(0.1)).toBe(0.5);
    expect(clampTempo(9)).toBe(2);
    expect(clampTempo(1.4)).toBe(1.4);
  });

  test('scales beats and the idle loop, not blinks', () => {
    expect(timelineLengthMs(timelineFor('building', 2))).toBe(timelineLengthMs(timelineFor('building')) / 2);
    expect(timelineLengthMs(timelineFor('idle', 2))).toBe(3000);
    expect(timelineLengthMs(timelineFor('idle', 0.5))).toBe(12000);
    expect(blinkGapMs(seq([0.5]))).toBe(4500); // no tempo parameter exists to pass
  });
});

describe('timelines', () => {
  test('building: four beats at 380 ms, the strike held 40 ms longer', () => {
    expect(timelineFor('building')).toEqual([
      { frame: 0, ms: 380 },
      { frame: 1, ms: 380 },
      { frame: 2, ms: 420 },
      { frame: 3, ms: 380 },
    ]);
    expect(timelineLengthMs(timelineFor('building'))).toBe(1560);
  });

  test('waving: two waves of two beats, then a 2 s rest on the raised arm', () => {
    expect(timelineFor('waving')).toEqual([
      { frame: 0, ms: 260 },
      { frame: 1, ms: 260 },
      { frame: 0, ms: 260 },
      { frame: 1, ms: 260 },
      { frame: 0, ms: 2000 },
    ]);
    expect(timelineLengthMs(timelineFor('waving'))).toBe(4 * 260 + 2000);
  });

  test('celebrating pumps its three frames at 320 ms', () => {
    expect(timelineFor('celebrating').map((b) => b.ms)).toEqual([320, 320, 320]);
  });

  test('idle and blink loop rest · breath · rest · tip, the rest pose two thirds of the time', () => {
    for (const s of ['idle', 'blink'] as const) {
      expect(timelineFor(s)).toEqual([
        { frame: 0, ms: 2000 },
        { frame: 1, ms: 1000 },
        { frame: 2, ms: 2000 },
        { frame: 3, ms: 1000 },
      ]);
    }
    const base = decompose('idle').base;
    expect(base[0]).toBe(base[2]); // the rest pose is one object, so the repeat is no change
  });

  test('thinking and sleeping are held: their motion is the overlays', () => {
    for (const s of ['thinking', 'sleeping'] as const) {
      expect(timelineFor(s)).toHaveLength(1);
      expect(timelineLengthMs(timelineFor(s))).toBe(0);
    }
  });

  test('beatAt walks and wraps a timeline', () => {
    const tl = timelineFor('building');
    expect(beatAt(tl, 0)).toEqual({ index: 0, frame: 0, elapsedMs: 0 });
    expect(beatAt(tl, 379)).toEqual({ index: 0, frame: 0, elapsedMs: 379 });
    expect(beatAt(tl, 380)).toEqual({ index: 1, frame: 1, elapsedMs: 0 });
    expect(beatAt(tl, 760 + 419)).toEqual({ index: 2, frame: 2, elapsedMs: 419 });
    expect(beatAt(tl, 1180)).toEqual({ index: 3, frame: 3, elapsedMs: 0 });
    expect(beatAt(tl, 1560)).toEqual({ index: 0, frame: 0, elapsedMs: 0 });
    expect(beatAt(tl, 1560 + 381)).toEqual({ index: 1, frame: 1, elapsedMs: 1 });
    expect(beatAt(timelineFor('thinking'), 99_999)).toEqual({ index: 0, frame: 0, elapsedMs: 99_999 });
    expect(beatAt(timelineFor('idle'), 2500)).toEqual({ index: 1, frame: 1, elapsedMs: 500 });
  });

  test('every beat frame indexes a real base frame', () => {
    for (const s of SPRITE_STATES) {
      const base = decompose(s).base;
      for (const b of timelineFor(s)) expect(b.frame).toBeLessThan(base.length);
    }
  });
});

describe('cadences', () => {
  test('blink gaps stay inside [3, 6] s and are not a metronome', () => {
    const rng = seq([0, 1, 0.25, 0.5, 0.75, 0.999]);
    const gaps = Array.from({ length: 6 }, () => blinkGapMs(rng));
    for (const g of gaps) {
      expect(g).toBeGreaterThanOrEqual(3000);
      expect(g).toBeLessThanOrEqual(6000);
    }
    expect(new Set(gaps).size).toBeGreaterThan(1);
    expect(gaps[0]).toBe(3000);
    expect(gaps[1]).toBe(6000);
  });

  test('stagger arithmetic: dots, z glyphs and confetti all fit inside one loop', () => {
    expect(staggered(3, MOTION.thinking.dotStaggerMs)).toEqual([0, 150, 300]);
    expect(300 + MOTION.thinking.dotLoopMs / 2).toBeLessThan(MOTION.thinking.dotLoopMs); // last dot peaks inside the loop
    expect(staggered(3, MOTION.sleeping.zStaggerMs)).toEqual([0, 600, 1200]);
    expect(1200).toBeLessThan(MOTION.sleeping.zRiseMs); // three z's are always in flight
    const n = decompose('celebrating').overlays.length;
    const last = staggered(n, MOTION.celebrating.confettiStaggerMs)[n - 1]!;
    expect(last).toBeLessThan(MOTION.celebrating.confettiMs); // the last piece launches before the first lands
  });

  test('who blinks', () => {
    expect(SPRITE_STATES.filter(blinks)).toEqual(['idle', 'blink', 'building', 'thinking', 'waving']);
  });
});

describe('cross-fade layers', () => {
  test('a repeated frame is a no-op by identity; a new frame flips the front', () => {
    const l0 = initLayers('a', 0);
    expect(stepLayers(l0, 'a', MOTION.crossfade, 10)).toBe(l0);
    const l1 = stepLayers(l0, 'b', MOTION.crossfade, 10);
    expect(l1).toEqual({ frames: ['a', 'b'], front: 1, fade: MOTION.crossfade, sinceMs: 10 });
    const l2 = stepLayers(l1, 'c', MOTION.crossfade, 20);
    expect(l2).toEqual({ frames: ['c', 'b'], front: 0, fade: MOTION.crossfade, sinceMs: 20 });
  });

  test('opacities: the front rises 0 → 1 over the fade while the back falls; a cut is instant', () => {
    const l = stepLayers(initLayers('a', 0), 'b', { ms: 100, easing: 'linear' }, 1000);
    expect(layerOpacities(l, 1000)).toEqual([1, 0]);
    expect(layerOpacities(l, 1050)).toEqual([0.5, 0.5]);
    expect(layerOpacities(l, 1100)).toEqual([0, 1]);
    expect(layerOpacities(l, 5000)).toEqual([0, 1]);
    const cut = stepLayers(l, 'c', CUT, 2000);
    expect(layerOpacities(cut, 2000)).toEqual([1, 0]);
  });

  test('driving the building timeline: each beat lands on the other layer and settles within 75 ms', () => {
    const samples = runCrossfade(timelineFor('building'), [0, 1, 2, 3], [0, 100, 380, 417.5, 455, 760, 1180, 1560], MOTION.crossfade);
    expect(samples.map((s) => s.layers.frames[s.layers.front])).toEqual([0, 0, 1, 1, 1, 2, 3, 0]);
    expect(samples.map((s) => s.layers.front)).toEqual([0, 0, 1, 1, 1, 0, 1, 0]);
    expect(samples[2]!.opacities).toEqual([1, 0]); // the swing has just started fading in
    expect(samples[3]!.opacities).toEqual([0.5, 0.5]);
    expect(samples[4]!.opacities).toEqual([0, 1]); // 75 ms later: settled, only the new frame
    expect(samples[7]!.layers.frames).toEqual([0, 3]); // the loop puts frame 0 back on layer A
  });

  test('a held timeline never changes layers', () => {
    const samples = runCrossfade(timelineFor('thinking'), ['x'], [0, 1000, 60_000], MOTION.crossfade);
    for (const s of samples) {
      expect(s.layers.front).toBe(0);
      expect(s.opacities).toEqual([1, 0]);
    }
  });

  test('waving sweeps with the longer eased fade; everyone else cuts crisp and short', () => {
    expect(crossfadeFor('waving')).toEqual({ ms: 130, easing: 'inOut' });
    for (const s of SPRITE_STATES) if (s !== 'waving') expect(crossfadeFor(s)).toEqual({ ms: 75, easing: 'linear' });
  });
});

/** Overlay two frames that must not both draw the same cell. */
function merge(a: string[], b: string[]): string[] {
  return a.map((row, y) =>
    row
      .split('')
      .map((ch, x) => {
        const other = b[y]![x]!;
        if (ch !== '.' && other !== '.') throw new Error(`both layers draw ${x},${y}`);
        return ch === '.' ? other : ch;
      })
      .join('')
  );
}

describe('splitFrames: only what differs cross-fades', () => {
  test('the wave: the body is shared, two hand pixels go out and two come in', () => {
    const [up, out] = framesFor('waving') as [string[], string[]];
    const s = splitFrames(up, out);
    expect(countGlyphs(s.outgoing, ['b', 'w', 'h', 'z'])).toBe(2);
    expect(countGlyphs(s.incoming, ['b', 'w', 'h', 'z'])).toBe(2);
    expect(bodyCount(s.shared)).toBe(bodyCount(up) - 2);
    // The face never fades: the eye holes stay open in the shared layer.
    expect(eyesOpen(s.shared)).toBe(true);
    expect(merge(s.shared, s.outgoing)).toEqual(up);
    expect(merge(s.shared, s.incoming)).toEqual(out);
  });

  test('is exact for every consecutive pair of every state, and for the blink', () => {
    for (const state of SPRITE_STATES) {
      const { base } = decompose(state);
      for (let i = 0; i < base.length; i++) {
        const from = base[i]!;
        const to = base[(i + 1) % base.length]!;
        const s = splitFrames(from, to);
        expect(isValidFrame(s.shared)).toBe(true);
        expect(merge(s.shared, s.outgoing)).toEqual(from);
        expect(merge(s.shared, s.incoming)).toEqual(to);
      }
    }
    const idle = framesFor('idle')[0]!;
    const s = splitFrames(idle, closeEyes(idle));
    expect(countGlyphs(s.outgoing, ['b', 'w', 'h', 'z'])).toBe(0); // the eyes were holes
    expect(countGlyphs(s.incoming, ['b'])).toBe(EYES.length); // and become body, two 2x2 eyes
  });

  test('identical frames share everything; the pair is memoised', () => {
    const f = framesFor('idle')[0]!;
    const s = splitFrames(f, f);
    expect(s.shared).toEqual(f);
    expect(countGlyphs(s.outgoing, ['b', 'w', 'h', 'z'])).toBe(0);
    expect(countGlyphs(s.incoming, ['b', 'w', 'h', 'z'])).toBe(0);
    const [up, out] = framesFor('waving') as [string[], string[]];
    expect(splitFrames(up, out)).toBe(splitFrames(up, out));
    expect(splitFrames(up, out)).not.toBe(splitFrames(out, up));
  });

  test('layerFrames: the front layer carries the incoming difference, and the composite is exact at both ends', () => {
    const [a, b, c] = decompose('building').base as [string[], string[], string[]];
    const l0 = initLayers(a, 0);
    const d0 = layerFrames(l0);
    expect(d0.shared).toEqual(a);
    expect(merge(d0.shared, d0.a)).toEqual(a); // front (A) at 1: shows `a`
    const l1 = stepLayers(l0, b, MOTION.crossfade, 10); // front becomes B
    const d1 = layerFrames(l1);
    expect(merge(d1.shared, d1.a)).toEqual(a); // A fading out: shared + A is the old frame
    expect(merge(d1.shared, d1.b)).toEqual(b); // B fading in: shared + B is the new frame
    const l2 = stepLayers(l1, c, MOTION.crossfade, 20); // front back to A
    const d2 = layerFrames(l2);
    expect(merge(d2.shared, d2.b)).toEqual(b);
    expect(merge(d2.shared, d2.a)).toEqual(c);
  });
});

describe('frame surgery', () => {
  test('closeEyes reproduces the drawn blink frame from the idle pose, and is idempotent', () => {
    const closed = closeEyes(framesFor('idle')[0]!);
    expect(closed).toEqual(framesFor('blink')[2]!);
    expect(closeEyes(closed)).toBe(closed);
  });

  test('closeEyes fills the eight eye cells and nothing else, sparks and all', () => {
    const strike = framesFor('building')[2]!;
    const closed = closeEyes(strike);
    expect(EYES.length).toBe(8);
    expect(countGlyphs(closed, ['w'])).toBe(countGlyphs(strike, ['w']));
    expect(countGlyphs(closed, ['b'])).toBe(countGlyphs(strike, ['b']) + EYES.length);
    for (const [x, y] of EYES) expect(closed[y]![x]).toBe('b');
  });

  test('closeEyes leaves eyes that are not open alone: asleep is slits, not a blink', () => {
    const asleep = framesFor('sleeping')[0]!;
    expect(eyesOpen(asleep)).toBe(false);
    expect(closeEyes(asleep)).toBe(asleep);
  });

  test('components: 8-connected, row-major', () => {
    const groups = components([
      { x: 0, y: 0, ch: 'z' },
      { x: 1, y: 1, ch: 'z' },
      { x: 5, y: 5, ch: 'z' },
    ]);
    expect(groups.map((g) => g.length)).toEqual([2, 1]);
  });
});

describe('decomposition', () => {
  test('never touches the character: every base frame is valid and keeps its body count', () => {
    for (const s of SPRITE_STATES) {
      const { base } = decompose(s);
      expect(base.length).toBeGreaterThan(0);
      const drawn = SPRITES[s === 'blink' ? 'idle' : s];
      for (const f of base) expect(isValidFrame(f)).toBe(true);
      // Base frames are a subsequence of the drawn ones minus overlays, so body counts match in order.
      const drawnCounts = drawn.map(bodyCount);
      for (const f of base) expect(drawnCounts).toContain(bodyCount(f));
    }
  });

  test('the overlays and the base partition each drawn frame', () => {
    for (const s of ['thinking', 'sleeping', 'building', 'celebrating'] as const) {
      const { base, overlays } = decompose(s);
      for (const o of overlays) {
        expect(isValidFrame(o.frame)).toBe(true);
        expect(countGlyphs(o.frame, ['b', 'd', 'e', 'w', 'h', 'z'])).toBeGreaterThan(0);
      }
      for (const f of base) expect(bodyCount(f)).toBeGreaterThan(40);
    }
  });

  test('thinking: three dots on the top row, and once they are lifted the frames are one', () => {
    const { base, overlays } = decompose('thinking');
    expect(base).toHaveLength(1);
    expect(overlays.map((o) => o.kind)).toEqual(['dot', 'dot', 'dot']);
    expect(overlays.map((o) => o.index)).toEqual([0, 1, 2]);
    for (const o of overlays) {
      expect(countGlyphs(o.frame, ['w'])).toBe(1);
      expect(o.frame[1]).toMatch(/w/);
    }
    // The bubble trail stays in the base; only the dots move.
    expect(countGlyphs(base[0]!, ['z'])).toBe(2);
    expect(base[0]![1]).toBe('.'.repeat(16));
  });

  test('sleeping: one held body, three z glyphs lowest-first, no z left in the base', () => {
    const { base, overlays } = decompose('sleeping');
    expect(base).toHaveLength(1);
    expect(countGlyphs(base[0]!, ['z'])).toBe(0);
    expect(overlays.map((o) => o.kind)).toEqual(['z', 'z', 'z']);
    expect(overlays.map((o) => countGlyphs(o.frame, ['z']))).toEqual([1, 1, 7]);
    const rowOf = (o: { frame: string[] }) => o.frame.findIndex((r) => r.includes('z'));
    expect(rowOf(overlays[0]!)).toBeGreaterThan(rowOf(overlays[1]!));
    expect(rowOf(overlays[1]!)).toBeGreaterThan(rowOf(overlays[2]!));
    // Each glyph launches 4 cells BELOW where it is drawn and rises into place, so the
    // launch position — the lowest row plus the rise — must still be inside the grid.
    const bottomOf = (o: { frame: string[] }) => o.frame.length - 1 - [...o.frame].reverse().findIndex((r) => r.includes('z'));
    for (const o of overlays) expect(bottomOf(o) + MOTION.sleeping.zRiseCells).toBeLessThanOrEqual(15);
  });

  test('building: the hammer stays in the base; sparks fire on the strike and the rest beat', () => {
    const { base, overlays } = decompose('building');
    expect(base).toHaveLength(4);
    for (const f of base) expect(countGlyphs(f, ['h'])).toBeGreaterThanOrEqual(5);
    expect(overlays.map((o) => [o.kind, o.beat, countGlyphs(o.frame, ['w'])])).toEqual([
      ['spark', 2, 2],
      ['spark', 3, 1],
    ]);
    expect(overlays.map((o) => o.beat)).toContain(MOTION.building.strikeBeat);
    for (const f of base) expect(countGlyphs(f, ['w'])).toBe(0); // every spark is lifted
  });

  test('celebrating: confetti lifted per pixel, antenna, eyes and arms kept', () => {
    const { base, overlays } = decompose('celebrating');
    expect(base).toHaveLength(3);
    expect(overlays.length).toBeGreaterThanOrEqual(8);
    for (const o of overlays) {
      expect(o.kind).toBe('confetti');
      expect(countGlyphs(o.frame, ['h', 'w', 'z'])).toBe(1);
    }
    for (const f of base) {
      expect(countGlyphs(f, ['h', 'w', 'z'])).toBe(0); // the antenna is body now
      expect(eyesOpen(f)).toBe(true);
    }
    expect(base.map(bodyCount)).toEqual(SPRITES.celebrating.map(bodyCount));
    // No hop: the pump moves the arms and nothing else, six cells a beat where the old hop
    // repainted fifty-six.
    for (let i = 0; i < base.length; i++) {
      const a = base[i]!;
      const b = base[(i + 1) % base.length]!;
      let n = 0;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (a[y]![x] !== b[y]![x]) n += 1;
      expect(n).toBeLessThanOrEqual(8);
    }
  });

  test('idle and blink share one decomposition; waving is its own two frames', () => {
    expect(decompose('blink')).toBe(decompose('idle'));
    expect(decompose('idle').base).toEqual(SPRITES.idle);
    expect(decompose('waving').base).toEqual(SPRITES.waving);
    expect(decompose('waving').overlays).toEqual([]);
  });

  test('is memoised, so frame identity survives re-renders', () => {
    expect(decompose('building')).toBe(decompose('building'));
    expect(decompose('building').base[0]).toBe(decompose('building').base[0]);
  });
});

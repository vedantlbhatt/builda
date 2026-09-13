/**
 * The react-bits effect ports (`src/ui/bits/effects`): their tuning against the design doc
 * and the originals, the pure geometry each one draws from, the shaders compiled and drawn
 * by a real Skia (CanvasKit, the wasm build Skia for React Native ships with) and held cell
 * for cell against their JavaScript twins, and the folder held to the kit's rules (David
 * Haz's notice in every port, a Reduce Motion path in every component, no hex, no gradient,
 * radii from the rule).
 *
 * DESIGN-V2-COLOUR-MOTION.md section 3 is where the numbers come from; a failure here that
 * names a number is a change to the design, not to a test.
 */
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import CanvasKitInit from 'canvaskit-wasm';

import { hash12 as onboardingHash } from '../src/onboarding/shaders';
import { colors, hue } from '../src/theme';
import { EASE_BEZIER, REDUCED_FADE, STAGGER, STAGGER_CAP, T } from '../src/ui/motionSpec';
import {
  CONTINUOUS_EXTENT,
  cometHead,
  cometPart,
  cometParts,
  continuousRadiusLimit,
  continuousRect,
  createStage,
  strokeOutline,
  tailDash,
  type PathCmd,
} from '../src/ui/bits/effects/comet';
import { entrancePlan, exitPlan, staggerTotalMs } from '../src/ui/bits/effects/entrance';
import { glareCenter, glareGeometry, gradientDirection } from '../src/ui/bits/effects/glare';
import { inkOf } from '../src/ui/bits/effects/hue';
import { copiesNeeded, easeVelocity, loopVelocity, snapToPixel, stepLoop, wrapOffset } from '../src/ui/bits/effects/marquee';
import { magnetOffset, softClamp } from '../src/ui/bits/effects/pull';
import { inBox, isTap, sparkAngle, sparkEase, sparkPixel, sparkReach, sparkSegment, sparkVisible } from '../src/ui/bits/effects/spark';
import { EFFECTS } from '../src/ui/bits/effects/spec';
import {
  COVER_SKSL,
  SWAP_PATTERNS,
  SWAP_SKSL,
  coverGrid,
  coverHashes,
  coverOn,
  coverPhases,
  cubicBezier,
  easeCurve,
  hash12,
  patternRank,
  patternUniform,
  swapGrid,
  swapLocal,
  swapOffset,
  swapTimes,
  swapWindow,
} from '../src/ui/bits/effects/swap';

const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

// ─── the numbers ───────────────────────────────────────────────────────────────────────

describe('the tuning is the design doc and the originals', () => {
  test('ClickSpark: v2 SPARK (8 sparks of the 3pt grain, 24pt, 400ms); react-bits count and duration', () => {
    expect(EFFECTS.spark.count).toBe(8);
    expect(EFFECTS.spark.sizePt).toBe(3);
    expect(EFFECTS.spark.radiusPt).toBe(24);
    expect(EFFECTS.spark.ms).toBe(400);
    // A ray starts three grain cells long.
    expect(EFFECTS.spark.lengthPt as number).toBe(3 * EFFECTS.spark.sizePt);
  });

  test('StarBorder: v2 COMET (6s a lap as react-bits speed, three laps, 24% long), a 1.5pt still outline', () => {
    expect(EFFECTS.comet.lapMs).toBe(6000);
    expect(EFFECTS.comet.laps).toBe(3);
    expect(EFFECTS.comet.length).toBe(0.24);
    expect(EFFECTS.comet.strokePt).toBe(1.5);
    // The tail thins in three flat steps, each thinner than the last.
    expect(EFFECTS.comet.tail).toHaveLength(3);
    for (let i = 1; i < EFFECTS.comet.tail.length; i++) expect(EFFECTS.comet.tail[i]!).toBeLessThan(EFFECTS.comet.tail[i - 1]!);
  });

  test('GlareHover: -45 degrees (react-bits), 24pt in three flat steps of 6, 10, 6%, 380ms (TILT.glareMs)', () => {
    expect(EFFECTS.glare.angleDeg).toBe(-45);
    expect(EFFECTS.glare.bandPt).toBe(24);
    expect([...EFFECTS.glare.steps]).toEqual([0.06, 0.1, 0.06]);
    expect(EFFECTS.glare.ms).toBe(380);
  });

  test('PixelSwap: v2 SWAP 900 and 240ms, react-bits 0.35 start scale, 256 cells (a 16 by 16 creature), on the 3pt dither grid', () => {
    expect(EFFECTS.swap.totalMs).toBe(900);
    expect(EFFECTS.swap.cellMs).toBe(240);
    expect(EFFECTS.swap.startScale).toBe(0.35);
    expect(EFFECTS.swap.maxCells as number).toBe(16 * 16);
    expect(EFFECTS.swap.snapPt).toBe(3);
  });

  test('PixelTransition: 12 across (v2), 300ms each way (react-bits 0.3s)', () => {
    expect(EFFECTS.cover.grid).toBe(12);
    expect(EFFECTS.cover.stepMs).toBe(300);
  });

  test('LogoLoop: react-bits speed times the v2 AMBIENT share, react-bits tau, copies and 32 gap', () => {
    expect(EFFECTS.loop.speed).toBeCloseTo(120 * 0.3, 9);
    expect(EFFECTS.loop.smoothTau).toBe(0.25);
    expect(EFFECTS.loop.minCopies).toBe(2);
    expect(EFFECTS.loop.headroom).toBe(2);
    expect(EFFECTS.loop.gapPt).toBe(32);
    expect([16, 32, 48, 64]).toContain(EFFECTS.loop.glyphPt);
  });

  test('Magnet: react-bits strength 2; a gentle pull, never past 6pt', () => {
    expect(EFFECTS.magnet.strength).toBe(2);
    expect(EFFECTS.magnet.maxPt).toBe(6);
  });

  test('entrances: 8 to 12pt (v2), a hue snaps its opacity in under 120ms', () => {
    expect(EFFECTS.enter.distancePt).toBeGreaterThanOrEqual(8);
    expect(EFFECTS.enter.distancePt).toBeLessThanOrEqual(12);
    expect(EFFECTS.enter.hueFadeMs).toBeLessThan(120);
  });
});

// ─── ClickSpark ────────────────────────────────────────────────────────────────────────

describe('ClickSpark geometry (react-bits, line for line)', () => {
  const shape = { count: 8, sizePt: 3, lengthPt: 9, radiusPt: 24 };

  test('sparks leave evenly round the circle, the first pointing right', () => {
    expect(sparkAngle(0, 8)).toBe(0);
    for (let i = 0; i < 8; i++) expect(close(sparkAngle(i, 8), (i * Math.PI) / 4)).toBe(true);
    expect(sparkAngle(3, 0)).toBe(0);
  });

  test('at launch a ray starts at the origin at full length; at the end it is a point at the radius', () => {
    const [x1, y1, x2, y2] = sparkSegment(0, 0, shape);
    expect([x1, y1]).toEqual([0, 0]);
    expect(close(Math.hypot(x2 - x1, y2 - y1), 9)).toBe(true);
    const end = sparkSegment(2, 1, shape);
    expect(close(Math.hypot(end[0], end[1]), 24)).toBe(true);
    expect(close(end[0], end[2]) && close(end[1], end[3])).toBe(true);
  });

  test('the near end only ever flies outward and the ray only ever shrinks', () => {
    let lastD = -1;
    let lastL = Infinity;
    for (let e = 0; e <= 1.0001; e += 0.05) {
      const s = sparkSegment(1, e, shape);
      const d = Math.hypot(s[0], s[1]);
      const l = Math.hypot(s[2] - s[0], s[3] - s[1]);
      expect(d).toBeGreaterThanOrEqual(lastD);
      expect(l).toBeLessThanOrEqual(lastL + 1e-12);
      lastD = d;
      lastL = l;
    }
  });

  test('extraScale multiplies the flight, as in react-bits', () => {
    const s = sparkSegment(0, 1, { ...shape, extraScale: 1.5 });
    expect(close(s[0], 36)).toBe(true);
  });

  test('a pixel spark shrinks from the grain to nothing while it flies the same ray', () => {
    expect(sparkPixel(0, 0, shape)[2]).toBe(3);
    expect(sparkPixel(0, 1, shape)[2]).toBe(0);
    const mid = sparkPixel(2, 0.5, shape);
    expect(close(mid[0], 0, 1e-9)).toBe(true);
    expect(mid[1]).toBeGreaterThan(0);
  });

  test('the overlay margin covers every point of every spark at every moment', () => {
    const reach = sparkReach(shape);
    for (let e = 0; e <= 1; e += 0.01) {
      for (let i = 0; i < 8; i++) {
        const s = sparkSegment(i, e, shape);
        expect(Math.hypot(s[2], s[3]) + shape.sizePt / 2).toBeLessThanOrEqual(reach);
        const q = sparkPixel(i, e, shape);
        expect(Math.hypot(q[0], q[1]) + q[2]).toBeLessThanOrEqual(reach);
      }
    }
  });

  test('nothing draws before launch or after the burst', () => {
    expect(sparkVisible(0)).toBe(false);
    expect(sparkVisible(1)).toBe(false);
    expect(sparkVisible(0.5)).toBe(true);
  });

  test('a press is a press: within the 10pt slop and on the element; a drag does not spark', () => {
    const slop = EFFECTS.tapSlopPt;
    expect(isTap(10, 10, 16, 18, slop)).toBe(true);
    expect(isTap(10, 10, 25, 10, slop)).toBe(false);
    expect(inBox(5, 5, 100, 52)).toBe(true);
    expect(inBox(-5, 5, 100, 52)).toBe(false);
    expect(inBox(-5, 5, 100, 52, slop)).toBe(true);
  });

  test('the original easings are kept for parity: ease-out is t(2 - t)', () => {
    expect(sparkEase('ease-out', 0.5)).toBe(0.75);
    expect(sparkEase('linear', 0.3)).toBe(0.3);
    expect(sparkEase('ease-in', 0.5)).toBe(0.25);
    expect(sparkEase('ease-in-out', 0.25)).toBe(0.125);
    expect(sparkEase('ease-in-out', 0.75)).toBe(0.875);
  });
});

// ─── StarBorder ────────────────────────────────────────────────────────────────────────

function points(cmds: readonly PathCmd[]): [number, number][] {
  const out: [number, number][] = [];
  for (const c of cmds) {
    if (c[0] === 'M' || c[0] === 'L') out.push([c[1], c[2]]);
    else if (c[0] === 'C') out.push([c[1], c[2]], [c[3], c[4]], [c[5], c[6]]);
  }
  return out;
}

describe('StarBorder: the continuous corner outline', () => {
  const W = 174.5;
  const H = 188;
  const R = 18;

  test('one lap is closed: it ends where it started, and draws a line on each side and three curves at each corner', () => {
    const lap = continuousRect(0, 0, W, H, R);
    expect(lap[0]![0]).toBe('M');
    expect(lap[lap.length - 1]![0]).toBe('Z');
    const last = lap[lap.length - 2] as readonly ['C', number, number, number, number, number, number];
    expect(close(last[5], (lap[0] as readonly ['M', number, number])[1])).toBe(true);
    expect(close(last[6], (lap[0] as readonly ['M', number, number])[2])).toBe(true);
    expect(lap.filter((c) => c[0] === 'L')).toHaveLength(4);
    expect(lap.filter((c) => c[0] === 'C')).toHaveLength(12);
  });

  test('it stays inside its box and touches all four sides, like the tile it outlines', () => {
    const pts = points(continuousRect(0, 0, W, H, R));
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(0, 9);
    expect(Math.max(...xs)).toBeCloseTo(W, 9);
    expect(Math.min(...ys)).toBeCloseTo(0, 9);
    expect(Math.max(...ys)).toBeCloseTo(H, 9);
  });

  test('a continuous corner starts easing in 1.52866 radii from the corner, not one radius', () => {
    const lap = continuousRect(0, 0, W, H, R);
    const m = lap[0] as readonly ['M', number, number];
    expect(close(m[1], CONTINUOUS_EXTENT * R, 1e-9)).toBe(true);
    expect(m[2]).toBe(0);
  });

  test('the radius is limited so two corners never overlap on a short side', () => {
    expect(continuousRadiusLimit(40, 30)).toBeCloseTo(15 / CONTINUOUS_EXTENT, 9);
    const pts = points(continuousRect(0, 0, 40, 30, 999));
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(-1e-9);
      expect(x).toBeLessThanOrEqual(40 + 1e-9);
      expect(y).toBeGreaterThanOrEqual(-1e-9);
      expect(y).toBeLessThanOrEqual(30 + 1e-9);
    }
  });

  test('two laps are one open contour, twice as many segments, so a trim can cross the start in one piece', () => {
    const one = continuousRect(0, 0, W, H, R, 1);
    const two = continuousRect(0, 0, W, H, R, 2);
    expect(two.filter((c) => c[0] === 'M')).toHaveLength(1);
    expect(two.some((c) => c[0] === 'Z')).toBe(false);
    expect(two.length - 1).toBe(2 * (one.length - 2));
  });

  test('the stroke lies inside the tile: inset by half its width, concentric radius', () => {
    const sw = EFFECTS.comet.strokePt;
    const pts = points(strokeOutline(W, H, R, sw));
    for (const [x, y] of pts) {
      expect(x - sw / 2).toBeGreaterThanOrEqual(-1e-9);
      expect(x + sw / 2).toBeLessThanOrEqual(W + 1e-9);
      expect(y - sw / 2).toBeGreaterThanOrEqual(-1e-9);
      expect(y + sw / 2).toBeLessThanOrEqual(H + 1e-9);
    }
    const m = strokeOutline(W, H, R, sw)[0] as readonly ['M', number, number];
    expect(close(m[1], sw / 2 + CONTINUOUS_EXTENT * (R - sw / 2))).toBe(true);
  });
});

describe('StarBorder: the walk', () => {
  const L = EFFECTS.comet.length;
  const tail = EFFECTS.comet.tail;

  test('the comet is a solid head and one piece per tail step, end to end, head first', () => {
    const parts = cometParts(0.3, L, tail);
    expect(parts).toHaveLength(tail.length + 1);
    expect(parts[0]!.density).toBe(1);
    expect(parts.slice(1).map((p) => p.density)).toEqual([...tail]);
    for (let k = 1; k < parts.length; k++) expect(close(parts[k]!.end, parts[k - 1]!.start)).toBe(true);
    const total = parts[0]!.end - parts[parts.length - 1]!.start;
    // Positions are on the two lap path: a comet L laps long spans L / 2 of it.
    expect(close(total, L / 2)).toBe(true);
  });

  test('at every head position every piece is a real window inside the path: it never wraps', () => {
    for (let h = 0; h < 3; h += 0.013) {
      for (const p of cometParts(h, L, tail)) {
        expect(p.start).toBeGreaterThan(0);
        expect(p.end).toBeLessThanOrEqual(1);
        expect(p.end).toBeGreaterThan(p.start);
      }
    }
  });

  test('the head moves forward with time, and a whole lap later it is back where it was', () => {
    const a = cometParts(0.2, L, tail)[0]!;
    const b = cometParts(0.25, L, tail)[0]!;
    expect(b.end).toBeGreaterThan(a.end);
    const again = cometParts(1.2, L, tail)[0]!;
    expect(close(again.end, a.end, 1e-9)).toBe(true);
  });

  test('cometPart (the per piece worklet) is cometParts, piece by piece', () => {
    for (const h of [0, 0.1, 0.5, 0.99, 2.7]) {
      const parts = cometParts(h, L, tail);
      parts.forEach((p, k) => {
        const [s, e] = cometPart(h, L, parts.length, k);
        expect(close(s, p.start) && close(e, p.end)).toBe(true);
      });
    }
  });

  test('the tail thins by cells: a dash of stroke-sized cells inked at its density, the head solid', () => {
    const sw = 1.5;
    expect(tailDash(1, sw)).toBeNull();
    for (const d of tail) {
      const [on, off] = tailDash(d, sw)!;
      expect(on).toBe(sw);
      expect(close(on / (on + off), d)).toBe(true);
    }
  });

  test('the run is laps of lapMs, clamped', () => {
    expect(cometHead(3000, 6000, 3)).toBe(0.5);
    expect(cometHead(99999, 6000, 3)).toBe(3);
    expect(cometHead(-5, 6000, 3)).toBe(0);
  });

  test('one comet on screen: the first claimant runs it, the next takes over when it leaves', () => {
    const stage = createStage();
    let notified = 0;
    const off = stage.subscribe(() => notified++);
    expect(stage.owner()).toBeNull();
    stage.claim(1);
    stage.claim(2);
    stage.claim(1);
    expect(stage.owner()).toBe(1);
    stage.release(1);
    expect(stage.owner()).toBe(2);
    stage.release(7);
    stage.release(2);
    expect(stage.owner()).toBeNull();
    expect(notified).toBe(4);
    off();
    stage.claim(3);
    expect(notified).toBe(4);
  });
});

// ─── GlareHover ────────────────────────────────────────────────────────────────────────

describe('GlareHover: the stepped band', () => {
  test('-45 degrees is the CSS meaning: "/" stripes travelling from the top left corner to the bottom right', () => {
    const [dx, dy] = gradientDirection(-45);
    expect(dx).toBeLessThan(0);
    expect(dy).toBeLessThan(0);
    const g = glareGeometry(150, 200, -45, 24, [0.06, 0.1, 0.06]);
    expect(g.u[0]).toBeCloseTo(Math.SQRT1_2, 9);
    expect(g.u[1]).toBeCloseTo(Math.SQRT1_2, 9);
    expect(g.rotateDeg).toBe(45);
  });

  test('at both ends of its travel the band is wholly off the card, whatever the angle', () => {
    for (const angle of [-45, 0, 30, 90, 135, -120]) {
      const W = 150;
      const H = 200;
      const g = glareGeometry(W, H, angle, 24, [0.06, 0.1, 0.06]);
      const along = [
        [0, 0],
        [W, 0],
        [0, H],
        [W, H],
      ].map(([x, y]) => x! * g.u[0] + y! * g.u[1]);
      const sMin = Math.min(...along);
      const sMax = Math.max(...along);
      expect(g.from + g.bandWidth / 2).toBeLessThanOrEqual(sMin + 1e-9);
      expect(g.to - g.bandWidth / 2).toBeGreaterThanOrEqual(sMax - 1e-9);
      // Across the travel the band always covers the card.
      const across = [
        [0, 0],
        [W, 0],
        [0, H],
        [W, H],
      ].map(([x, y]) => x! * g.v[0] + y! * g.v[1]);
      expect(g.length).toBeGreaterThanOrEqual(Math.max(...across) - Math.min(...across));
    }
  });

  test('the band centre moves along the travel and sits mid card across it', () => {
    const g = glareGeometry(150, 200, -45, 24, [0.06, 0.1, 0.06]);
    const a = glareCenter(g.from, g.u, g.v, g.across);
    const b = glareCenter(g.to, g.u, g.v, g.across);
    expect(b[0]).toBeGreaterThan(a[0]);
    expect(b[1]).toBeGreaterThan(a[1]);
    const mid = glareCenter((g.from + g.to) / 2, g.u, g.v, g.across);
    expect(mid[0]).toBeCloseTo(75, 6);
    expect(mid[1]).toBeCloseTo(100, 6);
  });

  test('three flat stripes, symmetric, filling the band exactly: no ramp anywhere', () => {
    const g = glareGeometry(150, 200, -45, 24, EFFECTS.glare.steps);
    expect(g.stripes).toHaveLength(3);
    expect(g.stripes.reduce((s, x) => s + x.width, 0)).toBeCloseTo(24, 9);
    expect(g.stripes[0]!.opacity).toBe(g.stripes[2]!.opacity);
    expect(g.stripes[1]!.opacity).toBeGreaterThan(g.stripes[0]!.opacity);
    expect(g.stripes[0]!.offset).toBeCloseTo(-g.stripes[2]!.offset, 9);
    expect(g.stripes[1]!.offset).toBeCloseTo(0, 9);
  });
});

// ─── entrances ─────────────────────────────────────────────────────────────────────────

describe('AnimatedContent and FadeContent: the kit timings', () => {
  test('the default is Rise: 8pt up from below over 300ms, from nothing to fully there', () => {
    const p = entrancePlan();
    expect(p).toEqual({ delay: 0, moveMs: T.enter, fadeMs: T.enter, from: { x: 0, y: 8, scale: 1, rotate: 0, opacity: 0 } });
  });

  test('the stagger is the kit’s 40ms, capped at eight: the rest arrive as a block', () => {
    expect(entrancePlan({ index: 1 }).delay).toBe(STAGGER);
    expect(entrancePlan({ index: 3, delay: 100 }).delay).toBe(100 + 3 * STAGGER);
    expect(entrancePlan({ index: 20 }).delay).toBe(STAGGER_CAP * STAGGER);
    expect(entrancePlan({ index: -4 }).delay).toBe(0);
  });

  test('react-bits direction and reverse: horizontal comes from the right, reverse from the other side', () => {
    expect(entrancePlan({ direction: 'horizontal' }).from).toMatchObject({ x: 8, y: 0 });
    expect(entrancePlan({ reverse: true }).from).toMatchObject({ x: 0, y: -8 });
    expect(entrancePlan({ direction: 'horizontal', reverse: true, distance: 12 }).from).toMatchObject({ x: -12, y: 0 });
  });

  test('content in a hue snaps its opacity in under 120ms while it still rises the full time', () => {
    const p = entrancePlan({ hue: true });
    expect(p.fadeMs).toBeLessThan(120);
    expect(p.moveMs).toBe(T.enter);
  });

  test('FadeContent (distance 0) does not move; animateOpacity false only moves', () => {
    expect(entrancePlan({ distance: 0 }).moveMs).toBe(0);
    expect(entrancePlan({ distance: 0 }).fadeMs).toBe(T.enter);
    expect(entrancePlan({ animateOpacity: false }).from.opacity).toBe(1);
    expect(entrancePlan({ initialOpacity: 0.4 }).from.opacity).toBe(0.4);
  });

  test('a Wrapped card pops from 0.95; a staggered pop can start turned', () => {
    expect(entrancePlan({ scale: 0.95, distance: 0 })).toMatchObject({ moveMs: T.enter, from: { scale: 0.95 } });
    expect(entrancePlan({ rotate: -13, distance: 0 }).moveMs).toBe(T.enter);
  });

  test('Reduce Motion: nothing moves, a 150ms fade, the same place in the stagger', () => {
    for (const o of [{}, { direction: 'horizontal' as const, scale: 0.9, rotate: 20 }, { hue: true }, { animateOpacity: false }]) {
      const p = entrancePlan({ ...o, index: 2 }, true);
      expect(p.moveMs).toBe(0);
      expect(p.fadeMs).toBe(REDUCED_FADE);
      expect(p.from).toMatchObject({ x: 0, y: 0, scale: 1, rotate: 0 });
      expect(p.from.opacity).toBe(0);
      expect(p.delay).toBe(2 * STAGGER);
    }
  });

  test('an exit is 0.7x its entrance and starts at once', () => {
    const e = exitPlan({ index: 5 });
    expect(e.delay).toBe(0);
    expect(e.moveMs).toBe(Math.round(T.enter * 0.7));
    expect(exitPlan({}, true).fadeMs).toBe(REDUCED_FADE);
  });

  test('a staggered list is done when its last block has arrived', () => {
    expect(staggerTotalMs(0)).toBe(0);
    expect(staggerTotalMs(3, { duration: T.std })).toBe(2 * STAGGER + T.std);
    expect(staggerTotalMs(30, { duration: T.std })).toBe(STAGGER_CAP * STAGGER + T.std);
  });
});

// ─── PixelSwap and PixelTransition ─────────────────────────────────────────────────────

describe('PixelSwap: order, grid and timing', () => {
  test('the hash is the onboarding dissolve’s, bit for bit: one rule, two users', () => {
    for (let x = -3; x < 40; x += 1) {
      for (let y = -3; y < 40; y += 3) {
        expect(hash12(x, y)).toBe(onboardingHash(x, y));
        expect(hash12(x, y)).toBeGreaterThanOrEqual(0);
        expect(hash12(x, y)).toBeLessThan(1);
      }
    }
  });

  test('the nine react-bits patterns, in the shader’s order, every rank inside 0 to 1', () => {
    expect([...SWAP_PATTERNS]).toEqual(['random', 'center', 'edges', 'left-to-right', 'right-to-left', 'top-to-bottom', 'bottom-to-top', 'diagonal', 'spiral']);
    SWAP_PATTERNS.forEach((p, i) => expect(patternUniform(p)).toBe(i));
    for (const p of SWAP_PATTERNS) {
      for (let x = 0; x <= 1; x += 0.1) {
        for (let y = 0; y <= 1; y += 0.1) {
          const r = patternRank(p, x, y);
          if (p === 'random') expect(r).toBeNull();
          else {
            expect(r!).toBeGreaterThanOrEqual(-1e-12);
            expect(r!).toBeLessThanOrEqual(1 + 1e-12);
          }
        }
      }
    }
    expect(patternRank('center', 0.5, 0.5)).toBe(0);
    expect(patternRank('center', 0, 0)).toBeCloseTo(1, 9);
    expect(patternRank('left-to-right', 0.2, 0.9)).toBe(0.2);
    expect(patternRank('edges', 0, 0.5)).toBe(0);
  });

  test('the grid: at least 8pt cells, at most 256, grown to whole 3pt dither cells, covering the box', () => {
    for (const [w, h] of [
      [192, 192],
      [361, 200],
      [60, 48],
      [1000, 800],
      [10, 10],
    ] as const) {
      const g = swapGrid(w, h);
      expect(g.size).toBeGreaterThanOrEqual(8);
      expect(g.size % 3).toBe(0);
      expect(g.cols * g.rows).toBeLessThanOrEqual(256);
      expect(g.cols * g.size).toBeGreaterThanOrEqual(w);
      expect(g.rows * g.size).toBeGreaterThanOrEqual(h);
    }
    // A 16 pixel creature at 12pt a pixel: one swap cell per creature pixel.
    expect(swapGrid(192, 192)).toEqual({ size: 12, cols: 16, rows: 16 });
    // The original's cap, where a caller asks for it: cells grow until 220 fit.
    const capped = swapGrid(192, 192, 12, 220);
    expect(capped.cols * capped.rows).toBeLessThanOrEqual(220);
    expect(capped.size).toBeGreaterThan(12);
  });

  test('the original’s clamps: at least 200ms, a cell between 60ms and the whole', () => {
    expect(swapTimes(900, 240)).toEqual({ total: 900, cell: 240, spread: 660 });
    expect(swapTimes(50, 10)).toEqual({ total: 200, cell: 60, spread: 140 });
    expect(swapTimes(300, 5000)).toEqual({ total: 300, cell: 300, spread: 0 });
  });

  test('the first cell starts at once, the last finishes exactly at the end, and nothing is left turning', () => {
    const { total, cell } = swapTimes(900, 240);
    expect(swapLocal(0, 0, total, cell)).toBe(0);
    expect(swapLocal(0, 1, total, cell)).toBeGreaterThan(0);
    expect(swapLocal(1, total, total, cell)).toBe(1);
    expect(swapLocal(1, total - 1, total, cell)).toBeLessThan(1);
    const g = swapGrid(361, 200);
    for (let r = 0; r < g.rows; r++) {
      for (let c = 0; c < g.cols; c++) {
        const off = swapOffset(c, r, g, 'spiral');
        expect(swapLocal(off, total, total, cell)).toBe(1);
      }
    }
  });

  test('a turning window grows from 0.35 of the cell to all of it; the fade is done in the first stretch', () => {
    expect(swapWindow(0, 0.35, true)).toEqual({ scale: 0, alpha: 0 });
    expect(swapWindow(1, 0.35, true)).toEqual({ scale: 1, alpha: 1 });
    const early = swapWindow(0.01, 0.35, true);
    expect(early.scale).toBeGreaterThan(0.35);
    expect(early.scale).toBeLessThan(0.4);
    // On the kit's strong ease out, the fade is whole a quarter of the way into a 240ms cell.
    expect(swapWindow(0.25, 0.35, true).alpha).toBe(1);
    expect(swapWindow(0.1, 0.35, false).alpha).toBe(1);
  });

  test('the curve is the kit’s EASE, solved the original’s way', () => {
    expect(easeCurve(0)).toBe(0);
    expect(easeCurve(1)).toBeCloseTo(1, 9);
    let last = 0;
    for (let t = 0; t <= 1; t += 0.02) {
      const v = easeCurve(t);
      expect(v).toBeGreaterThanOrEqual(last - 1e-9);
      last = v;
    }
    // A strong ease out: three quarters of the way at a quarter of the time.
    expect(easeCurve(0.25)).toBeGreaterThan(0.75);
    expect(cubicBezier(0.3, 0.3, 0.7, 0.7)(0.42)).toBe(0.42);
  });

  test('randomness mixes the pattern with chance; random ignores the pattern', () => {
    const g = swapGrid(120, 120);
    expect(swapOffset(2, 3, g, 'left-to-right', 0)).toBeCloseTo(2 / (g.cols - 1), 12);
    expect(swapOffset(2, 3, g, 'left-to-right', 1)).toBe(hash12(3, 4));
    expect(swapOffset(2, 3, g, 'random', 0)).toBe(hash12(3, 4));
  });
});

describe('PixelTransition: two random orders, the swap under a full cover', () => {
  test('cells cover in the first order, all on at the middle, all off at the end', () => {
    expect(coverPhases(0)).toEqual({ pin: 0, pout: 0 });
    expect(coverPhases(1)).toEqual({ pin: 1, pout: 0 });
    expect(coverPhases(1.5)).toEqual({ pin: 1, pout: 0.5 });
    expect(coverPhases(2)).toEqual({ pin: 1, pout: 1 });
    for (let c = 0; c < 12; c++) {
      for (let r = 0; r < 16; r++) {
        const [hIn, hOut] = coverHashes(c, r);
        expect(coverOn(hIn, hOut, 0, 0)).toBe(false);
        expect(coverOn(hIn, hOut, 1, 0)).toBe(true);
        expect(coverOn(hIn, hOut, 1, 1)).toBe(false);
      }
    }
  });

  test('the two orders are different orders', () => {
    const n = 12 * 16;
    let same = 0;
    for (let c = 0; c < 12; c++) for (let r = 0; r < 16; r++) {
      const [a, b] = coverHashes(c, r);
      if (Math.abs(a - b) < 0.05) same++;
    }
    expect(same).toBeLessThan(n * 0.2);
  });

  test('square cells, 12 across, as many rows as the height needs', () => {
    expect(coverGrid(240, 320)).toEqual({ cell: 20, cols: 12, rows: 16 });
    expect(coverGrid(240, 330).rows).toBe(17);
  });
});

// ─── Magnet and LogoLoop ───────────────────────────────────────────────────────────────

describe('Magnet: a gentle lean toward the thumb', () => {
  const opts = { padding: EFFECTS.magnet.paddingPt, strength: EFFECTS.magnet.strength, maxPt: EFFECTS.magnet.maxPt };

  test('a finger on the centre does not move it; off centre it leans toward the finger', () => {
    expect(magnetOffset(180, 26, 360, 52, opts)).toEqual({ x: 0, y: 0, active: true });
    const p = magnetOffset(300, 40, 360, 52, opts);
    expect(p.active).toBe(true);
    expect(p.x).toBeGreaterThan(0);
    expect(p.y).toBeGreaterThan(0);
    const q = magnetOffset(10, 5, 360, 52, opts);
    expect(q.x).toBeLessThan(0);
    expect(q.y).toBeLessThan(0);
  });

  test('never past 6pt, however far the finger is; a small pull is the original’s distance over strength', () => {
    for (let x = -24; x <= 384; x += 8) {
      const p = magnetOffset(x, 26, 360, 52, opts);
      expect(Math.abs(p.x)).toBeLessThan(EFFECTS.magnet.maxPt);
    }
    const small = magnetOffset(181, 26, 360, 52, opts);
    expect(small.x).toBeCloseTo(0.5, 2);
    expect(softClamp(0.1, 6)).toBeCloseTo(0.1, 4);
    expect(softClamp(1000, 6)).toBeLessThanOrEqual(6);
    expect(softClamp(5, 0)).toBe(0);
  });

  test('outside the padding it lets go', () => {
    expect(magnetOffset(360 + 30, 26, 360, 52, opts)).toEqual({ x: 0, y: 0, active: false });
    expect(magnetOffset(180, 52 + 24, 360, 52, opts).active).toBe(false);
    expect(magnetOffset(180, 52 + 23, 360, 52, opts).active).toBe(true);
  });
});

describe('LogoLoop: the original’s loop arithmetic', () => {
  test('copies: at least two, or enough to fill the strip plus two of headroom', () => {
    expect(copiesNeeded(0, 0)).toBe(2);
    expect(copiesNeeded(361, 448)).toBe(3);
    expect(copiesNeeded(361, 100)).toBe(6);
  });

  test('the target velocity: left is positive (the track moves left), a negative speed turns it round', () => {
    expect(loopVelocity(36, 'left')).toBe(36);
    expect(loopVelocity(36, 'right')).toBe(-36);
    expect(loopVelocity(-36, 'left')).toBe(-36);
  });

  test('the offset stays inside one row, whichever way it runs', () => {
    expect(wrapOffset(450, 448)).toBe(2);
    expect(wrapOffset(-2, 448)).toBe(446);
    expect(wrapOffset(5, 0)).toBe(0);
  });

  test('the velocity eases with tau 0.25s and does not depend on the frame rate', () => {
    const tau = EFFECTS.loop.smoothTau;
    const once = easeVelocity(0, 36, 1 / 30, tau);
    const twice = easeVelocity(easeVelocity(0, 36, 1 / 60, tau), 36, 1 / 60, tau);
    expect(once).toBeCloseTo(twice, 9);
    let v = 0;
    for (let i = 0; i < 120; i++) v = easeVelocity(v, 36, 1 / 60, tau);
    expect(v).toBeGreaterThan(35.9);
    expect(easeVelocity(10, 0, 1, 0)).toBe(0);
  });

  test('a frame of the loop wraps the offset and eases the velocity together', () => {
    const [o, v] = stepLoop(447.8, 36, 36, 1 / 60, 0.25, 448);
    expect(v).toBe(36);
    // 447.8 + 0.6 is past the row's end, so it comes back round to 0.4.
    expect(o).toBeCloseTo(0.4, 9);
  });

  test('the track lands on whole device pixels, so pixel glyphs never shimmer', () => {
    expect(snapToPixel(10.2, 3)).toBeCloseTo(10.333333333, 6);
    expect(snapToPixel(10.1, 3)).toBe(10);
    expect(snapToPixel(10.3, 2)).toBe(10.5);
    expect(snapToPixel(7.77, 0)).toBe(7.77);
  });
});

// ─── colour ────────────────────────────────────────────────────────────────────────────

describe('effects take their colour from the spectrum, never a hex', () => {
  test('amber by default (the action colour, and "needs you" on a live surface)', () => {
    expect(inkOf(undefined)).toBe(hue('amber').ink);
    expect(inkOf(undefined, 'light')).toBe(hue('amber', 'light').ink);
  });

  test('a name, or a hue a caller already resolved; the light scheme takes the 3:1 mark tone', () => {
    expect(inkOf('tide')).toBe(hue('tide').ink);
    expect(inkOf('tide', 'light')).toBe(hue('tide', 'light').ink);
    expect(inkOf(hue('orchid'))).toBe(hue('orchid').ink);
    expect(inkOf('not a hue' as never)).toBe(hue('amber').ink);
  });

  test('the glare is the warm white of the dark palette, not a pure white', () => {
    const src = readFileSync(join(EFX, 'GlareHover.tsx'), 'utf8');
    expect(src).toContain("colors('dark').text");
    expect(colors('dark').text.toUpperCase()).not.toBe('#FFFFFF');
  });
});

// ─── the shaders, compiled and drawn by a real Skia ────────────────────────────────────

const CK = await CanvasKitInit();

function compile(sksl: string): { ok: boolean; error: string } {
  let error = '';
  const fx = CK.RuntimeEffect.Make(sksl, (e: string) => {
    error = e;
  });
  const ok = fx !== null;
  fx?.delete();
  return { ok, error };
}

/** Draw `shader` into a `w` by `h` surface at one pixel a point and read it back as RGBA. */
function draw(shader: ReturnType<typeof CK.Shader.MakeColor>, w: number, h: number): Uint8Array {
  const surface = CK.MakeSurface(w, h)!;
  const canvas = surface.getCanvas();
  canvas.clear(CK.TRANSPARENT);
  const paint = new CK.Paint();
  paint.setShader(shader);
  canvas.drawRect(CK.XYWHRect(0, 0, w, h), paint);
  const img = surface.makeImageSnapshot();
  const px = img.readPixels(0, 0, { width: w, height: h, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB }) as Uint8Array;
  img.delete();
  paint.delete();
  surface.delete();
  return px;
}

/**
 * The GPU runs the hash in float32, where the last `fract` of a product near 20,000 is good to
 * about 0.005, so a hash that is 0.995 here can be 0.004 there: MEASURED, 2 of 192 cells in one
 * frame of the cover. Both are still a random order; the twin is exact away from a whole
 * number, and a cell that close to one is not a claim this test can make.
 */
function nearWrap(h: number): boolean {
  return h < 0.01 || h > 0.99;
}

describe('the shaders compile and match their JavaScript twins (CanvasKit)', () => {
  test('SWAP_SKSL and COVER_SKSL compile', () => {
    expect(compile(SWAP_SKSL)).toEqual({ ok: true, error: '' });
    expect(compile(COVER_SKSL)).toEqual({ ok: true, error: '' });
  });

  test('PixelSwap: at every moment each cell shows what swapLocal and swapWindow say it shows', () => {
    const W = 72;
    const H = 48;
    const g = swapGrid(W, H, 12, 256, 3);
    const times = swapTimes(900, 240);
    const fx = CK.RuntimeEffect.Make(SWAP_SKSL)!;
    const black = CK.Shader.MakeColor(CK.BLACK, CK.ColorSpace.SRGB);
    const white = CK.Shader.MakeColor(CK.WHITE, CK.ColorSpace.SRGB);
    let checked = 0;
    for (const pattern of ['spiral', 'center', 'random'] as const) {
      for (const t of [0, 120, 300, 450, 600, 899, 900]) {
        const u = [g.size, g.cols, g.rows, patternUniform(pattern), 0, t, times.total, times.cell, 0.35, 0, 1, ...EASE_BEZIER];
        const sh = fx.makeShaderWithChildren(u, [black, white]);
        const px = draw(sh, W, H);
        sh.delete();
        for (let r = 0; r < g.rows; r++) {
          for (let c = 0; c < g.cols; c++) {
            if (pattern === 'random' && nearWrap(hash12(c + 1, r + 1))) continue;
            const off = swapOffset(c, r, g, pattern);
            const raw = (t - off * times.spread) / times.cell;
            // Skip a cell within a hair of starting or finishing: the GPU's hash is float32 (its
            // last `fract` of a product near 20,000 is good to about 0.005), this one doubles.
            if (Math.abs(raw) < 0.03 || Math.abs(raw - 1) < 0.03) continue;
            const local = swapLocal(off, t, times.total, times.cell);
            expect(local).toBeCloseTo(Math.min(1, Math.max(0, raw)), 12);
            const win = swapWindow(local, 0.35, false);
            const half = (win.scale * g.size) / 2;
            // The cell's centre pixel, and a pixel 1.5pt in from its top left corner.
            for (const [ox, oy] of [
              [g.size / 2, g.size / 2],
              [1.5, 1.5],
            ] as const) {
              const x = Math.floor(c * g.size + ox);
              const y = Math.floor(r * g.size + oy);
              if (x >= W || y >= H) continue;
              const d = Math.max(Math.abs(x + 0.5 - (c + 0.5) * g.size), Math.abs(y + 0.5 - (r + 0.5) * g.size));
              if (Math.abs(d - half) < 0.75) continue;
              const want = local >= 1 || (local > 0 && d <= half) ? 255 : 0;
              expect({ pattern, t, c, r, ox, v: px[(y * W + x) * 4] }).toEqual({ pattern, t, c, r, ox, v: want });
              checked++;
            }
          }
        }
      }
    }
    black.delete();
    white.delete();
    fx.delete();
    expect(checked).toBeGreaterThan(300);
  });

  test('PixelSwap backwards: forward 0 brings the first picture back over the second', () => {
    const fx = CK.RuntimeEffect.Make(SWAP_SKSL)!;
    const black = CK.Shader.MakeColor(CK.BLACK, CK.ColorSpace.SRGB);
    const white = CK.Shader.MakeColor(CK.WHITE, CK.ColorSpace.SRGB);
    const at = (t: number) => {
      const sh = fx.makeShaderWithChildren([12, 4, 4, 8, 0, t, 900, 240, 0.35, 0, 0, ...EASE_BEZIER], [black, white]);
      const px = draw(sh, 48, 48);
      sh.delete();
      return px;
    };
    // Backwards, the start shows the second picture (white) and the end the first (black).
    expect(at(0)[0]).toBe(255);
    expect(at(900)[0]).toBe(0);
    black.delete();
    white.delete();
    fx.delete();
  });

  test('PixelTransition: every cell is on or off exactly as coverOn says, at every phase', () => {
    const W = 96;
    const H = 128;
    const g = coverGrid(W, H, 12);
    const fx = CK.RuntimeEffect.Make(COVER_SKSL)!;
    let checked = 0;
    for (const p of [0.2, 0.5, 0.8, 1, 1.3, 1.7, 2]) {
      const { pin, pout } = coverPhases(p);
      const sh = fx.makeShader([g.cell, pin, pout, 1, 1, 1, 1]);
      const px = draw(sh, W, H);
      sh.delete();
      for (let r = 0; r < g.rows; r++) {
        for (let c = 0; c < g.cols; c++) {
          const [hIn, hOut] = coverHashes(c, r);
          if (nearWrap(hIn) || nearWrap(hOut) || Math.abs(hIn - pin) < 0.01 || Math.abs(hOut - pout) < 0.01) continue;
          const x = Math.floor((c + 0.5) * g.cell);
          const y = Math.floor((r + 0.5) * g.cell);
          if (x >= W || y >= H) continue;
          const on = px[(y * W + x) * 4 + 3]! > 0;
          expect({ p, c, r, on }).toEqual({ p, c, r, on: coverOn(hIn, hOut, pin, pout) });
          checked++;
        }
      }
    }
    fx.delete();
    expect(checked).toBeGreaterThan(400);
  });
});

// ─── the folder obeys the kit ──────────────────────────────────────────────────────────

const EFX = join(import.meta.dir, '..', 'src', 'ui', 'bits', 'effects');
const files = readdirSync(EFX)
  .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
  .map((f) => ({ name: f, src: readFileSync(join(EFX, f), 'utf8') }));

/** Source with comments removed, so a rule is checked against code, not prose. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

/** The ports: every file carrying react-bits code or its arithmetic. */
const PORTS = [
  'AnimatedContent.tsx',
  'ClickSpark.tsx',
  'GlareHover.tsx',
  'LogoLoop.tsx',
  'Magnet.tsx',
  'PixelSwap.tsx',
  'PixelTransition.tsx',
  'StarBorder.tsx',
  'comet.ts',
  'entrance.ts',
  'glare.ts',
  'marquee.ts',
  'pull.ts',
  'spark.ts',
  'swap.ts',
];

describe('the effects folder obeys the kit', () => {
  test('there is a folder to check, and every port in it is listed here', () => {
    const names = files.map((f) => f.name);
    for (const p of PORTS) expect(names).toContain(p);
    const components = names.filter((n) => n.endsWith('.tsx') && n !== 'EffectsGallery.tsx');
    for (const c of components) expect(PORTS).toContain(c);
  });

  test('every port keeps David Haz’s notice: the source, the copyright, the permission and the restriction', () => {
    for (const f of files.filter((x) => PORTS.includes(x.name))) {
      const head = f.src.slice(0, f.src.indexOf('*/') + 2);
      expect({ file: f.name, source: /Ported from react-bits `[A-Za-z]+\/[A-Za-z]+\/[A-Za-z]+\.tsx`/.test(head) }).toEqual({ file: f.name, source: true });
      expect({ file: f.name, copyright: head.includes('Copyright (c) 2026 David Haz') }).toEqual({ file: f.name, copyright: true });
      expect({ file: f.name, permission: head.includes('Permission is hereby granted, free of charge') }).toEqual({ file: f.name, permission: true });
      expect({ file: f.name, clause: head.includes('Commons Clause Restriction') }).toEqual({ file: f.name, clause: true });
      expect({ file: f.name, changes: head.includes('What changed in the port') }).toEqual({ file: f.name, changes: true });
    }
  });

  test('every component has a Reduce Motion path, and says what it is in its header', () => {
    for (const f of files.filter((x) => x.name.endsWith('.tsx') && x.name !== 'EffectsGallery.tsx')) {
      expect({ file: f.name, hook: code(f.src).includes('useReduceMotion()') }).toEqual({ file: f.name, hook: true });
      expect({ file: f.name, still: /Reduce Motion:/.test(f.src.slice(0, f.src.indexOf('*/'))) }).toEqual({ file: f.name, still: true });
    }
  });

  test('no colour literal: every colour comes from tokens.json through theme.ts', () => {
    for (const f of files) {
      const hits = code(f.src).match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\(|'white'|'black'/g) ?? [];
      expect({ file: f.name, hits }).toEqual({ file: f.name, hits: [] });
    }
  });

  test('no gradient anywhere, the glare included', () => {
    for (const f of files) {
      expect({ file: f.name, gradient: /Gradient\b|gradient\(/.test(code(f.src)) }).toEqual({ file: f.name, gradient: false });
    }
  });

  test('no emoji', () => {
    for (const f of files) {
      expect({ file: f.name, emoji: /\p{Extended_Pictographic}/u.test(f.src) }).toEqual({ file: f.name, emoji: false });
    }
  });

  test('radii from the rule, every rounded rectangle continuous', () => {
    for (const f of files) {
      const c = code(f.src);
      for (const m of c.matchAll(/borderRadius:\s*([^,}\n]+)/g)) {
        const expr = (m[1] ?? '').trim();
        expect({ file: f.name, expr, ok: /^(SHAPE[.[]|radius\b)/.test(expr) }).toEqual({ file: f.name, expr, ok: true });
      }
      const radii = (c.match(/borderRadius:/g) ?? []).length;
      const curves = (c.match(/borderCurve:\s*'continuous'/g) ?? []).length;
      expect({ file: f.name, radii, curves }).toEqual({ file: f.name, radii, curves: radii });
    }
  });

  test('spacing literals from the scale', () => {
    const allowed = new Set<number>([0, 4, 8, 12, 14, 16, 24, 32, 40, 64]);
    for (const f of files) {
      for (const m of code(f.src).matchAll(/\b(gap|padding(?:Horizontal|Vertical|Top|Bottom|Left|Right)?|margin(?:Horizontal|Vertical|Top|Bottom|Left|Right)?):\s*(\d+(?:\.\d+)?)\b/g)) {
        const v = Number(m[2]);
        expect({ file: f.name, prop: m[1], v, ok: allowed.has(v) }).toEqual({ file: f.name, prop: m[1], v, ok: true });
      }
    }
  });

  test('every Reanimated timing in a component opts out of the launch-time switch: Reduce Motion is handled live', () => {
    for (const f of files.filter((x) => x.name.endsWith('.tsx'))) {
      const c = code(f.src);
      const timings = (c.match(/withTiming\(/g) ?? []).length;
      const never = (c.match(/reduceMotion: ReduceMotion\.Never/g) ?? []).length;
      expect({ file: f.name, timings, never: Math.min(never, timings) }).toEqual({ file: f.name, timings, never: timings });
    }
  });

  test('the gallery is not in the barrel (Metro does not tree shake)', () => {
    const barrel = files.find((f) => f.name === 'index.ts')!;
    expect(code(barrel.src).includes('EffectsGallery')).toBe(false);
  });
});

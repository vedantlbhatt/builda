/**
 * The ported react-bits components (`src/ui/bits/components`), without a renderer: every pose,
 * release rule, layout, entrance plan and fill rule the components draw from, and the four
 * SkSL programs compiled and drawn through CanvasKit (the SkSL compiler React Native Skia
 * ships) and held pixel for pixel against their JavaScript twins. A wrong number here is a
 * card in the wrong place or a cell in the wrong colour on every screen that uses it.
 *
 * The last group reads the folder's SOURCE: David Haz's notice in every port (the licence asks
 * for it), a Reduce Motion path in every component, and the kit's token rules (no colour or
 * radius literal, continuous corners, no gradient, no emoji).
 */
import { beforeAll, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { hash12 as dissolveHash, DISSOLVE_SKSL } from '../src/onboarding/shaders';
import { tokens } from '../src/generated/tokens';
import { bayer8 } from '../src/ui/dithering';
import { POP, SHEET, SNAP, STAGGER, STAGGER_CAP, T } from '../src/ui/motionSpec';
import {
  BAYER_SKSL,
  EDGE_SKSL,
  FIELD_SKSL,
  FIELD_WAVE,
  HASH_SKSL,
  PIXEL_FILL_SKSL,
  SPOTLIGHT_SKSL,
  cellHalf,
  cellTurn,
  clearBoxFor,
  edgeCovers,
  fillCovers,
  fillGeometry,
  fillSpan,
  hash12,
  inkFlipped,
  level3,
  spotAmount,
  spotLevel,
} from '../src/ui/bits/components/fills';
import {
  activeSlide,
  bentoGlow,
  bentoLayout,
  bringToTop,
  carouselTarget,
  depthIn,
  dragTilt,
  fanPoses,
  glareOffset,
  hitTest,
  initialOrder,
  introPoint,
  magnetOffset,
  nearestFanCard,
  pilePose,
  pushDelay,
  pushedPose,
  rotateOrder,
  rubberBand,
  seededTurn,
  sendsToBack,
  sendToBack,
  slideTurn,
  swapBox,
  swapSlot,
  swapTimeline,
  tiltAt,
  topOf,
  windowSlots,
  wrapIndex,
} from '../src/ui/bits/components/geometry';
import {
  CHECK_LENGTH,
  CHECK_PATH,
  barFill,
  connectorFill,
  edgeStrengths,
  entranceAt,
  planEntrances,
  stepLabel,
  stepStatus,
} from '../src/ui/bits/components/lists';
import { AMBIENT, BENTO, BOUNCE, CARD_SWAP, CAROUSEL, LIST, PIXEL, PROFILE, SPOT, STACK, STEPPER, TILT } from '../src/ui/bits/components/spec';

// ─── the numbers ──────────────────────────────────────────────────────────────────────────

describe('spec: the doc numbers, and what each cut from react-bits', () => {
  test('the design doc numbers (DESIGN-V2 3 and 4.3)', () => {
    expect(AMBIENT).toEqual({ fps: 20, speed: 0.3 });
    expect(TILT.maxDeg).toBe(8);
    expect(TILT.glareMs).toBe(380);
    expect(TILT.perspective).toBe(800);
    expect(SPOT.radius).toBe(120);
    expect(SPOT.outMs).toBe(T.std);
    expect(SPOT.inMs).toBe(T.press);
    expect(PIXEL.ms).toBe(240);
    expect(PIXEL.cell).toBe(tokens.dither.cell);
    expect(PIXEL.flipAt).toBe(0.5);
    expect(CARD_SWAP.cardDistance).toBe(16);
    expect(CARD_SWAP.verticalDistance).toBe(18);
    expect(CARD_SWAP.skew).toBe(2);
    expect(CARD_SWAP.staggerMs).toBe(150);
    expect(CAROUSEL.rotateDeg).toBe(35);
    expect(CAROUSEL.flick).toBe(800);
    expect(CAROUSEL.commitShare).toBe(0.3);
    expect(BOUNCE.fromScale).toBe(0.94);
    expect(BOUNCE.staggerMs).toBe(60);
  });

  test('react-bits numbers kept as written', () => {
    expect([...BOUNCE.rotations]).toEqual([10, 5, -3, -10, 2]);
    expect([...BOUNCE.offsets]).toEqual([-170, -85, 0, 85, 170]);
    expect(BOUNCE.designWidth).toBe(400);
    expect(BOUNCE.pushPt).toBe(160);
    expect(BOUNCE.pushStaggerMs).toBe(50);
    expect(STACK.rotateStep).toBe(4);
    expect(STACK.scaleStep).toBe(0.06);
    expect(STACK.perspective).toBe(600);
    expect(STACK.origin).toBe(0.9);
    expect(CARD_SWAP.perspective).toBe(900);
    expect(CARD_SWAP.depthFactor).toBe(1.5);
    expect(PROFILE.initialX).toBe(70);
    expect(PROFILE.initialY).toBe(60);
    expect(PROFILE.initialMs).toBe(1200);
    expect(PROFILE.aspect).toBe(0.718);
    expect(BENTO.magnet).toBe(0.05);
    expect(BENTO.proximity).toBe(0.5);
    expect(BENTO.fade).toBe(0.75);
    expect(LIST.fadeDistance).toBe(50);
    expect(CAROUSEL.perspective).toBe(1000);
    expect(CAROUSEL.gap).toBe(16);
    expect(CAROUSEL.dotActiveScale).toBe(1.2);
    expect(STEPPER.checkDelayMs).toBe(100);
    expect(STEPPER.checkMs).toBe(300);
    expect(FIELD_WAVE).toEqual({ speed: 0.05, frequency: 3, amplitude: 0.3 });
  });

  test('the cuts go the right way: gentler than the web, never louder', () => {
    expect(TILT.maxDeg).toBeLessThan(14);
    expect(TILT.pressScale).toBeLessThan(1.1);
    expect(STACK.tiltDeg).toBeLessThan(60);
    expect(BENTO.tiltDeg).toBeLessThan(10);
    expect(CAROUSEL.rotateDeg).toBeLessThan(90);
    expect(LIST.fromScale).toBeGreaterThan(0.7);
    expect(BOUNCE.fromScale).toBeGreaterThan(0);
  });

  test('every duration is the kit vocabulary or under 300ms, and snaps are under 120ms', () => {
    for (const ms of [SPOT.inMs, SPOT.outMs, PIXEL.ms, LIST.enterMs, LIST.fadeMs, BOUNCE.snapMs, PROFILE.snapMs, CAROUSEL.dotMs, STEPPER.checkMs]) {
      expect(ms).toBeLessThanOrEqual(300);
    }
    for (const ms of [LIST.fadeMs, BOUNCE.snapMs, PROFILE.snapMs, PIXEL.reducedMs]) expect(ms).toBeLessThanOrEqual(120);
    expect(LIST.stagger).toBe(STAGGER);
    expect(LIST.risePt).toBeGreaterThanOrEqual(8);
    expect(LIST.risePt).toBeLessThanOrEqual(12);
  });

  test('the glare is three flat steps, 24pt across, faint', () => {
    expect([...TILT.glareSteps]).toEqual([0.06, 0.1, 0.06]);
    expect(TILT.glareStepPt * TILT.glareSteps.length).toBe(24);
    for (const a of TILT.glareSteps) expect(a).toBeLessThanOrEqual(0.1);
  });

  test('the pieces that sit on the space scale', () => {
    const scale = new Set<number>(Object.values(tokens.space));
    expect(scale.has(LIST.edgeTop)).toBe(true);
    expect(scale.has(LIST.edgeBottom)).toBe(true);
    expect(scale.has(STEPPER.barHeight)).toBe(true);
    expect(scale.has(CAROUSEL.dotBox)).toBe(true);
    expect(BENTO.gap).toBe(tokens.layout.tileGap);
    // Creatures at 16, 32, 48 or 64 only.
    expect([16, 32, 48, 64]).toContain(PROFILE.creature);
  });
});

// ─── Stack ────────────────────────────────────────────────────────────────────────────────

describe('Stack', () => {
  test('the pile: the top card is flat and full size, each below 4 degrees and 6% on', () => {
    expect(pilePose(0)).toEqual({ rotate: 0, scale: 1 });
    expect(pilePose(1)).toEqual({ rotate: 4, scale: 0.94 });
    expect(pilePose(3).rotate).toBe(12);
    expect(pilePose(3).scale).toBeCloseTo(0.82, 10);
    expect(pilePose(-2)).toEqual({ rotate: 0, scale: 1 });
    expect(pilePose(1, 2.5).rotate).toBe(6.5);
  });

  test('react-bits steps its scale from 0.94 on top; here the step is the same and the top is 1', () => {
    const n = 4;
    for (let i = 0; i < n; i++) {
      const web = 1 + i * 0.06 - n * 0.06;
      const depth = n - 1 - i;
      expect(pilePose(depth).scale - pilePose(0).scale).toBeCloseTo(web - (1 + (n - 1) * 0.06 - n * 0.06), 10);
      expect(pilePose(depth).rotate).toBe((n - i - 1) * 4);
    }
  });

  test('the seeded turn: fixed per card, inside plus or minus 5, not all the same', () => {
    const turns = Array.from({ length: 15 }, (_, i) => seededTurn(i));
    for (const t of turns) {
      expect(Math.abs(t)).toBeLessThanOrEqual(STACK.jitterDeg);
    }
    expect(turns).toEqual(Array.from({ length: 15 }, (_, i) => seededTurn(i)));
    expect(new Set(turns.map((t) => t.toFixed(3))).size).toBe(15);
    expect(turns.some((t) => t < 0) && turns.some((t) => t > 0)).toBe(true);
  });

  test('the drag leans toward the finger at 12 degrees per 100pt, and no further', () => {
    expect(dragTilt(0, 0)).toEqual({ rotateX: -0, rotateY: 0 });
    expect(dragTilt(50, 0).rotateY).toBe(6);
    expect(dragTilt(0, 50).rotateX).toBe(-6);
    expect(dragTilt(400, -400)).toEqual({ rotateX: 12, rotateY: 12 });
    expect(dragTilt(-400, 400)).toEqual({ rotateX: -12, rotateY: -12 });
  });

  test('a release sends the card back past the sensitivity on either axis, or on a flick', () => {
    expect(sendsToBack({ dx: 111, dy: 0, vx: 0, vy: 0 })).toBe(true);
    expect(sendsToBack({ dx: 0, dy: -111, vx: 0, vy: 0 })).toBe(true);
    expect(sendsToBack({ dx: 60, dy: 60, vx: 100, vy: 100 })).toBe(false);
    expect(sendsToBack({ dx: 10, dy: 0, vx: 800, vy: 0 })).toBe(true);
    expect(sendsToBack({ dx: 10, dy: 0, vx: 600, vy: 600 })).toBe(true);
    expect(sendsToBack({ dx: 10, dy: 0, vx: 500, vy: 0 })).toBe(false);
    expect(sendsToBack({ dx: 150, dy: 0, vx: 0, vy: 0 }, 200)).toBe(false);
  });

  test('the order: bottom to top, the top card goes to the bottom, and back', () => {
    const o = initialOrder(4);
    expect(o).toEqual([3, 2, 1, 0]);
    expect(topOf(o)).toBe(0);
    const next = sendToBack(o, 0);
    expect(next).toEqual([0, 3, 2, 1]);
    expect(topOf(next)).toBe(1);
    expect(depthIn(next, 0)).toBe(3);
    expect(depthIn(next, 9)).toBe(-1);
    expect(bringToTop(next)).toEqual(o);
    expect(sendToBack(o, 7)).toEqual(o);
    expect(initialOrder(4, 2)).toEqual([1, 0, 3, 2]);
    expect(initialOrder(0)).toEqual([]);
    expect(topOf([])).toBe(-1);
  });

  test('sending every card back once is a full turn of the pile', () => {
    let o = initialOrder(5);
    const tops: number[] = [];
    for (let i = 0; i < 5; i++) {
      tops.push(topOf(o));
      o = sendToBack(o, topOf(o));
    }
    expect(tops).toEqual([0, 1, 2, 3, 4]);
    expect(o).toEqual(initialOrder(5));
  });
});

// ─── CardSwap ─────────────────────────────────────────────────────────────────────────────

describe('CardSwap', () => {
  test('slot 0 is the front: in place, full size, on top', () => {
    expect(swapSlot(0, 3)).toEqual({ x: 0, y: -0, scale: 1, zIndex: 3 });
  });

  test('each slot back climbs up and right, smaller, lower in z: react-bits through perspective 900', () => {
    const a = swapSlot(1, 3);
    const b = swapSlot(2, 3);
    expect(a.scale).toBeCloseTo(900 / (900 + 16 * 1.5), 10);
    expect(b.scale).toBeCloseTo(900 / (900 + 32 * 1.5), 10);
    expect(a.x).toBeCloseTo(16 * a.scale, 10);
    expect(a.y).toBeCloseTo(-18 * a.scale, 10);
    expect(b.x).toBeGreaterThan(a.x);
    expect(b.y).toBeLessThan(a.y);
    expect(b.scale).toBeLessThan(a.scale);
    expect([a.zIndex, b.zIndex]).toEqual([2, 1]);
  });

  test('the box holds the whole fan', () => {
    const box = swapBox(200, 150, 3);
    const back = swapSlot(2, 3);
    expect(box.width).toBeGreaterThanOrEqual(200 + back.x);
    expect(box.height).toBeGreaterThanOrEqual(150 - back.y);
    expect(swapBox(200, 150, 1)).toEqual({ width: 200, height: 150 });
  });

  test('a swap moves the front card to the back of the order', () => {
    expect(rotateOrder([0, 1, 2])).toEqual([1, 2, 0]);
    expect(rotateOrder(rotateOrder(rotateOrder([0, 1, 2])))).toEqual([0, 1, 2]);
    expect(rotateOrder([4])).toEqual([4]);
  });

  test('the beats: drop first, the rest 150ms apart, the return after the promote starts', () => {
    const tl = swapTimeline();
    expect(tl.dropMs).toBe(0);
    expect(tl.promoteMs(0)).toBe(CARD_SWAP.promoteMs);
    expect(tl.promoteMs(1) - tl.promoteMs(0)).toBe(150);
    expect(tl.returnMs).toBeGreaterThan(tl.promoteMs(0));
    // The dropped card starts back once its drop spring has settled.
    expect(tl.returnMs).toBeGreaterThanOrEqual(SHEET.duration);
  });
});

// ─── BounceCards ──────────────────────────────────────────────────────────────────────────

describe('BounceCards', () => {
  test('five cards are react-bits transforms exactly, scaled to the box', () => {
    expect(fanPoses(5, 400)).toEqual([
      { x: -170, rotate: 10 },
      { x: -85, rotate: 5 },
      { x: 0, rotate: -3 },
      { x: 85, rotate: -10 },
      { x: 170, rotate: 2 },
    ]);
    const half = fanPoses(5, 200);
    expect(half.map((p) => p.x)).toEqual([-85, -42.5, 0, 42.5, 85]);
  });

  test('another count spreads the same span evenly and cycles the turns', () => {
    const three = fanPoses(3, 400);
    expect(three.map((p) => p.x)).toEqual([-170, 0, 170]);
    expect(three.map((p) => p.rotate)).toEqual([10, 5, -3]);
    expect(fanPoses(1, 400)).toEqual([{ x: 0, rotate: 10 }]);
    expect(fanPoses(0, 400)).toEqual([]);
    expect(fanPoses(7, 400)[5]!.rotate).toBe(10);
  });

  test('the spread: the held card straightens where it is, the rest move away', () => {
    const base = fanPoses(5, 400);
    expect(pushedPose(2, 2, base[2]!, 160)).toEqual({ x: 0, rotate: 0 });
    expect(pushedPose(0, 2, base[0]!, 160)).toEqual({ x: -330, rotate: 10 });
    expect(pushedPose(4, 2, base[4]!, 160)).toEqual({ x: 330, rotate: 2 });
    expect(pushedPose(3, -1, base[3]!, 160)).toEqual(base[3]!);
    expect([0, 1, 2, 3, 4].map((i) => pushDelay(i, 2))).toEqual([100, 50, 0, 50, 100]);
    expect(pushDelay(3, -1)).toBe(0);
  });

  test('the finger picks the nearest card by its place in the fan', () => {
    const poses = fanPoses(5, 400);
    expect(nearestFanCard(200, poses, 400)).toBe(2);
    expect(nearestFanCard(0, poses, 400)).toBe(0);
    expect(nearestFanCard(400, poses, 400)).toBe(4);
    expect(nearestFanCard(200 + 60, poses, 400)).toBe(3);
    expect(nearestFanCard(10, [], 400)).toBe(-1);
  });
});

// ─── Carousel ─────────────────────────────────────────────────────────────────────────────

describe('Carousel', () => {
  const base = { from: 2, pitch: 280, count: 8, loop: false };

  test('30% of a slide moves on; less settles back', () => {
    expect(carouselTarget({ ...base, position: 2.31, vx: 0 })).toBe(3);
    expect(carouselTarget({ ...base, position: 2.29, vx: 0 })).toBe(2);
    expect(carouselTarget({ ...base, position: 1.69, vx: 0 })).toBe(1);
    expect(carouselTarget({ ...base, position: 1.72, vx: 0 })).toBe(2);
  });

  test('a flick at 800pt/s moves one in its direction, however short the drag', () => {
    expect(carouselTarget({ ...base, position: 2.02, vx: -800 })).toBe(3);
    expect(carouselTarget({ ...base, position: 1.98, vx: 800 })).toBe(1);
    expect(carouselTarget({ ...base, position: 2.02, vx: -799 })).toBe(2);
  });

  test('never more than one slide, never off the ends unless it loops', () => {
    expect(carouselTarget({ ...base, position: 4.5, vx: 0 })).toBe(3);
    expect(carouselTarget({ ...base, from: 7, position: 7.5, vx: -2000 })).toBe(7);
    expect(carouselTarget({ ...base, from: 0, position: -0.5, vx: 2000 })).toBe(0);
    expect(carouselTarget({ ...base, from: 7, position: 7.5, vx: -2000, loop: true })).toBe(8);
    expect(carouselTarget({ ...base, from: 0, position: -0.5, vx: 0, loop: true })).toBe(-1);
  });

  test('a neighbour turns 35 degrees and is held there', () => {
    expect(slideTurn(2, 2)).toBe(0);
    expect(slideTurn(3, 2)).toBe(35);
    expect(slideTurn(1, 2)).toBe(-35);
    expect(slideTurn(2.5, 2)).toBe(17.5);
    expect(slideTurn(6, 2)).toBe(35);
  });

  test('the rubber band: a quarter past the ends, nothing inside, nothing on a loop', () => {
    expect(rubberBand(-1, 8, false)).toBe(-0.25);
    expect(rubberBand(9, 8, false)).toBe(7.5);
    expect(rubberBand(3.3, 8, false)).toBe(3.3);
    expect(rubberBand(-1, 8, true)).toBe(-1);
  });

  test('the active slide holds until past 0.55 of a slide, then jumps to the nearest', () => {
    expect(activeSlide(2.5, 2)).toBe(2);
    expect(activeSlide(2.56, 2)).toBe(3);
    expect(activeSlide(1.44, 2)).toBe(1);
    expect(activeSlide(3.9, 2)).toBe(4);
  });

  test('wrapping and the drawn window', () => {
    expect(wrapIndex(-1, 8)).toBe(7);
    expect(wrapIndex(8, 8)).toBe(0);
    expect(wrapIndex(17, 8)).toBe(1);
    expect(wrapIndex(3, 0)).toBe(0);
    expect(windowSlots(0, 8, false)).toEqual([0, 1, 2]);
    expect(windowSlots(0, 8, true)).toEqual([-2, -1, 0, 1, 2]);
    expect(windowSlots(7, 8, false)).toEqual([5, 6, 7]);
    expect(windowSlots(0, 0, true)).toEqual([]);
  });
});

// ─── TiltedCard ───────────────────────────────────────────────────────────────────────────

describe('TiltedCard', () => {
  test('the centre is flat; the edges are the amplitude, signed as react-bits signs them', () => {
    expect(tiltAt(150, 100, 300, 200)).toEqual({ rotateX: -0, rotateY: 0 });
    expect(tiltAt(300, 100, 300, 200).rotateY).toBe(8);
    expect(tiltAt(0, 100, 300, 200).rotateY).toBe(-8);
    expect(tiltAt(150, 0, 300, 200).rotateX).toBe(8);
    expect(tiltAt(150, 200, 300, 200).rotateX).toBe(-8);
    expect(tiltAt(225, 150, 300, 200)).toEqual({ rotateX: -4, rotateY: 4 });
  });

  test('a finger slid off the card is held at the amplitude', () => {
    expect(tiltAt(900, -500, 300, 200)).toEqual({ rotateX: 8, rotateY: 8 });
    expect(tiltAt(-50, -50, 10, 10, 14)).toEqual({ rotateX: 14, rotateY: -14 });
    // A card with no size yet is flat, never NaN.
    expect(tiltAt(0, 0, 0, 0, 14)).toEqual({ rotateX: -0, rotateY: 0 });
  });

  test('the glare sweeps a card width and a half across the full lean', () => {
    expect(glareOffset(0, 8, 300)).toBe(0);
    expect(glareOffset(8, 8, 300)).toBe(225);
    expect(glareOffset(-16, 8, 300)).toBe(-225);
    expect(glareOffset(4, 0, 300)).toBe(0);
  });

  test('ProfileCard arrives from react-bits initial pointer, near the top right', () => {
    expect(introPoint(360)).toEqual({ x: 290, y: 60 });
    expect(introPoint(40)).toEqual({ x: 0, y: 60 });
    const lean = tiltAt(introPoint(360).x, introPoint(360).y, 360, 500);
    expect(lean.rotateY).toBeGreaterThan(0);
    expect(lean.rotateX).toBeGreaterThan(0);
  });
});

// ─── MagicBento ───────────────────────────────────────────────────────────────────────────

describe('MagicBento', () => {
  const width = 361;
  const gap = 12;
  const colW = (width - gap) / 2;

  function overlaps(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
    return a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6;
  }

  test('two columns of 1x1 tiles fill row by row', () => {
    const { rects, height } = bentoLayout([{}, {}, {}, {}], width, 2, gap, 120);
    expect(rects.map((r) => [r.x, r.y])).toEqual([
      [0, 0],
      [colW + gap, 0],
      [0, 132],
      [colW + gap, 132],
    ]);
    expect(rects[0]!.w).toBeCloseTo(colW, 10);
    expect(height).toBe(252);
  });

  test('a wide tile takes a row; a tall one takes two; a small one fills the hole (dense)', () => {
    const { rects, height } = bentoLayout([{ span: 2 }, { rows: 2 }, {}, {}], width, 2, gap, 120);
    expect(rects[0]).toEqual({ x: 0, y: 0, w: width, h: 120 });
    expect(rects[1]).toEqual({ x: 0, y: 132, w: colW, h: 252 });
    expect(rects[2]).toEqual({ x: colW + gap, y: 132, w: colW, h: 120 });
    expect(rects[3]).toEqual({ x: colW + gap, y: 264, w: colW, h: 120 });
    expect(height).toBe(384);
  });

  test('no two tiles overlap, every tile is inside the width, for a mixed list', () => {
    const items = [{ span: 2 }, {}, { rows: 2 }, {}, { span: 2, rows: 2 }, {}, { span: 3 }, {}];
    const { rects, height } = bentoLayout(items, width, 2, gap, 100);
    expect(rects.length).toBe(items.length);
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i]!;
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(width + 1e-6);
      expect(r.y + r.h).toBeLessThanOrEqual(height + 1e-6);
      for (let j = i + 1; j < rects.length; j++) expect(overlaps(r, rects[j]!)).toBe(false);
    }
    // A span wider than the grid is clamped to it.
    expect(rects[6]!.w).toBe(width);
    expect(bentoLayout([], width).height).toBe(0);
  });

  test('the shared light: full within half the radius of the edge, gone past three quarters', () => {
    const r = { x: 0, y: 0, w: 100, h: 100 };
    expect(bentoGlow(50, 50, r, 160)).toBe(1);
    expect(bentoGlow(50 + 50 + 80, 50, r, 160)).toBe(1);
    expect(bentoGlow(50 + 50 + 120, 50, r, 160)).toBe(0);
    expect(bentoGlow(50 + 50 + 100, 50, r, 160)).toBeCloseTo(0.5, 10);
    expect(bentoGlow(-1000, 50, r, 160)).toBe(0);
  });

  test('hit test and magnetism', () => {
    const { rects } = bentoLayout([{}, {}, {}], width, 2, gap, 120);
    expect(hitTest(rects, 10, 10)).toBe(0);
    expect(hitTest(rects, colW + gap + 1, 10)).toBe(1);
    expect(hitTest(rects, 10, 140)).toBe(2);
    expect(hitTest(rects, colW + 6, 10)).toBe(-1);
    expect(hitTest(rects, colW + gap + 10, 200)).toBe(-1);
    expect(magnetOffset(100, 60, { x: 0, y: 0, w: 100, h: 100 })).toEqual({ x: 2.5, y: 0.5 });
  });
});

// ─── PixelCard's fill ─────────────────────────────────────────────────────────────────────

describe('PixelCard: the fill grows out of the finger', () => {
  const w = 111;
  const h = 88;
  const g = fillGeometry([20, 70], w, h);
  const cols = Math.ceil(w / g.cell);
  const rows = Math.ceil(h / g.cell);

  test('the span reaches the farthest corner', () => {
    expect(fillSpan([0, 0], 30, 40)).toBe(50);
    expect(fillSpan([15, 20], 30, 40)).toBe(25);
    expect(g.span).toBeCloseTo(Math.hypot(111 - 20, 70), 10);
  });

  test('nothing at 0, a solid tile at 1', () => {
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        expect(fillCovers(x + 0.5, y + 0.5, 0, g)).toBe(false);
        expect(fillCovers(x + 0.5, y + 0.5, 1, g)).toBe(true);
      }
    }
  });

  test('a cell before its turn inks nothing, not even the pixel at its exact centre', () => {
    // At @3x a 3pt cell is 9 by 9 pixels and pixel 4's centre IS the cell's centre, where a
    // square of half size 0 still "contains" the point under `<=`: every cell showed a dot from
    // the first frame (seen on the contact sheet, fixed with a strict test).
    for (const p of [0.01, 0.1, 0.3]) {
      for (let iy = 0; iy < rows; iy++) {
        for (let ix = 0; ix < cols; ix++) {
          if (cellTurn(ix, iy, g) < p) continue;
          for (let k = 0; k < 9; k++) {
            for (let j = 0; j < 9; j++) expect(fillCovers(ix * 3 + (k + 0.5) / 3, iy * 3 + (j + 0.5) / 3, p, g)).toBe(false);
          }
        }
      }
    }
  });

  test('every cell turns inside the run and has fully grown by 1', () => {
    for (let iy = 0; iy < rows; iy++) {
      for (let ix = 0; ix < cols; ix++) {
        const t = cellTurn(ix, iy, g);
        expect(t).toBeGreaterThanOrEqual(0);
        expect(t).toBeLessThanOrEqual(1 - g.grow + 1e-12);
        expect(cellHalf(ix, iy, 1, g)).toBe(g.cell / 2);
      }
    }
  });

  test('a cell only ever grows as the run goes on', () => {
    for (const [ix, iy] of [
      [0, 0],
      [6, 23],
      [36, 29],
      [20, 10],
    ] as const) {
      let last = -1;
      for (let p = 0; p <= 1.0001; p += 0.02) {
        const s = cellHalf(ix, iy, p, g);
        expect(s).toBeGreaterThanOrEqual(last);
        last = s;
      }
    }
  });

  test('without the jitter the front is the distance: nearer cells always turn first', () => {
    const plain = { ...g, jitter: 0 };
    const at = (ix: number, iy: number) => cellTurn(ix, iy, plain);
    expect(at(6, 23)).toBeLessThan(at(20, 10));
    expect(at(20, 10)).toBeLessThan(at(36, 0));
    // With it, the finger's own cell still starts in the first third of the run.
    expect(cellTurn(6, 23, g)).toBeLessThan(0.35);
  });

  test('coverage rises with the run', () => {
    const covered = (p: number) => {
      let n = 0;
      for (let y = 0; y < h; y += 3) for (let x = 0; x < w; x += 3) n += fillCovers(x + 1.5, y + 1.5, p, g) ? 1 : 0;
      return n;
    };
    const steps = [0, 0.2, 0.4, 0.6, 0.8, 1].map(covered);
    for (let i = 1; i < steps.length; i++) expect(steps[i]!).toBeGreaterThanOrEqual(steps[i - 1]!);
    expect(steps[0]).toBe(0);
    expect(steps[5]).toBe(Math.ceil(w / 3) * Math.ceil(h / 3));
  });

  test('the words flip to the ink on the fill at half way, both ways', () => {
    expect(inkFlipped(0.49)).toBe(false);
    expect(inkFlipped(0.5)).toBe(true);
    expect(inkFlipped(1)).toBe(true);
  });

  test('the hash is the dissolve hash: one definition in SkSL, one twin in JavaScript', () => {
    for (let y = -5; y < 40; y += 3) for (let x = -5; x < 60; x += 7) expect(hash12(x, y)).toBe(dissolveHash(x, y));
    const body = HASH_SKSL.trim().split('\n').slice(1).map((l) => l.trim());
    for (const line of body) expect(DISSOLVE_SKSL).toContain(line);
  });
});

// ─── the three levels, the spotlight, the edges ───────────────────────────────────────────

describe('the three level dither', () => {
  test('0 is paper, 1 is ink, strictly above the threshold', () => {
    expect(level3(0, 0)).toBe(0);
    expect(level3(1, 63 / 64)).toBe(2);
    expect(level3(0.25, 0.5)).toBe(0);
    expect(level3(0.26, 0.5)).toBe(1);
    expect(level3(0.5, 0.99)).toBe(1);
    expect(level3(0.75, 0.5)).toBe(1);
    expect(level3(0.76, 0.5)).toBe(2);
  });

  test('over an 8x8 tile, the share of each level follows the amount', () => {
    const share = (v: number) => {
      const n = [0, 0, 0];
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) n[level3(v, bayer8(x, y))]! += 1;
      return n;
    };
    expect(share(0)).toEqual([64, 0, 0]);
    expect(share(0.25)).toEqual([32, 32, 0]);
    expect(share(0.5)).toEqual([0, 64, 0]);
    expect(share(0.75)).toEqual([0, 32, 32]);
    expect(share(1)).toEqual([0, 0, 64]);
  });
});

describe('SpotlightCard: a pool of pixels', () => {
  test('the amount falls from the strength at the finger to nothing at the radius', () => {
    expect(spotAmount(0)).toBe(SPOT.strength);
    expect(spotAmount(SPOT.radius)).toBe(0);
    expect(spotAmount(SPOT.radius * 2)).toBe(0);
    // Half way out, a smoothstep is at half, and squared a quarter.
    expect(spotAmount(60, 0.4, 120)).toBeCloseTo(0.1, 10);
    expect(spotAmount(10, 0)).toBe(0);
    let last = Infinity;
    for (let d = 0; d <= 130; d += 5) {
      const v = spotAmount(d);
      expect(v).toBeLessThanOrEqual(last);
      last = v;
    }
  });

  test('subtle by default: the partner only, never the ink', () => {
    for (let iy = 0; iy < 40; iy++) for (let ix = 0; ix < 40; ix++) expect(spotLevel(ix, iy, 3, [60, 60], SPOT.strength, SPOT.radius)).toBeLessThan(2);
  });

  test('densest under the finger, nothing outside the radius', () => {
    let inner = 0;
    let outer = 0;
    for (let iy = 0; iy < 100; iy++) {
      for (let ix = 0; ix < 100; ix++) {
        const d = Math.hypot((ix + 0.5) * 3 - 150, (iy + 0.5) * 3 - 150);
        const on = spotLevel(ix, iy, 3, [150, 150], SPOT.strength, SPOT.radius) > 0;
        if (d > SPOT.radius) expect(on).toBe(false);
        if (d < 30) inner += on ? 1 : 0;
        if (d > 90 && d < 120) outer += on ? 1 : 0;
      }
    }
    expect(inner).toBeGreaterThan(outer);
  });
});

describe('AnimatedList: the edges', () => {
  test('react-bits edge strengths: 50pt of scroll each way, no bottom edge when it all fits', () => {
    expect(edgeStrengths(0, 1000, 400)).toEqual({ top: 0, bottom: 1 });
    expect(edgeStrengths(25, 1000, 400)).toEqual({ top: 0.5, bottom: 1 });
    expect(edgeStrengths(575, 1000, 400)).toEqual({ top: 1, bottom: 0.5 });
    expect(edgeStrengths(600, 1000, 400)).toEqual({ top: 1, bottom: 0 });
    expect(edgeStrengths(0, 300, 400)).toEqual({ top: 0, bottom: 0 });
    expect(edgeStrengths(-40, 1000, 400).top).toBe(0);
  });

  test('the band is densest at the edge and thins toward the list', () => {
    const rows = 16;
    // Over 64 columns and both halves of the band: a Bayer row is not a Bayer average, so the
    // halves are compared, not single rows.
    const half = (from: number, fromBottom: boolean) => {
      let n = 0;
      for (let row = from; row < from + rows / 2; row++) for (let ix = 0; ix < 64; ix++) n += edgeCovers(ix, row, rows, 1, fromBottom) ? 1 : 0;
      return n;
    };
    expect(half(0, false)).toBeGreaterThan(2 * half(rows / 2, false));
    expect(half(rows / 2, true)).toBeGreaterThan(2 * half(0, true));
    // The row against the edge is nearly solid at full strength; the innermost nearly empty.
    let edge = 0;
    let inner = 0;
    for (let ix = 0; ix < 64; ix++) {
      edge += edgeCovers(ix, 0, rows, 1, false) ? 1 : 0;
      inner += edgeCovers(ix, rows - 1, rows, 1, false) ? 1 : 0;
    }
    expect(edge).toBeGreaterThanOrEqual(56);
    expect(inner).toBeLessThanOrEqual(8);
    expect(edgeCovers(3, 0, rows, 0, false)).toBe(false);
  });
});

// ─── AnimatedList and Stepper rules ───────────────────────────────────────────────────────

describe('AnimatedList: who enters, and when', () => {
  test('first load: every row, 40ms apart, the eighth on as a block', () => {
    const keys = Array.from({ length: 12 }, (_, i) => `k${i}`);
    const plan = planEntrances(null, keys);
    expect(keys.map((k) => plan.get(k)!.kind)).toEqual(Array(12).fill('stagger'));
    expect(keys.map((k) => plan.get(k)!.delay)).toEqual([0, 40, 80, 120, 160, 200, 240, 280, 320, 320, 320, 320]);
    expect(Math.max(...keys.map((k) => plan.get(k)!.delay))).toBe(STAGGER_CAP * STAGGER);
    expect(planEntrances([], ['a']).get('a')!.kind).toBe('stagger');
  });

  test('a refresh with the same rows is not an entrance', () => {
    const plan = planEntrances(['a', 'b', 'c'], ['a', 'b', 'c']);
    expect([...plan.values()].every((e) => e.kind === 'none')).toBe(true);
  });

  test('new rows above every known row slide in; appended and middle rows do not', () => {
    const plan = planEntrances(['c', 'd'], ['a', 'b', 'c', 'x', 'd', 'e']);
    expect(plan.get('a')).toEqual({ kind: 'insert', delay: 0 });
    expect(plan.get('b')).toEqual({ kind: 'insert', delay: 40 });
    expect(plan.get('c')!.kind).toBe('none');
    expect(plan.get('x')!.kind).toBe('none');
    expect(plan.get('e')!.kind).toBe('none');
  });

  test('a list replaced outright slides the new rows in', () => {
    const plan = planEntrances(['a'], ['b', 'c']);
    expect(plan.get('b')!.kind).toBe('insert');
    expect(plan.get('c')!.kind).toBe('insert');
  });

  test('a row mounting long after the first load is a scroll, not an entrance', () => {
    const stagger = { kind: 'stagger' as const, delay: 80 };
    expect(entranceAt(stagger, 0)).toEqual(stagger);
    expect(entranceAt(stagger, LIST.firstLoadWindowMs + 1)).toEqual({ kind: 'none', delay: 0 });
    const insert = { kind: 'insert' as const, delay: 0 };
    expect(entranceAt(insert, 60_000)).toEqual(insert);
    expect(entranceAt(undefined, 0)).toEqual({ kind: 'none', delay: 0 });
  });
});

describe('Stepper', () => {
  test('before the current step is complete, the current one active, the rest upcoming', () => {
    expect([0, 1, 2, 3].map((i) => stepStatus(i, 2))).toEqual(['complete', 'complete', 'active', 'upcoming']);
  });

  test('the bars: the current step and every one before it are full; the next fills with the push', () => {
    expect([0, 1, 2, 3].map((i) => barFill(i, 0))).toEqual([1, 0, 0, 0]);
    expect([0, 1, 2, 3].map((i) => barFill(i, 2))).toEqual([1, 1, 1, 0]);
    expect([0, 1, 2, 3].map((i) => barFill(i, 1.25))).toEqual([1, 1, 0.25, 0]);
    expect(barFill(3, 9)).toBe(1);
    expect(barFill(0, -3)).toBe(0);
  });

  test('a connector fills as the flow moves past its step', () => {
    expect([0, 1, 2].map((i) => connectorFill(i, 1))).toEqual([1, 0, 0]);
    expect([0, 1, 2].map((i) => connectorFill(i, 1.5))).toEqual([1, 0.5, 0]);
  });

  test('VoiceOver: one based, never past the end, no dashes', () => {
    expect(stepLabel(0, 4)).toBe('Step 1 of 4');
    expect(stepLabel(3, 4)).toBe('Step 4 of 4');
    expect(stepLabel(9, 4)).toBe('Step 4 of 4');
    expect(stepLabel(-2, 0)).toBe('Step 1 of 1');
  });

  test('the check is react-bits path, and its length is the path length', () => {
    expect(CHECK_PATH).toBe('M5 13l4 4L19 7');
    expect(CHECK_LENGTH).toBeCloseTo(Math.hypot(4, 4) + Math.hypot(10, 10), 10);
  });
});

describe('the pure rules the UI thread reads are worklets', () => {
  test("each carries the 'worklet' directive", () => {
    const fns: [string, (...a: never[]) => unknown][] = [
      ['seededTurn', seededTurn],
      ['pilePose', pilePose],
      ['dragTilt', dragTilt],
      ['sendsToBack', sendsToBack],
      ['swapSlot', swapSlot],
      ['pushedPose', pushedPose],
      ['pushDelay', pushDelay],
      ['nearestFanCard', nearestFanCard],
      ['wrapIndex', wrapIndex],
      ['slideTurn', slideTurn],
      ['carouselTarget', carouselTarget],
      ['rubberBand', rubberBand],
      ['activeSlide', activeSlide],
      ['tiltAt', tiltAt],
      ['glareOffset', glareOffset],
      ['bentoGlow', bentoGlow],
      ['hitTest', hitTest],
      ['magnetOffset', magnetOffset],
      ['inkFlipped', inkFlipped],
      ['edgeStrengths', edgeStrengths],
      ['barFill', barFill],
      ['connectorFill', connectorFill],
    ];
    // Read from the source: Bun's transpiler drops the directive from `fn.toString()`, and the
    // Reanimated plugin reads the source, not the runtime function.
    const src = ['geometry.ts', 'fills.ts', 'lists.ts'].map((f) => readFileSync(join(import.meta.dir, '..', 'src/ui/bits/components', f), 'utf8')).join('\n');
    for (const [name, fn] of fns) {
      expect(typeof fn).toBe('function');
      const at = src.indexOf(`export function ${name}(`);
      const next = src.indexOf('\nexport ', at + 1);
      const body = src.slice(at, next < 0 ? undefined : next);
      expect({ name, found: at >= 0, worklet: body.includes("'worklet';") }).toEqual({ name, found: true, worklet: true });
    }
  });

  test('the springs the components use are the kit vocabulary', () => {
    expect(SNAP).toEqual({ duration: 400, dampingRatio: 1 });
    expect(SHEET).toEqual({ duration: 300, dampingRatio: 0.8 });
    expect(POP).toEqual({ duration: 450, dampingRatio: 0.72 });
  });
});

// ─── the SkSL, through CanvasKit ──────────────────────────────────────────────────────────

interface CanvasKitLike {
  RuntimeEffect: { Make(src: string, onError?: (e: string) => void): RuntimeEffectLike | null };
  MakeSurface(w: number, h: number): SurfaceLike | null;
  Paint: new () => { setShader(s: unknown): void; delete(): void };
  ColorType: { RGBA_8888: unknown };
  AlphaType: { Unpremul: unknown };
  ColorSpace: { SRGB: unknown };
}
interface RuntimeEffectLike {
  makeShader(u: number[]): { delete(): void };
  getUniformCount(): number;
  getUniformFloatCount(): number;
  getUniformName(i: number): string;
}
interface SurfaceLike {
  getCanvas(): { drawPaint(p: unknown): void; clear(c: Float32Array): void; scale(x: number, y: number): void };
  makeImageSnapshot(): { readPixels(x: number, y: number, info: object): Uint8Array | null; delete(): void };
  flush(): void;
  delete(): void;
}

let CK: CanvasKitLike | null = null;

beforeAll(async () => {
  const require = createRequire(join(import.meta.dir, '..', 'package.json'));
  const init = require('canvaskit-wasm') as (o: { locateFile: (f: string) => string }) => Promise<CanvasKitLike>;
  CK = await init({ locateFile: (f: string) => require.resolve(`canvaskit-wasm/bin/${f}`) });
});

const INK = [1, 0, 0, 1];
const PARTNER = [0, 1, 0, 1];

function compile(src: string): RuntimeEffectLike {
  const errors: string[] = [];
  const effect = CK!.RuntimeEffect.Make(src, (e) => errors.push(e));
  expect({ errors, compiled: effect !== null }).toEqual({ errors: [], compiled: true });
  return effect!;
}

/**
 * Draw `src` over a w by h point box at `scale` pixels per point (the phone's @2x or @3x; the
 * shader works in points, as the layers' canvases do) and read it back, RGBA, w*scale wide.
 */
function draw(src: string, uniforms: number[], w: number, h: number, scale: number = 1): Uint8Array {
  const effect = compile(src);
  expect(effect.getUniformFloatCount()).toBe(uniforms.length);
  const surface = CK!.MakeSurface(w * scale, h * scale)!;
  const canvas = surface.getCanvas();
  canvas.clear(new Float32Array([0, 0, 0, 0]));
  canvas.scale(scale, scale);
  const paint = new CK!.Paint();
  const shader = effect.makeShader(uniforms);
  paint.setShader(shader);
  canvas.drawPaint(paint);
  surface.flush();
  const image = surface.makeImageSnapshot();
  const px = image.readPixels(0, 0, {
    width: w * scale,
    height: h * scale,
    colorType: CK!.ColorType.RGBA_8888,
    alphaType: CK!.AlphaType.Unpremul,
    colorSpace: CK!.ColorSpace.SRGB,
  });
  image.delete();
  shader.delete();
  paint.delete();
  surface.delete();
  return px!;
}

/** 0 paper, 1 partner (green), 2 ink (red), for the pixel at (x, y). */
function levelAt(px: Uint8Array, w: number, x: number, y: number): number {
  const i = (y * w + x) * 4;
  if (px[i + 3]! < 128) return 0;
  return px[i]! > 128 ? 2 : 1;
}

function namesOf(src: string): string[] {
  const e = compile(src);
  return Array.from({ length: e.getUniformCount() }, (_, i) => e.getUniformName(i));
}

describe('the SkSL compiles, and draws exactly what its JavaScript twin says', () => {
  test('all four compile with the uniforms the layers write, in order', () => {
    expect(namesOf(PIXEL_FILL_SKSL)).toEqual(['cell', 'origin', 'span', 'jitter', 'grow', 'progress', 'ink']);
    expect(namesOf(SPOTLIGHT_SKSL)).toEqual(['cell', 'origin', 'radius', 'strength', 'ink', 'partner']);
    expect(namesOf(EDGE_SKSL)).toEqual(['cell', 'rows', 'strength', 'fromBottom', 'ink']);
    expect(namesOf(FIELD_SKSL)).toEqual(['cell', 'size', 't', 'frequency', 'amplitude', 'density', 'clearBox', 'ink', 'partner']);
  });

  test('every uniform is written by its layer (a renamed one would draw nothing, silently)', () => {
    const layers = readFileSync(join(import.meta.dir, '..', 'src/ui/bits/components/layers.tsx'), 'utf8');
    for (const src of [PIXEL_FILL_SKSL, SPOTLIGHT_SKSL, EDGE_SKSL, FIELD_SKSL]) {
      for (const name of namesOf(src)) expect({ name, written: new RegExp(`\\b${name}\\b\\s*[:,\\n]`).test(layers) }).toEqual({ name, written: true });
    }
  });

  test('no SkSL feature the phone cannot run: no bitwise ops, no array indexing, loops bounded', () => {
    for (const src of [PIXEL_FILL_SKSL, SPOTLIGHT_SKSL, EDGE_SKSL, FIELD_SKSL, BAYER_SKSL, HASH_SKSL]) {
      expect(/[^&]&[^&]|[^|]\|[^|]|\^|<<|>>|~/.test(src.replace(/\/\/.*$/gm, ''))).toBe(false);
      expect(/\w\[[^\]]*\]/.test(src)).toBe(false);
      for (const m of src.matchAll(/for\s*\(([^)]*)\)/g)) expect(/<\s*\d+/.test(m[1]!)).toBe(true);
    }
  });

  test('PixelCard: the GPU cells are the JavaScript cells, at every stage of the fill, at @3x', () => {
    const w = 60;
    const h = 45;
    const S = 3;
    const origin: [number, number] = [14, 31];
    const g = fillGeometry(origin, w, h);
    let ties = 0;
    for (const p of [0, 0.05, 0.15, 0.35, 0.5, 0.72, 0.9, 1]) {
      const px = draw(PIXEL_FILL_SKSL, [g.cell, origin[0], origin[1], g.span, g.jitter, g.grow, p, ...INK], w, h, S);
      const wrong: string[] = [];
      for (let py = 0; py < h * S; py++) {
        for (let pxl = 0; pxl < w * S; pxl++) {
          // The pixel's centre, in points: where the shader evaluates it.
          const x = (pxl + 0.5) / S;
          const y = (py + 0.5) / S;
          if ((levelAt(px, w * S, pxl, py) === 2) === fillCovers(x, y, p, g)) continue;
          // The only disagreements allowed are precision ones. The hash's last step is `fract`
          // of a number near 20,000, which float32 holds to about 0.001: a cell whose hash sits
          // that close to a whole number wraps to the other end on the GPU (0.997 here is 0.0005
          // there, measured through CanvasKit), and any cell's square can land on a pixel centre
          // a hair early or late. Either way the cell still grows, a moment off; nothing else
          // may differ.
          const ix = Math.floor(x / g.cell);
          const iy = Math.floor(y / g.cell);
          const h = hash12(ix, iy);
          const wraps = Math.min(h, 1 - h) < 0.005;
          const half = cellHalf(ix, iy, p, g);
          const d = Math.max(Math.abs(x - (ix + 0.5) * g.cell), Math.abs(y - (iy + 0.5) * g.cell));
          if (wraps || Math.abs(half - d) < 5e-3) ties++;
          else wrong.push(`${pxl},${py}`);
        }
      }
      expect({ progress: p, wrong }).toEqual({ progress: p, wrong: [] });
    }
    // A cell or two (81 pixels each at @3x) over eight frames of 24,300 pixels.
    expect(ties).toBeLessThanOrEqual(3 * 81);
  });

  test('SpotlightCard: the GPU pool is the JavaScript pool, cell for cell', () => {
    const w = 96;
    const h = 72;
    for (const [strength, ox, oy] of [
      [SPOT.strength, 40, 30],
      [0.8, 70, 10],
      [0, 40, 30],
    ] as const) {
      const px = draw(SPOTLIGHT_SKSL, [3, ox, oy, 60, strength, ...INK, ...PARTNER], w, h);
      let mismatch = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) if (levelAt(px, w, x, y) !== spotLevel(Math.floor(x / 3), Math.floor(y / 3), 3, [ox, oy], strength, 60)) mismatch++;
      }
      expect({ strength, mismatch }).toEqual({ strength, mismatch: 0 });
    }
  });

  test('AnimatedList: the GPU edge is the JavaScript edge, at the top and the bottom', () => {
    const w = 48;
    const h = 33;
    const rows = Math.ceil(h / 3);
    for (const [strength, fromBottom] of [
      [1, false],
      [0.8, true],
      [0.37, false],
    ] as const) {
      const px = draw(EDGE_SKSL, [3, rows, strength, fromBottom ? 1 : 0, ...INK], w, h);
      let mismatch = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) if ((levelAt(px, w, x, y) === 2) !== edgeCovers(Math.floor(x / 3), Math.floor(y / 3), rows, strength, fromBottom)) mismatch++;
      }
      expect({ strength, fromBottom, mismatch }).toEqual({ strength, fromBottom, mismatch: 0 });
    }
  });

  test('ProfileCard field: whole cells only, the creature cleared, time moving only the field', () => {
    const w = 120;
    const h = 90;
    const clear = clearBoxFor(48, 30, 24, 3);
    const run = (t: number, density: number) =>
      draw(FIELD_SKSL, [3, w, h, t, FIELD_WAVE.frequency, FIELD_WAVE.amplitude, density, ...clear, ...INK, ...PARTNER], w, h);
    const a = run(0, PROFILE.density);
    const b = run(0.4, PROFILE.density);
    let paper = 0;
    let partner = 0;
    let ink = 0;
    let moved = 0;
    for (let cy = 0; cy < h / 3; cy++) {
      for (let cx = 0; cx < w / 3; cx++) {
        const la = levelAt(a, w, cx * 3, cy * 3);
        const lb = levelAt(b, w, cx * 3, cy * 3);
        // Every pixel of a cell is its cell's level: the threshold is fixed to the grid.
        for (let dy = 0; dy < 3; dy++) {
          for (let dx = 0; dx < 3; dx++) {
            expect(levelAt(a, w, cx * 3 + dx, cy * 3 + dy)).toBe(la);
            expect(levelAt(b, w, cx * 3 + dx, cy * 3 + dy)).toBe(lb);
          }
        }
        const centreX = cx * 3 + 1.5;
        const centreY = cy * 3 + 1.5;
        if (centreX > clear[0] && centreX < clear[0] + clear[2] && centreY > clear[1] && centreY < clear[1] + clear[3]) {
          expect(la).toBe(0);
          expect(lb).toBe(0);
        }
        if (la === 0) paper++;
        if (la === 1) partner++;
        if (la === 2) ink++;
        if (la !== lb) moved++;
      }
    }
    // A field, in three levels, that drifts.
    expect(paper).toBeGreaterThan(0);
    expect(partner).toBeGreaterThan(0);
    expect(ink).toBeGreaterThanOrEqual(0);
    expect(moved).toBeGreaterThan(0);
    // Density 0 is an empty band.
    const none = run(0, 0);
    for (let i = 3; i < none.length; i += 4) expect(none[i]).toBe(0);
  });
});

// ─── the source ───────────────────────────────────────────────────────────────────────────

const DIR = join(import.meta.dir, '..', 'src/ui/bits/components');
const FILES = readdirSync(DIR)
  .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
  .map((f) => ({ name: f, src: readFileSync(join(DIR, f), 'utf8') }));
const COMPONENTS = ['AnimatedList', 'BounceCards', 'CardSwap', 'Carousel', 'MagicBento', 'PixelCard', 'ProfileCard', 'SpotlightCard', 'Stack', 'Stepper', 'TiltedCard'];

/** Source with comments removed, so a rule is checked against code, not prose. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

describe('the folder obeys the licence and the kit (static checks on src/ui/bits/components)', () => {
  test('every component on the port list is here, and in the barrel', () => {
    const names = FILES.map((f) => f.name);
    const barrel = FILES.find((f) => f.name === 'index.ts')!.src;
    for (const c of COMPONENTS) {
      expect(names).toContain(`${c}.tsx`);
      expect(barrel).toContain(`export { ${c}`);
    }
  });

  test("David Haz's notice heads every port, with what changed in it", () => {
    for (const f of FILES.filter((x) => x.name !== 'index.ts' && x.name !== 'ComponentsGallery.tsx')) {
      const head = f.src.slice(0, f.src.indexOf('*/') + 2);
      const has = {
        file: f.name,
        author: head.includes('by David Haz'),
        copyright: head.includes('Copyright (c) 2026 David Haz'),
        permission: head.includes('Permission is hereby granted, free of charge'),
        clause: head.includes('Commons Clause Restriction'),
        changed: head.includes('What changed in the port'),
      };
      expect(has).toEqual({ file: f.name, author: true, copyright: true, permission: true, clause: true, changed: true });
    }
  });

  test('every component has a Reduce Motion path', () => {
    for (const c of COMPONENTS) {
      const src = FILES.find((f) => f.name === `${c}.tsx`)!.src;
      expect({ c, reads: code(src).includes('useReduceMotion()'), says: /Reduce Motion:/.test(src) }).toEqual({ c, reads: true, says: true });
    }
  });

  test('no radius literal: every borderRadius comes from SHAPE or a variable', () => {
    for (const f of FILES) {
      for (const m of code(f.src).matchAll(/borderRadius:\s*([^,}\n]+)/g)) {
        const expr = (m[1] ?? '').trim();
        expect({ file: f.name, expr, literal: /^\d/.test(expr) }).toEqual({ file: f.name, expr, literal: false });
      }
    }
  });

  test('every rounded rectangle is continuous', () => {
    for (const f of FILES) {
      const c = code(f.src);
      const radii = (c.match(/borderRadius[:=]/g) ?? []).length;
      const curves = (c.match(/borderCurve:\s*'continuous'/g) ?? []).length;
      expect({ file: f.name, radii, curves }).toEqual({ file: f.name, radii, curves: radii });
    }
  });

  test('no colour literal: colours come from tokens.json through theme.ts', () => {
    for (const f of FILES) {
      const hits = code(f.src).match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\(/g) ?? [];
      expect({ file: f.name, hits }).toEqual({ file: f.name, hits: [] });
    }
  });

  test('no gradient and no emoji anywhere in the folder', () => {
    for (const f of FILES) {
      expect({ file: f.name, gradient: /Gradient\b/.test(code(f.src)) }).toEqual({ file: f.name, gradient: false });
      expect({ file: f.name, emoji: /\p{Extended_Pictographic}/u.test(f.src) }).toEqual({ file: f.name, emoji: false });
    }
  });

  test('no off scale spacing literal', () => {
    const allowed = new Set<number>([0, ...Object.values(tokens.space), ...Object.values(tokens.layout)]);
    for (const f of FILES) {
      for (const m of code(f.src).matchAll(/\b(gap|padding(?:Horizontal|Vertical|Top|Bottom|Left|Right)?|margin(?:Horizontal|Vertical|Top|Bottom|Left|Right)?):\s*(\d+(?:\.\d+)?)\b/g)) {
        const v = Number(m[2]);
        expect({ file: f.name, prop: m[1], v, ok: allowed.has(v) }).toEqual({ file: f.name, prop: m[1], v, ok: true });
      }
    }
  });

  test('runOnJS, never scheduleOnRN (Reanimated 3.17)', () => {
    for (const f of FILES) expect({ file: f.name, v4: /scheduleOnRN/.test(code(f.src)) }).toEqual({ file: f.name, v4: false });
  });
});

import { describe, expect, test } from 'bun:test';

import { faceCells, filledEyeCells, blinkGap } from '../src/motion/faceModel';
import * as M from '../src/motion/spec';
import { EYES_FOR, stateColor, withAlpha } from '../src/motion/states';
import { ANIMALS } from '../src/pixel/animals';
import { EYES } from '../src/pixel/frames';

describe('the island spring is the clip', () => {
  test('the numbers are the kit\'s, measured off the clip', () => {
    expect(M.ISLAND).toEqual({ damping: 17, stiffness: 210, mass: 1 });
    expect(M.CONTENT).toEqual({ damping: 22, stiffness: 320, mass: 0.9 });
    expect(M.POP).toEqual({ damping: 14, stiffness: 260, mass: 0.7 });
    expect(M.WHEEL).toEqual({ damping: 20, stiffness: 190, mass: 1 });
  });

  test('the physics reproduces what the clip shows: first peak near 300 ms, ~10% over, still by ~450 ms', () => {
    expect(M.dampingRatio(M.ISLAND)).toBeCloseTo(0.587, 2);
    expect(M.peakMs(M.ISLAND)).toBeGreaterThan(240);
    expect(M.peakMs(M.ISLAND)).toBeLessThan(320);
    expect(M.overshoot(M.ISLAND)).toBeGreaterThan(0.08);
    expect(M.overshoot(M.ISLAND)).toBeLessThan(0.12);
    expect(M.settleMs(M.ISLAND)).toBeGreaterThan(400);
    expect(M.settleMs(M.ISLAND)).toBeLessThan(500);
  });

  test('content settles before its container does', () => {
    expect(M.settleMs(M.CONTENT)).toBeLessThan(M.settleMs(M.ISLAND));
    expect(M.overshoot(M.CONTENT)).toBeLessThan(M.overshoot(M.ISLAND));
  });

  test('a finger let go does not bounce', () => {
    expect(M.dampingRatio(M.SNAP)).toBeGreaterThanOrEqual(0.9);
  });

  test('the outgoing layer is gone before the incoming one starts', () => {
    expect(M.CONTENT_OUT[1]).toBeLessThan(M.CONTENT_IN[0]);
    expect(M.OUT_SCALE).toBeGreaterThan(1);
    expect(M.IN_SCALE).toBeLessThan(1);
  });

  test('staggers are capped and exits are one short beat', () => {
    expect(M.staggerDelay(0)).toBe(0);
    expect(M.staggerDelay(3)).toBe(3 * M.STAGGER_MS);
    expect(M.staggerDelay(100)).toBe(M.STAGGER_CAP * M.STAGGER_MS);
    expect(M.EXIT_MS).toBeLessThanOrEqual(150);
  });

  test('the idle loops are mismatched, so the character never falls into a rhythm', () => {
    expect(M.BREATHE_OUT_MS).not.toBe(M.BREATHE_BACK_MS);
    expect(M.BLINK.minGapMs).toBeLessThan(M.BLINK.maxGapMs);
    for (const u of [0, 0.25, 0.5, 0.999, 1.5, -1]) {
      const g = blinkGap(u, M.BLINK.minGapMs, M.BLINK.maxGapMs);
      expect(g).toBeGreaterThanOrEqual(M.BLINK.minGapMs);
      expect(g).toBeLessThanOrEqual(M.BLINK.maxGapMs);
    }
  });
});

describe('the face', () => {
  const eyeKeys = new Set(EYES.map(([x, y]) => `${x}.${y}`));
  const inkedEyes = (cells: { x: number; y: number }[]) => cells.filter((c) => eyeKeys.has(`${c.x}.${c.y}`)).length;

  test('open eyes are holes, shut eyes are filled, low and high fill one row each', () => {
    for (const a of ANIMALS) {
      expect(inkedEyes(faceCells(a, 'open'))).toBe(0);
      expect(inkedEyes(faceCells(a, 'shut'))).toBe(8);
      expect(inkedEyes(faceCells(a, 'low'))).toBe(4);
      expect(inkedEyes(faceCells(a, 'high'))).toBe(4);
    }
    const low = filledEyeCells('low').map(([, y]) => y);
    const high = filledEyeCells('high').map(([, y]) => y);
    // Lids DOWN when waiting: the top row is filled. A smile pushes the eyes UP: the bottom row is.
    expect(Math.min(...low)).toBeLessThan(Math.min(...high));
  });

  test('a blink closes every state, and a state never moves the silhouette', () => {
    for (const a of ANIMALS) {
      expect(inkedEyes(faceCells(a, 'open', true))).toBe(8);
      const body = (e: 'open' | 'low' | 'high' | 'shut') => faceCells(a, e).filter((c) => !eyeKeys.has(`${c.x}.${c.y}`)).length;
      expect(body('low')).toBe(body('open'));
      expect(body('high')).toBe(body('shut'));
    }
  });

  test('every state has an eye shape and a colour from the tokens', () => {
    for (const s of Object.keys(EYES_FOR) as (keyof typeof EYES_FOR)[]) {
      expect(stateColor(s, '#123456')).toMatch(/^#[0-9A-F]{6}$/i);
    }
    expect(stateColor('idle', '#123456')).toBe('#123456');
    expect(stateColor('waiting', '#123456')).toBe('#FFB300');
  });

  test('withAlpha', () => {
    expect(withAlpha('#FFB300', 0.5)).toBe('rgba(255,179,0,0.5)');
    expect(withAlpha('#000000', 2)).toBe('rgba(0,0,0,1)');
  });
});

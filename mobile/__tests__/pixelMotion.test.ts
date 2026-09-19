import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { cellOrder, modeOf, motionFor, NUM_MOTIONS, numFrame, numMotionFor, PIXEL_MOTIONS, takeOrder, tickStep, type PixelMotion } from '../src/motion/pixelMotion';

const COLS = 40;
const ROWS = 24;

function grid(m: PixelMotion): number[][] {
  return Array.from({ length: ROWS }, (_, y) => Array.from({ length: COLS }, (_, x) => cellOrder(m, x, y, COLS, ROWS)));
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('each pixel surface arrives its own way', () => {
  test('every order puts every cell somewhere in the arrival', () => {
    for (const m of PIXEL_MOTIONS) for (const row of grid(m)) for (const o of row) expect(o >= 0 && o <= 1).toBe(true);
  });

  test('the orders are different movements, not one order eight times', () => {
    // Scan goes down rows; wipe goes across columns; rise comes UP from the foot.
    const scan = grid('scan');
    expect(mean(scan[0]!)).toBeLessThan(mean(scan[ROWS - 1]!));
    const wipe = grid('wipe');
    expect(mean(wipe.map((r) => r[0]!))).toBeLessThan(mean(wipe.map((r) => r[COLS - 1]!)));
    const rise = grid('rise');
    expect(mean(rise[ROWS - 1]!)).toBeLessThan(mean(rise[0]!));
    // Ripple starts at its origin; spiral at the centre.
    expect(cellOrder('ripple', 0, 0, COLS, ROWS)).toBeLessThan(cellOrder('ripple', COLS - 1, ROWS - 1, COLS, ROWS));
    expect(cellOrder('spiral', COLS / 2, ROWS / 2, COLS, ROWS)).toBeLessThan(cellOrder('spiral', 0, 0, COLS, ROWS));
    // Interlace: one field lands a half ahead of the other.
    expect(cellOrder('interlace', 0, 0, COLS, ROWS)).toBeLessThan(cellOrder('interlace', 1, 0, COLS, ROWS));
    // Blocks: cells of one 8 cell block land close together.
    const b = [cellOrder('blocks', 1, 1, COLS, ROWS), cellOrder('blocks', 6, 6, COLS, ROWS)];
    expect(Math.abs(b[0]! - b[1]!)).toBeLessThanOrEqual(0.28);
  });

  test('an item always gets the same order, and the names spread over all eight', () => {
    expect(motionFor('Time')).toBe(motionFor('Time'));
    const titles = ['Time', 'Build', 'Shipping', 'Money', 'Your analysis', 'Your stack', 'Dimensions', 'Words you have met', 'Where your hours go', 'What it would cost', 'Five dimensions', 'Signed in', 'Private project 1', 'Private project 2', 'Your type', 'Active'];
    expect(new Set(titles.map(motionFor)).size).toBeGreaterThanOrEqual(6);
  });

  test("the band's shader has a branch for every order, in the same numbering", () => {
    const band = readFileSync(join(import.meta.dir, '../src/insights/Band.tsx'), 'utf8');
    const branches = band.match(/if \(mode < \d\.5\)/g) ?? [];
    // Seven thresholds and the last order as the fall through.
    expect(branches.length).toBe(PIXEL_MOTIONS.length - 1);
    expect(modeOf('rain')).toBe(0);
    expect(modeOf('wipe')).toBe(PIXEL_MOTIONS.length - 1);
  });
});

describe('one page, no two bands alike', () => {
  test('a band gets its own order when free, the next free one when not, and repeats only past eight', () => {
    const taken = new Set<number>();
    const rise = modeOf('rise');
    expect(takeOrder(taken, rise)).toBe(rise);
    expect(takeOrder(taken, rise)).toBe((rise + 1) % 8);
    const all = [takeOrder(taken, 0), takeOrder(taken, 0), takeOrder(taken, 0), takeOrder(taken, 0), takeOrder(taken, 0), takeOrder(taken, 0)];
    expect(new Set([...all, rise, (rise + 1) % 8]).size).toBe(8);
    // A ninth band: every order is on the page already, so it keeps its own.
    expect(takeOrder(taken, 5)).toBe(5);
  });
});

describe("each screen's counting number arrives its own way", () => {
  test('scramble keeps the shape and settles left to right, type prints left to right, all land on the final', () => {
    const final = '23,141';
    const early = numFrame(1, final, 0.1, 3);
    expect(early.length).toBe(final.length);
    expect(early[2]).toBe(',');
    // The first digit settles before the last one does.
    const mid = numFrame(1, final, 0.45, 3);
    expect(mid[0]).toBe('2');
    expect(numFrame(2, final, 0.5, 0)).toBe('23,');
    for (const m of [1, 2]) expect(numFrame(m, final, 1, 9)).toBe(final);
    expect(tickStep(0.37)).toBe(0.3);
    expect(tickStep(1)).toBe(1);
  });

  test('a number keeps its motion, and the four are all in use', () => {
    expect(numMotionFor('x|12')).toBe(numMotionFor('x|12'));
    const seen = new Set(Array.from({ length: 40 }, (_, i) => numMotionFor(`n|${i}`)));
    expect(seen.size).toBe(NUM_MOTIONS.length);
  });
});

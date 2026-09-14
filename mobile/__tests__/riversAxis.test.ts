/**
 * The dates under the rivers (`src/projects/Rivers.tsx` spacedTicks): as many as fit, the first
 * and the latest always, none touching once the edge boxes are held inside the gutters.
 */
import { describe, expect, test } from 'bun:test';

import { spacedTicks, tickBox } from '../src/projects/geometry';

const W = 402;
const G = 16;
const WEEKS = ['Aug 10', 'Aug 17', 'Aug 24', 'Aug 31', 'Sep 7', 'Sep 14'];
const xs = (k: number) => Array.from({ length: k }, (_, i) => (W * i) / (k - 1));

function spans(ticks: number[], x: number[], labels: string[]): [number, number][] {
  return ticks.map((i) => {
    const { left, align } = tickBox(x[i]!, W, G);
    const w = labels[i]!.length * 6.4;
    const from = align === 'left' ? left : align === 'right' ? left + 64 - w : left + (64 - w) / 2;
    return [from, from + w];
  });
}

describe('the dates under the rivers', () => {
  test('six weeks: the first and the latest, Aug 24 said, and no two dates touching', () => {
    // FOUND IN THE now3 PASS (2026-09-14): "Aug 10 Aug 17" ran together and Aug 24 had no date.
    const t = spacedTicks(xs(6), WEEKS, W, G);
    expect(t[0]).toBe(0);
    expect(t[t.length - 1]).toBe(5);
    expect(t).toContain(2);
    const s = spans(t, xs(6), WEEKS);
    for (let i = 1; i < s.length; i++) expect(s[i]![0]).toBeGreaterThanOrEqual(s[i - 1]![1] + 10);
  });

  test('one week is said once, and many weeks thin out without touching', () => {
    expect(spacedTicks([W / 2], ['Sep 14'], W, G)).toEqual([0]);
    const labels = Array.from({ length: 26 }, (_, i) => `Wk ${i + 1}`);
    const t = spacedTicks(xs(26), labels, W, G);
    expect(t[0]).toBe(0);
    expect(t[t.length - 1]).toBe(25);
    const s = spans(t, xs(26), labels);
    for (let i = 1; i < s.length; i++) expect(s[i]![0]).toBeGreaterThanOrEqual(s[i - 1]![1] + 10);
  });
});

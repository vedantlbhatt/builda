import { describe, expect, test } from 'bun:test';

import { hasDash } from '../src/copy/plain';
import { milestoneLine, milestoneNote, milestoneReached, milestoneStep, MILESTONE_HOURS } from '../src/share/milestones';

const H = 3600;

describe('hours milestones', () => {
  test('the highest milestone at or under the total', () => {
    expect(milestoneReached(0)).toBe(0);
    expect(milestoneReached(9.99 * H)).toBe(0);
    expect(milestoneReached(10 * H)).toBe(10);
    expect(milestoneReached(137.8 * H)).toBe(100);
    expect(milestoneReached(5000 * H)).toBe(1000);
    expect([...MILESTONE_HOURS]).toEqual([...MILESTONE_HOURS].sort((a, b) => a - b));
  });

  test('backfill is silent: the first reading remembers what is behind them and offers nothing', () => {
    expect(milestoneStep(300 * H, null)).toEqual({ kind: 'remember', hours: 250 });
    expect(milestoneStep(3 * H, null)).toEqual({ kind: 'remember', hours: 0 });
  });

  test('a milestone crossed after that is offered once, and never one already remembered', () => {
    expect(milestoneStep(101 * H, 50)).toEqual({ kind: 'offer', hours: 100 });
    expect(milestoneStep(101 * H, 100)).toEqual({ kind: 'none' });
    // Two crossed while the app was closed: the card is for the higher one.
    expect(milestoneStep(260 * H, 50)).toEqual({ kind: 'offer', hours: 250 });
  });

  test('the words: no dash, the count and the start', () => {
    expect(milestoneLine(100)).toBe('100 hours of building. Your card is made. Tap to see it.');
    expect(milestoneNote(1320, '2026-08-11T15:00:00Z')).toBe('1,320 sessions since Aug 11, 2026');
    expect(milestoneNote(1, null)).toBe('1 session');
    for (const s of [milestoneLine(1000), milestoneNote(12, '2026-01-02T12:00:00Z')]) expect(hasDash(s)).toBe(false);
  });
});

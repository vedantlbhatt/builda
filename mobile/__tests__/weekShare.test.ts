import { describe, expect, test } from 'bun:test';

import { weekRows, WEEK_CARD_ROWS } from '../src/session/week';

import type { SessionDetail } from '../src/data/api';
import type { WeekModel } from '../src/session/week';

const week: WeekModel = {
  days: ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20'].map((date, i) => ({
    date,
    letter: 'MTWTFSS'[i]!,
    seconds: i < 6 ? 3600 : 0,
    today: i === 5,
    future: i === 6,
  })),
  seconds: 6 * 3600,
  built: 6,
};

function s(id: string, date: string, mins: number, extra: Partial<SessionDetail> = {}): SessionDetail {
  return { id, local_date: date, active_seconds: mins * 60, title: `Run ${id}`, state: 'final' } as SessionDetail;
}

describe('the week card names the week’s longest sessions', () => {
  test('only this week’s finished sessions, longest first, at most three', () => {
    const rows = weekRows(
      [s('old', '2026-09-10', 300), s('a', '2026-09-15', 40), s('b', '2026-09-16', 95), s('c', '2026-09-19', 70), s('d', '2026-09-18', 10), { ...s('live', '2026-09-19', 500), state: 'live' } as SessionDetail],
      week,
    );
    expect(rows.map((r) => r.id)).toEqual(['b', 'c', 'a']);
    expect(rows).toHaveLength(WEEK_CARD_ROWS);
    expect(rows[0]!.active).toBe('1h 35m');
  });

  test('a session with no title is named the way its row is, never an empty row', () => {
    const row = weekRows([{ ...s('x', '2026-09-15', 12), title: null, started_at: '2026-09-15T15:10:00Z' } as SessionDetail], week)[0]!;
    expect(row.title.length).toBeGreaterThan(0);
    expect(row.title).not.toBe('null');
  });
});

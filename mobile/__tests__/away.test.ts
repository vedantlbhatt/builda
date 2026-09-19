import { describe, expect, test } from 'bun:test';

import type { SessionDetail } from '../src/data/api';
import { hasDash } from '../src/copy/plain';
import { AWAY_MIN_MS, AWAY_ROWS, awaySummary } from '../src/live/away';

const H = 3600_000;
const NOW = Date.parse('2026-09-19T13:00:00Z');

function s(id: string, endedHoursAgo: number, activeMin: number, extra: Partial<SessionDetail> = {}): SessionDetail {
  return {
    id,
    client_session_id: id,
    harness: 'claude_code',
    repo_name: 'tramline',
    started_at: new Date(NOW - endedHoursAgo * H - activeMin * 60_000).toISOString(),
    ended_at: new Date(NOW - endedHoursAgo * H).toISOString(),
    active_seconds: activeMin * 60,
    idle_seconds: 0,
    local_date: '2026-09-19',
    title: `Run ${id}`,
    title_source: 'analysis',
    notable: false,
    unattended: false,
    timeline_fidelity: 'full',
    is_shared: false,
    state: 'final',
    ...extra,
  } as SessionDetail;
}

describe('while you were away', () => {
  test('nothing under an hour away, and nothing when nothing finished', () => {
    const runs = [s('a', 0.2, 30)];
    expect(awaySummary(runs, [], NOW - (AWAY_MIN_MS - 60_000), NOW)).toBeNull();
    expect(awaySummary([], [], NOW - 8 * H, NOW)).toBeNull();
    expect(awaySummary(runs, [], null, NOW)).toBeNull();
  });

  test('counts only what ended after you left, newest first', () => {
    const left = NOW - 8 * H;
    const runs = [s('before', 9, 40), s('night', 5, 120), s('dawn', 1, 45)];
    const a = awaySummary(runs, [], left, NOW)!;
    expect(a.finished).toBe(2);
    expect(a.rows.map((r) => r.id)).toEqual(['dawn', 'night']);
    expect(a.work).toBe('2h 45m');
    expect(a.lead).toBe('2 runs finished while you were away');
  });

  test('a run still live is the tiles\' news, not the band\'s', () => {
    const live = s('now', 0, 60, { state: 'live' });
    const a = awaySummary([s('done', 2, 10), live], [live], NOW - 6 * H, NOW)!;
    expect(a.finished).toBe(1);
    expect(a.running).toBe(1);
  });

  test('says plainly which ran on their own, and names at most a few', () => {
    const runs = [1, 2, 3, 4, 5].map((i) => s(String(i), i, 20, { unattended: i % 2 === 1 }));
    const a = awaySummary(runs, [], NOW - 10 * H, NOW)!;
    expect(a.rows).toHaveLength(AWAY_ROWS);
    expect(a.alone).toBe(3);
    expect(a.line).toBe('1h 40m of work, 3 of them on their own.');
    const one = awaySummary([s('x', 2, 50, { unattended: true })], [], NOW - 5 * H, NOW)!;
    expect(one.lead).toBe('1 run finished while you were away');
    expect(one.line).toBe('50m of work, on its own.');
  });

  test('plain words: no dash anywhere it can say', () => {
    const runs = [s('a', 1, 70, { title: null }), s('b', 2, 5, { unattended: true })];
    const a = awaySummary(runs, [], NOW - 4 * H, NOW)!;
    for (const w of [a.lead, a.line, ...a.rows.flatMap((r) => [r.title, r.repo, r.active])]) expect(hasDash(w)).toBe(false);
    // A run with no title is called by its repository, never "null" or an empty row.
    expect(a.rows.find((r) => r.id === 'a')!.title).toBe('tramline');
  });
});

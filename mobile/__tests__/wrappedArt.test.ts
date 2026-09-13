/**
 * The Wrapped headers (`src/wrapped/art.ts`): real data where the phone holds it, a seeded
 * field where it does not, and never a picture that changes between two renders.
 */
import { describe, expect, test } from 'bun:test';

import { REPORT_ENUMS, type ReportWrappedCard, type WrappedCard } from '../src/generated/report';
import { graphLevel } from '../src/theme';
import {
  FADED_INK,
  NO_SOURCES,
  activityGrid,
  artFor,
  attendedBars,
  commitRow,
  cumulativeLines,
  dayNumber,
  fieldOf,
  kindShares,
  peakLanes,
  promptBars,
  seedOf,
  stripHeights,
  weeksFor,
  type ArtBasis,
  type ArtSession,
  type ArtSpec,
} from '../src/wrapped/art';
import { SAMPLE_SOURCES, SAMPLE_WRAPPED, refusalSamples } from '../src/wrapped/sample';

const COLS = 96;
const ROWS = 60;

function card(id: WrappedCard): ReportWrappedCard {
  return SAMPLE_WRAPPED.cards.find((c) => c.id === id)!;
}

function bytes(spec: ArtSpec, faded = false): number[] {
  return Array.from(fieldOf(spec, COLS, ROWS, { faded }).data);
}

describe('never random: the same card draws the same header, every render', () => {
  test('every card, with nothing to draw from, gets its seeded field, twice identical', () => {
    for (const id of REPORT_ENUMS.wrapped_card) {
      const a = artFor(card(id), NO_SOURCES);
      const b = artFor(card(id), NO_SOURCES);
      expect(a).toEqual(b);
      expect(bytes(a)).toEqual(bytes(b));
    }
  });

  test('with no sources the data cards fall back to a seeded field, and say so', () => {
    const procedural = REPORT_ENUMS.wrapped_card.filter((id) => artFor(card(id), NO_SOURCES).basis === 'procedural');
    // Two cards carry their own data on the wire: the share and the split.
    expect(procedural.sort()).toEqual(
      [...REPORT_ENUMS.wrapped_card].filter((id) => id !== 'change_course' && id !== 'kind_of_work').sort(),
    );
  });

  test('different cards seed different fields', () => {
    const fields = new Set(REPORT_ENUMS.wrapped_card.map((id) => bytes(artFor(card(id), NO_SOURCES)).join(',')));
    expect(fields.size).toBe(REPORT_ENUMS.wrapped_card.length);
  });

  test('the seed is the card id, FNV-1a, stable across builds', () => {
    expect(seedOf('builder_type')).toBe(seedOf('builder_type'));
    expect(seedOf('')).toBe(0x811c9dc5);
    expect(seedOf('builder_type')).not.toBe(seedOf('shipped'));
  });

  test('every field is exactly cols by rows, every cell in 0 to 1, and some of it ink', () => {
    for (const id of REPORT_ENUMS.wrapped_card) {
      for (const sources of [NO_SOURCES, SAMPLE_SOURCES]) {
        const f = fieldOf(artFor(card(id), sources), COLS, ROWS);
        expect(f.width).toBe(COLS);
        expect(f.height).toBe(ROWS);
        expect(f.data.length).toBe(COLS * ROWS);
        let ink = 0;
        for (const v of f.data) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
          ink += v;
        }
        expect(ink).toBeGreaterThan(0);
      }
    }
  });
});

describe('real data where the phone holds it', () => {
  const expected: Partial<Record<WrappedCard, ArtBasis>> = {
    time_put_in: 'activity_grid',
    longest_session: 'session_strip',
    agents_at_once: 'peak_overlap',
    streak: 'commit_days',
    shipped: 'cumulative_lines',
    change_course: 'card_share',
    kind_of_work: 'role_split',
    deep_sessions: 'attended_per_session',
    prompts_per_session: 'prompts_per_session',
  };

  test('each data card draws its own data; the rest are seeded', () => {
    for (const id of REPORT_ENUMS.wrapped_card) {
      expect({ id, basis: artFor(card(id), SAMPLE_SOURCES).basis }).toEqual({ id, basis: expected[id] ?? 'procedural' });
    }
  });

  test('a refused card never draws data: it has no answer to draw', () => {
    for (const c of refusalSamples()) expect(artFor(c, SAMPLE_SOURCES).basis).toBe('procedural');
  });

  test('a refused card is drawn thinner, at most FADED_INK of its ink', () => {
    const spec = artFor(card('builder_type'), NO_SOURCES);
    const full = bytes(spec);
    const faded = bytes(spec, true);
    faded.forEach((v, i) => expect(v).toBeCloseTo(full[i]! * FADED_INK, 6));
  });
});

describe('the data into shapes', () => {
  test('the contribution grid: weekday rows, the latest week on the right, the You tab\'s buckets', () => {
    // 2026-09-13 is a Sunday: the last row of the last column.
    const graph = [
      { date: '2026-09-07', active_seconds: 3 * 3600 }, // Monday
      { date: '2026-09-13', active_seconds: 9 * 3600 }, // Sunday
      { date: '2026-08-31', active_seconds: 1800 }, // the Monday before
    ];
    const grid = activityGrid(graph, 6)!;
    expect(grid.length).toBe(7);
    expect(grid[0]!.length).toBe(6);
    expect(grid[6]![5]).toBe(graphLevel(9 * 3600) / 5);
    expect(grid[0]![5]).toBe(graphLevel(3 * 3600) / 5);
    expect(grid[0]![4]).toBe(graphLevel(1800) / 5);
    expect(grid.flat().filter((v) => v > 0).length).toBe(3);
  });

  test('a grid with no time in it is no grid (the seeded field draws instead)', () => {
    expect(activityGrid([{ date: '2026-09-13', active_seconds: 0 }], 8)).toBeNull();
    expect(activityGrid([], 8)).toBeNull();
  });

  test('square days: the grid shows as many weeks as the header is wide, 6 to 17', () => {
    expect(weeksFor(1)).toBe(7);
    expect(weeksFor(1.6)).toBe(11);
    expect(weeksFor(0.2)).toBe(6);
    expect(weeksFor(9)).toBe(17);
  });

  test('the commit row: one value a day from the first commit, empty days paper, a single commit still ink', () => {
    const row = commitRow(
      [
        { day: '2026-09-01', commits: 1 },
        { day: '2026-09-03', commits: 10 },
      ],
      '2026-09-04T08:00:00Z',
    )!;
    expect(row.length).toBe(4);
    expect(row[1]).toBe(0);
    expect(row[3]).toBe(0);
    expect(row[0]).toBeGreaterThanOrEqual(0.4);
    expect(row[2]).toBe(1);
    expect(commitRow([{ day: '2026-09-01', commits: 0 }], null)).toBeNull();
    expect(dayNumber('2026-09-02') - dayNumber('2026-09-01')).toBe(1);
  });

  test('the strip: idle is nothing, activity its density, and a strip that will not decode is no strip', () => {
    const h = stripHeights(SAMPLE_SOURCES.longestStrip!)!;
    expect(h.length).toBe(1024);
    expect(h.every((v) => [0, 0.25, 0.5, 0.75, 1].includes(v))).toBe(true);
    expect(h.some((v) => v === 0)).toBe(true);
    expect(stripHeights('not base64 of anything')).toBeNull();
  });

  test('the busiest moment: three sessions at once are the three solid lanes', () => {
    const at = (h: number) => new Date(Date.UTC(2026, 8, 1, 10) + h * 3_600_000).toISOString();
    const sessions: ArtSession[] = [
      { started_at: at(0), ended_at: at(2) },
      { started_at: at(0.5), ended_at: at(1.5) },
      { started_at: at(1), ended_at: at(3) },
      { started_at: at(5), ended_at: at(6) },
    ];
    const lanes = peakLanes(sessions)!;
    expect(lanes.length).toBe(3);
    expect(lanes.flat().filter((l) => l.peak).length).toBe(3);
    for (const lane of lanes) for (const l of lane) expect(l.from).toBeLessThan(l.to);
  });

  test('a handoff at the same instant is not two at once (agents.py\'s rule)', () => {
    const at = (h: number) => new Date(Date.UTC(2026, 8, 1, 10) + h * 3_600_000).toISOString();
    const lanes = peakLanes([
      { started_at: at(0), ended_at: at(1) },
      { started_at: at(1), ended_at: at(2) },
    ])!;
    expect(lanes.flat().filter((l) => l.peak).length).toBe(1);
    expect(lanes.length).toBe(1);
  });

  test('lines summed session by session end at the whole, and never fall', () => {
    const series = cumulativeLines(SAMPLE_SOURCES.sessions!)!;
    expect(series[series.length - 1]).toBeCloseTo(1, 9);
    for (let i = 1; i < series.length; i++) expect(series[i]!).toBeGreaterThanOrEqual(series[i - 1]!);
    expect(cumulativeLines([{ started_at: '2026-09-01T00:00:00Z', ended_at: '2026-09-01T01:00:00Z', lines: 5 }])).toBeNull();
  });

  test('an attended hour is a solid bar; shorter sittings are lighter', () => {
    const mk = (a: number): ArtSession => ({ started_at: `2026-09-0${a}T00:00:00Z`, ended_at: `2026-09-0${a}T05:00:00Z`, attended_seconds: a * 1200 });
    const bars = attendedBars([mk(1), mk(2), mk(3), mk(4)])!;
    expect(bars.map((b) => b.d)).toEqual([0.34, 0.34, 1, 1]);
    expect(promptBars([mk(1)])).toBeNull();
  });

  test('the kind of work split, from the basis that answered, largest first, summing to 1', () => {
    const split = kindShares(card('kind_of_work'))!;
    expect(split.basis).toBe('role_split');
    expect(split.shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    for (let i = 1; i < split.shares.length; i++) expect(split.shares[i]!).toBeLessThanOrEqual(split.shares[i - 1]!);
    const labelled = kindShares({ ...card('kind_of_work'), basis: 'commit_subject_labels' })!;
    expect(labelled.basis).toBe('kind_split');
    expect(labelled.shares[0]).toBeCloseTo(12 / 25, 9);
  });

  test('the change of course scatter inks exactly the card\'s share of its blocks', () => {
    for (const share of [0, 0.25, 0.435, 1]) {
      const spec = artFor({ ...card('change_course'), value: share }, NO_SOURCES);
      expect(spec.kind === 'motif' && spec.amount).toBe(share);
      // Count the blocks drawn solid through a coarse probe at each block's centre.
      const f = fieldOf(spec, 100, 100);
      let solid = 0;
      let blocks = 0;
      const nx = 10;
      for (let by = 0; by < 10; by++)
        for (let bx = 0; bx < nx; bx++) {
          blocks += 1;
          if (f.data[(by * 10 + 3) * 100 + (bx * 10 + 3)] === 1) solid += 1;
        }
      expect(solid).toBe(Math.round(share * blocks));
    }
  });
});

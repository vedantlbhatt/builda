/**
 * THIS WEEK, for the band at the top of the Sessions tab: the hours and the seven days.
 *
 * Read from the profile's activity graph (`GET /v1/profile` `graph`, one row per Builda day,
 * every visible finished session summed by the server), never from the list under the band.
 * The list is the NOTABLE sessions (`cache.sync` asks `notable_only`), so summing it would be a
 * plausible wrong number: every short sitting of the week left out, and nothing to say so.
 *
 * A week starts on Monday, as the contribution grid's rows do (`insights/model.gridOf`), and a
 * day starts at 04:00 (`theme.DAY_BOUNDARY_HOUR`, the same 4 as ingest and the graph). The graph
 * leaves running sessions out on purpose (the server's `profile` docstring); the band says the
 * hours of finished sittings and the running ones are the rows right under it.
 *
 * Pure: no React Native, so `bun test` holds it.
 */

import { n } from '../copy/numbers';
import { spoken } from '../copy/plain';
import { numSpec, type NumSpec } from '../insights/format';
import type { SessionDetail } from '../data/api';
import { rowOf } from './page';
import { DAY_BOUNDARY_HOUR, duration } from '../theme';

export interface WeekDay {
  /** "2026-09-07", the graph's own key. */
  date: string;
  /** "M", "T", "W". */
  letter: string;
  seconds: number;
  today: boolean;
  /** Later this week: nothing has happened yet, which is not the same as nothing done. */
  future: boolean;
}

export interface WeekModel {
  days: WeekDay[];
  seconds: number;
  /** Days this week with any finished session. */
  built: number;
}

const LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The week `now` falls in, Monday first, on the Builda clock, with the graph's seconds per day. */
export function weekOf(graph: readonly { date: string; active_seconds: number }[], now: number): WeekModel {
  const day = new Date(now - DAY_BOUNDARY_HOUR * 3_600_000);
  const row = (day.getDay() + 6) % 7;
  const byDate = new Map<string, number>();
  for (const g of graph) {
    if (typeof g.active_seconds === 'number' && Number.isFinite(g.active_seconds)) {
      byDate.set(g.date, (byDate.get(g.date) ?? 0) + Math.max(0, g.active_seconds));
    }
  }
  const days: WeekDay[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(day.getFullYear(), day.getMonth(), day.getDate() - row + i);
    const date = ymd(d);
    const future = i > row;
    days.push({ date, letter: LETTERS[i]!, seconds: future ? 0 : (byDate.get(date) ?? 0), today: i === row, future });
  }
  const seconds = days.reduce((s, d) => s + d.seconds, 0);
  return { days, seconds, built: days.filter((d) => d.seconds > 0).length };
}

export interface WeekFigure {
  num: NumSpec;
  /** What the figure counts: "hours this week", or "this week" beside a duration. */
  caption: string;
  /** "across four days so far", "on one day so far". */
  note: string;
}

/**
 * The band's number, or null for a week with nothing finished in it yet (the band says that in a
 * sentence rather than a zero). An hour or more is hours to one decimal, the way the analysis
 * page says hours (`profile._n`); under an hour is the duration ("42m"), because "0.7 hours"
 * is a number nobody says.
 */
export function weekFigure(w: WeekModel): WeekFigure | null {
  if (w.seconds <= 0) return null;
  const note = w.built === 1 ? 'on one day so far' : `across ${spoken(w.built)} days so far`;
  if (w.seconds < 3600) {
    return { num: numSpec(w.seconds, duration(w.seconds), { kind: 'duration' }), caption: 'this week', note };
  }
  const h = w.seconds / 3600;
  return { num: numSpec(h, n(h)), caption: 'hours this week', note };
}

/** Said when the week has nothing finished yet. */
export const QUIET_WEEK = 'Nothing finished yet this week. The first session you finish lands here.';

// ------------------------------------------------------------------ the week card (`share/WeekShare.tsx`)

/** Sessions named on the card: the week's longest, by active time. */
export const WEEK_CARD_ROWS = 3;

export interface WeekCardRow {
  id: string;
  title: string;
  active: string;
}

/**
 * The week's longest sessions, by active time, for the card. PURE. A session counts for the week when
 * it started on one of the week's days (the model's dates, which already follow the 4am day).
 */
export function weekRows(sessions: readonly SessionDetail[], week: WeekModel, max = WEEK_CARD_ROWS, now = Date.now()): WeekCardRow[] {
  const days = new Set(week.days.filter((d) => !d.future).map((d) => d.date));
  return sessions
    .filter((s) => days.has(s.local_date) && (s.state ?? 'final') !== 'live')
    .sort((a, b) => (b.active_seconds || 0) - (a.active_seconds || 0))
    .slice(0, max)
    // Named the way its row in the list names it (`page.rowOf`): the title, else the day and its part.
    .map((s) => ({ id: s.id, title: rowOf(s, now).title, active: duration(s.active_seconds || 0) }));
}

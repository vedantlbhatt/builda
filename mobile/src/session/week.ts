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
import { TAP } from '../copy/device';
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
  /** A week that is over (`lastWeekOf`): no today, nothing "so far". */
  past?: boolean;
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
  const sofar = w.past ? '' : ' so far';
  const note = w.built === 1 ? `on one day${sofar}` : `across ${spoken(w.built)} days${sofar}`;
  const which = w.past ? 'last week' : 'this week';
  if (w.seconds < 3600) {
    return { num: numSpec(w.seconds, duration(w.seconds), { kind: 'duration' }), caption: which, note };
  }
  const h = w.seconds / 3600;
  return { num: numSpec(h, n(h)), caption: `hours ${which}`, note };
}

/** The week before the one `now` is in: all seven days over, none of them today. */
export function lastWeekOf(graph: readonly { date: string; active_seconds: number }[], now: number): WeekModel {
  const monday = weekOf(graph, now).days[0]!.date;
  const [y, m, d] = monday.split('-').map(Number) as [number, number, number];
  // An hour before this Monday's day begins (04:00) is still last Sunday on the Builda clock.
  const sunday = new Date(y, m - 1, d, DAY_BOUNDARY_HOUR - 1).getTime();
  const last = weekOf(graph, sunday);
  return { ...last, days: last.days.map((x) => ({ ...x, today: false })), past: true };
}

/**
 * Last week is news until Wednesday: Monday to Wednesday (the first three days of a Builda week)
 * the Sessions band offers its card beside this week's, and after that it is old.
 */
export const LAST_WEEK_DAYS = 3;

/** Whether `now` is in the first `LAST_WEEK_DAYS` days of its week, when last week is news. */
export function lastWeekIsNews(now: number): boolean {
  const row = weekOf([], now).days.findIndex((x) => x.today);
  return row >= 0 && row < LAST_WEEK_DAYS;
}

/** Last week, while it is still news and had any finished session in it, else null. */
export function lastWeekShown(graph: readonly { date: string; active_seconds: number }[], now: number): WeekModel | null {
  if (!lastWeekIsNews(now)) return null;
  const last = lastWeekOf(graph, now);
  return last.seconds > 0 ? last : null;
}

/**
 * Last week up to the same day, for the band's comparison: "Same days last week: 9.2 hours". Never
 * the whole of last week: on a Tuesday that says "down 80%" about a week that is two days old.
 * Null when last week had nothing on those days (a comparison with nothing is not one), or for a
 * week that is over.
 */
export function sameDaysLastWeek(graph: readonly { date: string; active_seconds: number }[], now: number): string | null {
  const cur = weekOf(graph, now);
  if (cur.past) return null;
  const row = cur.days.findIndex((d) => d.today);
  if (row < 0) return null;
  const last = lastWeekOf(graph, now);
  const seconds = last.days.slice(0, row + 1).reduce((s, d) => s + d.seconds, 0);
  if (seconds <= 0) return null;
  // A no-break space: on an iPhone SE the line wrapped as "...: 13.7" / "hours".
  const amount = seconds < 3600 ? duration(seconds) : `${n(seconds / 3600)}\u00a0hours`;
  return row === 6 ? `Last week: ${amount}` : `Same days last week: ${amount}`;
}

/** The kv row that remembers the Monday of the last week whose card was offered on its own. */
export const WEEK_OFFERED_KEY = 'week.offered';

/**
 * The week Builda makes a card of by itself, once: last week, while it is news, if its card has
 * not been offered already (`offered` is the Monday it was offered for).
 */
export function weekToOffer(graph: readonly { date: string; active_seconds: number }[], now: number, offered: string | null): WeekModel | null {
  const last = lastWeekShown(graph, now);
  return last && last.days[0]!.date !== offered ? last : null;
}

/** What the island says when it has made last week's card. */
export function weekOfferLine(w: WeekModel): string {
  const f = weekFigure(w);
  if (!f) return '';
  const amount = f.caption.startsWith('hours') ? `${f.num.final} hours` : f.num.final;
  return `Last week's card is made: ${amount}. ${TAP} to see it.`;
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
  const sorted = sessions
    .filter((s) => days.has(s.local_date) && (s.state ?? 'final') !== 'live')
    .sort((a, b) => (b.active_seconds || 0) - (a.active_seconds || 0));
  // One row per title: FOUND ON THE SIMULATOR, last week's card read "Debugged a failing test
  // suite" three times over, one fact said three times. The row keeps the longest session's own
  // time. Never a sum: sessions that ran at once overlap, and a summed row read 14h 37m under a
  // week of 14 hours.
  const seen = new Set<string>();
  const rows: WeekCardRow[] = [];
  for (const s of sorted) {
    // Named the way its row in the list names it (`page.rowOf`): the title, else the day and its part.
    const title = rowOf(s, now).title;
    if (seen.has(title)) continue;
    seen.add(title);
    rows.push({ id: s.id, title, active: duration(s.active_seconds || 0) });
    if (rows.length >= max) break;
  }
  return rows;
}

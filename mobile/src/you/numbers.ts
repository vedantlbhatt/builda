/**
 * What the You pages say about numbers that `src/copy/` does not already say: the dollar mask,
 * and the days and months a glossary term or a stack item was first met. Pure, no React Native,
 * so `bun test` holds every rule (`__tests__/you.test.ts`).
 *
 * Every other number on these pages is said by `src/copy/numbers.ts` and `src/copy/money.ts`,
 * the ports of `profile._n`, `_count`, `_pct`, `burn._share_words` and `pricing.money` that are
 * pinned to Python by their own fixtures. Nothing here is a second copy of one of those.
 */
import { DAY_BOUNDARY_HOUR } from '../theme';

/** What a masked dollar figure shows (SYNTHESIS 5, technique 2). Never a number. */
export const MASKED_DOLLARS = '$•••';

/** A dollar amount as `src/copy/money.ts dollars()` writes one: "$0.43", "$22.10", "$1,873". */
const DOLLAR_AMOUNT = /-?\$\d[\d,]*(?:\.\d+)?/g;

/**
 * Every dollar amount in a line, masked. The sentences are written by `src/copy/money.ts`
 * with real figures; the mask is applied to what they wrote, so no sentence needs a second,
 * masked wording and none can forget to hide its number.
 */
export function maskDollars(text: string): string {
  return text.replace(DOLLAR_AMOUNT, MASKED_DOLLARS);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

interface Ymd {
  y: number;
  m: number;
  d: number;
}

/**
 * The Builder day an instant belongs to, in the phone's zone, where days start at 04:00
 * (`theme.DAY_BOUNDARY_HOUR`, the same 4 as ingest and the graph): a term first met at 01:30
 * was met on the evening before.
 */
function builderDay(t: number): Ymd {
  const d = new Date(t - DAY_BOUNDARY_HOUR * 3_600_000);
  return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
}

/** An instant as the Builder day it happened on: "Aug 29", the year when it is not this one. */
export function dayOf(iso: string, now: number = Date.now()): string | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const day = builderDay(t);
  const base = `${MONTHS[day.m - 1]} ${day.d}`;
  return day.y === builderDay(now).y ? base : `${base}, ${day.y}`;
}

/** The month an instant's Builder day falls in, as a sortable key: "2026-09". */
export function monthKey(iso: string): string | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const day = builderDay(t);
  return `${day.y}-${String(day.m).padStart(2, '0')}`;
}

/** "September", or "September 2025" when it is not this year. */
export function monthLabel(key: string, now: number = Date.now()): string {
  const [y, m] = key.split('-').map(Number);
  const name = MONTH_NAMES[(m ?? 1) - 1] ?? key;
  return y === builderDay(now).y ? name : `${name} ${y}`;
}

/** "9:41", the clock a stale note names. Local, 24 hours: no am or pm to misread. */
export function clockOf(t: number): string {
  const d = new Date(t);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

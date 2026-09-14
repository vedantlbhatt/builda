/**
 * How far back the Sessions list has read, and the sentence at its end.
 *
 * FOUND IN THE CAPTURE PASS (2026-09-14, shots/now2/03-sessions-13): the list showed the 50 rows
 * the sync reads and stopped at Aug 21 with nothing under it, while the server held 81 sessions of
 * that kind and 183 in all. Nothing said the list was cut, and the older ones could not be reached
 * from it at all. The list now reads further back a page at a time (`GET /v1/sessions?before=`) as
 * it is scrolled to its end, says at its end what it holds and how far back it goes, and offers the
 * sessions it leaves out.
 *
 * What the list holds by default is the route's default: sessions you were there for at least
 * 20 minutes (`notable`: `Tuning.notableMinActiveSec`, 1200 s of attended time, never a run the
 * agent did alone). "Every session" is the rest too. The count at the end is the rows the list
 * shows, so the sentence cannot disagree with the list above it, and it is said only once the
 * server has answered that there is nothing older.
 *
 * Pure: no React Native, so `bun test` holds it.
 */
import { commas } from '../copy/numbers';
import { dayLabel } from '../theme';

/** What the list holds: the sessions you were there for at least 20 minutes, or every one. */
export type ListMode = 'notable' | 'every';

/** Rows a page reads: the route's default, and what the sync reads for the top of the list. */
export const LIST_PAGE = 50;

/** The most rows the list will draw at once (the route pages at 200; a list this long is years). */
export const LIST_MAX = 2000;

/**
 * How far back the list has read the server with no gap, and whether the server holds more.
 *
 * `from` is the `started_at` of the oldest row read: every row of the mode at or after it is in
 * the phone's cache. Null with `more: false` means the server has nothing older: every saved row
 * of the mode is listed.
 */
export interface Reach {
  from: string | null;
  /** The server said a page follows (`next_before`); false, it said none does. */
  more: boolean;
}

/** What one page of the route says about the reach: the page read from the top (no `before`). */
export function reachOfPage(rows: readonly { started_at: string }[], nextBefore: string | null | undefined): Reach {
  if (!nextBefore) return { from: null, more: false };
  const last = rows[rows.length - 1];
  return { from: last ? last.started_at : nextBefore, more: true };
}

/**
 * A page read further back, from the reach `prev`: the reach moves to its oldest row, or, on the
 * last page, to everything.
 */
export function extendReach(prev: Reach, rows: readonly { started_at: string }[], nextBefore: string | null | undefined): Reach {
  if (!nextBefore) return { from: null, more: false };
  const last = rows[rows.length - 1];
  return { from: last ? last.started_at : (prev.from ?? nextBefore), more: true };
}

/**
 * A fresh first page against the reach the list already had.
 *
 * The list re-reads its top every time the tab is focused, which includes coming back from a
 * session page, so a first page that simply replaced the reach would cut a list scrolled back to
 * August down to its newest fifty under the reader's finger. The two are kept together when they
 * touch (the new page reaches back to the newest row the list showed before, so there is no gap
 * between them); otherwise the new page stands alone, because more sessions arrived than one
 * page holds and the rows in between were never read.
 */
export function mergeReach(prev: Reach | null, next: Reach, prevNewest: string | null): Reach {
  if (!prev) return next;
  // The server's first page is all of it.
  if (!next.more) return next;
  const touches = prevNewest !== null && next.from !== null && instant(next.from) <= instant(prevNewest);
  return touches ? prev : next;
}

function instant(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

/** The act at the end of the list. */
export type ListAct = 'older' | 'every' | 'notable';

export interface ListEnd {
  /** The sentence at the end: what the list holds and how far back. */
  words: string;
  /** A quieter second line, or null. */
  note: string | null;
  door: { title: string; line: string | null; act: ListAct } | null;
}

/** " back to Aug 11", or ", all of them today". */
function reachWords(oldest: string | null, now: number, shown: number): string {
  if (!oldest) return '';
  const day = dayLabel(oldest, now);
  if (!day) return '';
  if (day === 'today') return shown === 1 ? ', from today' : ', all from today';
  return `, back to ${day}`;
}

const NOTABLE_KIND = 'you were there for at least 20 minutes';

/**
 * The end of the list: what it holds, whether there is more, and the door to it. Null when there
 * is nothing to end (no rows: the empty state speaks).
 *
 * `reach` null is a list the server has not answered for (offline, or the sync failed): saved rows
 * nobody has confirmed never claim to be all of them.
 */
export function listEnd(args: {
  mode: ListMode;
  shown: number;
  oldest: string | null;
  reach: Reach | null;
  now: number;
  failed?: string | null;
}): ListEnd | null {
  const { mode, shown, oldest, reach, now, failed } = args;
  if (shown <= 0) return null;
  const back = reachWords(oldest, now, shown);
  const n = commas(shown);
  if (reach && !reach.more) {
    if (mode === 'notable') {
      return {
        words: shown === 1 ? `That is the one session ${NOTABLE_KIND}${back}.` : `That is all ${n} sessions ${NOTABLE_KIND}${back}.`,
        note: 'Shorter ones, and runs the agent did without you, count toward your hours but are not in this list.',
        door: { title: 'Show every session', line: 'The shorter ones and the runs without you too', act: 'every' },
      };
    }
    return {
      words: shown === 1 ? `That is the one session on your account${back}.` : `That is every session on your account: ${n}${back}.`,
      note: null,
      door: { title: 'Only the longer sessions', line: `The ones ${NOTABLE_KIND}`, act: 'notable' },
    };
  }
  const one = shown === 1;
  const which =
    mode === 'notable'
      ? one
        ? `the newest session ${NOTABLE_KIND}`
        : `the ${n} newest sessions ${NOTABLE_KIND}`
      : one
        ? 'your newest session'
        : `your ${n} newest sessions`;
  const lead = one ? 'This is' : 'These are';
  const words = reach ? `${lead} ${which}${back}. There are older ones.` : `${lead} ${which} saved on this phone${back}.`;
  return {
    words,
    note: failed ? `Could not read older sessions. ${sentence(failed)}` : null,
    door: { title: failed ? 'Try again' : 'Show older sessions', line: null, act: 'older' },
  };
}

/** A message as a sentence: its first letter up, one full stop at the end. */
export function sentence(message: string): string {
  const t = message.trim();
  const up = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(up) ? up : `${up}.`;
}

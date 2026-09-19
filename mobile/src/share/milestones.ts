/**
 * Hours milestones: the second thing Builda makes a card of by itself, beside last week's
 * (`weekOffer.ts`). Strava says "you have run 100 miles"; a builder has hours. PURE, so
 * `__tests__/milestones.test.ts` holds it.
 *
 * The total is the profile's (`totals.active_seconds`, every visible finished session summed by
 * the server), never a sum of the list, which holds only the notable sessions.
 *
 * BACKFILL IS SILENT, the rule this repository learned from notifications (CLAUDE.md: first launch
 * finalized 71 historical sessions and announced every one). Someone who opens the app with 300
 * hours already on record has crossed 250 at some point nobody saw, and a card for it now is not
 * news: the first reading only remembers the highest milestone already behind them, and a card is
 * offered only for one crossed after that.
 */

/** In hours. Spaced so each one is further than the last, and the first comes in a week or two. */
export const MILESTONE_HOURS = [10, 25, 50, 100, 250, 500, 1000] as const;

/** The kv row that remembers the highest milestone already offered (or passed before Builda knew). */
export const MILESTONE_KEY = 'milestone.hours';

/** The highest milestone at or under `seconds`, or 0 before the first. */
export function milestoneReached(seconds: number): number {
  const hours = Math.max(0, seconds) / 3600;
  let best = 0;
  for (const m of MILESTONE_HOURS) if (hours >= m) best = m;
  return best;
}

export type MilestoneStep =
  /** First reading: remember what is already behind them, offer nothing. */
  | { kind: 'remember'; hours: number }
  /** A milestone crossed since the last reading: offer its card, then remember it. */
  | { kind: 'offer'; hours: number }
  | { kind: 'none' };

/** What to do with a total, given what was remembered (`null` on the first reading). */
export function milestoneStep(seconds: number, remembered: number | null): MilestoneStep {
  const reached = milestoneReached(seconds);
  if (remembered === null) return { kind: 'remember', hours: reached };
  return reached > remembered ? { kind: 'offer', hours: reached } : { kind: 'none' };
}

/** The island's line for a milestone card. */
export function milestoneLine(hours: number): string {
  return `${hours} hours of building. Your card is made. Tap to see it.`;
}

/** The card's small line: "132 sessions since Aug 11". The start is the earliest project's first session. */
export function milestoneNote(sessions: number, firstIso: string | null): string {
  const count = sessions === 1 ? '1 session' : `${sessions.toLocaleString('en-US')} sessions`;
  const t = firstIso ? Date.parse(firstIso) : NaN;
  if (!Number.isFinite(t)) return count;
  const since = new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${count} since ${since}`;
}

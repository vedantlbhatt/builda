/**
 * When the Monday notification for last week's card fires (`push/weekly.ts`). PURE, so bun holds it.
 *
 * 09:00 on the Monday that starts the NEXT Builda week, local time. The week turns at 04:00 on
 * Monday (`theme.DAY_BOUNDARY_HOUR`), not at midnight and not at nine: FOUND IN REVIEW, a version
 * that took "the next Monday at nine" scheduled, at 06:00 on a Monday, a notification for that same
 * morning about a week the island had just offered (or about an empty week, whose tap opened
 * nothing). The card it announces is always the week `now` is in, once that week is over.
 */
import { weekOf } from '../session/week';

export const WEEK_CARD_HOUR = 9;

export function nextWeekCardAt(now: number, hour = WEEK_CARD_HOUR): Date {
  const [y, m, d] = weekOf([], now).days[0]!.date.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d + 7, hour, 0, 0, 0);
}

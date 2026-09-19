/**
 * When the Monday notification for last week's card fires (`push/weekly.ts`). PURE, so bun holds it.
 *
 * 09:00 on the next Monday, local time: after the Builda day has turned (04:00) and at an hour a
 * person reads a phone. Never in the past: on a Monday before nine it is that morning, after nine
 * it is the Monday after.
 */
export const WEEK_CARD_HOUR = 9;

export function nextWeekCardAt(now: number, hour = WEEK_CARD_HOUR): Date {
  const d = new Date(now);
  const daysToMonday = (8 - d.getDay()) % 7;
  const at = new Date(d.getFullYear(), d.getMonth(), d.getDate() + daysToMonday, hour, 0, 0, 0);
  if (at.getTime() <= now) at.setDate(at.getDate() + 7);
  return at;
}

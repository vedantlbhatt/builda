/**
 * When a session started, as the hero band says it: "Today at 9:40am", "Yesterday at 1:12pm",
 * "Saturday at 1:12pm", "Aug 29 at 1:12pm". The day is `theme.dayLabel`'s (the Builda day, which
 * starts at 04:00), so a sitting begun at 00:30 is filed under the evening before, as every list
 * files it; the clock is the phone's own, in the zone it is in.
 *
 * Pure: no React Native, so `bun test` holds it.
 */

import { dayLabel } from '../theme';

/** "1:12pm", "9:05am", "12:00pm". Lower case, no space, as the analysis page writes an hour. */
export function clockLabel(t: number): string {
  const d = new Date(t);
  const h = d.getHours();
  const m = d.getMinutes();
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;
}

export function whenLabel(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'A session';
  const day = dayLabel(t, now);
  const cap = day ? `${day.charAt(0).toUpperCase()}${day.slice(1)}` : '';
  return cap ? `${cap} at ${clockLabel(t)}` : clockLabel(t);
}

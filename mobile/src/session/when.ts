/**
 * When a session started, as the hero band says it: "Today at 9:40am", "Yesterday at 1:12pm",
 * "Saturday at 1:12pm", "Aug 29 at 1:12pm". The day is `theme.dayLabel`'s (the Builda day, which
 * starts at 04:00), so a sitting begun at 00:30 is filed under the evening before, as every list
 * files it; the clock is the phone's own, in the zone it is in.
 *
 * Pure: no React Native, so `bun test` holds it.
 */

import { timeOfDay } from '../copy/time';
import { dayLabel } from '../theme';

export function whenLabel(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'A session';
  const day = dayLabel(t, now);
  const cap = day ? `${day.charAt(0).toUpperCase()}${day.slice(1)}` : '';
  return cap ? `${cap} at ${timeOfDay(t)}` : timeOfDay(t);
}

/**
 * THE ONE WAY A TIME OF DAY IS WRITTEN: "9:12am", "12:40am", "3pm". Lower case, no space, no
 * leading zero on the hour.
 *
 * FOUND IN THE FINAL CAPTURE (2026-09-13): one session page said "9:12am" in its hero and
 * "9:12 AM" on the card under it, the codebase map said "last touched at 15:19", mission control
 * "since 15:22", and the trends "work after 22:00" on a page whose clock dial says "10pm". Four
 * spellings of one kind of fact. This is the majority's: the session hero and its strip, the
 * analysis page's hours ("11am", "22% between 10pm and 4am") and every Wrapped card, whose
 * sentence is Python's (`wrapped._when`, "A Tuesday, at 11:42pm"), so the engine already writes
 * it this way and a phone that wrote it any other way would disagree with its own cards.
 *
 * Every time of day on the phone comes through here; `__tests__/timeOfDay.test.ts` holds the
 * rule and scans the app for a clock written any other way. The count up's frames are the one
 * exception it cannot call (a worklet: `insights/format.ts` `hour`), and the same test holds
 * that frame to `hourOfDay`.
 *
 * Pure: no React Native, so `bun test` runs it.
 */

/** "9:12am" from an hour 0 to 23 and a minute 0 to 59. The form every other function here writes. */
export function clockWords(hour: number, minute: number): string {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  const m = Math.max(0, Math.min(59, Math.floor(minute)));
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;
}

/** An instant (epoch ms) as the phone's own clock says it, in the zone the phone is in: "9:12am". */
export function timeOfDay(t: number): string {
  const d = new Date(t);
  return clockWords(d.getHours(), d.getMinutes());
}

/** A whole clock hour, 0 to 23: "12am", "11am", "10pm". For an hour the data names, never an instant. */
export function hourOfDay(hour: number): string {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}${h < 12 ? 'am' : 'pm'}`;
}

/** A 24 hour clock inside words the engine wrote ("work after 22:00"). Hours 0 to 23, minutes 00 to 59. */
const TWENTY_FOUR = /\b([01]?\d|2[0-3]):([0-5]\d)\b(?!\s?(?:am|pm|AM|PM))/g;

/**
 * Words from the report or the server with a 24 hour clock in them, in the house clock:
 * "work after 22:00" is "work after 10pm", "at 14:05" is "at 2:05pm". A whole hour drops its
 * ":00", as the analysis page writes a boundary hour. Only a clock is touched; a ratio like
 * "3:1" has no two digit minute and stays as it is.
 */
export function clocksInWords(text: string): string {
  return text.replace(TWENTY_FOUR, (_m, h: string, m: string) => (m === '00' ? hourOfDay(Number(h)) : clockWords(Number(h), Number(m))));
}

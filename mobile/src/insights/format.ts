/**
 * How an animated number is written at every frame of its count, on the UI thread.
 *
 * A count up draws a string per frame inside a Reanimated worklet, where `Intl` does not exist
 * and nothing from `src/copy/` can run (those helpers do exact Python rounding with BigInt). So
 * each number on the page carries two things: its FINAL string, written by the copy helper the
 * rest of the app uses (`n`, `pct`, `dollars`, `clock`, ...), and a `NumFormat` that writes the
 * frames on the way there with the same shape: the same decimals, the same grouping, the same
 * prefix and unit. At rest the page shows the final string, so the resting number is always
 * the copy helper's; `__tests__/insights.test.ts` holds each format to its helper so the last
 * frame and the resting string never differ by a digit.
 *
 * Pure: no React Native, so `bun test` runs every function here.
 */

export type NumFormat =
  /** Digits with a fixed number of decimals, optionally grouped, with a prefix and a unit. */
  | { kind: 'fixed'; decimals: number; grouping: boolean; prefix: string; suffix: string }
  /** `theme.duration`: "45s", "12m", "1h 05m" (`copy.wholeMinutes`, floored). */
  | { kind: 'duration' }
  /** `copy.clock`: measured seconds exactly, "39s", "59m 28s", "1h 02m 05s". */
  | { kind: 'clock' }
  /** `copy.floorMins`: a record's length, "under a minute", "42 minutes", "3h 06m". */
  | { kind: 'floorMins' }
  /** A clock hour, 0 to 23: "12am", "11am", "3pm". */
  | { kind: 'hour' }
  /** `copy.human`: a token count, "999", "38k", "4,170.5M". */
  | { kind: 'tokens' };

/** An animated number: where it counts to, the string it rests on, and how its frames read. */
export interface NumSpec {
  value: number;
  final: string;
  fmt: NumFormat;
}

function groupThousands(digits: string): string {
  'worklet';
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    const fromEnd = digits.length - i;
    out += digits.charAt(i);
    if (fromEnd > 1 && (fromEnd - 1) % 3 === 0) out += ',';
  }
  return out;
}

function fixed(value: number, decimals: number, grouping: boolean): string {
  'worklet';
  const d = Math.max(0, Math.min(6, Math.floor(decimals)));
  const factor = Math.pow(10, d);
  const scaled = Math.round(Math.abs(value) * factor);
  const whole = Math.floor(scaled / factor);
  const frac = scaled - whole * factor;
  let body = grouping ? groupThousands(String(whole)) : String(whole);
  if (d > 0) {
    let f = String(frac);
    while (f.length < d) f = '0' + f;
    body += '.' + f;
  }
  return (value < 0 && scaled !== 0 ? '-' : '') + body;
}

function pad2(x: number): string {
  'worklet';
  return x < 10 ? '0' + String(x) : String(x);
}

/** Every frame's string. `value` is wherever the count has got to. */
export function formatWith(fmt: NumFormat, value: number): string {
  'worklet';
  const v = Number.isFinite(value) ? value : 0;
  switch (fmt.kind) {
    case 'fixed':
      return fmt.prefix + fixed(v, fmt.decimals, fmt.grouping) + fmt.suffix;
    case 'duration': {
      const m = Math.floor(Math.max(0, v) / 60);
      if (m < 1) return String(Math.floor(Math.max(0, v))) + 's';
      const h = Math.floor(m / 60);
      return h > 0 ? String(h) + 'h ' + pad2(m % 60) + 'm' : String(m) + 'm';
    }
    case 'clock': {
      const s = Math.round(Math.max(0, v));
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = s % 60;
      if (h) return String(h) + 'h ' + pad2(m) + 'm ' + pad2(sec) + 's';
      if (m) return String(m) + 'm ' + pad2(sec) + 's';
      return String(sec) + 's';
    }
    case 'floorMins': {
      const m = Math.floor(Math.max(0, v) / 60);
      if (m < 1) return 'under a minute';
      if (m < 60) return String(m) + (m === 1 ? ' minute' : ' minutes');
      return String(Math.floor(m / 60)) + 'h ' + pad2(m % 60) + 'm';
    }
    case 'hour': {
      const h = ((Math.floor(v) % 24) + 24) % 24;
      const twelve = h % 12 === 0 ? 12 : h % 12;
      return String(twelve) + (h < 12 ? 'am' : 'pm');
    }
    case 'tokens': {
      const t = Math.round(Math.max(0, v));
      if (t >= 1000000 || Math.round(t / 1000) >= 1000) return fixed(t / 1000000, 1, true) + 'M';
      if (t >= 1000) return String(Math.round(t / 1000)) + 'k';
      return String(t);
    }
  }
}

const FIXED_SHAPE = /^([^\d]*?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?([^\d]*)$/;

/**
 * The `fixed` format a copy helper's string implies: "$2,952" is a dollar prefix, grouped, no
 * decimals; "74.5" is one decimal; "82%" is a percent unit. Null when the string is not one
 * plain number with words around it (then the caller names a format itself).
 */
export function fixedFormatOf(final: string): NumFormat | null {
  const m = FIXED_SHAPE.exec(final);
  if (!m) return null;
  const digits = m[2]!;
  return {
    kind: 'fixed',
    decimals: m[3]?.length ?? 0,
    // A four digit number written without a comma ("4170.5M") was not grouped.
    grouping: digits.includes(',') || digits.length <= 3,
    prefix: m[1] ?? '',
    suffix: m[4] ?? '',
  };
}

/**
 * A count to `value` that rests on `final`, with the frames shaped like `final`.
 *
 * A plain number counts to the number `final` WRITES, not to the raw value: 0.285 is "29%" by the
 * one rounding rule (the share as written, a tie up), while `0.285 * 100` is the double
 * 28.499999999999996, so a count to it would land on "28%" and then snap to "29%". Counting to
 * 29 lands where it rests. Durations, clock hours and token counts
 * name their own format and count the raw value, which their formats write exactly as the
 * helpers do.
 */
export function numSpec(value: number, final: string, fmt?: NumFormat): NumSpec {
  if (fmt) return { value, final, fmt };
  const m = FIXED_SHAPE.exec(final);
  const shape = fixedFormatOf(final);
  if (!m || !shape) return { value, final, fmt: { kind: 'fixed', decimals: 0, grouping: true, prefix: '', suffix: '' } };
  const written = Number(`${m[2]!.replace(/,/g, '')}${m[3] ? `.${m[3]}` : ''}`);
  return { value: Number.isFinite(written) ? written : value, final, fmt: shape };
}

/**
 * Whether a count starting at `delay` and running `duration` has landed at block clock `clock`.
 * A worklet: the counter reads it on the UI thread, and the same rule on the JS thread decides
 * what React renders (`restingText`), so the two can never disagree about whether it is done.
 */
export function countLanded(clock: number, delay: number, duration: number): boolean {
  'worklet';
  if (duration <= 0) return clock >= delay;
  return clock >= delay + duration;
}

/**
 * What React renders for a count, the string a commit puts back on screen: the resting string
 * once its block's clock is past the count's end, else its first frame.
 *
 * FOUND IN INTEGRATION (2026-09-13, the stack page after a hot reload): a number that MOUNTS
 * after its block has already played, or whose data arrives late (a slow network), showed "0"
 * forever. React only ever rendered the first frame, "0", and the counter's frames are written
 * on the UI thread only when the clock moves: a clock already at rest never moves again, so
 * nothing ever wrote the number. React now renders what the clock says (`Num`), and a count that
 * missed its block's play simply shows its value.
 */
export function restingText(spec: NumSpec, landed: boolean): string {
  return landed ? spec.final : formatWith(spec.fmt, 0);
}

/**
 * The display size for a big number that must fit `width` on one line. Never larger than `max`,
 * never under `min`.
 */
export function fitSize(text: string, width: number, max: number, min: number): number {
  // Measured on the simulator at 91 pt heavy: "+50,17" ran 307 pt, so a tabular figure is about
  // 0.68 em; the rest are estimates on the same side. A 6% margin keeps a figure off the edge.
  let ems = 0;
  for (const ch of text) {
    if (/[0-9]/.test(ch)) ems += 0.68;
    else if (ch === ',' || ch === '.') ems += 0.3;
    else if (ch === ' ') ems += 0.28;
    else if (ch === '%') ems += 0.98;
    else if (ch === '$' || ch === '+' || ch === '-') ems += 0.68;
    else if (/[A-Z]/.test(ch)) ems += 0.72;
    else ems += 0.6;
  }
  if (ems <= 0) return max;
  return Math.max(min, Math.min(max, Math.floor((width * 0.94) / ems)));
}

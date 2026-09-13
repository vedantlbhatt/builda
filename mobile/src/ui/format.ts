/**
 * Number formatting for animated numbers. Hand-written because it runs inside a Reanimated
 * worklet on the UI thread, where `Intl` does not exist; and deliberately small: product
 * formatting (1.4M, 38k) belongs to the screen, a count up only needs digits, grouping and
 * a fixed number of decimals so the width never jumps mid-count.
 *
 * `decimalsOf` is ported from react-bits `TextAnimations/CountUp/CountUp.tsx` (David Haz,
 * MIT + Commons Clause; the notice is in `digits.ts`).
 */

/** Decimal places written in `n`: 12.5 has 1, 12 has 0, 12.50 is 12.5 and has 1. */
export function decimalsOf(n: number): number {
  const str = n.toString();
  if (str.includes('e')) return 0;
  const dot = str.indexOf('.');
  if (dot === -1) return 0;
  const decimals = str.slice(dot + 1);
  return parseInt(decimals, 10) !== 0 ? decimals.length : 0;
}

/** Comma between thousands, by hand: "1204" to "1,204". */
export function groupThousands(digits: string): string {
  'worklet';
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    const fromEnd = digits.length - i;
    out += digits.charAt(i);
    if (fromEnd > 1 && (fromEnd - 1) % 3 === 0) out += ',';
  }
  return out;
}

/**
 * `value` with exactly `decimals` places, optionally grouped, with a prefix and suffix.
 * Rounds half away from zero. Negative numbers get a leading "-" (a minus, not a dash).
 */
export function formatCount(
  value: number,
  decimals: number,
  grouping: boolean,
  prefix: string,
  suffix: string,
): string {
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
  const sign = value < 0 && scaled !== 0 ? '-' : '';
  return prefix + sign + body + suffix;
}

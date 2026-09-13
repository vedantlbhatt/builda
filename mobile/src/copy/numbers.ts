/**
 * How a number is said, exactly as the engine says it.
 *
 * Every sentence the phone writes from the report and the session wire is a port of a
 * Python sentence (docs/overnight-integration.md 1.5: the report carries no rendered
 * string, and the phone renders every one). The words are the easy half. The hard half is
 * the numbers, because Python and JavaScript round differently and a card that says 12%
 * where the Mac says 13% is two answers to one question:
 *
 *   - Python's `round(x, n)` and `f"{x:.nf}"` round the EXACT binary value of `x`, and an
 *     exact tie goes to the even digit: `round(0.125, 2)` is 0.12, `round(2.5)` is 2.
 *   - `Math.round` rounds a tie up, and `toFixed` rounds a tie up.
 *
 * So `pyRound` and `pyFixed` below do the arithmetic Python does, exactly, on the double's
 * own bits, and every helper here is built on them. Each helper names the Python function
 * it ports; `__tests__/copyNumbers.test.ts` pins them to Python when python3 is on the
 * machine, and to hand checked values always.
 *
 * Pure: no React Native, so `bun test` runs it.
 */

// ------------------------------------------------------------------ exact rounding

const TWO = 2n;

/** `x` as `mantissa * 2^exponent`, exactly, with the sign on the mantissa. */
function decompose(x: number): { mant: bigint; exp: number } {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const negative = hi >>> 31 === 1;
  const biased = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let exp: number;
  if (biased === 0) {
    exp = -1074; // subnormal: no implicit leading bit
  } else {
    mant |= 1n << 52n;
    exp = biased - 1075;
  }
  return { mant: negative ? -mant : mant, exp };
}

/**
 * `x * 10^digits` rounded to an integer the way CPython rounds: on the exact binary value,
 * an exact tie to the even integer. Returned as a BigInt so nothing is rounded twice.
 */
function scaledHalfEven(x: number, digits: number): bigint {
  if (!Number.isFinite(x)) throw new RangeError(`cannot round ${x}`);
  if (!Number.isInteger(digits) || digits < 0) throw new RangeError(`digits must be a whole number, got ${digits}`);
  if (x === 0) return 0n;
  const { mant, exp } = decompose(x);
  const negative = mant < 0n;
  const num = (negative ? -mant : mant) * 10n ** BigInt(digits);
  let q: bigint;
  if (exp >= 0) {
    q = num << BigInt(exp);
  } else {
    const den = 1n << BigInt(-exp);
    q = num / den;
    const twice = (num % den) * TWO;
    if (twice > den || (twice === den && q % TWO === 1n)) q += 1n;
  }
  return negative ? -q : q;
}

/** Python's `round(x, digits)`: the double nearest the half even decimal. */
export function pyRound(x: number, digits = 0): number {
  const q = scaledHalfEven(x, digits);
  return digits === 0 ? Number(q) : Number(`${q}e-${digits}`);
}

/** The decimal digits of a scaled integer, `digits` of them after the point, no sign. */
function place(q: bigint, digits: number): { int: string; frac: string } {
  const s = (q < 0n ? -q : q).toString().padStart(digits + 1, '0');
  return { int: s.slice(0, s.length - digits), frac: s.slice(s.length - digits) };
}

/** Thousands separated with commas, as Python's `,` format option writes them. */
function grouped(intDigits: string): string {
  return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Python's `f"{x:.{digits}f}"`, and with `commas`, `f"{x:,.{digits}f}"`. A value that rounds
 * to zero keeps its sign as Python does ("-0.0"); nothing here formats a negative share.
 */
export function pyFixed(x: number, digits: number, commas = false): string {
  const q = scaledHalfEven(x, digits);
  const { int, frac } = place(q, digits);
  const sign = x < 0 || Object.is(x, -0) ? '-' : '';
  const whole = commas ? grouped(int) : int;
  return `${sign}${whole}${digits ? `.${frac}` : ''}`;
}

/** Python's `f"{n:,}"` for a whole number. */
export function commas(n: number): string {
  if (!Number.isInteger(n)) throw new RangeError(`commas() takes a whole number, got ${n}`);
  const sign = n < 0 ? '-' : '';
  return `${sign}${grouped(String(Math.abs(n)))}`;
}

// ------------------------------------------------------------------ analysis/profile.py

/**
 * `profile._n`: a number a person reads out loud. One decimal at most, no trailing ".0",
 * thousands separated, rounded FIRST (4.96 is "5", never "5.0").
 */
export function n(x: number): string {
  const q = scaledHalfEven(x, 1);
  if (q % 10n === 0n) return commas(Number(q / 10n));
  const { int, frac } = place(q, 1);
  return `${q < 0n ? '-' : ''}${grouped(int)}.${frac}`;
}

/**
 * `profile._count`: the number and its noun, agreed. The noun agrees with the number AS
 * GIVEN, not as printed: Python compares `n == 1` before rounding, so this does too.
 */
export function count(x: number, one: string, many?: string): string {
  return `${n(x)} ${x === 1 ? one : (many ?? `${one}s`)}`;
}

/** `profile._pct`: a share as a whole percent, `round(x * 100)`. */
export function pct(share: number): string {
  return `${Number(scaledHalfEven(share * 100, 0))}%`;
}

/** `profile.in_ten`: a share as "N in 10", rounded half UP, the one rule every such line reads. */
export function inTen(share: number): number {
  return Math.trunc(share * 10 + 0.5 + 1e-9);
}

// ------------------------------------------------------------------ templates

/** A template, or a set of forms chosen by `n` (`profile.fill`). */
export type FillTemplate = string | Readonly<{ zero?: string; one?: string; other: string }>;

const SLOT = /\{(\w+)(?::([^{}]+))?\}/g;

/**
 * `profile.fill`: a template with its numbers in. `{name}` is the value said by `n()`,
 * `{name:noun}` the value and its noun agreed by `count()`, and a string value goes in as it
 * is. A mapping template picks `zero` when `n` is 0 and `one` when it is 1 (each only if it
 * has one), else `other`.
 *
 * Python raises on a slot whose value is absent: "a sentence with a hole in it is a bug,
 * never a sentence". On the phone that is `null`, so the screen renders nothing rather than
 * a crash or a hole.
 */
export function fill(template: FillTemplate, values: Readonly<Record<string, number | string | null | undefined>>): string | null {
  let t: string;
  if (typeof template === 'string') {
    t = template;
  } else {
    const k = values.n;
    t = k === 0 && template.zero !== undefined ? template.zero : k === 1 && template.one !== undefined ? template.one : template.other;
  }
  let hole = false;
  const out = t.replace(SLOT, (_m, name: string, noun: string | undefined) => {
    const v = values[name];
    if (v === null || v === undefined) {
      hole = true;
      return '';
    }
    if (typeof v === 'string') return v;
    return noun ? count(v, noun) : n(v);
  });
  return hole ? null : out;
}

// ------------------------------------------------------------------ durations

/** `feedback._mins`: "under a minute", "12 minutes", "1h 05m". Rounded, half to even. */
export function mins(seconds: number): string {
  const m = Number(scaledHalfEven(seconds / 60, 0));
  if (m < 1) return 'under a minute';
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/**
 * `analysis/__main__._clock`: measured seconds, exactly, for a block of numbers ("45s",
 * "3m 35s", "1h 02m 05s"). Not a sentence, so not `mins`: that rounds to the nearest minute
 * while the cards floor (`theme.duration`), and a numbers cell beside a sentence must agree
 * with both. FOUND IN INTEGRATION (2026-09-13), on this session live on the simulator: the
 * paragraph said "3 minutes of it with you there" above a numbers cell "2m attended", both
 * about 162 seconds. The exact figure, "2m 42s", reads true beside either.
 */
export function clock(seconds: number): string {
  const s = pyRound(Math.max(0, seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (x: number) => String(x).padStart(2, '0');
  if (h) return `${h}h ${two(m)}m ${two(sec)}s`;
  if (m) return `${m}m ${two(sec)}s`;
  return `${sec}s`;
}

/**
 * Python's float `a // b`, which is NOT `Math.floor(a / b)`: CPython floors the exact
 * quotient through `fmod`, so a quotient a hair under a whole number that the division
 * rounds up to it still floors down. JavaScript's `%` is the same exact `fmod`.
 */
export function pyFloorDiv(a: number, b: number): number {
  let mod = a % b;
  let div = (a - mod) / b;
  if (mod && b < 0 !== mod < 0) {
    mod += b;
    div -= 1;
  }
  if (!div) return 0;
  let floor = Math.floor(div);
  if (div - floor > 0.5) floor += 1;
  return floor;
}

/**
 * THE WHOLE MINUTES of a duration: floored, never rounded up. One function for a session's own
 * clock in minutes, the figure (`theme.duration`) and the sentence (`floorMins`), so the two can
 * never disagree by a minute. FOUND IN REVIEW (2026-09-13): the session page printed 3,570 s as
 * "59m" on the hero and "You built for 1h 00m" under it, one floored and one rounded. Floored
 * because a duration is a clock: 59 minutes and 30 seconds has not been an hour yet, which is
 * the cards' rule too (`wrapped._floor_mins`).
 */
export function wholeMinutes(seconds: number): number {
  return pyFloorDiv(Math.max(0, seconds), 60);
}

/**
 * `wrapped._floor_mins`: a record's length, never rounded UP. 3,585 seconds is 59 minutes
 * on every card that says it. The minutes are `wholeMinutes`.
 */
export function floorMins(seconds: number): string {
  const m = wholeMinutes(seconds);
  if (m < 1) return 'under a minute';
  if (m < 60) return count(m, 'minute');
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

// ------------------------------------------------------------------ analysis/burn.py

/** `burn._count`: a whole number with commas and its noun, agreed. */
export function tally(x: number, noun: string): string {
  return `${commas(x)} ${noun}${x === 1 ? '' : 's'}`;
}

/**
 * `burn._human`: a token count as a person says it. 999,500 is "1.0M", never "1000k", and the
 * millions are grouped like every other number on the phone: 3,766,512,000 is "3,766.5M".
 *
 * THE ONE TOKEN FORMATTER. FOUND IN THE FINAL CAPTURE (2026-09-13): Money and the analysis page
 * printed "3766.5M tokens" two lines from "$2,564" and "47,803 lines", because `_human` wrote
 * `f"{n / 1_000_000:.1f}M"` with no `,`. The phone groups, and `analysis/burn.py` now does too
 * (`:,.1f`), so the two agree to the byte at every size (`__tests__/copyNumbers.test.ts` runs
 * Python on it).
 */
export function human(tokens: number): string {
  if (tokens >= 1_000_000 || Number(scaledHalfEven(tokens / 1_000, 0)) >= 1_000) {
    return `${pyFixed(tokens / 1_000_000, 1, true)}M`;
  }
  if (tokens >= 1_000) return `${pyFixed(tokens / 1_000, 0)}k`;
  return String(tokens);
}

/**
 * `burn._share_words`: a share as a person says it. A positive share that rounds to 0% is
 * "under 1%" (a zero is printed only when it was measured), and a share short of all of it
 * that rounds to 100% is "over 99%".
 */
export function shareWords(share: number): string {
  if (share > 0 && share < 0.005) return 'under 1%';
  if (share >= 0.995 && share < 1) return 'over 99%';
  return `${pyFixed(share * 100, 0)}%`;
}

/** `burn._about`: a share opening a sentence, "About 40%", and never "About 100%". */
export function about(share: number): string {
  const said = shareWords(share);
  if (said.startsWith('under') || said.startsWith('over')) return capital(said);
  return `About ${said}`;
}

/** The first letter upper case, as `said[0].upper() + said[1:]` does. */
export function capital(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * WORDS ON A TILE ARE NEVER BROKEN INSIDE A WORD.
 *
 * FOUND IN THE FINAL CAPTURE (2026-09-13, shots 70 and 72): a half tile in mission control set
 * its verdict as "convergin" over "g". The word sits beside its glyph in the band of the tile the
 * creature does not cover (about 77pt on an iPhone 16 Pro), and "converging" in 14pt heavy is
 * 81pt, so iOS, with no space to break at, broke the word. `numberOfLines` does not stop that and
 * `adjustsFontSizeToFit` answers a different question (does the block fit its lines), so every
 * word a tile sets is sized here first: the largest size, no larger than its role's, at which the
 * widest unbreakable run of the text fits the measure it is given, at the reader's text size.
 *
 * The widths are MEASURED, not guessed: the advance of every character below is SF Pro's own
 * (`/System/Library/Fonts/SFNS.ttf`, instanced by fontTools at wght 800, opsz 17, the widest
 * optical size and the heaviest weight a tile sets, so a lighter or larger setting only has more
 * room), in ems. SF Mono's advance is one number at every weight. A character not in the table
 * counts as a whole em, wider than any letter here. `MARGIN` covers what the table does not: SF's
 * own tracking table moves a 13 to 17pt glyph by under 0.02 em, and the tiles' letter spacing is
 * negative, so both only give room back.
 *
 * Pure: no React Native, so `bun test` holds it (`__tests__/missionFit.test.ts`).
 */

/** SF Pro, wght 800, opsz 17: advance widths in ems. Digits are the widest figure (tabular). */
const SF: Readonly<Record<string, number>> = {
  a: 0.602, b: 0.664, c: 0.597, d: 0.664, e: 0.611, f: 0.423, g: 0.657, h: 0.646, i: 0.3, j: 0.3,
  k: 0.621, l: 0.309, m: 0.953, n: 0.642, o: 0.629, p: 0.659, q: 0.66, r: 0.453, s: 0.581, t: 0.429,
  u: 0.642, v: 0.596, w: 0.872, x: 0.599, y: 0.615, z: 0.576,
  A: 0.752, B: 0.706, C: 0.75, D: 0.754, E: 0.63, F: 0.606, G: 0.765, H: 0.797, I: 0.335, J: 0.622,
  K: 0.726, L: 0.604, M: 0.917, N: 0.777, O: 0.792, P: 0.687, Q: 0.792, R: 0.708, S: 0.688, T: 0.669,
  U: 0.768, V: 0.737, W: 1.023, X: 0.747, Y: 0.726, Z: 0.68,
  '0': 0.712, '1': 0.712, '2': 0.712, '3': 0.712, '4': 0.712, '5': 0.712, '6': 0.712, '7': 0.712, '8': 0.712, '9': 0.712,
  '.': 0.365, ',': 0.365, ':': 0.365, ';': 0.365, "'": 0.365, '’': 0.365, '!': 0.371, '?': 0.572,
  '-': 0.489, '+': 0.685, '(': 0.444, ')': 0.444, '%': 1.072, '$': 0.685, '/': 0.344, '&': 0.755,
  '#': 0.685, '@': 0.93, '_': 0.6, '·': 0.365,
};

/** SF Mono's advance at every weight (measured at wght 600, the repository line's). */
const MONO_EM = 0.618;

/** What the table does not measure: tracking and rendering, as a share of the run. */
export const MARGIN = 0.04;

/** A face a tile sets: SF Pro at any weight up to 800, or SF Mono. */
export type Face = 'sans' | 'mono';

/** One run's width in ems. */
export function runEms(run: string, face: Face): number {
  let ems = 0;
  for (const ch of run) ems += face === 'mono' ? MONO_EM : (SF[ch] ?? 1);
  return ems;
}

/**
 * The runs a line can only be broken between: split at spaces, and after a hyphen or a slash,
 * where iOS breaks a line too (Unicode line breaking, UAX #14), so "gt-transit" may end a line
 * after "gt-" and that is not a word broken. Empty runs are dropped. A no-break space is not a
 * break: "Private project 2" holds its number to its words with one (`projects/model.projectLabel`),
 * so "project 2" is one run, and JavaScript's `\s` would have split it.
 */
export function unbreakableRuns(text: string): string[] {
  const out: string[] = [];
  for (const word of text.split(/[^\S\u00a0]+/)) {
    let run = '';
    for (const ch of word) {
      run += ch;
      if (ch === '-' || ch === '/') {
        out.push(run);
        run = '';
      }
    }
    if (run) out.push(run);
  }
  return out;
}

/** The widest run of `text`, in ems. 0 for no words. */
export function widestRunEms(text: string, face: Face): number {
  let widest = 0;
  for (const run of unbreakableRuns(text)) widest = Math.max(widest, runEms(run, face));
  return widest;
}

/**
 * The size to set `text` at so no word of it is broken: `size` when its widest run already fits
 * `width` points, else the size, in tenths of a point, at which it does. `scale` is what iOS will
 * multiply the size by (the reader's text size, capped the way the tile caps it), so the fit is
 * of what is drawn, not of the number in the style.
 */
export function fitWords(text: string, width: number, size: number, face: Face = 'sans', scale = 1): number {
  const ems = widestRunEms(text, face);
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  if (ems <= 0 || !(width > 0)) return size;
  const fits = width / (s * ems * (1 + MARGIN));
  return fits >= size ? size : Math.floor(fits * 10) / 10;
}

/**
 * The verdict word beside its glyph ("converging"), or under it, whole, when beside it would
 * set it smaller than `STACK_AT` of its size: a glance should read a status word, not squint at
 * one. Under the glyph it has the row's whole measure.
 */
export const STACK_AT = 0.8;

export function stateLayout(
  word: string,
  rowWidth: number,
  glyph: number,
  gap: number,
  size: number,
  scale = 1,
): { stacked: boolean; size: number } {
  const beside = fitWords(word, rowWidth - glyph - gap, size, 'sans', scale);
  if (beside >= size * STACK_AT) return { stacked: false, size: beside };
  return { stacked: true, size: fitWords(word, rowWidth, size, 'sans', scale) };
}

// ------------------------------------------------------------------ the tiles' sizes

export type TileVariant = 'lead' | 'wide' | 'half';

export interface VariantSpec {
  pad: number;
  logo: number;
  repo: number;
  sentence: number;
  sentenceLh: number;
  state: number;
  glyph: number;
  figure: number;
  caption: number;
  eta: number;
  /** Whole points per cell: 16 cells of 3, 4 or 5 points. */
  creature: number;
  track: number;
  gap: number;
}

/**
 * The three sizes (`MissionTile.tsx` sets them and nothing else does). The lead's sentence is the
 * largest words on the screen after the summary band's number; a half tile's is 17/700, which at
 * 146 points of measure holds the engine's longest sentence ("Stuck on the same failing command
 * for twenty minutes") in four lines.
 */
export const VARIANT: Record<TileVariant, VariantSpec> = {
  lead: { pad: 18, logo: 20, repo: 15, sentence: 26, sentenceLh: 30, state: 17, glyph: 18, figure: 44, caption: 13, eta: 15, creature: 80, track: 6, gap: 12 },
  wide: { pad: 16, logo: 18, repo: 14, sentence: 21, sentenceLh: 25, state: 15, glyph: 16, figure: 34, caption: 12, eta: 14, creature: 64, track: 5, gap: 10 },
  half: { pad: 14, logo: 16, repo: 13, sentence: 17, sentenceLh: 21, state: 14, glyph: 14, figure: 30, caption: 12, eta: 13, creature: 48, track: 4, gap: 9 },
};

/** Between a state's glyph and its word. */
export const STATE_GAP = 6;

/**
 * The measures a tile's words are set in, for a tile `width` points wide: the whole text column
 * (`inner`), the lower column beside the creature (`lower`, where the state, the figures and the
 * ETA sit), and the repository's line beside the harness stamp (`repo`).
 */
export function tileMeasures(variant: TileVariant, width: number): { inner: number; lower: number; repo: number; headGap: number } {
  const v = VARIANT[variant];
  const inner = width - v.pad * 2;
  const headGap = variant === 'half' ? 6 : 8;
  return { inner, lower: inner - v.creature - 6, repo: inner - (v.logo + 8) - headGap, headGap };
}

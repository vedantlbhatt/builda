/**
 * The band's figure set as a line of print: numbers large and the words between them smaller,
 * "42 files, 3 hot", on one line fitted to the band. The width is estimated per character with
 * the analysis page's measurements (`insights/format.ts fitSize`: a tabular figure is about
 * 0.68 em at a heavy weight, measured on the simulator), words at WORD_RATIO of the figures.
 *
 * Pure: no React Native, so `bun test` holds it.
 */

import { commas } from '../copy/numbers';

export interface FigurePart {
  kind: 'num' | 'word';
  text: string;
}

/** Words beside the figures, as a share of the figures' size: a headline, not a caption. */
export const WORD_RATIO = 0.46;

/** A string's width in ems at a heavy weight (the analysis page's estimates, same side). */
export function emsOf(text: string): number {
  let ems = 0;
  for (const ch of text) {
    if (/[0-9]/.test(ch)) ems += 0.68;
    else if (ch === ',' || ch === '.') ems += 0.3;
    else if (ch === ' ') ems += 0.28;
    else if (/[A-Z]/.test(ch)) ems += 0.72;
    else if (ch === 'i' || ch === 'l' || ch === 't' || ch === 'f') ems += 0.36;
    else ems += 0.6;
  }
  return ems;
}

/**
 * The figures' size so the whole line fits `width` with a 6% margin, never over `max` or under
 * `min`. The words are set at `ratio` of it.
 */
export function fitFigure(parts: readonly FigurePart[], width: number, max: number, min: number, ratio: number = WORD_RATIO): number {
  let ems = 0;
  for (const p of parts) ems += emsOf(p.text) * (p.kind === 'num' ? 1 : ratio);
  if (ems <= 0) return max;
  return Math.max(min, Math.min(max, Math.floor((width * 0.94) / ems)));
}

/**
 * The widest label the replay's clock passes on its way to `last` (a session `span` seconds
 * long), so the figure holds that width and nothing beside it moves while it counts: a session
 * past ten minutes reads "59m 59s" somewhere before its "1h 04m", which is wider.
 */
export function widestLabel(last: string, span: number): string {
  const candidates = [last];
  if (span >= 600) candidates.push('59m 59s');
  else if (span >= 60) candidates.push('9m 59s');
  else if (span >= 10) candidates.push('59s');
  return candidates.reduce((a, b) => (emsOf(b) > emsOf(a) ? b : a));
}

/** "42 files, 3 hot" as parts; the hot clause only when something is hot. Numbers grouped, "1,204". */
export function headlineParts(files: number, hot: number): FigurePart[] {
  const parts: FigurePart[] = [
    { kind: 'num', text: commas(files) },
    { kind: 'word', text: files === 1 ? ' file' : ' files' },
  ];
  if (hot > 0) parts.push({ kind: 'word', text: ', ' }, { kind: 'num', text: commas(hot) }, { kind: 'word', text: ' hot' });
  return parts;
}

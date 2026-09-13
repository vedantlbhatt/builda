/**
 * Splitting text into the units an effect animates: characters (graphemes, so an accented
 * letter or a flag is one unit), words, and the lines the text system actually broke the text
 * into. Pure, so `bun test` can hold it.
 *
 * Ported from react-bits `TextAnimations/SplitText/SplitText.tsx` (GSAP SplitText's `chars`
 * and `words`) and `TextAnimations/RotatingText/RotatingText.tsx` (`splitIntoCharacters`,
 * the word and space elements) by David Haz. react-bits is MIT + Commons Clause (Copyright (c)
 * 2026 David Haz): the notice is kept here as the licence asks, and the port is used as part of
 * this application only; it is not to be redistributed as a component.
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a copy of this
 *   software and associated documentation files (the "Software"), to deal in the Software
 *   without restriction, including without limitation the rights to use, copy, modify,
 *   merge, publish, and distribute the Software as part of an application, website, or
 *   product, subject to the following conditions: The above copyright notice and this
 *   permission notice shall be included in all copies or substantial portions of the
 *   Software. Commons Clause Restriction: You may use this Software, including for any
 *   commercial purpose, so long as you do not sell, sublicense, or redistribute the
 *   components themselves, whether alone, in a bundle, or as a ported version.
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
 *
 * What changed in the port: GSAP splits the DOM after layout; here the text is laid out once by
 * the real text system (a hidden `Text`, read through `onTextLayout`), and each LINE it broke
 * is split into units, so the animated copy wraps exactly where the settled text does. Spaces
 * are never a unit (they never animate and never cost a stagger step), and a word keeps the
 * spaces after it, so the gap between two words is the text system's own.
 */

/** Combining marks, variation selectors, the zero width joiner and skin tone modifiers. */
function joinsPrevious(cp: number): boolean {
  return (
    (cp >= 0x0300 && cp <= 0x036f) ||
    (cp >= 0x1ab0 && cp <= 0x1aff) ||
    (cp >= 0x1dc0 && cp <= 0x1dff) ||
    (cp >= 0x20d0 && cp <= 0x20ff) ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    (cp >= 0xfe20 && cp <= 0xfe2f) ||
    (cp >= 0x1f3fb && cp <= 0x1f3ff) ||
    (cp >= 0xe0020 && cp <= 0xe007f) ||
    cp === 0x200d
  );
}

function isRegionalIndicator(cp: number): boolean {
  return cp >= 0x1f1e6 && cp <= 0x1f1ff;
}

interface SegmenterLike {
  segment(input: string): Iterable<{ segment: string }>;
}

function segmenter(): SegmenterLike | null {
  const I = (globalThis as { Intl?: { Segmenter?: new (locale: string, options: { granularity: string }) => SegmenterLike } }).Intl;
  if (!I || typeof I.Segmenter !== 'function') return null;
  try {
    return new I.Segmenter('en', { granularity: 'grapheme' });
  } catch {
    return null;
  }
}

/**
 * The user perceived characters of `s`. `Intl.Segmenter` when the engine has it (react-bits'
 * choice); otherwise code points, with combining marks, joiners, variation selectors and skin
 * tones attached to the character before them and regional indicators paired into flags
 * (Hermes on this build has no Segmenter).
 */
export function graphemes(s: string, useIntl: boolean = true): string[] {
  const seg = useIntl ? segmenter() : null;
  if (seg) return Array.from(seg.segment(s), (x) => x.segment);
  const out: string[] = [];
  let joinNext = false;
  let riOpen = false;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    const last = out.length - 1;
    if (last >= 0 && (joinNext || joinsPrevious(cp))) {
      out[last] += ch;
      joinNext = cp === 0x200d;
      continue;
    }
    if (last >= 0 && riOpen && isRegionalIndicator(cp)) {
      out[last] += ch;
      riOpen = false;
      continue;
    }
    out.push(ch);
    riOpen = isRegionalIndicator(cp);
    joinNext = false;
  }
  return out;
}

export function isBlank(s: string): boolean {
  return /^\s*$/.test(s);
}

export type SplitBy = 'chars' | 'words';

export interface TextUnit {
  text: string;
  /** Animated order across the whole text, from 0. -1 for a run of spaces, which never moves. */
  index: number;
}

/**
 * One line's units. `chars`: every grapheme is a unit and a run of spaces is one still unit.
 * `words`: a word and the spaces after it are a unit ("Hi. "); spaces before the first word are
 * a still unit. `startIndex` continues the numbering from the line before.
 */
export function splitUnits(line: string, by: SplitBy, startIndex: number = 0): { units: TextUnit[]; next: number } {
  const units: TextUnit[] = [];
  let next = startIndex;
  if (by === 'words') {
    const re = /(\s+)|(\S+\s*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      if (m[1] !== undefined) units.push({ text: m[1], index: -1 });
      else units.push({ text: m[2] ?? '', index: next++ });
    }
    return { units, next };
  }
  let spaces = '';
  for (const g of graphemes(line)) {
    if (isBlank(g)) {
      spaces += g;
      continue;
    }
    if (spaces) {
      units.push({ text: spaces, index: -1 });
      spaces = '';
    }
    units.push({ text: g, index: next++ });
  }
  if (spaces) units.push({ text: spaces, index: -1 });
  return { units, next };
}

/** What `onTextLayout` reports for one line, the fields the effects read. */
export interface LaidLine {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A line as the text system broke it, without the space or newline it broke on. */
export function trimLineEnd(text: string): string {
  return text.replace(/[\s\u200b]+$/u, '');
}

/**
 * Every line's units, numbered through the whole text, so a stagger runs across the lines the
 * way the eye reads them.
 */
export function unitsForLines(lines: readonly { text: string }[], by: SplitBy): { lines: TextUnit[][]; count: number } {
  let next = 0;
  const out: TextUnit[][] = [];
  for (const line of lines) {
    const r = splitUnits(trimLineEnd(line.text), by, next);
    out.push(r.units);
    next = r.next;
  }
  return { lines: out, count: next };
}

/** How many units `text` animates as, without laying it out (for a budget before layout). */
export function unitCount(text: string, by: SplitBy): number {
  return splitUnits(text, by).next;
}

/**
 * Whether the lines the text system reported are this text, with only the line breaks moved:
 * a truncated line (`numberOfLines`) or a stale layout event for an older string is not.
 */
export function linesAreText(lines: readonly { text: string }[], text: string): boolean {
  const squash = (s: string) => s.replace(/\s+/g, '');
  return squash(lines.map((l) => l.text).join('')) === squash(text);
}

/**
 * What to measure so a line's characters can sit where the text system put them, kerning and
 * all. A character drawn on its own loses the kerning to its neighbour (at 40 pt the swap from
 * the animated copy to the settled text jumped "Hi. I'm Bit." by about 4 pt on this build), so
 * each visible character's left edge is measured instead: the line up to and including it, less
 * the character alone. Returns both, in the order the visible characters appear.
 */
export function kerningProbes(line: string): { prefixes: string[]; glyphs: string[] } {
  const g = graphemes(line);
  const prefixes: string[] = [];
  const glyphs: string[] = [];
  let acc = '';
  for (const ch of g) {
    acc += ch;
    if (isBlank(ch)) continue;
    prefixes.push(acc);
    glyphs.push(ch);
  }
  return { prefixes, glyphs };
}

/**
 * Each visible character's left edge from the measured widths: the prefix through it minus the
 * character alone. Both widths carry the same trailing letter spacing, so it cancels.
 */
export function kernedOffsets(prefixWidths: readonly number[], glyphWidths: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < prefixWidths.length; i++) out.push(Math.max(0, (prefixWidths[i] ?? 0) - (glyphWidths[i] ?? 0)));
  return out;
}

/** Two layouts are the same when every line has the same text at the same place. */
export function sameLines(a: readonly LaidLine[] | null, b: readonly LaidLine[] | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const p = a[i]!;
    const q = b[i]!;
    if (p.text !== q.text || Math.abs(p.x - q.x) > 0.25 || Math.abs(p.y - q.y) > 0.25) return false;
  }
  return true;
}

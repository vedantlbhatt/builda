/**
 * What colour a text effect draws in, and whether that colour is an IDENTITY hue. Pure, so
 * `bun test` can hold the rule.
 *
 * Part of the react-bits text ports (by David Haz; MIT + Commons Clause, Copyright (c) 2026
 * David Haz; used as part of this application, not redistributed as components).
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
 * Why it matters (DESIGN-V2 1.3, "colour enters by cells, not by opacity"): a hue at partial
 * opacity over the warm ground turns brown. So an effect that fades is free to fade neutral
 * text (`text`, `dim`, `faint`), but text in a hue, amber included, snaps its opacity in under
 * `SNAP_FADE_MS` and arrives by position, and never draws translucent ghost copies.
 */
import type { HueName } from '../../../theme';
import type { Tone } from '../../scheme';

/** The longest an identity hue may spend at partial opacity (the doc: "under 120 ms"). */
export const SNAP_FADE_MS = 120;

export interface InkSource {
  /** A kit tone. Default `text`. */
  tone?: Tone;
  /** One of the nine spectrum hues, as a label (`hue(name, scheme).text`). Wins over `tone`. */
  hue?: HueName;
  /** Any token colour, already resolved (`creatureHue(c).text`, `harnessHue(id)?.text`). Wins over both. */
  color?: string;
}

/** The fields of the kit palette an ink resolves from (`useColors()` has them all). */
export interface InkPalette {
  text: string;
  textDim: string;
  textFaint: string;
  accent: string;
  onAccent: string;
  data: { add: string; del: string; human: string };
  hues: Record<HueName, { text: string }>;
}

const NEUTRAL_TONES: ReadonlySet<Tone> = new Set<Tone>(['text', 'dim', 'faint', 'onAccent']);

function toneValue(c: InkPalette, tone: Tone): string {
  switch (tone) {
    case 'text':
      return c.text;
    case 'dim':
      return c.textDim;
    case 'faint':
      return c.textFaint;
    case 'accent':
      return c.accent;
    case 'onAccent':
      return c.onAccent;
    case 'add':
      return c.data.add;
    case 'del':
      return c.data.del;
    case 'human':
      return c.data.human;
  }
}

/**
 * The colour, and `identity`: true for a hue, amber, a data colour or any colour passed in
 * that is not one of the neutral inks.
 */
export function resolveInk(c: InkPalette, src: InkSource): { color: string; identity: boolean } {
  if (src.color) {
    const neutral = src.color === c.text || src.color === c.textDim || src.color === c.textFaint || src.color === c.onAccent;
    return { color: src.color, identity: !neutral };
  }
  if (src.hue) return { color: c.hues[src.hue].text, identity: true };
  const tone = src.tone ?? 'text';
  return { color: toneValue(c, tone), identity: !NEUTRAL_TONES.has(tone) };
}

/** An entrance's fade: as asked for neutral ink, never longer than `SNAP_FADE_MS` for a hue. */
export function fadeFor(identity: boolean, fadeMs: number): number {
  return identity ? Math.min(fadeMs, SNAP_FADE_MS) : fadeMs;
}

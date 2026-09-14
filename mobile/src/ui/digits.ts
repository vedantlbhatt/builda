/**
 * The arithmetic of the rolling-digit Counter, kept apart from the component so it can be
 * tested without a renderer.
 *
 * Ported from react-bits `Components/Counter/Counter.tsx` by David Haz.
 * react-bits is MIT + Commons Clause (Copyright (c) 2026 David Haz): the notice is kept
 * here as the licence asks, and the port is used as part of this application only; it is
 * not to be redistributed as a component.
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
 * What changed in the port: one Reanimated shared value per place driven by `withSpring`
 * with the app's `SNAP` (not motion's bouncy default), `translateY` per numeral on the UI
 * thread, tabular figures, grouping separators, and no gradient masks at the column edges
 * (the column clips instead; gradients are banned here).
 */

/** A digit column is a power of ten; a separator is a fixed glyph that never rolls. */
export type Place = number | '.' | ',';

export interface PlaceOptions {
  /** Digits after the decimal point. Default 0. */
  decimals?: number;
  /** Insert a comma between thousands. Default true: "1,204", product formatting. */
  grouping?: boolean;
  /** Pad with leading zero columns up to this many integer digits. Default 1. */
  minDigits?: number;
}

/** Guards `value / place` against 12.3 / 0.1 = 122.99999999999999. From the original. */
export function normalizeNearInteger(num: number): number {
  'worklet';
  const nearest = Math.round(num);
  const tolerance = 1e-9 * Math.max(1, Math.abs(num));
  return Math.abs(num - nearest) < tolerance ? nearest : num;
}

/** The number a place's column springs to: 1,204 at the tens place is 120. */
export function valueAtPlace(value: number, place: number): number {
  return Math.floor(normalizeNearInteger(Math.abs(value) / place));
}

/** How many integer digits `value` has (0 has one). */
export function integerDigits(value: number): number {
  const n = Math.floor(Math.abs(value));
  return n === 0 ? 1 : Math.floor(Math.log10(n)) + 1;
}

/** The columns, most significant first: 1204.5 at 1 decimal is 1000 , 100 10 1 . 0.1 */
export function placesFor(value: number, options: PlaceOptions = {}): Place[] {
  const decimals = Math.max(0, Math.floor(options.decimals ?? 0));
  const grouping = options.grouping ?? true;
  const digits = Math.max(integerDigits(value), Math.floor(options.minDigits ?? 1));
  const places: Place[] = [];
  for (let e = digits - 1; e >= 0; e--) {
    places.push(10 ** e);
    if (grouping && e > 0 && e % 3 === 0) places.push(',');
  }
  if (decimals > 0) {
    places.push('.');
    for (let e = 1; e <= decimals; e++) places.push(Number((10 ** -e).toFixed(e)));
  }
  return places;
}

/**
 * Vertical offset of `digit`'s numeral, in points, when the column's animated value is
 * `latest`. The numeral that matches the value sits at 0; the next one waits one row below,
 * the previous one row above, and anything more than five away wraps to the other side so
 * a roll always takes the short way round (9 to 0 goes up one row, not down nine).
 */
export function digitOffset(digit: number, latest: number, height: number): number {
  'worklet';
  const placeValue = latest % 10;
  const offset = (10 + digit - placeValue) % 10;
  let memo = offset * height;
  if (offset > 5) memo -= 10 * height;
  return memo;
}

/** The digit a column shows when it is at rest on `settled`. */
export function restingDigit(settled: number): number {
  return ((Math.round(settled) % 10) + 10) % 10;
}

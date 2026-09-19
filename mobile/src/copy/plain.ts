/**
 * `analysis/plain.py` on the phone: the words for numbers, the file roles, and the one
 * definition of a dash.
 *
 * The rules are the engine's, line for line (docs/overnight-engine.md 1.1). The tables
 * (`ROLES`, `ROLE_NOUN`) are generated (`generated/copy.ts`) and re-exported here, so the
 * phone never retypes one. RECORDED: `src/live/sentence.ts` still carries an older copy of
 * `spoken`, `ordinal`, `ROLE_NOUN` and a two character dash rule; it should import these
 * instead (it belongs to the live surface workflow).
 */

import type { PlainRole } from '../generated/report';
import { ROLE_NOUN, ROLES } from './catalog';

export { ROLE_NOUN, ROLES };
export type Role = PlainRole;

const WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
  'nineteen', 'twenty',
] as const;

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'] as const;

/** `plain.spoken`: 0 to 20 as words ("six"), digits above ("34") and below zero. */
export function spoken(x: number): string {
  const i = Math.trunc(x);
  return i >= 0 && i < WORDS.length ? WORDS[i]! : String(i);
}

/** `plain.ordinal`: 1 to 10 as words ("third"), then "11th", "12th", "21st"; "0th" too. */
export function ordinal(x: number): string {
  const i = Math.trunc(x);
  if (i >= 1 && i <= ORDINALS.length) return ORDINALS[i - 1]!;
  const tail = Math.abs(i) % 100;
  const suffix = tail >= 10 && tail <= 20 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[Math.abs(i) % 10] ?? 'th';
  return `${i}${suffix}`;
}

export function isRole(x: unknown): x is Role {
  return typeof x === 'string' && (ROLES as readonly string[]).includes(x);
}

/**
 * `plain.DASH_CHARS`: an em dash (U+2014), an en dash (U+2013), a horizontal bar (U+2015)
 * and a minus sign (U+2212). A negative number on the phone is written with a hyphen for
 * that reason: "-9,021" carries no dash, and a U+2212 would.
 */
export const DASH_CODE_POINTS = [0x2014, 0x2013, 0x2015, 0x2212] as const;
/** The four as characters. Built from code points, so no copy scan reads this as copy. */
export const DASH_CHARS: readonly string[] = DASH_CODE_POINTS.map((c) => String.fromCharCode(c));

/** Any of `DASH_CHARS`, or a hyphen alone between spaces: a dash typed on a keyboard. */
export const DASH = /[—–―−]|\s-{1,2}\s/;

/** `plain.has_dash`. A hyphen inside a word (`go-to`) or a flag (`--json`) is not one. */
export function hasDash(text: string): boolean {
  return DASH.test(text);
}

/**
 * Words this app did not write (a Claude Code run's own outcome line, a creator's caption) made
 * to follow the rule before they are shown: a dash between clauses becomes a comma, and a minus
 * sign a hyphen. The run that wrote "Done — created README.md" meant "Done, created README.md".
 */
export function undash(text: string): string {
  return text
    .replace(/\s*[—–―]\s*/g, ', ')
    .replace(/\s-{1,2}\s/g, ', ')
    .replace(/−/g, '-')
    .replace(/,\s*,/g, ',')
    .replace(/^,\s*/, '');
}

/**
 * THE ONE WAY FACTS SHARE A LINE: "gt-transit · yesterday · on its own". The space before each
 * dot is a no break space (U+00A0), so the dot stays at the end of the fact before it and a line
 * that wraps breaks after "· ", never before it: no line can start with a dot. FOUND IN THE
 * CAPTURE PASS (2026-09-14): a meta line wrapped and its second line began with "·". Empty and
 * missing facts are left out rather than joined as nothing.
 */
export const DOT_JOIN = `${String.fromCharCode(0xa0)}· `;

export function dotted(parts: readonly (string | null | undefined | false)[]): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.trim() !== '').join(DOT_JOIN);
}

/**
 * Words already joined with " · " (a string the engine or a model wrote), given the same no break
 * space before each dot as `dotted`, so the text components can apply the rule to whatever they
 * are handed. A string, or the strings in an array of children; anything else is left as it is.
 */
export function keepDots<N>(node: N): N {
  if (typeof node === 'string') return (node.includes(' · ') ? node.split(' · ').join(DOT_JOIN) : node) as N;
  if (Array.isArray(node)) return node.map((c) => keepDots(c)) as N;
  return node;
}

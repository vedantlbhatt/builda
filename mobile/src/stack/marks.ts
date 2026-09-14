/**
 * Every thing on the Stack page wears its real mark: the brand's logo in the brand's own colour
 * (`stackLogos.ts`, generated from Simple Icons by `scripts/gen_stack_logos.py`), or, where there
 * is no honest logo to draw, a monogram in its category's hue. Pure, so `bun test` holds the
 * colour rules.
 *
 * A brand colour is content, not chrome (Dropbox's rule, design-md/productivity/dropbox: "file
 * type icons carry their own product colors, but those are illustration, not UI accent"), so it
 * is drawn as the brand draws it wherever it can be seen. Where it cannot, the rule is the one
 * the brands themselves use on a dark screen (design-md/misc/vercel: the triangle is `#EDEDED` on
 * dark, `#000000` on light):
 *
 *   a black or grey mark     (Vercel, Next.js, Bun, Railway, Expo)  the ground's text colour
 *   a dark coloured mark     (SQLite, Django, Sentry, Fly.io)       the same hue, lifted toward
 *                                                                   white until it reads at 3:1
 *   anything else                                                   exactly the brand's hex
 *
 * 3:1 is the WCAG floor for a graphic that has to be seen, checked against the lightest ground a
 * mark sits on here (`raised`), so it holds on every one of them.
 */
import { contrast, GROUND, ON_HUE } from '../insights/palette';
import type { StackItem } from '../generated/report';
import { STACK_MARKS, type StackMark } from './stackLogos';

export type { StackMark } from './stackLogos';

/** The contrast a mark must reach on its ground to be seen (WCAG 1.4.11, non text). */
export const MARK_CONTRAST = 3;
/** A disc of brand colour must stand off the ground at least this much, or it reads as a hole. */
export const DISC_CONTRAST = 1.35;

/** The mark for a catalog id, or null for an id this build's catalog does not have. */
export function markOf(id: StackItem | string): StackMark | null {
  return (STACK_MARKS as Record<string, StackMark>)[id] ?? null;
}

function rgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1, 7), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function hexOf([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/** A colour with no hue to lift: black, grey, or a near black tint (Railway's `#0B0D0E`). */
export function isAchromatic(hex: string): boolean {
  const [r, g, b] = rgb(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  // HSV saturation, with very dark colours counted as grey whatever their tint.
  return max < 40 || (max - min) / Math.max(1, max) < 0.2;
}

/** `hex` mixed toward white by `t` (0 is `hex`, 1 is white): the same hue, lighter. */
export function lift(hex: string, t: number): string {
  const k = Math.min(1, Math.max(0, t));
  return hexOf(rgb(hex).map((c) => c + (255 - c) * k) as [number, number, number]);
}

/**
 * The colour a brand's mark is drawn in on the warm dark ground. The brand's own hex whenever it
 * reads at `MARK_CONTRAST`; a black or grey brand in the ground's text colour; a dark coloured
 * brand lifted in 5% steps until it reads.
 */
export function brandInk(hex: string, ground: string = GROUND.raised, min: number = MARK_CONTRAST): string {
  const own = hex.toUpperCase();
  if (contrast(own, ground) >= min) return own;
  if (isAchromatic(own)) return GROUND.text;
  for (let i = 1; i <= 20; i++) {
    const c = lift(own, i * 0.05);
    if (contrast(c, ground) >= min) return c;
  }
  return GROUND.text;
}

/**
 * A disc filled with the brand's colour, the way Simple Icons shows a brand on its site and
 * Grammarly sets its mark in an orb (design-md/productivity/grammarly: a green circle with the
 * white mark): the fill is the brand's hex, and the mark on it is whichever of the ground's text
 * colour and the dark ink reads better. A black or grey brand would be a hole in the warm ground,
 * so it turns over: a light disc with its mark in dark ink, the black and white those brands
 * print in (Vercel's triangle, Next.js, Bun, Railway). A dark coloured brand is lifted until it
 * stands off the ground.
 */
export function discOf(hex: string): { fill: string; mark: string } {
  const own = hex.toUpperCase();
  let fill = own;
  if (contrast(own, GROUND.bg) < DISC_CONTRAST) {
    if (isAchromatic(own)) return { fill: GROUND.text, mark: ON_HUE };
    for (let i = 1; i <= 20 && contrast(fill, GROUND.bg) < DISC_CONTRAST; i++) fill = lift(own, i * 0.05);
  }
  const mark = contrast(GROUND.text, fill) >= contrast(ON_HUE, fill) ? GROUND.text : ON_HUE;
  return { fill, mark };
}

/**
 * The colour a thing's mark is drawn in on the ground: its brand ink, or for a monogram the
 * category's ink (a monogram has no brand colour, and inventing one would be a claim).
 */
export function inkFor(mark: StackMark | null, categoryInk: string): string {
  return mark && mark.kind === 'logo' ? brandInk(mark.hex) : categoryInk;
}

/**
 * The credits the page owes for the marks it shows: every attribution licence, once, in the order
 * the marks appear. Empty when every mark shown is CC0 or the brand's own.
 */
export function creditsFor(ids: readonly string[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const m = markOf(id);
    if (m && m.kind === 'logo' && m.credit && !out.includes(m.credit)) out.push(m.credit);
  }
  return out;
}

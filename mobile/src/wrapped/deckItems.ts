/**
 * The deck: the report's cards, in the engine's order, each with its face. Pure.
 *
 * A card the copy layer cannot honestly draw is left out (an id this build does not know,
 * or an answered card missing a number its words need: `faceOf` returns null for both),
 * so the deck can be fourteen long; a refused card is never left out, because its refusal
 * is its answer.
 */
import type { QuotesUpload } from '../generated/quotes';
import type { ReportWrapped, ReportWrappedCard } from '../generated/report';
import type { ArtSources } from './art';
import { CARD_ORDER } from './deck';
import { faceOf, shareFaceOf, type Face, type QuotesState } from './face';

export interface DeckItem {
  card: ReportWrappedCard;
  face: Face;
  sources: ArtSources;
}

export function deckItems(
  wrapped: ReportWrapped,
  quotes: QuotesUpload | null,
  quotesState: QuotesState,
  sources: ArtSources,
  tzOffsetMinutes?: number,
): DeckItem[] {
  const byCard = new Map((quotes?.quotes ?? []).map((q) => [q.card as string, q]));
  const rank = (c: ReportWrappedCard) => {
    const i = CARD_ORDER.indexOf(c.id);
    return i < 0 ? CARD_ORDER.length : i;
  };
  const out: DeckItem[] = [];
  for (const card of [...wrapped.cards].sort((a, b) => rank(a) - rank(b))) {
    const face = faceOf(card, byCard.get(card.id) ?? null, quotesState, tzOffsetMinutes);
    if (face) out.push({ card, face, sources });
  }
  return out;
}

/**
 * The card as a share draws it: its face with no quote (`shareFaceOf`), whatever the owner's
 * story shows. A card the copy layer could not draw without its quote would share its
 * question alone, never the quoted face; that cannot happen for the three quote cards (the
 * go to prompt's answer does not read its quote, and the LOCAL two fall back to their
 * counts), and `__tests__/wrappedShare.test.ts` walks every card.
 */
export function shareItem(item: DeckItem, tzOffsetMinutes?: number): DeckItem {
  const face = shareFaceOf(item.card, tzOffsetMinutes);
  const bare: Face = { ...item.face, hero: null, tail: null, sentence: null, quote: null, decrypt: false, note: null, label: item.face.question };
  return { ...item, face: face ?? bare };
}

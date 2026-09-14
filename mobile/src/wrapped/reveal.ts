/**
 * Which cards have had their first reveal. Pure; the screen keeps the set in the kv.
 *
 * A count up is a FIRST REVEAL only (DESIGN-DIRECTION 3.5), and "first" is per report: the
 * first time these numbers are shown to you. A new report is new numbers, so its cards
 * reveal again; the same report opened a second time just shows them. The key is the
 * report's `generated_at`, the moment the machine computed it.
 */
import { REPORT_ENUMS, type WrappedCard } from '../generated/report';

/** In the kv, not `device.`: a sign out clears it with the rest of the account's cache. */
export const REVEALED_KEY = 'wrapped.revealed.v1';

interface Stored {
  report: string;
  ids: string[];
}

const CARD_IDS: ReadonlySet<string> = new Set(REPORT_ENUMS.wrapped_card);

/**
 * The cards already revealed for `report`. Anything unreadable, from another report or
 * naming a card this build does not know, reveals again rather than being trusted.
 */
export function parseRevealed(raw: string | null, report: string): Set<WrappedCard> {
  if (!raw) return new Set();
  try {
    const v = JSON.parse(raw) as Partial<Stored>;
    if (v.report !== report || !Array.isArray(v.ids)) return new Set();
    return new Set(v.ids.filter((id): id is WrappedCard => typeof id === 'string' && CARD_IDS.has(id)));
  } catch {
    return new Set();
  }
}

export function serializeRevealed(report: string, ids: Iterable<WrappedCard>): string {
  const stored: Stored = { report, ids: [...new Set(ids)].sort() };
  return JSON.stringify(stored);
}

/**
 * Getting a link onto the board, from wherever it came.
 *
 * THREE DOORS, one rule at the end of all of them:
 *
 *   the share extension   iOS. `targets/share` writes into the App Group and this drains it
 *                         (`modules/builder-drops`). The extension never calls the API.
 *   a deep link           `builder://drop?url=...`, which is what a Mac, a shortcut or a pasted
 *                         link uses, and what the Android intent filter will hand over when the
 *                         Android half is built.
 *   pasted by hand        the board's own field. The one door that works in Expo Go, which is
 *                         why it exists at all: a feature you cannot try without a native build
 *                         is a feature nobody tries.
 *
 * The normalising itself is `urls.ts`, which imports nothing, so the rule that decides what one
 * reel's link IS can be tested against the Python without a simulator.
 */
import BuilderDrops, { type PendingDrop } from '../../modules/builder-drops';
import { api } from '../data/client';
import { normalizeShared } from './urls';
import { trackDrop } from '../island/feeds';

/** Send one shared payload to the board. Returns the drop's id, or null when it was not a link. */
export async function landShared(payload: string, extraText = ''): Promise<string | null> {
  const shared = normalizeShared(payload);
  if (!shared) return null;
  const text = [shared.text, extraText].filter(Boolean).join(' ').slice(0, 1000);
  const { drop } = await api.shareDrop(shared.url, shared.platform, text || null);
  // The answer lands on the island, where you are, not behind a banner (docs/motion.md).
  if (drop.status === 'waiting' || drop.status === 'resolving') trackDrop(drop.id, shared.url);
  return drop.id;
}

/** The two things a person sending a link by hand is told, when it did not land. */
export const NOT_A_LINK = 'That is not a link Builda can read.';
export const NOT_SENT = 'Builda could not send that link. Try it again.';

/**
 * A link a person sent by hand (the paste field, a link from outside they said Send to): null when
 * it landed, or the line to show them. FOUND IN REVIEW (2026-09-19): a paste that was not a link,
 * or that failed to send, cleared the field and said nothing, and the failure was an unhandled
 * rejection.
 */
export async function sendByHand(link: string): Promise<string | null> {
  try {
    return (await landShared(link)) ? null : NOT_A_LINK;
  } catch {
    return NOT_SENT;
  }
}

/**
 * Everything the share extension queued while the app was away, sent, oldest first.
 *
 * Returns how many landed. Takes and clears in ONE native call, so a share that arrives while
 * the app is coming to the foreground cannot be emptied out from under the read. A send that
 * fails is lost, and that is a deliberate limit rather than an oversight: retrying would need a
 * second queue on this side, and the drop is one share away from being back.
 */
export async function drainPending(): Promise<number> {
  const pending: PendingDrop[] = BuilderDrops?.takePending?.() ?? [];
  let landed = 0;
  for (const p of pending.sort((a, b) => a.at - b.at)) {
    try {
      if (await landShared(p.url, p.text)) landed += 1;
    } catch {
      // A failed send is one share away from being back. See the docstring.
    }
  }
  return landed;
}

/** How many are waiting, without taking them. Null where there is no native module. */
export function pendingCount(): number | null {
  return BuilderDrops?.pendingCount?.() ?? null;
}

/**
 * What the Settings band and its chapters say. Pure, so `__tests__/navChrome.test.ts` holds it.
 *
 * The band is the builder: their creature printed on it, their name set large, their handle
 * under it, and one sentence that answers the owner's question ("what even is the theme of this
 * app?") where the answer can be changed: Builda wears your creature's colour.
 */
import type { Me } from '../data/api';
import { ANIMAL_LABELS, type Animal } from '../pixel/animals';
import { TAP } from '../copy/device';

export interface Identity {
  /** The band's small title: whether this phone is signed in. */
  title: string;
  /** Set large: the display name, else the name typed in onboarding, else the handle, else You. */
  name: string;
  /** "@handle", "No handle yet", or null when there is no account to have one. */
  handle: string | null;
}

export function identityLines({
  signedIn,
  me,
  localName,
}: {
  signedIn: boolean;
  me: Pick<Me, 'handle' | 'display_name'> | null;
  localName: string | null;
}): Identity {
  const display = signedIn ? me?.display_name?.trim() || null : null;
  const handle = signedIn ? me?.handle?.trim() || null : null;
  const local = localName?.trim() || null;
  return {
    title: signedIn ? 'Signed in' : 'Not signed in',
    name: display ?? local ?? handle ?? 'You',
    // Nothing until the profile has loaded: "No handle yet" is a claim about the account.
    handle: !signedIn || !me ? null : handle ? `@${handle}` : 'No handle yet',
  };
}

/** The rule, said once, where it can be changed. */
export function colourLine(animal: Animal, hueName: string): string {
  const who = ANIMAL_LABELS[animal];
  return `Builda wears your creature's colour, the ${who}'s ${hueName}. ${TAP} the ${who} to change it.`;
}

/** What VoiceOver says for the creature on the band. */
export function creatureLabel(animal: Animal): string {
  return `Your creature, the ${ANIMAL_LABELS[animal]}. Change it`;
}

/** The words beside the live key count: "live key" or "live keys", and the cap. */
export function keysCaption(live: number, cap: number): string {
  return `${live === 1 ? 'live key' : 'live keys'}, of ${cap}`;
}

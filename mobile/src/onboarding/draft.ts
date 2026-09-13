import { isAnimal, type Animal } from '../pixel/animals';
import { APPLE_NAME_KEY, ANIMAL_KEY, LOCAL_NAME_KEY } from './keys';

/**
 * What the person has picked so far, held in memory so the NEXT step can draw its first frame
 * complete. The kv (`src/data/cache.ts`) is the record and answers in a frame or two; a step
 * that waited on it arrived with an empty stage and filled in while the push was still moving
 * ("Vedant" had to be read back from SQLite before "Vedant, the fox" could be drawn).
 *
 * `primeDraft` reads the kv once while Bit says hello; each step writes what it picked here
 * the moment it is picked, before the push, and saves it to the kv as it always did. A step
 * reached by a deep link before anything was primed reads the kv itself, as before.
 *
 * Pure apart from the `Kv` passed in, so the tests drive it with a Map.
 */

export interface DraftKv {
  getKv(k: string): Promise<string | null>;
}

export interface Draft {
  /** The name typed on the name step (or stored by an earlier run of it). */
  name: string | null;
  /** The name Sign in with Apple handed over, for the prefill. */
  apple: string | null;
  /** The creature picked (or stored). */
  animal: Animal | null;
  /** The kv has been read. Until then, null means "not known yet", not "none". */
  primed: boolean;
}

const EMPTY: Draft = { name: null, apple: null, animal: null, primed: false };
let draft: Draft = EMPTY;
let priming: Promise<Draft> | null = null;

async function read(kv: DraftKv, key: string): Promise<string | null> {
  try {
    const v = await kv.getKv(key);
    return typeof v === 'string' && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

/**
 * Read the kv into the draft, once per run of the flow (the onboarding layout calls
 * `resetDraft` and then this when it mounts). What a step has already written wins over
 * what was read: it is newer.
 */
export function primeDraft(kv: DraftKv): Promise<Draft> {
  if (priming) return priming;
  priming = (async () => {
    const [name, apple, animal] = await Promise.all([read(kv, LOCAL_NAME_KEY), read(kv, APPLE_NAME_KEY), read(kv, ANIMAL_KEY)]);
    draft = {
      name: draft.name ?? name,
      apple: draft.apple ?? apple,
      animal: draft.animal ?? (isAnimal(animal) ? animal : null),
      primed: true,
    };
    return draft;
  })();
  return priming;
}

export function currentDraft(): Draft {
  return draft;
}

export function setDraftName(name: string): void {
  draft = { ...draft, name };
}

export function setDraftApple(apple: string): void {
  draft = { ...draft, apple };
}

export function setDraftAnimal(animal: Animal): void {
  draft = { ...draft, animal };
}

/** Forget everything: a reset of onboarding, or a test. */
export function resetDraft(): void {
  draft = EMPTY;
  priming = null;
}

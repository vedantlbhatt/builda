/**
 * The draft (`src/onboarding/draft.ts`): what the next step needs to draw its first frame
 * whole. The creature step used to wait on SQLite for the name typed a moment before, and
 * arrived with an empty stage while the push was still moving. A Map stands in for the kv.
 */
import { beforeEach, describe, expect, test } from 'bun:test';

import { ANIMAL_KEY, APPLE_NAME_KEY, LOCAL_NAME_KEY } from '../src/onboarding/keys';
import { currentDraft, primeDraft, resetDraft, setDraftAnimal, setDraftApple, setDraftName } from '../src/onboarding/draft';

function kv(seed: Record<string, string> = {}, failing = false) {
  const map = new Map(Object.entries(seed));
  let reads = 0;
  return {
    reads: () => reads,
    async getKv(k: string) {
      reads++;
      if (failing) throw new Error('sqlite is gone');
      return map.has(k) ? map.get(k)! : null;
    },
  };
}

beforeEach(() => resetDraft());

describe('the draft', () => {
  test('unprimed, nothing is known and it says so', () => {
    expect(currentDraft()).toEqual({ name: null, apple: null, animal: null, primed: false });
  });

  test('primed from what an earlier run stored', async () => {
    await primeDraft(kv({ [LOCAL_NAME_KEY]: 'Vedant', [APPLE_NAME_KEY]: 'Ved', [ANIMAL_KEY]: 'fox' }));
    expect(currentDraft()).toEqual({ name: 'Vedant', apple: 'Ved', animal: 'fox', primed: true });
  });

  test('an empty name and a creature this build does not have read as none', async () => {
    await primeDraft(kv({ [LOCAL_NAME_KEY]: '', [ANIMAL_KEY]: 'dragon' }));
    expect(currentDraft()).toMatchObject({ name: null, animal: null, primed: true });
  });

  test('what a step wrote wins over what the kv said (it is newer)', async () => {
    const store = kv({ [LOCAL_NAME_KEY]: 'Old', [ANIMAL_KEY]: 'crab' });
    setDraftName('New');
    setDraftAnimal('owl');
    setDraftApple('Apple');
    await primeDraft(store);
    expect(currentDraft()).toEqual({ name: 'New', apple: 'Apple', animal: 'owl', primed: true });
  });

  test('the kv is read once per run, and again after a reset', async () => {
    const store = kv({ [LOCAL_NAME_KEY]: 'Vedant' });
    await primeDraft(store);
    await primeDraft(store);
    expect(store.reads()).toBe(3);
    resetDraft();
    expect(currentDraft().primed).toBe(false);
    await primeDraft(store);
    expect(store.reads()).toBe(6);
  });

  test('a kv that throws primes to nothing rather than breaking the flow', async () => {
    await primeDraft(kv({}, true));
    expect(currentDraft()).toEqual({ name: null, apple: null, animal: null, primed: true });
  });
});

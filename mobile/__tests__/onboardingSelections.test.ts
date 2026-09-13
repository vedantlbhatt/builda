/**
 * What onboarding remembers: the name (through `src/nav/name.ts`, the same store the pending
 * `PATCH /v1/users/me` reads), the creature, the tools, and what the account already says
 * about them. A Map stands in for the SQLite kv, so every branch runs in bun.
 */
import { describe, expect, test } from 'bun:test';

import { getLocalName, saveLocalName, syncPendingName, type NameApi } from '../src/nav/name';
import { ANIMALS, CORPUS_ARCHETYPE_ANIMALS, ARCHETYPE_ANIMALS } from '../src/pixel/animals';
import { HARNESS_MARKS, sessionsFor, statusLine, type Harness } from '../src/pixel/harness';
import { ANIMAL_KEY, APPLE_NAME_KEY, LOCAL_NAME_KEY, NAME_PENDING_KEY, TOOLS_KEY } from '../src/onboarding/keys';
import { prefillName } from '../src/onboarding/names';
import {
  archetypeFrom,
  foundFor,
  harnessCounts,
  initialTools,
  marksInOrder,
  loadAnimal,
  loadTools,
  parseTools,
  preselect,
  saveAnimal,
  saveTools,
  serializeTools,
  suggestedAnimal,
  type Kv,
} from '../src/onboarding/selection';

function memoryKv(seed: Record<string, string> = {}): Kv & { map: Map<string, string> } {
  const map = new Map(Object.entries(seed));
  return {
    map,
    async getKv(k) {
      return map.has(k) ? map.get(k)! : null;
    },
    async setKv(k, v) {
      map.set(k, v);
    },
  };
}

describe('the keys', () => {
  test('everything onboarding picks is profile data, cleared with the account; the gate is not', () => {
    for (const k of [ANIMAL_KEY, TOOLS_KEY, APPLE_NAME_KEY, LOCAL_NAME_KEY, NAME_PENDING_KEY]) expect(k.startsWith('profile.')).toBe(true);
  });

  test('the creature key is the one the You tab and the picker already read', () => {
    expect(ANIMAL_KEY).toBe('profile.animal.v1');
    expect(LOCAL_NAME_KEY).toBe('profile.name.v1');
  });
});

describe('the name persists and waits for an account', () => {
  test('stored normalised, marked pending, and read back as the prefill', async () => {
    const kv = memoryKv();
    await saveLocalName('  Vedant  ', kv);
    expect(kv.map.get(LOCAL_NAME_KEY)).toBe('Vedant');
    expect(kv.map.get(NAME_PENDING_KEY)).toBe('1');
    expect(prefillName({ local: await getLocalName(kv), server: 'Someone else', apple: null })).toBe('Vedant');
  });

  test('sent as display_name once there is an account, and only then cleared', async () => {
    const kv = memoryKv();
    await saveLocalName('Vedant', kv);
    const sent: unknown[] = [];
    let signedIn = false;
    const api: NameApi = {
      isSignedIn: async () => signedIn,
      patchMe: async (body) => {
        sent.push(body);
        return { id: 'u', handle: null, display_name: 'Vedant', profile_public: false, created_at: '', factions: [] };
      },
    };
    expect(await syncPendingName(api, kv)).toBe('signed_out');
    expect(kv.map.get(NAME_PENDING_KEY)).toBe('1');
    signedIn = true;
    expect(await syncPendingName(api, kv)).toBe('sent');
    expect(sent).toEqual([{ display_name: 'Vedant' }]);
    expect(kv.map.get(NAME_PENDING_KEY)).toBe('0');
  });
});

describe('the tools', () => {
  const sessions = [
    ...Array.from({ length: 77 }, () => ({ harness: 'claude_code' })),
    { harness: 'codex' },
    { harness: 'cursor_agent' },
    { harness: 'cursor_ide' },
    { harness: 'a_harness_from_next_year' },
  ];

  test('counted per wire value; a value this build does not know is left out, not guessed', () => {
    expect(harnessCounts(sessions)).toEqual({ claude_code: 77, codex: 1, cursor_agent: 1, cursor_ide: 1 });
  });

  test('with sessions, only the tools they came from carry a count; the rest say nothing', () => {
    const found = foundFor(harnessCounts(sessions))!;
    expect(found).toEqual({ claude_code: 77, codex: 1, cursor_ide: 1, cursor_agent: 1 });
    expect('aider' in found).toBe(false);
    // So no tile on the step ever reads "not found": six of those under seven tiles was noise,
    // and a picked tile saying it was not found contradicted itself.
    for (const m of HARNESS_MARKS) expect(statusLine(sessionsFor(m, found))).not.toBe('not found');
  });

  test('the tiles run found first, most sessions first, then the pack order', () => {
    const found = foundFor({ codex: 3, claude_code: 77, aider: 3 });
    expect(marksInOrder(HARNESS_MARKS, found).map((m) => m.id)).toEqual([
      'claude_code',
      'codex',
      'aider',
      'cursor',
      'gemini_cli',
      'cline',
      'opencode',
    ]);
    expect(marksInOrder(HARNESS_MARKS, undefined).map((m) => m.id)).toEqual(HARNESS_MARKS.map((m) => m.id));
    // Cursor's tile stands for two wire values and sums them.
    expect(marksInOrder(HARNESS_MARKS, foundFor({ cursor_ide: 2, cursor_agent: 2, codex: 3 }))[0]!.id).toBe('cursor');
  });

  test('with none counted, or none at all, the tiles state nothing', () => {
    expect(foundFor(null)).toBeUndefined();
    expect(foundFor({})).toBeUndefined();
    expect(foundFor(harnessCounts([]))).toBeUndefined();
  });

  test('the tools sessions came from start picked, in HARNESSES order', () => {
    expect(preselect(foundFor(harnessCounts(sessions)))).toEqual(['claude_code', 'cursor_ide', 'cursor_agent', 'codex']);
    expect(preselect(undefined)).toEqual([]);
  });

  test('their own earlier choice wins over what was found, an empty one included', () => {
    const found = foundFor(harnessCounts(sessions));
    expect(initialTools(['aider'], found)).toEqual(['aider']);
    expect(initialTools([], found)).toEqual([]);
    expect(initialTools(null, found)).toEqual(preselect(found));
  });

  test('stored in one order with no repeats; anything unreadable reads as never stored', () => {
    const odd: Harness[] = ['codex', 'claude_code', 'codex'];
    expect(serializeTools(odd)).toBe(JSON.stringify(['claude_code', 'codex']));
    expect(parseTools(serializeTools(odd))).toEqual(['claude_code', 'codex']);
    expect(parseTools('["claude_code","not_a_tool",3]')).toEqual(['claude_code']);
    expect(parseTools('[]')).toEqual([]);
    expect(parseTools(null)).toBeNull();
    expect(parseTools('')).toBeNull();
    expect(parseTools('{')).toBeNull();
    expect(parseTools('{"claude_code":true}')).toBeNull();
  });

  test('a save and a load round trip through the kv', async () => {
    const kv = memoryKv();
    expect(await loadTools(kv)).toBeNull();
    await saveTools(kv, ['gemini_cli', 'claude_code']);
    expect(kv.map.get(TOOLS_KEY)).toBe('["claude_code","gemini_cli"]');
    expect(await loadTools(kv)).toEqual(['claude_code', 'gemini_cli']);
  });

  test('a kv that throws reads as nothing stored rather than breaking the step', async () => {
    const broken: Kv = {
      getKv: async () => {
        throw new Error('sqlite gone');
      },
      setKv: async () => undefined,
    };
    expect(await loadTools(broken)).toBeNull();
    expect(await loadAnimal(broken)).toBeNull();
  });
});

describe('the creature', () => {
  test('a pick round trips; an id that is no longer a creature reads as unset', async () => {
    const kv = memoryKv({ [ANIMAL_KEY]: 'dragon' });
    expect(await loadAnimal(kv)).toBeNull();
    await saveAnimal(kv, ANIMALS[3]!);
    expect(await loadAnimal(kv)).toBe(ANIMALS[3]!);
  });

  test("the suggestion is the archetype's creature, and never a fallback dressed as one", () => {
    for (const [archetype, animal] of Object.entries({ ...ARCHETYPE_ANIMALS, ...CORPUS_ARCHETYPE_ANIMALS })) {
      expect(suggestedAnimal(archetype)).toBe(animal);
    }
    expect(suggestedAnimal(null)).toBeNull();
    expect(suggestedAnimal(undefined)).toBeNull();
    expect(suggestedAnimal('an_archetype_from_next_year')).toBeNull();
  });

  test('the archetype: the corpus rules first, then the analyses, from JSON or an object', () => {
    const builder = { corpus: { archetype: { name: 'velocity_machine' } }, builder_profile: { archetype: { modal: 'architect' } } };
    expect(archetypeFrom(builder)).toBe('velocity_machine');
    expect(archetypeFrom(JSON.stringify(builder))).toBe('velocity_machine');
    expect(archetypeFrom({ corpus: { archetype: { name: null } }, builder_profile: { archetype: { modal: 'architect' } } })).toBe('architect');
    expect(archetypeFrom(null, { builder_profile: { archetype: { modal: 'night_owl' } } })).toBe('night_owl');
    expect(archetypeFrom('not json', null)).toBeNull();
    expect(archetypeFrom(undefined, undefined)).toBeNull();
  });
});

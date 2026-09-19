/**
 * Every sentence the board and the sheet can say, and which repository a move runs in.
 *
 * The copy test is the one that catches a spec change: every enum value the wire can carry has to
 * have a sentence, or a build that meets a new code renders a debug string at somebody.
 *
 * WHAT LEFT THIS FILE. It used to open with the pile wall's geometry — packing, fans, seats, the
 * saved arrangement. That board is gone, and so is the web that replaced it: drops are a wall of
 * posters now (`src/drops/wall/`, held by `dropsWall.test.ts`; docs/motion.md says why).
 */
import { describe, expect, test } from 'bun:test';

import {
  CATALOG,
  EFFORT_WORD,
  KIND_WORD,
  MOVE_REFUSAL,
  MOVE_STATUS_LINE,
  MOVE_TARGET_WORD,
  MOVE_VERB,
  PLATFORM_WORD,
  REFUSAL,
  STATUS_LINE,
  readLine,
} from '../src/drops/copy';
import { projectChoices } from '../src/drops/repos';

describe('every code has a sentence', () => {
  const tables: [string, readonly string[], Record<string, string>][] = [
    ['drop_refusal', CATALOG.refusals, REFUSAL],
    ['drop_kind', CATALOG.kinds, KIND_WORD],
    ['move_kind', CATALOG.moveKinds, MOVE_VERB],
    ['move_status', CATALOG.moveStatuses, MOVE_STATUS_LINE],
    ['move_refusal', CATALOG.moveRefusals, MOVE_REFUSAL],
    ['effort', CATALOG.efforts, EFFORT_WORD],
    ['platform', CATALOG.platforms, PLATFORM_WORD],
    ['drop_status', CATALOG.dropStatuses, STATUS_LINE],
    ['move_target', CATALOG.moveTargets, MOVE_TARGET_WORD],
  ];

  for (const [name, values, table] of tables) {
    test(`${name}`, () => {
      for (const v of values) expect(typeof table[v]).toBe('string');
      // And nothing extra: a sentence for a code the wire cannot carry is a sentence nobody
      // will ever see and a rename nobody will notice.
      expect(Object.keys(table).sort()).toEqual([...values].sort());
    });
  }

  test('no sentence carries a dash', () => {
    const all = [REFUSAL, KIND_WORD, MOVE_VERB, MOVE_STATUS_LINE, MOVE_REFUSAL, EFFORT_WORD, MOVE_TARGET_WORD, PLATFORM_WORD, STATUS_LINE]
      .flatMap((t) => Object.values(t))
      .concat(readLine(0, 0), readLine(238, 1200));
    for (const s of all) expect(s).not.toMatch(/[—–―−]|\s-{1,2}\s/);
  });

  test('a refusal says how much there was to read', () => {
    expect(readLine(0, 0)).toBe('no caption, no published subtitles');
    expect(readLine(238, 0)).toBe('238 characters of caption, no published subtitles');
    expect(readLine(238, 1200)).toBe('238 characters of caption, 1200 of subtitles');
  });
});

describe('which repository a move runs in', () => {
  const listed = [
    { key: 'a'.repeat(64), history: { first_at: '2026-08-01T00:00:00Z' } },
    { key: 'b'.repeat(64), history: { first_at: '2026-09-01T00:00:00Z' } },
    { key: 'c'.repeat(64), history: { first_at: '2026-09-01T00:00:00Z' } },
  ];
  const names = {
    nicknames: { ['b'.repeat(64)]: 'RideGT' },
    registry: { projects: { ['a'.repeat(64)]: { n: 1 }, ['c'.repeat(64)]: { n: 4 } } },
  };

  test('newest first, and a tie breaks on the key rather than on render order', () => {
    const out = projectChoices(listed, names);
    expect(out?.map((p) => p.key[0])).toEqual(['b', 'c', 'a']);
  });

  test('the words are the register the Projects tab keeps, not a second set', () => {
    const out = projectChoices(listed, names) ?? [];
    expect(out[0]?.label).toBe('RideGT');
    expect(out[1]?.label).toContain('4');
    expect(out[2]?.label).toContain('1');
  });

  test('nothing to offer is not an empty list of nothing', () => {
    // Null means the report has not been read yet; the row says so instead of showing zero
    // projects and inviting a tap that cannot work.
    expect(projectChoices(null, names)).toBeNull();
    expect(projectChoices([], names)).toEqual([]);
  });

  test('a phone with no register still names every project', () => {
    const out = projectChoices(listed, null) ?? [];
    expect(out).toHaveLength(3);
    for (const p of out) expect(p.label.length).toBeGreaterThan(0);
  });
});

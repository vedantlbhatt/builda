/**
 * The map's layout, and every sentence the board can say.
 *
 * The layout is pure (`src/drops/layout.ts`), so what it promises is testable without a
 * simulator: nodes do not overlap, a cluster's constellation holds together, the whole board
 * fits a phone, and adding a drop does not move the ones already there.
 *
 * The copy test is the one that catches a spec change: every enum value the wire can carry has
 * to have a sentence, or a build that meets a new code renders a debug string at somebody.
 */
import { describe, expect, test } from 'bun:test';

import { board as clusterBoard } from '../src/drops/cluster';
import {
  CATALOG,
  EFFORT_WORD,
  KIND_WORD,
  MOVE_REFUSAL,
  MOVE_STATUS_LINE,
  MOVE_VERB,
  PLATFORM_WORD,
  REFUSAL,
  STATUS_LINE,
  readLine,
} from '../src/drops/copy';
import { fit, focus, layout, MIN_HUB_SPACING, NODE, place, reach, ringRadius } from '../src/drops/layout';

const DROPS = [
  { kind: 'recipe', title: 'Garlic butter pasta', summary: 'one pan', tags: ['pasta', 'garlic'] },
  { kind: 'recipe', title: 'Creamy garlic pasta', summary: 'quick', tags: ['pasta', 'garlic'] },
  { kind: 'recipe', title: 'Shrimp pasta', summary: 'one pan', tags: ['pasta', 'shrimp'] },
  { kind: 'technique', title: 'VS Code terminal', summary: 'editor', tags: ['vscode', 'terminal'] },
  { kind: 'technique', title: 'VS Code shortcuts', summary: 'editor', tags: ['vscode', 'shortcuts'] },
  { kind: 'skill', title: 'Claude skills', summary: 'install', tags: ['claude', 'skills'] },
  { kind: 'unknown', title: 'A dog', summary: 'dogs', tags: ['pets'] },
];

const PHONE = { width: 390, height: 780 };
const UNIT = 46;

describe('the map', () => {
  const shape = layout(clusterBoard(DROPS));

  test('every drop is on it exactly once', () => {
    expect(shape.nodes).toHaveLength(DROPS.length);
    expect(new Set(shape.nodes.map((n) => n.index)).size).toBe(DROPS.length);
  });

  test('no two nodes sit on top of each other', () => {
    for (let i = 0; i < shape.nodes.length; i++) {
      for (let j = i + 1; j < shape.nodes.length; j++) {
        const a = shape.nodes[i];
        const b = shape.nodes[j];
        if (!a || !b) continue;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(NODE * 0.9);
      }
    }
  });

  test("a cluster's members are nearer their own hub than any other", () => {
    for (const n of shape.nodes) {
      const own = shape.hubs[n.cluster];
      if (!own || shape.hubs.length < 2) continue;
      const mine = Math.hypot(n.x - own.x, n.y - own.y);
      for (const other of shape.hubs) {
        if (other.cluster === n.cluster) continue;
        expect(mine).toBeLessThanOrEqual(Math.hypot(n.x - other.x, n.y - other.y) + 1e-9);
      }
    }
  });

  test('a singleton is one node, not a node orbiting nothing', () => {
    for (const h of shape.hubs) {
      if (h.size !== 1) continue;
      expect(h.radius).toBe(0);
      const node = shape.nodes.find((n) => n.cluster === h.cluster);
      expect(node?.x).toBe(h.x);
      expect(node?.y).toBe(h.y);
      expect(node?.isHub).toBe(true);
    }
  });

  test('constellations are packed, and never inside one another', () => {
    // Two regressions in one test. HUB_SPACING was tightened from 4.2 to 3.4 because a board
    // looked sparse, and two nodes landed 0.55 units apart; deriving one spacing from the widest
    // ring fixed that and made a board of eight drops run off both edges of the phone, because
    // one two member ring set the distance for every pair. Packing gives each constellation its
    // own reach.
    for (const sizes of [[1, 1, 1], [2, 2], [9, 9], [1, 9, 3], [5, 4, 3, 2, 1], [1, 1, 2, 1, 1, 1]]) {
      const clusters = sizes.map((size) => ({ size }));
      const spots = place(clusters);
      for (let i = 0; i < spots.length; i++) {
        for (let j = i + 1; j < spots.length; j++) {
          const a = spots[i] as { x: number; y: number };
          const b = spots[j] as { x: number; y: number };
          const need = reach(sizes[i] as number) + reach(sizes[j] as number);
          expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(need);
        }
      }
    }
    // A board with no rings packs at the floor rather than at somebody else's ring.
    const singles = place([{ size: 1 }, { size: 1 }]);
    const a = singles[0] as { x: number; y: number };
    const b = singles[1] as { x: number; y: number };
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(MIN_HUB_SPACING * 1.5);
  });

  test('no two nodes overlap on any shape of board', () => {
    for (const sizes of [[9, 9, 9], [1, 1, 1, 1, 1, 1, 1, 1], [5, 1, 4, 1, 3], [2, 2, 2, 2]]) {
      const shape = layout(sizes.map((size, i) => ({
        label: `c${i}`,
        size,
        members: Array.from({ length: size }, (_, j) => i * 100 + j),
      })));
      for (let i = 0; i < shape.nodes.length; i++) {
        for (let j = i + 1; j < shape.nodes.length; j++) {
          const a = shape.nodes[i];
          const b = shape.nodes[j];
          if (!a || !b) continue;
          expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(NODE * 0.9);
        }
      }
    }
  });

  test('a bigger ring holds a bigger cluster without its ends touching', () => {
    for (let n = 2; n <= 9; n++) {
      const r = ringRadius(n);
      const step = (2 * Math.PI * r) / n;
      expect(step).toBeGreaterThanOrEqual(NODE * 1.3);
      expect(r).toBeGreaterThanOrEqual(ringRadius(n - 1));
    }
  });

  test('the whole board fits a phone, and one node fills it', () => {
    const f = fit(shape.extent, PHONE, UNIT);
    expect(f.scale).toBeGreaterThan(0);
    expect(f.scale).toBeLessThanOrEqual(1.4);
    const node = shape.nodes[0];
    if (!node) throw new Error('no nodes');
    const z = focus(node, PHONE, UNIT, 2.1);
    expect(node.x * UNIT * z.scale + z.x).toBeCloseTo(PHONE.width / 2, 6);
    expect(node.y * UNIT * z.scale + z.y).toBeCloseTo(PHONE.height / 2, 6);
  });

  test('the first hub never moves as the board grows', () => {
    // Phyllotaxis grows outward: the nth hub is placed from n alone, so a board that gains a
    // cluster does not rearrange the ones you had already learned the position of.
    const small = layout(clusterBoard(DROPS.slice(0, 3)));
    expect(small.hubs[0]?.x).toBe(shape.hubs[0]?.x ?? NaN);
    expect(small.hubs[0]?.y).toBe(shape.hubs[0]?.y ?? NaN);
  });

  test('an empty board has no nodes and still has an extent', () => {
    const e = layout([]);
    expect(e.nodes).toHaveLength(0);
    expect(Number.isFinite(e.extent.minX)).toBe(true);
    expect(Number.isFinite(e.extent.maxY)).toBe(true);
  });
});

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
    const all = [REFUSAL, KIND_WORD, MOVE_VERB, MOVE_STATUS_LINE, MOVE_REFUSAL, EFFORT_WORD, PLATFORM_WORD, STATUS_LINE]
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

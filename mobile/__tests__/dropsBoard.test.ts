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
  MOVE_TARGET_WORD,
  MOVE_VERB,
  PLATFORM_WORD,
  REFUSAL,
  STATUS_LINE,
  readLine,
} from '../src/drops/copy';
import { CARD_H, CARD_W, fan, OPEN_GAP, spread, spreadSize, STACK_SHOWN, stackSize } from '../src/drops/card';
import {
  applyOrder,
  board as layoutBoard,
  cardScaleFor,
  extentOf,
  fit,
  LABEL_H,
  MIN_FIT,
  reorder,
  seats,
  slotAt,
} from '../src/drops/layout';
import { projectChoices } from '../src/drops/repos';

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

describe('the wall', () => {
  const clusters = [
    { label: 'pasta', size: 6, members: [0, 1, 2, 3, 4, 5] },
    { label: 'vscode', size: 5, members: [6, 7, 8, 9, 10] },
    { label: 'skills', size: 1, members: [11] },
    { label: 'saas', size: 1, members: [12] },
    { label: 'pets', size: 1, members: [13] },
  ];
  const W = 393;
  const spots = layoutBoard(clusters, W);

  test('every cluster gets a spot, in the order it came', () => {
    expect(spots).toHaveLength(clusters.length);
    expect(spots.map((s) => s.label)).toEqual(clusters.map((c) => c.label));
    expect(spots.map((s) => s.cluster)).toEqual([0, 1, 2, 3, 4]);
  });

  test('a banded pile skips the queue, whatever it weighs', () => {
    // The regression: a reel shared ten seconds ago is a pile of one, and tallest-first filed it
    // halfway down the wall under four piles nobody was looking for — at the exact moment the
    // person opened the app to watch it land. A dead end sorts the other way, under the board.
    const banded = layoutBoard(
      [
        ...clusters,
        { label: 'JUST IN', size: 1, members: [14], band: -1 as const },
        { label: 'NO WAY IN', size: 1, members: [15], band: 1 as const },
      ],
      W,
    );
    const top = banded.find((s) => s.label === 'JUST IN')!;
    const sunk = banded.find((s) => s.label === 'NO WAY IN')!;
    const ordinary = banded.filter((s) => s.label !== 'JUST IN' && s.label !== 'NO WAY IN');

    // Above every ordinary pile's top edge, and below every ordinary pile's bottom edge.
    for (const s of ordinary) {
      expect(top.y - top.height / 2).toBeLessThanOrEqual(s.y - s.height / 2);
      expect(sunk.y + sunk.height / 2).toBeGreaterThanOrEqual(s.y + s.height / 2);
    }
    // And it is still a wall: nothing it pinned overlaps anything it flowed.
    for (let i = 0; i < banded.length; i++) {
      for (let j = i + 1; j < banded.length; j++) {
        const a = banded[i]!;
        const b = banded[j]!;
        expect(
          Math.abs(a.x - b.x) >= (a.width + b.width) / 2 ||
            Math.abs(a.y - b.y) >= (a.height + b.height) / 2,
        ).toBe(true);
      }
    }
  });

  test('no stack overlaps another', () => {
    // The regression this replaces: the first board packed rectangles around an origin and came
    // out 657 points wide on a 393 point phone, which either overflows sideways or shrinks every
    // card to a smudge.
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        const a = spots[i]!;
        const b = spots[j]!;
        const apart =
          Math.abs(a.x - b.x) >= (a.width + b.width) / 2 ||
          Math.abs(a.y - b.y) >= (a.height + b.height) / 2;
        expect(apart).toBe(true);
      }
    }
  });

  test('the wall fits the phone sideways, whatever is on it', () => {
    for (const w of [360, 393, 430]) {
      const out = layoutBoard(clusters, w);
      for (const s of out) {
        expect(s.x - s.width / 2).toBeGreaterThan(-1);
        expect(s.x + s.width / 2).toBeLessThan(w + 1);
      }
    }
  });

  test('the tallest pile is near the top, not stranded at the bottom', () => {
    const tallest = spots.reduce((m, s) => (s.height > m.height ? s : m), spots[0]!);
    const lowest = spots.reduce((m, s) => (s.y > m.y ? s : m), spots[0]!);
    expect(tallest.y).toBeLessThanOrEqual(lowest.y);
  });

  test('it is a wall, not a table: the two columns do not line up exactly', () => {
    const xs = new Set(spots.map((s) => Math.round(s.x)));
    expect(xs.size).toBeGreaterThan(2);
  });

  test('the same board lays out the same way twice', () => {
    expect(layoutBoard(clusters, W)).toEqual(spots);
  });

  test('an empty board has an extent and no spots', () => {
    expect(layoutBoard([], W)).toEqual([]);
    const e = extentOf([], W);
    expect(Number.isFinite(e.minY)).toBe(true);
    expect(Number.isFinite(e.maxY)).toBe(true);
  });

  test('the opening view fits the width and never shrinks a card to a smudge', () => {
    const f = fit(extentOf(spots, W), { width: W, height: 760 });
    expect(f.scale).toBeGreaterThanOrEqual(MIN_FIT);
    expect(f.scale).toBeLessThanOrEqual(1.1);
  });
});

describe('a seat', () => {
  const only = [{ label: 'pasta', size: 4, members: [0, 1, 2, 3] }];
  const spot = layoutBoard(only, 393)[0]!;
  // The SAME scale the wall was laid out at. A seat computed at any other one lands outside the
  // box its pile reserved, which is what this suite caught the first time it was written.
  const k = cardScaleFor(only, 393);
  const ids = ['a', 'b', 'c', 'd'];

  test('the pile and the flight into it agree about where a card sits', () => {
    // One function answers both, which is the point of it: they used to compute this separately,
    // and a card drawn at one place with a flight aimed at another jumps on landing.
    for (const seat of seats(spot, ids, k)) {
      expect(seat.homeX).toBeCloseTo(spot.x - spot.width / 2 + seat.left + seat.width / 2, 6);
      expect(seat.homeY).toBeCloseTo(
        spot.y - spot.height / 2 + LABEL_H + seat.top + seat.height / 2,
        6,
      );
    }
  });

  test('every seat is inside the pile it belongs to', () => {
    for (const seat of seats(spot, ids, k)) {
      expect(seat.homeX - seat.width / 2).toBeGreaterThanOrEqual(spot.x - spot.width / 2 - 0.01);
      expect(seat.homeX + seat.width / 2).toBeLessThanOrEqual(spot.x + spot.width / 2 + 0.01);
      expect(seat.homeY + seat.height / 2).toBeLessThanOrEqual(spot.y + spot.height / 2 + 0.01);
    }
  });

  test('shrinking the cards shrinks the seats with them', () => {
    const full = seats(spot, ids, k);
    const small = seats(spot, ids, k * 0.7);
    expect(small[0]!.width).toBeCloseTo(full[0]!.width * 0.7, 6);
    expect(small.map((p) => p.index)).toEqual(full.map((p) => p.index));
  });
});

describe('a pile', () => {
  test('the top card is square on and the ones behind it lean both ways', () => {
    const cards = fan([0, 1, 2, 3, 4, 5], ['aa', 'bb', 'cc', 'dd', 'ee', 'ff']);
    const top = cards[cards.length - 1]!;
    expect(top.depth).toBe(0);
    expect(top.rotate).toBe(0);
    expect(top.x).toBe(0);
    const sides = cards.filter((p) => p.depth > 0).map((p) => Math.sign(p.x));
    expect(new Set(sides).size).toBe(2);
  });

  test('a pile never draws more than it can show, and says how many are left', () => {
    const cards = fan([0, 1, 2, 3, 4, 5, 6, 7], Array.from({ length: 8 }, (_, i) => `x${i}`));
    expect(cards.length).toBeLessThanOrEqual(STACK_SHOWN);
  });

  test('a pile of one is one card, square on', () => {
    const cards = fan([3], ['only']);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ index: 3, x: 0, y: 0, rotate: 0, depth: 0 });
  });

  test('the box a pile occupies covers everything that peeks out of it', () => {
    for (const n of [1, 2, 3, 4, 9]) {
      const box = stackSize(n);
      const cards = fan(Array.from({ length: n }, (_, i) => i), Array.from({ length: n }, (_, i) => `y${i}`));
      for (const p of cards) {
        expect(Math.abs(p.x) + CARD_W / 2).toBeLessThanOrEqual(box.width / 2 + 0.01);
        expect(p.y + CARD_H).toBeLessThanOrEqual(box.height + 0.01);
      }
    }
  });

  test('an open pile is two across and grows down', () => {
    const out = spread([0, 1, 2, 3, 4]);
    expect(out.map((p) => p.x)).toEqual([0, CARD_W + OPEN_GAP, 0, CARD_W + OPEN_GAP, 0]);
    expect(out[0]!.y).toBe(0);
    expect(out[2]!.y).toBe(CARD_H + OPEN_GAP);
    expect(spreadSize(5).height).toBe(3 * CARD_H + 2 * OPEN_GAP);
  });

  test('the same drop always leans the same way', () => {
    expect(fan([0, 1], ['a', 'b'])).toEqual(fan([0, 1], ['a', 'b']));
  });
});

describe('arranging the wall yourself', () => {
  const clusters = [
    { label: 'pasta', size: 6, members: [0] },
    { label: 'vscode', size: 5, members: [1] },
    { label: 'skills', size: 1, members: [2] },
    { label: 'saas', size: 1, members: [3] },
  ];
  const spots = layoutBoard(clusters, 393);

  test('a pile lands in the slot it was dropped nearest', () => {
    for (const s of spots) expect(slotAt({ x: s.x, y: s.y }, spots)).toBe(s.index);
    // And a point between two is the nearer of the two, never a third.
    const a = spots[0]!;
    const b = spots[1]!;
    const between = { x: (a.x + b.x) / 2 + (b.x - a.x) * 0.1, y: (a.y + b.y) / 2 + (b.y - a.y) * 0.1 };
    expect([a.index, b.index]).toContain(slotAt(between, spots));
  });

  test('moving one shuffles the rest by one and loses nothing', () => {
    const list = ['a', 'b', 'c', 'd'];
    expect(reorder(list, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(reorder(list, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(reorder(list, 1, 1)).toEqual(list);
    for (const [from, to] of [[0, 3], [2, 1], [3, 2]] as const) {
      expect([...reorder(list, from, to)].sort()).toEqual([...list].sort());
    }
  });

  test('a saved arrangement survives the clustering running again', () => {
    const order = ['saas', 'pasta', 'vscode', 'skills'];
    expect(applyOrder(clusters, order).map((c) => c.label)).toEqual(order);
  });

  test('a label the arrangement never knew keeps its own place', () => {
    // The regression this guards: share one reel, the vocabulary shifts, a cluster is renamed or
    // a new one appears, and a wall somebody spent time arranging is swept into a new shape.
    const withNew = [...clusters, { label: 'pets', size: 1, members: [4] }];
    const out = applyOrder(withNew, ['saas', 'pasta', 'vscode', 'skills']);
    expect(out.map((c) => c.label)).toEqual(['saas', 'pasta', 'vscode', 'skills', 'pets']);

    const front = applyOrder(
      [{ label: 'pets', size: 1, members: [4] }, ...clusters],
      ['saas', 'pasta'],
    );
    expect(front[0]!.label).toBe('pets');
  });

  test('an arrangement naming piles that are gone is simply skipped', () => {
    // `saas` and `pasta` are the only two the arrangement knows, so they take the slots the two
    // it does not know are not holding (1 and 2), in the order it put them in. Nothing is dropped
    // and nothing is duplicated, which is the part that matters.
    const out = applyOrder(clusters, ['gone', 'saas', 'also-gone', 'pasta']);
    expect(out.map((c) => c.label)).toEqual(['saas', 'vscode', 'skills', 'pasta']);
    expect(out.map((c) => c.label).sort()).toEqual(clusters.map((c) => c.label).sort());
  });

  test('no arrangement is the clustering\'s own order', () => {
    expect(applyOrder(clusters, [])).toBe(clusters);
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

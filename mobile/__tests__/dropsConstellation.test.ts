/**
 * The constellation: clusters as hubs, what links them, and where an open hub's drops go.
 */
import { describe, expect, test } from 'bun:test';

import {
  bloom,
  bloomExtent,
  CARD_H,
  CARD_W,
  constellation,
  HUB_FORCE,
  HUB_MAX,
  HUB_MIN,
  hubRadius,
  type Drop,
} from '../src/drops/constellation';

const DROPS: Drop[] = [
  { kind: 'recipe', title: '1-Pan Garlic Butter Pasta with Shrimp', summary: 'shrimp pasta garlic butter', tags: ['pasta', 'garlic'], thumbnail_url: 'a' },
  { kind: 'recipe', title: 'Homemade Garlic Butter Pasta', summary: 'garlic butter pasta', tags: ['pasta', 'garlic'], thumbnail_url: 'b' },
  { kind: 'recipe', title: 'Garlic Butter Noodles', summary: 'garlic butter noodles', tags: ['pasta', 'garlic'], thumbnail_url: 'c' },
  { kind: 'recipe', title: 'Lemon Butter Garlic Pasta Sauce', summary: 'lemon garlic butter pasta', tags: ['pasta', 'garlic'], thumbnail_url: 'd' },
  { kind: 'technique', title: '25 VS Code Productivity Tips', summary: 'vs code editor shortcuts', tags: ['vscode'], thumbnail_url: 'e' },
  { kind: 'technique', title: 'Top 5 VS Code Productivity Tips', summary: 'vs code editor shortcuts', tags: ['vscode'], thumbnail_url: 'f' },
  { kind: 'skill', title: '5 Claude Skills every beginner needs', summary: 'claude code skills', tags: ['claude'], thumbnail_url: 'g' },
  { kind: 'skill', title: 'Claude Code Skills', summary: 'claude code skills', tags: ['claude'], thumbnail_url: 'h' },
  { kind: 'unknown', title: 'Pet name scramble game post', summary: 'a dog on a beach', tags: [], thumbnail_url: 'i' },
  { kind: null, title: null, summary: null, tags: [], status: 'waiting' },
  { kind: null, title: null, summary: null, tags: [], status: 'refused' },
];

const c = constellation(DROPS);

describe('hubs', () => {
  test('every drop is in exactly one hub', () => {
    const all = c.hubs.flatMap((h) => h.members).sort((a, b) => a - b);
    expect(all).toEqual(DROPS.map((_, i) => i));
  });

  test('drops that are about the same thing share a hub', () => {
    const hubOf = (i: number) => c.hubs.findIndex((h) => h.members.includes(i));
    expect(hubOf(0)).toBe(hubOf(1));
    expect(hubOf(0)).toBe(hubOf(3));
    expect(hubOf(4)).toBe(hubOf(5));
    expect(hubOf(6)).toBe(hubOf(7));
    expect(hubOf(0)).not.toBe(hubOf(4));
  });

  test('a drop still being read, and one nobody could read, are held apart and not clustered', () => {
    const arriving = c.hubs.find((h) => h.holding === 'arriving');
    const closed = c.hubs.find((h) => h.holding === 'closed');
    expect(arriving?.members).toEqual([9]);
    expect(closed?.members).toEqual([10]);
  });

  test('a hub wears the kind most of its drops are', () => {
    const pasta = c.hubs.find((h) => h.members.includes(0))!;
    expect(pasta.kind).toBe('recipe');
    const pets = c.hubs.find((h) => h.members.includes(8))!;
    expect(pets.kind).toBeNull();
  });

  test('a bigger hub is a bigger bubble, up to a ceiling', () => {
    expect(hubRadius(1)).toBe(HUB_MIN);
    expect(hubRadius(4)).toBeGreaterThan(hubRadius(2));
    expect(hubRadius(400)).toBe(HUB_MAX);
  });

  test('a bubble leads with a picture', () => {
    for (const h of c.hubs) {
      if (h.holding) continue;
      expect(DROPS[h.members[0]!]!.thumbnail_url).toBeTruthy();
    }
  });
});

describe('links', () => {
  test('a holding pile has no strand, because nothing true connects it yet', () => {
    const holding = new Set(c.hubs.map((h, i) => (h.holding ? i : -1)).filter((i) => i >= 0));
    for (const l of c.links) {
      expect(holding.has(l.a)).toBe(false);
      expect(holding.has(l.b)).toBe(false);
    }
  });

  test('every link is between two different hubs, once', () => {
    const keys = c.links.map((l) => `${l.a}.${l.b}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const l of c.links) expect(l.a).not.toBe(l.b);
  });
});

describe('the settled constellation', () => {
  test('no two bubbles overlap', () => {
    for (let i = 0; i < c.hubs.length; i++) {
      for (let j = i + 1; j < c.hubs.length; j++) {
        const d = Math.hypot(c.at[i]!.x - c.at[j]!.x, c.at[i]!.y - c.at[j]!.y);
        expect(d).toBeGreaterThanOrEqual(c.hubs[i]!.r + c.hubs[j]!.r + HUB_FORCE.gap * 0.9);
      }
    }
  });

  test('is the same every time', () => {
    const again = constellation(DROPS);
    expect(again.at.map((p) => [Math.round(p.x), Math.round(p.y)])).toEqual(
      c.at.map((p) => [Math.round(p.x), Math.round(p.y)]),
    );
  });

  test('fits a phone at a scale where the words are still readable', () => {
    const xs = c.at.map((p, i) => [p.x - c.hubs[i]!.r, p.x + c.hubs[i]!.r]).flat();
    const ys = c.at.map((p, i) => [p.y - c.hubs[i]!.r, p.y + c.hubs[i]!.r + 40]).flat();
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    // A 393 x 620 board at a scale of at least 0.6.
    expect(Math.min(393 / w, 620 / h)).toBeGreaterThan(0.6);
  });

  test('an empty board is an empty constellation', () => {
    expect(constellation([])).toMatchObject({ hubs: [], links: [], at: [] });
  });
});

describe('the bloom', () => {
  const pasta = c.hubs.find((h) => h.members.includes(0))!;
  const at = bloom(pasta.members, c.sim);

  test('one place per drop, centred on the hub', () => {
    expect(at).toHaveLength(pasta.members.length);
    const cx = at.reduce((s, p) => s + p.x, 0) / at.length;
    const cy = at.reduce((s, p) => s + p.y, 0) / at.length;
    expect(Math.abs(cx)).toBeLessThan(1);
    expect(Math.abs(cy)).toBeLessThan(1);
  });

  test('no two cards overlap, in either direction', () => {
    for (let i = 0; i < at.length; i++) {
      for (let j = i + 1; j < at.length; j++) {
        const dx = Math.abs(at[i]!.x - at[j]!.x);
        const dy = Math.abs(at[i]!.y - at[j]!.y);
        // Two 9:16 frames clear each other if they clear on either axis.
        expect(dx >= CARD_W || dy >= CARD_H).toBe(true);
      }
    }
  });

  test('is compact enough to open without panning', () => {
    const box = bloomExtent(at);
    expect(Math.min(393 / box.w, 620 / box.h)).toBeGreaterThan(0.55);
  });

  test('one drop sits on the hub, and none is nothing', () => {
    expect(bloom([3], c.sim)).toEqual([{ x: 0, y: 0 }]);
    expect(bloom([], c.sim)).toEqual([]);
  });
});

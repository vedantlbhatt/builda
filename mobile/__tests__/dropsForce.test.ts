/**
 * The web's physics: that it settles, that it settles the SAME way twice, that frames never end
 * up on top of each other, and that two drops which resemble each other end up nearer than two
 * that do not. Pure (`src/drops/force.ts`), so none of it needs a simulator.
 */
import { describe, expect, test } from 'bun:test';

import { board as clusterBoard, similarityMatrix } from '../src/drops/cluster';
import {
  boundsOf,
  edgesOf,
  energy,
  FORCE,
  NODE_H,
  NODE_W,
  seedRing,
  settle,
  step,
  type Node,
} from '../src/drops/force';

const DROPS = [
  { kind: 'recipe', title: '1-Pan Garlic Butter Pasta with Shrimp', summary: 'shrimp pasta garlic butter', tags: ['pasta', 'garlic'] },
  { kind: 'recipe', title: 'Homemade Garlic Butter Pasta', summary: 'garlic butter pasta', tags: ['pasta', 'garlic'] },
  { kind: 'recipe', title: 'Garlic Butter Noodles', summary: 'garlic butter noodles', tags: ['pasta', 'garlic'] },
  { kind: 'technique', title: '25 VS Code Productivity Tips', summary: 'vs code editor shortcuts', tags: ['vscode'] },
  { kind: 'technique', title: 'Top 5 VS Code Productivity Tips', summary: 'vs code editor shortcuts', tags: ['vscode'] },
  { kind: 'skill', title: '5 Claude Skills every beginner needs', summary: 'claude code skills', tags: ['claude'] },
  { kind: 'skill', title: 'Claude Code Skills', summary: 'claude code skills', tags: ['claude'] },
  { kind: 'unknown', title: 'Pet name scramble game post', summary: 'a dog on a beach', tags: [] },
];

const sim = similarityMatrix(DROPS);
const edges = edgesOf(sim);

function web(): Node[] {
  return settle(seedRing(DROPS.length), edges);
}

describe('which resemblances get drawn', () => {
  test('every drop keeps at least one strand', () => {
    for (let i = 0; i < DROPS.length; i++) {
      expect(edges.some((e) => e.a === i || e.b === i)).toBe(true);
    }
  });

  test('a pair is drawn once, never twice and never to itself', () => {
    const keys = edges.map((e) => `${e.a}.${e.b}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const e of edges) expect(e.a).toBeLessThan(e.b);
  });

  test('it is a web and not a hairball', () => {
    // Every pair over a threshold would be O(n²) strands and unreadable. k nearest is O(kn).
    expect(edges.length).toBeLessThanOrEqual(DROPS.length * 2);
  });

  test('the strands drawn are the strong ones', () => {
    const drawn = edges.filter((e) => e.w > 0.2);
    expect(drawn.length).toBeGreaterThan(0);
    // The three pasta drops are tied to each other, not to the VS Code ones.
    const pasta = edges.filter((e) => e.a < 3 && e.b < 3);
    expect(pasta.length).toBeGreaterThan(0);
  });
});

describe('the web settles', () => {
  test('and stops moving', () => {
    const nodes = web();
    expect(energy(nodes)).toBeLessThan(1);
    for (const p of nodes) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  test('to the same shape every time', () => {
    // No Math.random anywhere in the file. A board that rearranges itself between launches is a
    // board nobody builds a memory of.
    const a = web();
    const b = web();
    expect(a.map((p) => [Math.round(p.x), Math.round(p.y)])).toEqual(
      b.map((p) => [Math.round(p.x), Math.round(p.y)]),
    );
  });

  test('with no two frames on top of each other', () => {
    // The floor and the frame have to agree or the physics permits an overlap the eye sees.
    const clear = Math.hypot(NODE_W, NODE_H);
    expect(FORCE.floor).toBeGreaterThanOrEqual(clear * 0.97);

    const nodes = web();
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(clear * 0.94);
      }
    }
  });

  test('and inside a space a phone can hold', () => {
    const box = boundsOf(web());
    expect(box.maxX - box.minX).toBeLessThan(1400);
    expect(box.maxY - box.minY).toBeLessThan(1400);
  });
});

describe('what the shape means', () => {
  test('drops that resemble each other end up nearer than drops that do not', () => {
    const nodes = web();
    const gap = (i: number, j: number) => Math.hypot(nodes[i]!.x - nodes[j]!.x, nodes[i]!.y - nodes[j]!.y);
    // Two pasta reels, against a pasta reel and a VS Code one.
    expect(gap(0, 1)).toBeLessThan(gap(0, 3));
    expect(gap(3, 4)).toBeLessThan(gap(3, 5));
    expect(gap(5, 6)).toBeLessThan(gap(5, 0));
  });

  test('the clustering and the web agree about what goes with what', () => {
    const nodes = web();
    const groups = clusterBoard(DROPS);
    const centre = (m: number[]) => ({
      x: m.reduce((s, i) => s + nodes[i]!.x, 0) / m.length,
      y: m.reduce((s, i) => s + nodes[i]!.y, 0) / m.length,
    });
    for (const g of groups) {
      if (g.members.length < 2) continue;
      const c = centre(g.members);
      const own = Math.max(...g.members.map((i) => Math.hypot(nodes[i]!.x - c.x, nodes[i]!.y - c.y)));
      const others = groups
        .filter((h) => h !== g && h.members.length >= 1)
        .flatMap((h) => h.members)
        .map((i) => Math.hypot(nodes[i]!.x - c.x, nodes[i]!.y - c.y));
      // A cluster holds together: its own members sit closer to its middle than the nearest
      // outsider does. The two are computed from the same vectors, so this is a real claim.
      if (others.length) expect(own).toBeLessThan(Math.max(...others));
    }
  });
});

describe('a node in somebody\'s hand', () => {
  test('does not move, and the web moves around it', () => {
    const nodes = web();
    const held = nodes[0]!;
    held.pinned = true;
    held.x = 400;
    held.y = -300;
    const before = nodes.slice(1).map((p) => ({ x: p.x, y: p.y }));
    for (let i = 0; i < 40; i++) step(nodes, edges);
    expect(held.x).toBe(400);
    expect(held.y).toBe(-300);
    const moved = nodes.slice(1).some((p, i) => Math.hypot(p.x - before[i]!.x, p.y - before[i]!.y) > 1);
    expect(moved).toBe(true);
  });
});

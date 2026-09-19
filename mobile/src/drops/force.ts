/**
 * The board as a web: every drop a node, every real resemblance an edge, the shape settled by
 * forces rather than packed into a grid. PURE, so `__tests__/dropsForce.test.ts` holds it.
 *
 * WHY THIS AND NOT THE WALL IT REPLACES. A wall of piles hid the one thing the clustering
 * actually knows: how MUCH two drops have to do with each other. A pile says "these four are
 * about garlic" and says nothing about the shrimp one sitting closest to the edge of it, or about
 * the two productivity drops that are nearly the same video. The web says both, continuously, in
 * the one language a person reads without being taught: things that belong together end up near
 * each other, and you can see the strand that made it so.
 *
 * WHAT A NODE IS: the reel's own frame. Never a generated glyph — the whole feature is that you
 * recognise the post you shared.
 *
 * IT IS DETERMINISTIC. No `Math.random` anywhere in this file: the starting ring is a golden angle
 * spiral off each node's index, and every pass iterates in the same order. The same drops always
 * settle into the same web, on the phone and in a test, because a board that rearranges itself
 * between launches is a board nobody builds a memory of.
 */

/** A node in flight. Positions are in points, relative to the web's own centre. */
export interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Held by a finger: forces still act on its neighbours, but not on it. */
  pinned?: boolean;
  /**
   * How much room this node needs, as a radius. Absent means the frame (`NODE_W`/`NODE_H`).
   *
   * A cluster bubble with nine drops in it is not the size of a bubble with one, and a floor that
   * treats them alike either lets the big one swallow its neighbours or spaces the small ones as
   * if they were huge. Clearance between two nodes is the sum of their radii plus `gap`.
   */
  r?: number;
}

/** Two drops that resemble each other, and by how much (cosine, 0..1). */
export interface Edge {
  a: number;
  b: number;
  w: number;
}

export interface ForceOptions {
  /** How hard every node pushes every other one apart. */
  repulsion: number;
  /** How hard an edge pulls its two ends together. */
  spring: number;
  /** The pull toward the middle, which stops the web drifting off screen. */
  gravity: number;
  /** Velocity kept per tick. Below 1 or it never settles. */
  damping: number;
  /** Rest length of the weakest edge and of the strongest. */
  far: number;
  near: number;
  /** No two nodes closer than this, so frames never sit on top of each other (`NODE_W/H`). */
  floor: number;
  /** Clear air between two nodes that carry their own radius. */
  gap: number;
}

/**
 * Tuned against `__tests__/dropsForce.test.ts`, which asks the only question that matters of these
 * numbers: do two drops that resemble each other end up nearer than two that do not.
 *
 * Three sets said no before these, and the failures were the useful part. A spring of 0.055 was
 * so much weaker than the summed repulsion that every strand settled at the same length whatever
 * its weight, and the web was a mesh with no shape in it. Stiffening the spring alone was not
 * enough either: what decides the shape is the GAP between what a tie asks for and what repulsion
 * alone gives, and with both raised together they just moved in step.
 *
 * The last failure is worth keeping too: once separation became a constraint rather than a force,
 * `near` at 78 asked every strong tie for a distance the constraint would not allow, and the two
 * shoved the same pair back and forth forever — the web never settled at all. A rest length below
 * the clearance is not a preference the physics can express. `near` is the clearance now.
 *
 * These come from a sweep rather than from taste. On the eight drop corpus the suite uses they
 * put every real tie within 135 points and everything unconnected beyond 178, in a web spanning
 * 337 — a phone's width and a bit, so the board opens already readable and panning is a choice
 * rather than a requirement.
 */
export const FORCE: ForceOptions = {
  repulsion: 22000,
  spring: 0.35,
  gravity: 0.01,
  damping: 0.86,
  far: 210,
  near: 106,
  floor: 104,
  gap: 18,
};

/**
 * A node's frame, in points. 9:16, because that is what a reel is.
 *
 * Small, and deliberately smaller than the pile cards this replaced: a web is read as a shape
 * first and as a set of pictures second, and a node big enough to read the title off is a node
 * that leaves no room for the strands. The half diagonal is 51, so two frames clear each other at
 * 102 points apart — which is why `floor` is 100 and why the suite checks the two agree.
 */
export const NODE_W = 50;
export const NODE_H = 89;

/** The golden angle, for a starting ring that is even at every count. */
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/**
 * Where the web starts before any force has acted: a phyllotaxis spiral.
 *
 * A spiral rather than a circle or a random scatter. A circle puts every node the same distance
 * out and the first pass explodes; a scatter is not reproducible; a sunflower spiral is already
 * evenly spread at every count, so the simulation only has to do the interesting part.
 */
export function seedRing(n: number, spread = 26): Node[] {
  return Array.from({ length: n }, (_, i) => {
    const r = spread * Math.sqrt(i + 0.5);
    const t = i * GOLDEN;
    return { x: r * Math.cos(t), y: r * Math.sin(t), vx: 0, vy: 0 };
  });
}

/**
 * Which resemblances are worth drawing.
 *
 * EVERY pair over a threshold is a hairball: with thirty drops that is hundreds of strands and the
 * web reads as noise. So each node keeps its `k` strongest ties and nothing else, and a tie is
 * kept once however many times it is chosen. A node whose best tie is still weak keeps it anyway:
 * a drop with no strand at all drifts to the rim and reads as broken rather than as unusual.
 */
export function edgesOf(sim: number[][], k = 2, floor = 0.08): Edge[] {
  const seen = new Set<string>();
  const out: Edge[] = [];
  for (let i = 0; i < sim.length; i++) {
    const row = sim[i] ?? [];
    const best = row
      .map((w, j) => ({ j, w }))
      .filter((p) => p.j !== i)
      .sort((p, q) => q.w - p.w || p.j - q.j)
      .slice(0, k);
    for (const { j, w } of best) {
      if (w < floor && out.some((e) => e.a === i || e.b === i)) continue;
      const key = i < j ? `${i}.${j}` : `${j}.${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ a: Math.min(i, j), b: Math.max(i, j), w });
    }
  }
  return out.sort((p, q) => p.a - q.a || p.b - q.b);
}

/** How far apart two nodes must be: their own radii when they have them, the frame floor if not. */
export function clearance(a: Node, b: Node, o: ForceOptions = FORCE): number {
  'worklet';
  if (a.r == null && b.r == null) return o.floor;
  const ra = a.r ?? o.floor / 2;
  const rb = b.r ?? o.floor / 2;
  return ra + rb + o.gap;
}

/** One tick. Mutates `nodes`, which is the point: the simulation runs every frame. */
export function step(nodes: Node[], edges: Edge[], o: ForceOptions = FORCE): void {
  'worklet';
  const n = nodes.length;
  if (n === 0) return;

  // Everything pushes everything apart. O(n²), and n here is how many reels somebody has shared.
  for (let i = 0; i < n; i++) {
    const a = nodes[i] as Node;
    for (let j = i + 1; j < n; j++) {
      const b = nodes[j] as Node;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let d2 = dx * dx + dy * dy;
      // Two nodes exactly on top of each other have no direction to separate along. Nudge by
      // index so the answer stays the same every run.
      if (d2 < 0.01) {
        dx = ((i % 7) - 3) * 0.1 + 0.05;
        dy = ((j % 5) - 2) * 0.1 + 0.05;
        d2 = dx * dx + dy * dy;
      }
      const d = Math.sqrt(d2);
      const push = o.repulsion / d2;
      const fx = (dx / d) * push;
      const fy = (dy / d) * push;
      a.vx -= fx;
      a.vy -= fy;
      b.vx += fx;
      b.vy += fy;
    }
  }

  // Each strand pulls its ends toward a rest length set by how alike they are.
  for (const e of edges) {
    const a = nodes[e.a];
    const b = nodes[e.b];
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
    const floor = clearance(a, b, o);
    const span = o.far - o.near;
    const rest = floor + (o.near - o.floor) + span * (1 - Math.max(0, Math.min(1, e.w)));
    const pull = (d - rest) * o.spring;
    const fx = (dx / d) * pull;
    const fy = (dy / d) * pull;
    a.vx += fx;
    a.vy += fy;
    b.vx -= fx;
    b.vy -= fy;
  }

  for (let i = 0; i < n; i++) {
    const p = nodes[i] as Node;
    if (p.pinned) {
      p.vx = 0;
      p.vy = 0;
      continue;
    }
    p.vx = (p.vx - p.x * o.gravity) * o.damping;
    p.vy = (p.vy - p.y * o.gravity) * o.damping;
    p.x += p.vx;
    p.y += p.vy;
  }

  separate(nodes, o.floor, 2, o);
}

/**
 * No two frames overlapping, as a CONSTRAINT rather than as another force.
 *
 * It was a force first — an extra shove that grew as two nodes closed — and a force is a request.
 * Repulsion, springs and gravity all vote, and on a crowded web the shove lost: the suite caught
 * two frames settled 89 points apart when the frame itself needs 102 to clear, which is a visible
 * overlap of a centimetre. This moves them instead of asking, after everything else has had its
 * say, so the guarantee holds no matter what the other forces wanted. Two passes, because moving
 * one pair apart can push a third pair together.
 *
 * A node somebody is holding does not move; its neighbour takes the whole correction.
 */
export function separate(nodes: Node[], floor: number, passes = 2, o: ForceOptions = FORCE): void {
  'worklet';
  const n = nodes.length;
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < n; i++) {
      const a = nodes[i] as Node;
      for (let j = i + 1; j < n; j++) {
        const b = nodes[j] as Node;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.001;
        const want = a.r == null && b.r == null ? floor : clearance(a, b, o);
        if (d >= want) continue;
        const need = want - d;
        const ux = dx / d;
        const uy = dy / d;
        if (a.pinned && b.pinned) continue;
        if (a.pinned) {
          b.x += ux * need;
          b.y += uy * need;
        } else if (b.pinned) {
          a.x -= ux * need;
          a.y -= uy * need;
        } else {
          a.x -= (ux * need) / 2;
          a.y -= (uy * need) / 2;
          b.x += (ux * need) / 2;
          b.y += (uy * need) / 2;
        }
      }
    }
  }
}

/** Run it until it stops moving, for a first paint that is already settled. */
export function settle(nodes: Node[], edges: Edge[], ticks = 220, o: ForceOptions = FORCE): Node[] {
  'worklet';
  for (let t = 0; t < ticks; t++) step(nodes, edges, o);
  return nodes;
}

/** How far the web spreads, so a caller can fit it to a screen. */
export function boundsOf(nodes: Node[], pad = 0): { minX: number; minY: number; maxX: number; maxY: number } {
  'worklet';
  if (!nodes.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of nodes) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

/** The total movement left in the web: what "settled" means, as a number. */
export function energy(nodes: Node[]): number {
  'worklet';
  let sum = 0;
  for (const p of nodes) sum += Math.abs(p.vx) + Math.abs(p.vy);
  return sum;
}

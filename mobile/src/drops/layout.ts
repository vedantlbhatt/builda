/**
 * Where every drop sits on the board. Pure: `__tests__/dropsLayout.test.ts` holds it.
 *
 * THE BOARD IS A MAP, NOT A LIST. Clusters (`cluster.ts`) become constellations: a hub with its
 * drops around it. Two drops near each other on screen are near each other in what they are
 * about, and that is the only thing position means here. Nothing is placed by recency, nothing
 * drifts, and the same board always draws the same way.
 *
 * HUBS GO ON A PHYLLOTAXIS SPIRAL. Sunflower packing: the nth hub at angle n * 137.5 degrees and
 * radius proportional to sqrt(n). It is the arrangement with no preferred direction and no two
 * points ever lining up, which is exactly what a map of unrelated groups wants, and it grows
 * outward so adding the twentieth cluster does not move the first. A grid was tried on paper and
 * rejected for the obvious reason: a grid is a list with extra steps, and the owner asked for a
 * mind map.
 *
 * MEMBERS GO ON A RING, and the ring's radius comes from how many there are, so a cluster of
 * eight is a wider constellation rather than eight overlapping nodes. One member sits ON its hub
 * (a singleton is one node, not a node orbiting an invisible centre).
 *
 * UNITS ARE ABSTRACT. The canvas works in "board units", one unit being one node diameter, and
 * the view multiplies by whatever the current zoom is. Nothing here knows about pixels, which is
 * why the same function can lay out the board, the zoomed in view and a screenshot at 3x.
 */

import type { Cluster } from './cluster';

/** The golden angle, in radians. */
export const GOLDEN = Math.PI * (3 - Math.sqrt(5));
/** A node's diameter, in board units. One, by definition; named so the maths reads. */
export const NODE = 1;
/**
 * The gap a ring keeps from its hub.
 *
 * 1.25, not the 1.6 it started at: the ring used to have to clear the hub's own WORD, and the
 * word now sits above the constellation's highest member instead, so the only thing left to
 * clear is the members' own width.
 */
export const RING_MIN = 1.25;
/**
 * The step the spiral takes. Constellations are PACKED against each other from here, so this is
 * the distance between two hubs that have no rings at all, not the distance between any two.
 */
export const MIN_HUB_SPACING = 2.2;
/** Clear air between the outermost members of two constellations, in node widths. */
export const HUB_AIR = 0.45;
/**
 * The floor and the ceiling on the opening view.
 *
 * FOUND ON THE SIMULATOR: fitting the whole board is the right instinct and the wrong result once
 * there are enough clusters, because every sigil ends up at 23 points, a map of specks with a lot
 * of ground around it. A board is a thing you pan, so the opening view stops shrinking at a scale
 * that keeps a node legible (46 * 0.62 = 29 points) and the rest is one drag away.
 */
export const MIN_FIT = 0.62;
export const MAX_FIT = 1.4;

/** The reach of a constellation from its hub: its ring, plus half a node for the node itself. */
export function reach(size: number): number {
  return ringRadius(size) + NODE / 2;
}

/**
 * Where each cluster's hub goes: a phyllotaxis spiral, PACKED.
 *
 * It was one spacing for every pair, derived from the widest ring on the board. That is correct
 * and it is wasteful: MEASURED on a real board of eight drops in six clusters, one two member
 * ring set the spacing for all of them and the map ran off both edges of the phone with four
 * nodes on screen. A constellation's reach is its own, so the spiral is walked one step at a
 * time and a cluster takes the first step whose circle clears every circle already placed.
 *
 * It terminates: the spiral's radius grows without bound, so a step far enough out always clears.
 * It is deterministic: same clusters, same order, same steps, on both devices and in the review
 * sheet. And it packs a board of singletons, which have no rings, at MIN_HUB_SPACING.
 */
export function place(clusters: { size: number }[]): { x: number; y: number }[] {
  const out: { x: number; y: number; r: number }[] = [];
  let t = 0;
  for (const c of clusters) {
    const r = reach(c.size);
    for (;;) {
      const angle = t * GOLDEN;
      const radius = MIN_HUB_SPACING * Math.sqrt(t);
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      const clear = out.every(
        (o) => Math.hypot(o.x - x, o.y - y) >= o.r + r + NODE * HUB_AIR,
      );
      t += 1;
      if (clear) {
        out.push({ x, y, r });
        break;
      }
    }
  }
  return out.map(({ x, y }) => ({ x, y }));
}

export interface Placed {
  /** Index into the drops array the cluster came from. */
  index: number;
  x: number;
  y: number;
  /** Which cluster, for the hue of the thread that ties it to its hub. */
  cluster: number;
  /** True for the drop drawn AT the hub: a singleton, or a cluster's first member. */
  isHub: boolean;
}

export interface Hub {
  cluster: number;
  label: string;
  size: number;
  x: number;
  y: number;
  /** The ring the members sit on. 0 when there is only one member. */
  radius: number;
  /**
   * The y of this cluster's HIGHEST member, which is where its word goes.
   *
   * Not `y - radius`: a ring starts at its hub's own angle, so the topmost member is wherever
   * that rotation put it. FOUND ON THE SIMULATOR: with a two member ring rotated off vertical,
   * the label sat at the hub's centre, which on a real board was on top of the thread belonging
   * to the cluster above it.
   */
  top: number;
}

export interface Board {
  hubs: Hub[];
  nodes: Placed[];
  /** The bounding box in board units, so the view can fit the whole map on first paint. */
  extent: { minX: number; minY: number; maxX: number; maxY: number };
}

/** The ring radius for a cluster of `n`, in board units. */
export function ringRadius(n: number): number {
  if (n <= 1) return 0;
  // Circumference has to hold n nodes with a node's worth of air between them, so r grows with
  // n rather than with sqrt(n): a ring of eight is nearly twice the ring of four, which is what
  // keeps the eighth node from touching the first.
  return Math.max(RING_MIN, (n * (NODE * 2)) / (2 * Math.PI));
}

export function layout(clusters: Cluster[]): Board {
  const hubs: Hub[] = [];
  const nodes: Placed[] = [];
  const spots = place(clusters);

  clusters.forEach((c, i) => {
    // sqrt(i) spacing keeps the density of hubs constant as the board grows: the alternative,
    // a linear radius, leaves the middle crowded and the edge empty.
    const spot = spots[i] as { x: number; y: number };
    const hx = spot.x;
    const hy = spot.y;
    // The ring starts at the hub's own direction from the centre, so a constellation leans
    // away from the middle of the board rather than all of them pointing the same way.
    const angle = Math.atan2(hy, hx);
    const r = ringRadius(c.size);
    const hub: Hub = { cluster: i, label: c.label, size: c.size, x: hx, y: hy, radius: r, top: hy };
    hubs.push(hub);

    if (c.size === 1) {
      nodes.push({ index: c.members[0] as number, x: hx, y: hy, cluster: i, isHub: true });
      return;
    }
    c.members.forEach((m, j) => {
      // The ring starts at the hub's own angle, so a constellation leans away from the centre
      // of the board rather than all of them pointing the same way.
      const a = angle + (j / c.size) * Math.PI * 2;
      const ny = hy + Math.sin(a) * r;
      hub.top = Math.min(hub.top, ny);
      nodes.push({ index: m, x: hx + Math.cos(a) * r, y: ny, cluster: i, isHub: false });
    });
  });

  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const pad = NODE * 2;
  return {
    hubs,
    nodes,
    extent: {
      minX: (xs.length ? Math.min(...xs) : 0) - pad,
      minY: (ys.length ? Math.min(...ys) : 0) - pad,
      maxX: (xs.length ? Math.max(...xs) : 0) + pad,
      maxY: (ys.length ? Math.max(...ys) : 0) + pad,
    },
  };
}

/**
 * The scale and offset that fit a board into a viewport, and the scale that frames one node.
 *
 * Returned rather than applied so the zoom animation has both ends of the journey as plain
 * numbers: the map's transform is one shared value the gesture and the zoom both write, and a
 * component that computed its own target would fight the gesture for it.
 */
export function fit(
  extent: Board['extent'],
  viewport: { width: number; height: number },
  unit: number,
): { scale: number; x: number; y: number } {
  const w = (extent.maxX - extent.minX) * unit;
  const h = (extent.maxY - extent.minY) * unit;
  const scale = Math.max(
    MIN_FIT,
    Math.min(viewport.width / Math.max(w, 1), viewport.height / Math.max(h, 1), MAX_FIT),
  );
  const cx = ((extent.minX + extent.maxX) / 2) * unit;
  const cy = ((extent.minY + extent.maxY) / 2) * unit;
  return { scale, x: viewport.width / 2 - cx * scale, y: viewport.height / 2 - cy * scale };
}

/** The transform that puts one node in the middle of the viewport at `scale`. */
export function focus(
  node: { x: number; y: number },
  viewport: { width: number; height: number },
  unit: number,
  scale: number,
): { scale: number; x: number; y: number } {
  return {
    scale,
    x: viewport.width / 2 - node.x * unit * scale,
    y: viewport.height / 2 - node.y * unit * scale,
  };
}

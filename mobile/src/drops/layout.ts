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
/**
 * The closest two hubs may ever be, whatever else is true. A board of singletons has no rings at
 * all, and this is what keeps it from becoming a pile.
 */
export const MIN_HUB_SPACING = 2.2;
/** Clear air between the outermost members of two neighbouring constellations, in node widths. */
export const HUB_AIR = 0.6;

/**
 * Board units between the centres of two adjacent hubs, DERIVED from the rings on this board.
 *
 * It was a constant, 4.2. A board of five clusters looked sparse on the simulator so it was
 * tightened to 3.4, and `dropsBoard.test.ts` immediately failed: two nodes 0.55 units apart, half
 * a node, which is an overlap. The constant had been right and the reason was not written down.
 *
 * It is written down now, as the arithmetic: a sunflower spiral puts consecutive points about
 * `spacing` apart, two neighbouring constellations reach `r1 + r2` towards each other, so the
 * clearance is `spacing - r1 - r2` and it has to stay above a node's width. Taking the LARGEST
 * ring on the board makes that true for every pair on it. The pay off is the case a constant
 * cannot serve: a board of singletons has no rings, so it packs at MIN_HUB_SPACING and reads as
 * one map rather than as specks with a lot of ground around them.
 */
export function hubSpacing(clusters: { size: number }[]): number {
  const widest = clusters.reduce((m, c) => Math.max(m, ringRadius(c.size)), 0);
  return Math.max(MIN_HUB_SPACING, 2 * widest + NODE * (1 + HUB_AIR));
}
/** A node's diameter, in board units. One, by definition; named so the maths reads. */
export const NODE = 1;
/** The gap a ring keeps from its hub, so a hub's own label is never under a member. */
export const RING_MIN = 1.6;
/**
 * The floor and the ceiling on the opening view.
 *
 * FOUND ON THE SIMULATOR: fitting the whole board is the right instinct and the wrong result
 * past about five clusters. The spiral is 4.2 units between hubs, so five clusters span sixteen
 * units, which on a 393 point wide phone fits at 0.5 and draws every sigil at 23 points: a map
 * of specks with a lot of black around it. A board is a thing you pan, so the opening view stops
 * shrinking at a scale that keeps a node legible (46 * 0.62 = 29 points, the tap floor's own
 * ballpark) and the rest is one drag away.
 */
export const MIN_FIT = 0.62;
export const MAX_FIT = 1.4;

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
  const spacing = hubSpacing(clusters);

  clusters.forEach((c, i) => {
    // sqrt(i) spacing keeps the density of hubs constant as the board grows: the alternative,
    // a linear radius, leaves the middle crowded and the edge empty.
    const angle = i * GOLDEN;
    const radius = spacing * Math.sqrt(i);
    const hx = Math.cos(angle) * radius;
    const hy = Math.sin(angle) * radius;
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

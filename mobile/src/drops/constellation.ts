/**
 * The board's model: clusters as hubs, the resemblance between hubs as links, and where a hub's
 * drops go when you open it. PURE, so `__tests__/dropsConstellation.test.ts` holds it.
 *
 * WHY HUBS AND NOT NODES. The first web drew every drop at once, and to fit forty reels on a
 * phone each one came out fifty points wide: too small to recognise, too small to hit, and no word
 * on screen you could read. That is the classic failure of a graph view on a phone, and the known
 * cure is SEMANTIC ZOOM — show each cluster as one summary object at the overview, and trade it for
 * its contents when there is room to read them. Here the trade is a tap: open a hub and its drops
 * bloom out around it at a size you can read, while the rest of the constellation steps back.
 *
 * DETERMINISTIC throughout, for the reason `force.ts` gives.
 */
import { board as clusterBoard, similarityMatrix, type Clusterable } from './cluster';
import { edgesOf, FORCE, seedRing, settle, type Edge, type ForceOptions, type Node } from './force';

export interface Drop extends Clusterable {
  status?: string | null;
  thumbnail_url?: string | null;
}

export interface Hub {
  /** The cluster's own word, or one of the two holding piles. */
  label: string;
  /** Indices into the drops, most representative first. */
  members: number[];
  /** The kind most of its drops are, for its hue. */
  kind: string | null;
  /** How much room the bubble takes, in points. */
  r: number;
  /** Not a cluster: a holding pile that is about a state rather than a subject. */
  holding: 'arriving' | 'closed' | null;
}

/** A bubble's radius grows with what is in it, and stops growing before it dominates the board. */
export const HUB_MIN = 46;
export const HUB_MAX = 86;
export function hubRadius(n: number): number {
  return Math.min(HUB_MAX, HUB_MIN + 15 * Math.sqrt(Math.max(0, n - 1)));
}

/** The physics for hubs: fewer, bigger nodes, so the strands are longer and the gap wider. */
export const HUB_FORCE: ForceOptions = { ...FORCE, near: 120, far: 230, gap: 34, repulsion: 26000 };

export interface Constellation {
  hubs: Hub[];
  links: Edge[];
  /** Hub centres, settled, relative to the middle of the constellation. */
  at: { x: number; y: number }[];
  /** Pairwise resemblance between drops, for the bloom's own strands. */
  sim: number[][];
}

/**
 * The whole model, from the drops.
 *
 * Drops that are still being read, and drops nobody could read, have no words and so no vector;
 * they are not clustered but held in two piles of their own (`holding`), which float at the rim
 * with no strand to anything, because there is nothing true to connect them by yet.
 */
export function constellation(drops: Drop[]): Constellation {
  const sim = similarityMatrix(drops);
  const landing: number[] = [];
  const closed: number[] = [];
  const read: number[] = [];
  drops.forEach((d, i) => {
    if (d.status === 'waiting' || d.status === 'resolving') landing.push(i);
    else if (!d.title) closed.push(i);
    else read.push(i);
  });

  const groups = clusterBoard(read.map((i) => drops[i] as Drop)).map((g) => g.members.map((j) => read[j] as number));
  const labels = clusterBoard(read.map((i) => drops[i] as Drop)).map((g) => g.label);

  const hubs: Hub[] = groups.map((members, g) => ({
    label: labels[g] || 'loose ends',
    members: representative(members, sim, drops),
    kind: dominantKind(members, drops),
    r: hubRadius(members.length),
    holding: null,
  }));
  if (landing.length) {
    hubs.push({ label: 'just in', members: landing, kind: null, r: hubRadius(landing.length), holding: 'arriving' });
  }
  if (closed.length) {
    hubs.push({ label: 'no way in', members: closed, kind: null, r: hubRadius(closed.length), holding: 'closed' });
  }

  // A hub resembles another as much as its closest pair of drops do.
  const hubSim = hubs.map((a) =>
    hubs.map((b) => {
      if (a === b || a.holding || b.holding) return 0;
      let best = 0;
      for (const i of a.members) for (const j of b.members) best = Math.max(best, sim[i]?.[j] ?? 0);
      return best;
    }),
  );
  // Only real ties between subjects. A holding pile gets no strand, and neither does a pair of
  // hubs whose best tie is noise.
  const links = edgesOf(hubSim, 2, 0.05).filter((e) => {
    const a = hubs[e.a];
    const b = hubs[e.b];
    return !!a && !!b && !a.holding && !b.holding && e.w >= 0.05;
  });

  const nodes: Node[] = seedRing(hubs.length, 60).map((p, i) => ({ ...p, r: hubs[i]?.r }));
  settle(nodes, links, 320, HUB_FORCE);
  return { hubs, links, at: nodes.map((p) => ({ x: p.x, y: p.y })), sim };
}

/** Most representative first: the drop most like the rest of its cluster, a picture over none. */
function representative(members: number[], sim: number[][], drops: Drop[]): number[] {
  const score = (i: number) => members.reduce((s, j) => (j === i ? s : s + (sim[i]?.[j] ?? 0)), 0);
  return [...members].sort((a, b) => {
    const pa = drops[a]?.thumbnail_url ? 1 : 0;
    const pb = drops[b]?.thumbnail_url ? 1 : 0;
    return pb - pa || score(b) - score(a) || a - b;
  });
}

function dominantKind(members: number[], drops: Drop[]): string | null {
  const counts = new Map<string, number>();
  for (const i of members) {
    const k = drops[i]?.kind;
    if (k && k !== 'unknown') counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let best: string | null = null;
  let n = 0;
  for (const [k, c] of counts) if (c > n || (c === n && best !== null && k < best)) [best, n] = [k, c];
  return best;
}

// ───────────────────────────────────────────────────────────────── the bloom

/** A card in an open hub. 9:16, big enough to recognise and to read two lines under. */
export const CARD_W = 112;
export const CARD_H = 199;

/**
 * Where an open hub's drops go, relative to the hub's centre.
 *
 * A small force layout of its own, so two drops that are nearly the same video sit side by side.
 * Cards are tall, and circles are the only shape the physics knows, so the layout runs in a space
 * whose y axis is squashed by the card's aspect: a card is square there, a circle clears it, and
 * stretching the answer back gives ellipses that clear a 9:16 frame in every direction.
 */
export function bloom(members: number[], sim: number[][]): { x: number; y: number }[] {
  const n = members.length;
  if (n === 0) return [];
  if (n === 1) return [{ x: 0, y: 0 }];
  const squash = CARD_W / CARD_H;
  const r = Math.hypot(CARD_W, CARD_W) / 2 + 2;
  const local = members.map((i) => members.map((j) => (i === j ? 0 : (sim[i]?.[j] ?? 0))));
  const edges = edgesOf(local, 2, 0);
  const nodes: Node[] = seedRing(n, 70).map((p) => ({ ...p, r }));
  const o: ForceOptions = { ...FORCE, gap: 16, near: 2 * r + 16, far: 2 * r + 90, repulsion: 30000, gravity: 0.03 };
  settle(nodes, edges, 360, o);
  // Centre the bloom on the hub, whatever the physics drifted to.
  const cx = nodes.reduce((s, p) => s + p.x, 0) / n;
  const cy = nodes.reduce((s, p) => s + p.y, 0) / n;
  return nodes.map((p) => ({ x: p.x - cx, y: (p.y - cy) / squash }));
}

/** The box a bloom occupies, cards included, for the camera. */
export function bloomExtent(at: { x: number; y: number }[]): { w: number; h: number } {
  if (!at.length) return { w: CARD_W, h: CARD_H };
  const xs = at.map((p) => p.x);
  const ys = at.map((p) => p.y);
  return {
    w: Math.max(...xs) - Math.min(...xs) + CARD_W,
    h: Math.max(...ys) - Math.min(...ys) + CARD_H,
  };
}

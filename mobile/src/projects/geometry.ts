/**
 * Where the three project drawings put things, as plain arithmetic so `bun test` holds every
 * rule: the RIVERS (a streamgraph of hours per project, week by week), the RANK RACE (a bump
 * chart of the projects re-ranking week by week) and the SESSION SWARM (a beeswarm of one
 * project's sessions on a time axis). Nothing here reads React Native or Skia; the components
 * (`Rivers.tsx`, `RankRace.tsx`, `Swarm.tsx`) turn these numbers into paths.
 *
 * Borrowed, with the rule named:
 *   - the streams' baseline and their inside out order are Byron and Wattenberg's
 *     ("Stacked Graphs: Geometry and Aesthetics", InfoVis 2008): the thickest stream in the
 *     middle, the thinner ones added outside it alternately, and the whole stack centred on
 *     the axis (their silhouette), so a river reads as a river and not as a bar stack;
 *   - the curve between two weeks is a cubic whose control points sit halfway across at each
 *     end's own height (d3's `curveBumpX`): it never overshoots, so two edges that are in order
 *     at both weeks stay in order all the way between them and no stream ever crosses another;
 *   - the swarm places each dot at the free height nearest the axis, touching the dots already
 *     down (the "accurate beeswarm" of Eklund's beeswarm package), biggest first, so the long
 *     sessions sit on the axis and the short ones pack round them.
 */

// ------------------------------------------------------------------ the rivers

export interface StreamIn {
  key: string;
  /** One value a week, every week present. Zero is a real zero: the stream is closed there. */
  values: readonly number[];
}

export interface StreamOut {
  key: string;
  /** Top and bottom edge of the stream at each week, in points from the top. */
  top: number[];
  bottom: number[];
}

export interface StreamLayout {
  /** The x of each week's centre, in points. */
  xs: number[];
  /** Inside out order: the order the streams are stacked in, top to bottom. */
  streams: StreamOut[];
  /** Points per unit of value. */
  scale: number;
  /** The largest weekly total, in the values' unit. */
  peak: number;
}

/**
 * Inside out order (Byron and Wattenberg): the streams by total, largest first, each next one
 * put on whichever side of the stack is lighter so far, so the biggest sits in the middle.
 * Returns the keys top to bottom. Ties by the order given, so the same input draws the same river.
 */
export function insideOut(streams: readonly StreamIn[]): string[] {
  const total = (s: StreamIn) => s.values.reduce((a, v) => a + Math.max(0, v), 0);
  const sorted = streams.map((s, i) => ({ key: s.key, t: total(s), i })).sort((a, b) => b.t - a.t || a.i - b.i);
  const [centre, ...rest] = sorted;
  if (!centre) return [];
  // Each side's weight leaves the centre stream out, so the sides take turns.
  const top: string[] = [];
  const bottom: string[] = [];
  let upper = 0;
  let lower = 0;
  for (const s of rest) {
    if (upper <= lower) {
      top.unshift(s.key);
      upper += s.t;
    } else {
      bottom.push(s.key);
      lower += s.t;
    }
  }
  return [...top, centre.key, ...bottom];
}

/**
 * A streamgraph of `streams` over `weeks` columns in a `width` by `height` box: each week's
 * streams stacked in inside out order and centred on the middle (the silhouette baseline),
 * scaled so the fullest week fills `height` less `pad` top and bottom. The x of a week is the
 * centre of its column. With one week the river is one column wide at the middle.
 */
export function streamLayout(streams: readonly StreamIn[], width: number, height: number, pad = 6): StreamLayout {
  const weeks = Math.max(0, ...streams.map((s) => s.values.length));
  const xs = Array.from({ length: weeks }, (_, i) => (weeks <= 1 ? width / 2 : pad + (i * (width - pad * 2)) / (weeks - 1)));
  const order = insideOut(streams);
  const byKey = new Map(streams.map((s) => [s.key, s]));
  const totals = xs.map((_, i) => streams.reduce((a, s) => a + Math.max(0, s.values[i] ?? 0), 0));
  const peak = Math.max(0, ...totals);
  const scale = peak > 0 ? (height - pad * 2) / peak : 0;
  const mid = height / 2;
  const cursor = totals.map((t) => mid - (t * scale) / 2);
  const out: StreamOut[] = order.map((key) => {
    const s = byKey.get(key)!;
    const top: number[] = [];
    const bottom: number[] = [];
    for (let i = 0; i < weeks; i++) {
      const h = Math.max(0, s.values[i] ?? 0) * scale;
      top.push(cursor[i]!);
      bottom.push(cursor[i]! + h);
      cursor[i] = cursor[i]! + h;
    }
    return { key, top, bottom };
  });
  return { xs, streams: out, scale, peak };
}

/**
 * The stream under a point, and the week column it falls in: the week is the nearest centre,
 * the stream is the one whose band holds `y` at that week, or null over open water.
 */
export function streamAt(layout: StreamLayout, x: number, y: number): { key: string | null; week: number } {
  if (!layout.xs.length) return { key: null, week: -1 };
  let week = 0;
  for (let i = 1; i < layout.xs.length; i++) if (Math.abs(layout.xs[i]! - x) < Math.abs(layout.xs[week]! - x)) week = i;
  for (const s of layout.streams) {
    const top = s.top[week]!;
    const bottom = s.bottom[week]!;
    // A stream thinner than a fingertip still takes the tap when the finger is on it.
    const slack = bottom - top < 8 ? (8 - (bottom - top)) / 2 : 0;
    if (y >= top - slack && y <= bottom + slack && bottom > top) return { key: s.key, week };
  }
  return { key: null, week };
}

/** One curve segment: from (x0, y0) to (x1, y1) with d3's bumpX controls. */
export interface Bump {
  c1x: number;
  c1y: number;
  c2x: number;
  c2y: number;
  x: number;
  y: number;
}

/** The segments of a smooth line through `points`, each a cubic with bumpX controls. */
export function bumps(xs: readonly number[], ys: readonly number[]): Bump[] {
  const out: Bump[] = [];
  for (let i = 1; i < Math.min(xs.length, ys.length); i++) {
    const mx = (xs[i - 1]! + xs[i]!) / 2;
    out.push({ c1x: mx, c1y: ys[i - 1]!, c2x: mx, c2y: ys[i]!, x: xs[i]!, y: ys[i]! });
  }
  return out;
}

/** Where a bumpX segment is at parameter t (0 to 1): the point the curve passes through. */
export function bumpPoint(x0: number, y0: number, b: Bump, t: number): { x: number; y: number } {
  const u = 1 - t;
  const a = u * u * u;
  const c = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return { x: a * x0 + c * b.c1x + d * b.c2x + e * b.x, y: a * y0 + c * b.c1y + d * b.c2y + e * b.y };
}

// ------------------------------------------------------------------ the rank race

export interface RaceIn {
  key: string;
  /** Rank each week, 1 is the top, null when the project had no time with you there that week. */
  ranks: readonly (number | null)[];
}

export interface RaceRun {
  /** Consecutive weeks the project was ranked in: one drawn line each. */
  points: { week: number; rank: number; x: number; y: number }[];
}

export interface RaceLine {
  key: string;
  runs: RaceRun[];
}

export interface RaceLayout {
  xs: number[];
  /** The y of each rank row, rank 1 first. */
  rows: number[];
  lines: RaceLine[];
}

/**
 * A bump chart: one row per rank (as many rows as the most projects ranked in any week, at most
 * `maxRows`), one column per week, and each project's line through its rank at each week it was
 * ranked. A week with no time with you there breaks the line: absent is not a rank, and a line
 * drawn through it would claim a place nobody measured. A rank past `maxRows` leaves the chart.
 */
export function raceLayout(runs: readonly RaceIn[], width: number, rowGap: number, pad = 10, maxRows = 8): RaceLayout {
  const weeks = Math.max(0, ...runs.map((r) => r.ranks.length));
  const deepest = Math.max(0, ...runs.flatMap((r) => r.ranks.map((x) => x ?? 0)));
  const rowsN = Math.min(maxRows, deepest);
  const rows = Array.from({ length: rowsN }, (_, i) => pad + i * rowGap);
  const xs = Array.from({ length: weeks }, (_, i) => (weeks <= 1 ? width / 2 : pad + (i * (width - pad * 2)) / (weeks - 1)));
  const lines = runs.map((r) => {
    const out: RaceRun[] = [];
    let cur: RaceRun | null = null;
    for (let i = 0; i < weeks; i++) {
      const rank = r.ranks[i] ?? null;
      if (rank === null || rank > rowsN) {
        cur = null;
        continue;
      }
      if (!cur) {
        cur = { points: [] };
        out.push(cur);
      }
      cur.points.push({ week: i, rank, x: xs[i]!, y: rows[rank - 1]! });
    }
    return { key: r.key, runs: out };
  });
  return { xs, rows, lines };
}

// ------------------------------------------------------------------ the session swarm

/**
 * The most dots one swarm draws. Placing a dot checks it against every dot already down, so the
 * layout grows with the square of the dots, on the JavaScript thread: 400 lays out in well under
 * a frame's budget on a phone, and the page says how many of how many it drew. UNMEASURED
 * JUDGEMENT CALL beside that: the corpus's busiest project has 155 sessions.
 */
export const SWARM_MAX = 400;

export interface SwarmIn {
  id: string;
  /** Epoch ms the session started. */
  at: number;
  /** Seconds: sets the dot's area. */
  size: number;
}

export interface SwarmDot {
  id: string;
  x: number;
  /** Offset from the axis, in points: negative above it. */
  dy: number;
  r: number;
}

export interface SwarmOptions {
  rMin: number;
  rMax: number;
  gap: number;
  pad: number;
}

/** Area by length: a session twice as long is twice the ink. Never under `rMin`, so a short one is still a dot a finger can find. */
export function swarmRadius(size: number, max: number, o: Pick<SwarmOptions, 'rMin' | 'rMax'>): number {
  if (!(max > 0) || !(size > 0)) return o.rMin;
  return Math.max(o.rMin, o.rMax * Math.sqrt(Math.min(1, size / max)));
}

/**
 * Every session as a dot at its start on a time axis `width` wide, packed without overlap:
 * biggest first, each at the height nearest the axis where it touches nothing already down.
 * `from` and `to` are the axis's ends in epoch ms (the first and last start when left out).
 * Deterministic: the same sessions always make the same swarm.
 */
export function beeswarm(all: readonly SwarmIn[], width: number, o: SwarmOptions, from?: number, to?: number): { dots: SwarmDot[]; extent: number; from: number; to: number } {
  // Never more than the cap, the newest kept: the caller says how many of how many it drew.
  const items = all.length > SWARM_MAX ? [...all].sort((a, b) => a.at - b.at).slice(-SWARM_MAX) : all;
  if (!items.length) return { dots: [], extent: 0, from: from ?? 0, to: to ?? 0 };
  // The axis reaches the ends it is given (a project's first session), and never cuts a dot off.
  const lo = Math.min(from ?? Number.POSITIVE_INFINITY, ...items.map((s) => s.at));
  const hi = Math.max(to ?? Number.NEGATIVE_INFINITY, ...items.map((s) => s.at));
  const max = Math.max(...items.map((s) => s.size));
  const span = hi - lo;
  const xOf = (at: number) => (span > 0 ? o.pad + ((at - lo) / span) * (width - o.pad * 2) : width / 2);
  const order = items
    .map((s, i) => ({ s, i, r: swarmRadius(s.size, max, o) }))
    .sort((a, b) => b.r - a.r || a.s.at - b.s.at || a.i - b.i);
  const placed: SwarmDot[] = [];
  for (const { s, r } of order) {
    const x = Math.min(width - r, Math.max(r, xOf(s.at)));
    const blocked: [number, number][] = [];
    for (const p of placed) {
      const reach = r + p.r + o.gap;
      const dx = x - p.x;
      if (Math.abs(dx) >= reach) continue;
      const h = Math.sqrt(reach * reach - dx * dx);
      blocked.push([p.dy - h, p.dy + h]);
    }
    const candidates = [0, ...blocked.flatMap(([a, b]) => [a, b])].sort((a, b) => Math.abs(a) - Math.abs(b) || a - b);
    const free = candidates.find((y) => blocked.every(([a, b]) => y <= a + 1e-6 || y >= b - 1e-6)) ?? 0;
    placed.push({ id: s.id, x, dy: free, r });
  }
  const extent = Math.max(0, ...placed.map((p) => Math.abs(p.dy) + p.r));
  // Back in time order, so the entrance can run left to right.
  const at = new Map(items.map((s) => [s.id, s.at]));
  placed.sort((a, b) => (at.get(a.id) ?? 0) - (at.get(b.id) ?? 0));
  return { dots: placed, extent, from: lo, to: hi };
}

/** The dot under a point (the nearest whose rim is within `slop`), or null. */
export function dotAt(dots: readonly SwarmDot[], axisY: number, x: number, y: number, slop = 6): SwarmDot | null {
  let best: SwarmDot | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const d of dots) {
    const dist = Math.hypot(d.x - x, axisY + d.dy - y) - d.r;
    if (dist <= slop && dist < bestD) {
      best = d;
      bestD = dist;
    }
  }
  return best;
}

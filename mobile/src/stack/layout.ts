/**
 * Where the Stack page puts things, as plain arithmetic so `bun test` can hold it: the bubbles of
 * what you build with most (area by sessions), the tiles of each category (size by sessions),
 * and the row of marks a band prints. Nothing here reads React Native.
 *
 * Sizes are the data, with a floor: a thing used once still gets a tile or a bubble big enough to
 * carry its mark, the way the analysis page's bars keep a two point mark for a share that is not
 * zero, and the number on it says the real value.
 */

// ------------------------------------------------------------------ bubbles

export interface BubbleIn {
  key: string;
  value: number;
}

export interface Bubble {
  key: string;
  /** Centre, in points from the cloud's top left. */
  x: number;
  y: number;
  r: number;
}

export interface BubbleOptions {
  /** The biggest bubble's radius. */
  rMax: number;
  /** No bubble is smaller than this, whatever its value: it still carries its mark. */
  rMin: number;
  /** Air between two bubbles. */
  gap: number;
  /**
   * How much a vertical step costs against a horizontal one when a bubble looks for its place:
   * above 1 spreads the cloud across the width rather than down the page.
   */
  squash?: number;
}

/** Area by value: the radius goes as the square root, so a bubble twice the sessions is twice the ink. */
export function bubbleRadius(value: number, max: number, o: Pick<BubbleOptions, 'rMax' | 'rMin'>): number {
  if (!(max > 0) || !(value > 0)) return o.rMin;
  return Math.max(o.rMin, o.rMax * Math.sqrt(Math.min(1, value / max)));
}

function fits(x: number, y: number, r: number, placed: readonly Bubble[], gap: number, width: number): boolean {
  if (x - r < -0.01 || x + r > width + 0.01) return false;
  for (const p of placed) {
    const dx = x - p.x;
    const dy = y - p.y;
    if (dx * dx + dy * dy < (r + p.r + gap) ** 2 - 0.01) return false;
  }
  return true;
}

/**
 * A cloud of circles, biggest first, each placed touching the ones already down at the free spot
 * nearest the first one's centre (a vertical step costing `squash` times a horizontal one), and
 * never past either edge. Deterministic: the same values always draw the same cloud.
 */
export function packBubbles(items: readonly BubbleIn[], width: number, o: BubbleOptions): { bubbles: Bubble[]; height: number } {
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const max = sorted[0]?.value ?? 0;
  const squash = o.squash ?? 1.3;
  const placed: Bubble[] = [];
  for (const it of sorted) {
    const r = Math.min(width / 2, bubbleRadius(it.value, max, o));
    if (!placed.length) {
      placed.push({ key: it.key, x: width / 2, y: r, r });
      continue;
    }
    const ax = placed[0]!.x;
    const ay = placed[0]!.y;
    let best: { x: number; y: number; cost: number } | null = null;
    const consider = (x: number, y: number) => {
      if (!Number.isFinite(x) || !Number.isFinite(y) || !fits(x, y, r, placed, o.gap, width)) return;
      const dx = x - ax;
      const dy = (y - ay) * squash;
      const cost = dx * dx + dy * dy;
      if (!best || cost < best.cost - 1e-9) best = { x, y, cost };
    };
    // Touching one bubble, every 15 degrees round it.
    for (const p of placed) {
      const d = p.r + r + o.gap;
      for (let a = 0; a < 360; a += 15) {
        const t = (a * Math.PI) / 180;
        consider(p.x + Math.cos(t) * d, p.y + Math.sin(t) * d);
      }
    }
    // Touching two at once: where the two grown circles cross.
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const A = placed[i]!;
        const B = placed[j]!;
        const ra = A.r + r + o.gap;
        const rb = B.r + r + o.gap;
        const dx = B.x - A.x;
        const dy = B.y - A.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d <= 0 || d > ra + rb || d < Math.abs(ra - rb)) continue;
        const a = (ra * ra - rb * rb + d * d) / (2 * d);
        const h = Math.sqrt(Math.max(0, ra * ra - a * a));
        const mx = A.x + (a * dx) / d;
        const my = A.y + (a * dy) / d;
        consider(mx + (h * -dy) / d, my + (h * dx) / d);
        consider(mx - (h * -dy) / d, my - (h * dx) / d);
      }
    }
    const found = best as { x: number; y: number } | null;
    // Nowhere touching fits (a bubble wider than the room left beside the others): under them all.
    const bottom = Math.max(...placed.map((p) => p.y + p.r));
    placed.push(found ? { key: it.key, x: found.x, y: found.y, r } : { key: it.key, x: width / 2, y: bottom + o.gap + r, r });
  }
  if (!placed.length) return { bubbles: [], height: 0 };
  const top = Math.min(...placed.map((p) => p.y - p.r));
  const bottom = Math.max(...placed.map((p) => p.y + p.r));
  return { bubbles: placed.map((p) => ({ ...p, y: p.y - top })), height: bottom - top };
}

// ------------------------------------------------------------------ tiles

export type TileSize = 'lead' | 'mid' | 'small';

export interface TileIn {
  key: string;
  value: number;
}

export interface Tile {
  key: string;
  size: TileSize;
  /** Of `TILE_UNITS` across. */
  units: number;
  x: number;
  w: number;
}

export interface TileRow {
  y: number;
  h: number;
  tiles: Tile[];
}

/** A row is six units across: a lead alone is six, two leads or a mid three each, a small two. */
export const TILE_UNITS = 6;
export const TILE_HEIGHT: Record<TileSize, number> = { lead: 136, mid: 118, small: 104 };
/** At or above this share of the category's most used thing, a thing leads. */
export const LEAD_AT = 0.75;
/** At or above this share, a thing is a middle tile; below it, a small one. */
export const MID_AT = 0.25;

/** A thing's tile by its sessions against the most used in its category. */
export function tileSize(value: number, max: number): TileSize {
  if (!(max > 0)) return 'small';
  const f = value / max;
  return f >= LEAD_AT ? 'lead' : f >= MID_AT ? 'mid' : 'small';
}

/**
 * The tiles of one category, most used first, in rows of six units. Each tile takes its size's
 * units; a row closes when the next tile does not fit, and what it has left goes to its tiles one
 * unit at a time from the first, so a row runs edge to edge and the biggest thing on it is the
 * widest. No tile grows past twice its own size: a thing used once, alone on the last row, stays
 * small rather than stretching as wide as the leader. A row is as tall as its tallest tile.
 */
export function packTiles(items: readonly TileIn[], width: number, gap: number): TileRow[] {
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const max = sorted[0]?.value ?? 0;
  const sizes = sorted.map((it) => tileSize(it.value, max));
  const leads = sizes.filter((s) => s === 'lead').length;
  const unitsOf = (s: TileSize) => (s === 'lead' ? (leads === 1 ? TILE_UNITS : 3) : s === 'mid' ? 3 : 2);

  const rows: { key: string; size: TileSize; units: number; own: number }[][] = [];
  let row: { key: string; size: TileSize; units: number; own: number }[] = [];
  let used = 0;
  const close = () => {
    if (!row.length) return;
    let left = TILE_UNITS - used;
    for (let pass = 0; left > 0 && pass < TILE_UNITS; pass++) {
      for (const t of row) {
        if (left <= 0) break;
        if (t.units >= t.own * 2) continue;
        t.units += 1;
        left -= 1;
      }
    }
    rows.push(row);
    row = [];
    used = 0;
  };
  sorted.forEach((it, i) => {
    const units = unitsOf(sizes[i]!);
    if (used + units > TILE_UNITS) close();
    row.push({ key: it.key, size: sizes[i]!, units, own: units });
    used += units;
  });
  close();

  const unit = (width - gap * (TILE_UNITS - 1)) / TILE_UNITS;
  const out: TileRow[] = [];
  let y = 0;
  for (const r of rows) {
    let x = 0;
    const tiles: Tile[] = r.map((t) => {
      const w = t.units * unit + (t.units - 1) * gap;
      const tile = { key: t.key, size: t.size, units: t.units, x, w };
      x += w + gap;
      return tile;
    });
    const h = Math.max(...r.map((t) => TILE_HEIGHT[t.size]));
    out.push({ y, h, tiles });
    y += h + gap;
  }
  return out;
}

/** The height of packed rows, gaps between them included. */
export function rowsHeight(rows: readonly TileRow[], gap: number): number {
  if (!rows.length) return 0;
  return rows.reduce((s, r) => s + r.h, 0) + gap * (rows.length - 1);
}

// ------------------------------------------------------------------ a band's printed row

export interface Slot {
  x: number;
  y: number;
}

/** `count` marks of `size` points, `gap` apart, in rows that wrap at `width`. */
export function wrapMarks(count: number, size: number, gap: number, width: number): { slots: Slot[]; height: number } {
  const perRow = Math.max(1, Math.floor((width + gap) / (size + gap)));
  const slots: Slot[] = [];
  for (let i = 0; i < count; i++) {
    slots.push({ x: (i % perRow) * (size + gap), y: Math.floor(i / perRow) * (size + gap) });
  }
  const rows = Math.ceil(count / perRow);
  return { slots, height: rows > 0 ? rows * size + (rows - 1) * gap : 0 };
}

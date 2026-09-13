/**
 * The codebase map's shape: where each file sits.
 *
 * WHY ISLANDS, AND NOT A TREEMAP OR A RADIAL TREE. The wire gives each file a salted id, the
 * salted id of its folder (`dir_id`, null at the checkout's top) and its folder `depth`, and
 * nothing that says which folder sits inside which (spec/live.v1.json `LiveFile`). So the
 * structure that can honestly be drawn has two levels: folders, and the files in them.
 *
 *   - A radial tree needs parent links to put a child under its parent. Without them its
 *     angles would be arbitrary while still reading as ancestry: a picture of structure the
 *     data does not have.
 *   - A squarified treemap draws exactly two levels, but it sizes cells to fill the box, so
 *     three files come out as three giant blocks, and its rows reflow from scratch whenever a
 *     folder gains a file.
 *   - Islands: each folder is a round pixel island of equal cells, one cell per file, and the
 *     islands are packed around the middle (`pack.ts`), top of the repository first, then by
 *     depth, so deeper folders tend to sit further out. Every file is one cell of one size,
 *     so three files look like three files and four hundred like a codebase, which is the
 *     brief's "the repo drawn as a shape" and the pixel grid Builda's identity is drawn on.
 *
 * STABLE ACROSS REFRESHES. Every order here comes from the ids, which are HMACs of the paths
 * under the machine's private salt: folders by depth then folder id, files in a folder by file
 * id. Never `Math.random`, never the order the rows arrived in (the spec promises none), and
 * no trig (the spiral compares angles by exact integer cross products), so the same map lands
 * on the same coordinates on every device and every refresh. New files move the map only as
 * much as the packing has to; the canvas glides between the two layouts (`MapCanvas.tsx`).
 *
 * Coordinates are in CELL units (a cell is 1 by 1, centred on its coordinates) until
 * `fitGeometry` turns them into points. Pure: no React Native, so `bun test` holds it
 * (`__tests__/mapLayout.test.ts`).
 */

import { ROLES } from '../copy/plain';
import type { LiveFile, PlainRole } from '../generated/live';
import { packSiblings, type Circle } from './pack';

/** The folder key of files at the top of the checkout (`dir_id` null). Never a hex id. */
export const BASE_FOLDER = 'base';

/**
 * Empty space between two islands' circles, in cells. UNMEASURED JUDGEMENT CALL, judged on a
 * render of the sample at phone size: at 0.8 a map of small folders read as scattered specks,
 * not one shape; much under half a cell two islands' corners can meet across a diagonal and
 * the folders run together. The corners of two islands' cells are always at least this far
 * apart along the line between their centres, and never under `ISLAND_GAP / sqrt 2` on a
 * diagonal (`__tests__/mapLayout.test.ts` holds that for every pair).
 */
export const ISLAND_GAP = 0.6;

export interface MapCell {
  id: string;
  /** Index into `MapLayout.folders`. */
  folder: number;
  /** Centre, in cells, from the layout's top left. */
  x: number;
  y: number;
  role: PlainRole;
}

export interface MapFolder {
  /** `dir_id`, or `BASE_FOLDER` for the top of the checkout. */
  key: string;
  /** Directories between the base and these files; null outside the base. */
  depth: number | null;
  /** Indices into `MapLayout.cells`. */
  cells: number[];
  /** The island's circle: centred on its cells' centroid, holding every cell's corners. */
  x: number;
  y: number;
  r: number;
  /** Where the island's spiral starts (its first cell's centre): cells sit at whole offsets from it. */
  ox: number;
  oy: number;
  /** The role most of its files have, ties to `plain.ROLES` order. */
  role: PlainRole;
  /** How many of its files have that role. */
  roleCount: number;
}

export interface MapLayout {
  cells: MapCell[];
  folders: MapFolder[];
  /** The bounding box in cells, from 0. */
  width: number;
  height: number;
  /** File id to cell index. */
  index: Readonly<Record<string, number>>;
}

// ------------------------------------------------------------------ the spiral

/** Which half turn an offset lies in, screen coordinates (y down), from 3 o'clock clockwise. */
function half(dx: number, dy: number): number {
  return dy > 0 || (dy === 0 && dx > 0) ? 0 : 1;
}

/**
 * Integer offsets around (0, 0), nearest first, then clockwise from 3 o'clock: the order an
 * island fills. 1 is a cell, 5 a plus, 9 a square, 13 a diamond, and on to a round blob.
 * Compared exactly: squared distance, then the half turn, then the sign of the cross product.
 */
function spiralCompare(a: readonly [number, number], b: readonly [number, number]): number {
  const da = a[0] * a[0] + a[1] * a[1];
  const db = b[0] * b[0] + b[1] * b[1];
  if (da !== db) return da - db;
  const ha = half(a[0], a[1]);
  const hb = half(b[0], b[1]);
  if (ha !== hb) return ha - hb;
  const cross = a[0] * b[1] - a[1] * b[0];
  return cross > 0 ? -1 : cross < 0 ? 1 : 0;
}

let SPIRAL: [number, number][] = [];

/** The first `n` offsets of the spiral, grown on demand. */
export function spiral(n: number): readonly (readonly [number, number])[] {
  if (SPIRAL.length < n) {
    let radius = 4;
    while (Math.PI * radius * radius < n * 1.3 + 16) radius += 2;
    const pts: [number, number][] = [];
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= radius * radius) pts.push([dx, dy]);
      }
    }
    pts.sort(spiralCompare);
    SPIRAL = pts;
  }
  return SPIRAL.slice(0, n);
}

// ------------------------------------------------------------------ folders

function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Top of the checkout first, then shallower folders, folders outside the base last, then id. */
function folderRank(key: string, depth: number | null): number {
  if (key === BASE_FOLDER) return -1;
  return depth === null ? Number.POSITIVE_INFINITY : depth;
}

function dominantRole(roles: readonly PlainRole[]): { role: PlainRole; count: number } {
  const counts = new Map<PlainRole, number>();
  for (const r of roles) counts.set(r, (counts.get(r) ?? 0) + 1);
  let best: PlainRole = 'unknown';
  let bestCount = -1;
  for (const r of ROLES) {
    const k = counts.get(r) ?? 0;
    if (k > bestCount) {
      best = r;
      bestCount = k;
    }
  }
  return { role: best, count: Math.max(0, bestCount) };
}

/**
 * Lay out the files. Duplicate ids keep their first row (the engine keys rows by id, so a
 * duplicate is a producer bug, and one cell per file is the rule the picture rests on).
 */
export function layoutMap(files: readonly LiveFile[]): MapLayout {
  const seen = new Set<string>();
  const unique: LiveFile[] = [];
  for (const f of files) {
    if (!f || typeof f.id !== 'string' || seen.has(f.id)) continue;
    seen.add(f.id);
    unique.push(f);
  }

  // Group by folder.
  const groups = new Map<string, LiveFile[]>();
  for (const f of unique) {
    const key = f.dir_id ?? BASE_FOLDER;
    const g = groups.get(key);
    if (g) g.push(f);
    else groups.set(key, [f]);
  }

  interface Pending extends Circle {
    key: string;
    depth: number | null;
    files: LiveFile[];
    offsets: readonly (readonly [number, number])[];
    /** The offsets' centroid: the circle's centre, relative to the spiral's first cell. */
    cx: number;
    cy: number;
  }

  const pending: Pending[] = [];
  for (const [key, members] of groups) {
    members.sort((p, q) => compareKeys(p.id, q.id));
    const depths = members.map((m) => m.depth).filter((d): d is number => typeof d === 'number');
    const depth = depths.length ? Math.min(...depths) : null;
    const offsets = spiral(members.length);
    let cx = 0;
    let cy = 0;
    for (const [dx, dy] of offsets) {
      cx += dx;
      cy += dy;
    }
    cx /= offsets.length;
    cy /= offsets.length;
    // The circle round the centroid that holds every corner of every cell: not the smallest
    // enclosing circle, but a tight one, and one no cell can poke out of.
    let reach = 0;
    for (const [dx, dy] of offsets) {
      const ex = Math.abs(dx - cx) + 0.5;
      const ey = Math.abs(dy - cy) + 0.5;
      reach = Math.max(reach, Math.sqrt(ex * ex + ey * ey));
    }
    pending.push({ key, depth, files: members, offsets, cx, cy, r: reach + ISLAND_GAP / 2, x: 0, y: 0 });
  }

  pending.sort((p, q) => {
    const a = folderRank(p.key, p.depth);
    const b = folderRank(q.key, q.depth);
    if (a !== b) return a < b ? -1 : 1;
    return compareKeys(p.key, q.key);
  });

  packSiblings(pending);

  const cells: MapCell[] = [];
  const folders: MapFolder[] = [];
  pending.forEach((p, fi) => {
    const idx: number[] = [];
    const ox = p.x - p.cx;
    const oy = p.y - p.cy;
    p.files.forEach((f, j) => {
      const [dx, dy] = p.offsets[j]!;
      idx.push(cells.length);
      cells.push({ id: f.id, folder: fi, x: ox + dx, y: oy + dy, role: f.role });
    });
    const { role, count } = dominantRole(p.files.map((f) => f.role));
    folders.push({ key: p.key, depth: p.depth, cells: idx, x: p.x, y: p.y, r: p.r - ISLAND_GAP / 2, ox, oy, role, roleCount: count });
  });

  // Move the top left corner of the top left cell to (0, 0).
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const c of cells) {
    minX = Math.min(minX, c.x - 0.5);
    minY = Math.min(minY, c.y - 0.5);
    maxX = Math.max(maxX, c.x + 0.5);
    maxY = Math.max(maxY, c.y + 0.5);
  }
  if (cells.length === 0) {
    return { cells, folders, width: 0, height: 0, index: {} };
  }
  for (const c of cells) {
    c.x -= minX;
    c.y -= minY;
  }
  for (const f of folders) {
    f.x -= minX;
    f.y -= minY;
    f.ox -= minX;
    f.oy -= minY;
  }
  const index: Record<string, number> = {};
  cells.forEach((c, i) => {
    index[c.id] = i;
  });
  return { cells, folders, width: maxX - minX, height: maxY - minY, index };
}

// ------------------------------------------------------------------ points

/**
 * Cell pitch bounds in points. MAX: a three file map is three cells a thumb can tell apart,
 * not three posters (28pt is the size of a 44pt tap target less its gap). MIN: under 4pt a
 * cell is not a thing a person can see as one. Both UNMEASURED JUDGEMENT CALLS.
 */
export const MAX_PITCH = 28;
export const MIN_PITCH = 4;

export interface MapGeometry {
  /** Whole points from one cell's left edge to the next's. */
  pitch: number;
  /** The drawn square, whole points: the pitch less the gap between cells. */
  cell: number;
  /** The canvas. */
  width: number;
  height: number;
  /** Where cell space (0, 0) lands, whole points. */
  ox: number;
  oy: number;
}

/** The gap between two cells: about a sixth of the pitch, at least a point. */
export function cellGap(pitch: number): number {
  return Math.max(1, Math.round(pitch / 6));
}

/**
 * Points for a layout in a box `width` wide and at most `maxHeight` tall, with `margin` round
 * the shape. The pitch is a whole number of points so every cell edge lands on a point, the
 * shape is centred across the box, and the canvas is as tall as the shape needs.
 */
export function fitGeometry(layout: MapLayout, width: number, maxHeight: number, margin: number): MapGeometry {
  const w = Math.max(1, layout.width);
  const h = Math.max(1, layout.height);
  const fit = Math.min(MAX_PITCH, (width - 2 * margin) / w, (maxHeight - 2 * margin) / h);
  const pitch = Math.max(MIN_PITCH, Math.floor(fit));
  const shapeW = layout.width * pitch;
  const shapeH = layout.height * pitch;
  return {
    pitch,
    cell: pitch - cellGap(pitch),
    width,
    height: Math.ceil(shapeH + 2 * margin),
    ox: Math.round((width - shapeW) / 2),
    oy: margin,
  };
}

export interface CellRects {
  /** Top left corner of each drawn square, whole points, in `layout.cells` order. */
  x: number[];
  y: number[];
  /** The side of every square. */
  size: number;
}

/**
 * Every cell's square in points. An island's cells keep one exact pitch apart (its centre is
 * rounded once and its integer offsets added after), so no cell in an island sits a point off
 * its neighbours.
 */
export function cellRects(layout: MapLayout, geo: MapGeometry): CellRects {
  const inset = (geo.pitch - geo.cell) / 2;
  const x: number[] = [];
  const y: number[] = [];
  const folderX = layout.folders.map((f) => Math.round(f.ox * geo.pitch));
  const folderY = layout.folders.map((f) => Math.round(f.oy * geo.pitch));
  for (const c of layout.cells) {
    const f = layout.folders[c.folder]!;
    const dx = Math.round(c.x - f.ox);
    const dy = Math.round(c.y - f.oy);
    x.push(geo.ox + folderX[c.folder]! + dx * geo.pitch - Math.floor(geo.pitch / 2) + Math.floor(inset));
    y.push(geo.oy + folderY[c.folder]! + dy * geo.pitch - Math.floor(geo.pitch / 2) + Math.floor(inset));
  }
  return { x, y, size: geo.cell };
}

/**
 * The cell under a finger. Cells are small, so a tap anywhere within `reach` points of a
 * cell's centre counts, nearest first; a tap in open water is nothing.
 */
export function hitTest(rects: CellRects, px: number, py: number, reach: number): number | null {
  let best: number | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  const limit = reach * reach;
  const half2 = rects.size / 2;
  for (let i = 0; i < rects.x.length; i++) {
    const dx = rects.x[i]! + half2 - px;
    const dy = rects.y[i]! + half2 - py;
    const d = dx * dx + dy * dy;
    // Strictly nearer only, so a tie keeps the lower index.
    if (d <= limit && d < bestD) {
      best = i;
      bestD = d;
    }
  }
  return best;
}

// ------------------------------------------------------------------ labels

/**
 * An island is named by its role only when it is big enough to carry a word (LABEL_MIN_CELLS
 * cells) and the role is most of it; each role word appears once, on its biggest island, so
 * the labels read as landmarks ("test", "docs") rather than "source" on every island. At most
 * LABEL_MAX. All UNMEASURED JUDGEMENT CALLS.
 */
export const LABEL_MIN_CELLS = 5;
export const LABEL_MAX = 5;

export interface MapLabel {
  folder: number;
  role: PlainRole;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * Where each role label goes: centred under its island, else over it, never on a cell,
 * another label or past the canvas edge; a label with no room is left out. `measure` is the
 * label's width in points for its text.
 */
export function placeLabels(
  layout: MapLayout,
  geo: MapGeometry,
  rects: CellRects,
  measure: (role: PlainRole) => number,
  height: number,
): MapLabel[] {
  const cellBoxes: Box[] = rects.x.map((x, i) => ({ x, y: rects.y[i]!, width: rects.size, height: rects.size }));
  const order = layout.folders
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => f.cells.length >= LABEL_MIN_CELLS && f.roleCount * 2 > f.cells.length)
    .sort((a, b) => b.f.cells.length - a.f.cells.length || a.i - b.i);
  const used = new Set<PlainRole>();
  const placed: MapLabel[] = [];
  for (const { f, i } of order) {
    if (placed.length >= LABEL_MAX) break;
    if (used.has(f.role)) continue;
    let top = Number.POSITIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    let left = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    for (const ci of f.cells) {
      top = Math.min(top, rects.y[ci]!);
      bottom = Math.max(bottom, rects.y[ci]! + rects.size);
      left = Math.min(left, rects.x[ci]!);
      right = Math.max(right, rects.x[ci]! + rects.size);
    }
    const width = Math.ceil(measure(f.role));
    const x = Math.round(Math.min(Math.max(0, (left + right) / 2 - width / 2), geo.width - width));
    const spots = [bottom + 2, top - height - 2];
    for (const y of spots) {
      const box = { x, y: Math.round(y), width, height };
      if (box.y < 0 || box.y + height > geo.height) continue;
      if (cellBoxes.some((c) => overlaps(c, box)) || placed.some((p) => overlaps(p, box))) continue;
      placed.push({ folder: i, role: f.role, ...box });
      used.add(f.role);
      break;
    }
  }
  return placed;
}

/**
 * Where every mark of a session strip goes, at one width, for every way the phone draws it: the
 * SVG strip (`TimelineStrip.tsx`, the card, the feed, the recap sheet) and the drawn on strip
 * (`StripDraw.tsx`, the session page and the Sessions list). One function, so two drawings of one
 * session can never disagree about its shape.
 *
 * It was the body of `TimelineStrip`'s memo, moved here unchanged for the three presets that
 * existed (`sparkline`, `row`, `hero`), with one preset added: `mini`, the hero's bars at a list
 * row's size, so a row in the Sessions list shows the rhythm of the sitting (burst, pause, burst)
 * rather than a flat band of colour.
 *
 * Pure: no React Native, so `bun test` holds it.
 */

import { DENSITY_ALPHAS, MARK_DEDUPE_MIN_PX, StripClass } from '../generated/strip';
import { colors, type Scheme } from '../theme';
import { classShare, decodeStrip, layoutMarks, resampleColumns, type Mark } from './decode';

export type Preset = 'sparkline' | 'row' | 'mini' | 'hero';

/** Geometry of a preset that draws bars: a lane of your moves, a gap, then the agent's activity. */
export interface BarGeometry {
  moves: number;
  gap: number;
  activity: number;
  baseline: number;
  /** Bars are averaged to about this many points wide. */
  bar: number;
  /** Width of one of your moves in the lane above. */
  mark: number;
}

/** Hero geometry: a thin lane of your moves, a gap, then the agent's activity. */
export const HERO: BarGeometry = { moves: 12, gap: 5, activity: 46, baseline: 1, bar: 3, mark: 3 };

/** The hero at a list row's size: the same rhythm in 30 points. */
export const MINI: BarGeometry = { moves: 5, gap: 3, activity: 21, baseline: 1, bar: 2, mark: 1.5 };

export const TRACK_HEIGHT: Record<Preset, number> = {
  sparkline: 8,
  row: 12,
  mini: MINI.moves + MINI.gap + MINI.activity + MINI.baseline,
  hero: 72,
};

/**
 * The track's clipping radius. None on the bar presets: their moves lane runs to both ends, and a
 * mark at the first or last moment sits in the corner a radius clips, so it was drawn at half its
 * width with a rounded top (FOUND IN THE DEFECTS PASS, 2026-09-14: the first mark of Sessions rows
 * and of the session page's strip), and the end bars lost a corner. A floor a point tall needs none.
 */
export const CORNER: Record<Preset, number> = { sparkline: 2, row: 3, mini: 0, hero: 0 };

/**
 * How tall an activity bar stands, per density bucket.
 *
 * The old hero painted every non-idle column full height and varied only the alpha, so a
 * 72-minute session was a solid amber block with a few slightly paler stripes: nothing to
 * read. Height carries the density instead, idle draws nothing at all, and the rhythm of
 * the session (burst, pause, burst) is the shape you see.
 */
export const DENSITY_HEIGHT = [0.34, 0.58, 0.8, 1.0];

export interface StripRect {
  x: number;
  w: number;
  y: number;
  h: number;
  fill: string;
  opacity: number;
}

export interface StripLayout {
  rects: StripRect[];
  marks: StripRect[];
  /** The floor the bars stand on (bar presets only). */
  floor: StripRect | null;
  height: number;
  label: string;
}

export function geometryOf(preset: Preset): BarGeometry | null {
  return preset === 'hero' ? HERO : preset === 'mini' ? MINI : null;
}

/** The strip at `width`, as rectangles. A malformed strip is an empty track, never a throw. */
export function layoutStrip(
  cols: string,
  marks: readonly Mark[],
  spanMs: number,
  preset: Preset,
  scheme: Scheme,
  width: number,
): StripLayout {
  const height = TRACK_HEIGHT[preset];
  let bytes: Uint8Array;
  try {
    bytes = decodeStrip(cols);
  } catch {
    // A malformed strip must degrade to an empty track, never crash a feed row.
    return { rects: [], marks: [], floor: null, height, label: 'Session timeline unavailable' };
  }
  const palette = colors(scheme);
  const g = geometryOf(preset);

  // One rect per pixel column would be ~400 nodes per row. Runs of the same colour are merged
  // instead, which on a real session is an order of magnitude fewer: the strip is mostly long
  // stretches of agent work broken by idle. The bar presets average into bars about `g.bar`
  // points wide, which is what makes the burst and pause rhythm legible; the row and sparkline
  // presets stay per point, where they are only ever a texture.
  const target = g ? Math.max(1, Math.round(width / g.bar)) : Math.max(1, Math.round(width));
  const columns = resampleColumns(bytes, target);
  const colWidth = width / columns.length;

  const activityTop = g ? g.moves + g.gap : 0;
  const activityH = g ? g.activity : 0;

  const merged: StripRect[] = [];
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i]!;
    // Idle is the absence of work. With bars it draws nothing, so a pause is a real gap above
    // the baseline rather than a darker shade of busy.
    if (g && col.klass === StripClass.idle) continue;

    const fill = palette.strip[col.klass];
    const opacity = g
      ? 1
      : col.klass === StripClass.idle
        ? 1
        : (DENSITY_ALPHAS[preset === 'sparkline' ? (col.density >= 2 ? DENSITY_ALPHAS.length - 1 : 0) : col.density] ?? 1);

    // With bars a prompting column is a full height tick: seconds of typing next to an hour of
    // agent work would otherwise round away to nothing.
    const frac = g ? (col.klass === StripClass.prompting ? 1 : (DENSITY_HEIGHT[col.density] ?? 1)) : 1;
    const h = g ? Math.max(2, activityH * frac) : height;
    const y = g ? activityTop + (activityH - h) : 0;

    const last = merged[merged.length - 1];
    if (last && last.fill === fill && last.opacity === opacity && last.y === y && last.h === h) {
      last.w += colWidth;
    } else {
      merged.push({ x: i * colWidth, w: colWidth, y, h, fill, opacity });
    }
  }

  const laid = preset === 'sparkline' || spanMs <= 0 ? [] : layoutMarks([...marks], spanMs, width, MARK_DEDUPE_MIN_PX);

  // Your moves ride in their own lane above the activity, so a prompt is never buried under the
  // agent run it started.
  const markWidth = g ? g.mark : 1.5;
  const markRects: StripRect[] = laid.map((m) => ({
    x: Math.max(0, Math.min(width - markWidth, m.x - markWidth / 2)),
    w: markWidth,
    y: 0,
    h: g ? g.moves : height,
    fill: palette.mark[m.kind],
    opacity: 1,
  }));

  // The floor the activity stands on. Without it a long pause reads as a missing strip rather
  // than as quiet.
  const floor: StripRect | null = g
    ? { x: 0, w: width, y: g.moves + g.gap + g.activity, h: g.baseline, fill: palette.strip[StripClass.idle], opacity: 1 }
    : null;

  const share = classShare(columns);
  const pct = (v: number) => Math.round(v * 100);
  const label =
    `Session timeline: ${pct(share[StripClass.agent])} percent agent working, ` +
    `${pct(share[StripClass.prompting])} percent prompting, ` +
    `${pct(share[StripClass.human_edit])} percent your edits, ` +
    `${pct(share[StripClass.idle])} percent idle. ${marks.length} prompts.`;

  return { rects: merged, marks: markRects, floor, height, label };
}

/**
 * The key under a strip: each class with its share of the session, said so a share that rounds
 * to zero is "under 1%" (ten typed prompts inside 72 minutes really are under half a percent of
 * the strip, and "0%" would claim they never happened). Null shares when the strip is malformed.
 */
export interface LegendEntry {
  klass: StripClass;
  label: string;
  share: string | null;
}

const LEGEND: readonly { klass: StripClass; label: string }[] = [
  { klass: StripClass.agent, label: 'agent working' },
  { klass: StripClass.prompting, label: 'you prompting' },
  { klass: StripClass.human_edit, label: 'your edits' },
  { klass: StripClass.idle, label: 'idle' },
];

export function legendOf(cols: string | null | undefined): LegendEntry[] {
  let shares: Record<StripClass, number> | null = null;
  if (cols) {
    try {
      shares = classShare(Array.from(decodeStrip(cols), (b) => ({ klass: (b & 0b11) as StripClass, density: (b >> 2) & 0b11 })));
    } catch {
      shares = null;
    }
  }
  return LEGEND.map(({ klass, label }) => {
    const raw = shares ? shares[klass] * 100 : null;
    const share = raw === null ? null : raw > 0 && raw < 1 ? 'under 1%' : `${Math.round(raw)}%`;
    return { klass, label, share };
  });
}

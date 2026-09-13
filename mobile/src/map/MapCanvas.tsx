/**
 * The codebase map, drawn in Skia on the warm ground, full bleed: the page's hero chart (Strava's
 * rule, design-md/fitness/strava: the map carries the page). One square cell per file on the
 * islands `layout.ts` places (the layout, its determinism and its tests are unchanged), each in
 * the hue of its kind of file (`paint.ROLE_HUE`), filled where the agent changed it and hollow
 * where it only read, bright and glowing in the working set and cooling as the agent moves on.
 *
 * Layers, bottom up:
 *
 *   the sea      react-bits DotGrid (the port in `ui/bits/backgrounds`), in the session's hue: a
 *                3 pt dot every 12 pt that develops in Bayer order as the block arrives and that a
 *                tap shoves outward. Each island paints its own ground over the dots as it blooms,
 *                so the repository is a shape cut out of a dotted sea.
 *   the path     the last six files it touched, joined in order in the session's hue over a dark
 *                casing (Strava's halo under the route), round caps and joins. Wandering draws
 *                long strides between islands; circling draws a tight loop. On the time lapse it
 *                is the trail, thinning back from the head by ShapeGrid's rule.
 *   the glow     a Skia blur under every cell in the working set: soft for a read, more for a
 *                change, most for the file it is changing now.
 *   the cells    bloom in from the top of the repository outward (the sandpile's waves, four
 *                discrete sizes, a bright release beat); flip over when a refresh changes their
 *                heat or the replay first touches them (the braille flipwave).
 *   the knot     the files it keeps rewriting, in the session's hue, breathing a seventh larger
 *                every PULSE_MS, closed into a loop, with square rings going out from it on
 *                MagicRings' cycle. Reduce Motion: outlined and still.
 *   the end      when a replay lands: PixelBlast's ripple crosses the map from the burst, lit
 *                through the Bayer matrix, and each burst file throws ClickSpark's pixel sparks.
 *   the finger   a tap picks the nearest cell (a thumb is wider than a cell): corner ticks,
 *                a selection tick, and ClickSpark's sparks from it in its hue.
 *
 * One `Picture` recorded on the UI thread from shared values: the reveal clock, the pulse, the
 * glide, a refresh's flips and the playhead. Nothing re-renders React while it moves, and once
 * the draw on has landed a map with no knot records nothing until something changes.
 */
import { useIsFocused } from '@react-navigation/native';
import { BlurStyle, Canvas, createPicture, PaintStyle, Picture, Skia, StrokeCap, StrokeJoin, type SkMaskFilter } from '@shopify/react-native-skia';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import type { PlainRole } from '../generated/live';
import { type } from '../insights/kit';
import { ease, phase } from '../insights/motion';
import { GROUND, type HueName } from '../insights/palette';
import { useClock } from '../insights/reveal';
import { DotGrid, type FieldPoint } from '../ui/bits/backgrounds';
import { SparkBurst } from '../ui/bits/effects';
import { sparkPixel, type SparkShape } from '../ui/bits/effects/spark';
import { select } from '../ui/haptics';
import { timing, useReduceMotion } from '../ui/motion';
import { frameAt, replayCursor, replayFailing, replayLevel, type Replay } from './heat';
import { cellRects, fitGeometry, hitTest, placeLabels, type MapLayout } from './layout';
import {
  bayer8,
  bloomDelays,
  bloomEnd,
  bloomFlash,
  bloomSize,
  bloomWaves,
  CELL_MS,
  centreOf,
  FAIL_INK,
  FLIP_MS,
  FLIP_WAVE_MS,
  flipAt,
  glowOf,
  PATH_FILES,
  pathWidth,
  RING_CYCLE_S,
  RING_REACH,
  RING_STROKE,
  ringAt,
  RIPPLE,
  rippleAt,
  rippleLit,
  ROLE_HUE,
  roleInk,
  SLOT_INK,
  TRAIL_BACK,
  TRAIL_MS,
  trailAt,
  trailFade,
  trailStrength,
} from './paint';
import { REPLAY_MS, roleWord } from './view';

/** Room round the shape inside the canvas, points: the rings and the sparks fly into it. */
export const MAP_MARGIN = 22;

/** One breath of the knot: the brief's "pulse only those, 2s". */
export const PULSE_MS = 2000;

/** A refresh's layout change settles like SNAP (DESIGN-DIRECTION 3.5: settle, layout): 400ms. */
export const GLIDE_MS = 400;

/** The end of a replay: the ripple, the sparks and the pop, ms. `pop` runs 0 to 1 over this. */
export const POP_MS = 1400;

/** When the map starts blooming on its block's clock: after the sea has developed. */
export const BLOOM_AT = 420;

/** How long the live path takes to trace on after the last cell lands. */
const PATH_MS = 700;
/** How long ClickSpark's sparks fly at the end, and the burst cells' pop. */
const SPARK_MS = 460;
const POP_GROW_MS = 380;

/** How far a tap may land from a cell and still pick it: half a 44pt tap target. */
const TAP_REACH = 22;

/** The role label's line: the `label` type, 12pt at 1.25. */
const LABEL_HEIGHT = 15;

/** A conservative width for a label at 12pt semibold: labels are placed before they are drawn. */
function measureLabel(role: PlainRole): number {
  return roleWord(role).length * 6.8 + 2;
}

/** The session's hue: the builder's accent (`theme/accent.tsx`), which the knot and the path wear. */
export interface SessionHue {
  name: HueName;
  ink: string;
  partner: string;
}

export interface MapCanvasProps {
  layout: MapLayout;
  /** The canvas: the screen's width, full bleed. */
  width: number;
  /** The tallest the canvas may be. */
  maxHeight: number;
  hue: SessionHue;
  /** The live map: one level per cell. */
  levels?: readonly number[];
  /** The time lapse: levels come from the replay at `playhead` seconds of `span`. */
  replay?: Replay | null;
  playhead?: SharedValue<number>;
  span?: number;
  /** Cells that pulse. */
  knot: readonly number[];
  /** The replay's knot pulses only while the playhead is inside this stretch, seconds. */
  knotWindow?: { from: number; to: number } | null;
  /** The live map's cursor; the replay finds its own. */
  cursor?: number | null;
  /** The live map's path, oldest first (`paint.recentPath`); the replay draws its own trail. */
  path?: readonly number[];
  /** Cells that throw sparks when `pop` runs 0 to 1, and where the ripple starts. */
  burst?: readonly number[];
  pop?: SharedValue<number>;
  selected?: number | null;
  onSelect?: (cell: number | null) => void;
  /** Place role labels on the biggest islands. */
  labels?: boolean;
  accessibilityLabel: string;
  accessibilityHint?: string;
}

const NONE: readonly number[] = [];

export function MapCanvas({
  layout,
  width,
  maxHeight,
  hue,
  levels,
  replay = null,
  playhead,
  span = 0,
  knot,
  knotWindow = null,
  cursor = null,
  path,
  burst,
  pop,
  selected = null,
  onSelect,
  labels = true,
  accessibilityLabel,
  accessibilityHint,
}: MapCanvasProps) {
  const clock = useClock();
  const reduce = useReduceMotion();

  const geo = useMemo(() => fitGeometry(layout, width, maxHeight, MAP_MARGIN), [layout, width, maxHeight]);
  const rects = useMemo(() => cellRects(layout, geo), [layout, geo]);
  const placed = useMemo(
    () => (labels ? placeLabels(layout, geo, rects, measureLabel, LABEL_HEIGHT) : []),
    [labels, layout, geo, rects],
  );

  // ---------------------------------------------------------------- the bloom
  const delays = useMemo(() => bloomDelays(bloomWaves(layout), BLOOM_AT), [layout]);
  const landed = useMemo(() => bloomEnd(delays), [delays]);
  const sea = useDerivedValue(() => ease(phase(clock.value, 0, 520)));

  // ---------------------------------------------------------------- the inks
  // A small palette and an index per cell, so the worklet turns a dozen strings into colours
  // per frame rather than four hundred.
  const inks = useMemo(() => {
    const palette: string[] = [];
    const at = new Map<string, number>();
    const put = (hex: string) => {
      let i = at.get(hex);
      if (i === undefined) {
        i = palette.length;
        palette.push(hex);
        at.set(hex, i);
      }
      return i;
    };
    const ink = layout.cells.map((c) => put(roleInk(c.role).ink));
    const partner = layout.cells.map((c) => put(roleInk(c.role).partner));
    return {
      palette,
      ink,
      partner,
      slot: put(SLOT_INK),
      fail: put(FAIL_INK),
      accent: put(hue.ink),
      text: put(GROUND.text),
      bg: put(GROUND.bg),
      dim: put(GROUND.dim),
    };
  }, [layout, hue.ink]);

  // ---------------------------------------------------------------- the glide
  // Where each cell was last drawn, by file id, so a refresh that moves an island glides it.
  const drawn = useRef<{ pos: Map<string, [number, number]>; size: number } | null>(null);
  const from = useMemo(() => {
    const prev = drawn.current;
    const fx: number[] = [];
    const fy: number[] = [];
    layout.cells.forEach((cell, i) => {
      const was = prev?.pos.get(cell.id);
      fx.push(was ? was[0] : rects.x[i]!);
      fy.push(was ? was[1] : rects.y[i]!);
    });
    return { x: fx, y: fy, size: prev?.size ?? rects.size };
  }, [layout, rects]);
  const glide = useSharedValue(1);
  useEffect(() => {
    const moved = from.x.some((x, i) => x !== rects.x[i] || from.y[i] !== rects.y[i]) || from.size !== rects.size;
    drawn.current = { pos: new Map(layout.cells.map((cell, i) => [cell.id, [rects.x[i]!, rects.y[i]!]])), size: rects.size };
    if (!moved || reduce) {
      glide.value = 1;
      return;
    }
    glide.value = 0;
    glide.value = withTiming(1, timing(GLIDE_MS));
  }, [from, rects, layout, reduce, glide]);

  // ---------------------------------------------------------------- a refresh's flips
  // A cell whose heat changed since the last refresh turns over to show the new one, left to
  // right across the map, a few hundredths of a second apart (the flipwave's column stagger).
  const seen = useRef<Map<string, number> | null>(null);
  const flipFrom = useMemo(() => {
    const prev = seen.current;
    return layout.cells.map((c, i) => {
      const was = prev?.get(c.id);
      const now = levels?.[i];
      return was !== undefined && now !== undefined && was !== now ? was : -1;
    });
  }, [layout, levels]);
  const flipDelay = useMemo(() => rects.x.map((x) => (x / Math.max(1, geo.width)) * FLIP_WAVE_MS), [rects, geo.width]);
  const flipT = useSharedValue(FLIP_MS + FLIP_WAVE_MS);
  useEffect(() => {
    seen.current = new Map(layout.cells.map((c, i) => [c.id, levels?.[i] ?? 0]));
    if (!levels || reduce || !flipFrom.some((v) => v >= 0)) return;
    flipT.value = 0;
    flipT.value = withTiming(FLIP_MS + FLIP_WAVE_MS, { duration: FLIP_MS + FLIP_WAVE_MS, easing: Easing.linear });
  }, [flipFrom, layout, levels, reduce, flipT]);

  // ---------------------------------------------------------------- the pulse
  // Only while the screen is the one on top: a pulse under another screen redraws for nobody.
  const focused = useIsFocused();
  const breath = useSharedValue(0);
  const rings = useSharedValue(0);
  const pulsing = knot.length > 0 && !reduce && focused;
  useEffect(() => {
    if (!pulsing) {
      cancelAnimation(breath);
      cancelAnimation(rings);
      breath.value = 0;
      rings.value = 0;
      return;
    }
    breath.value = 0;
    breath.value = withRepeat(withTiming(1, { duration: PULSE_MS / 2, easing: Easing.inOut(Easing.sin) }), -1, true);
    // Four ring cycles a lap, so the lap's restart at 0 lands on a cycle boundary.
    rings.value = 0;
    rings.value = withRepeat(withTiming(RING_CYCLE_S * 4, { duration: RING_CYCLE_S * 4000, easing: Easing.linear }), -1, false);
    return () => {
      cancelAnimation(breath);
      cancelAnimation(rings);
    };
  }, [pulsing, breath, rings]);

  // ---------------------------------------------------------------- what the worklet reads
  const n = layout.cells.length;
  const isKnot = useMemo(() => {
    const out = new Array<boolean>(n).fill(false);
    for (const k of knot) if (k >= 0 && k < n) out[k] = true;
    return out;
  }, [knot, n]);
  const knotList = useMemo(() => knot.filter((k) => k >= 0 && k < n), [knot, n]);
  const isBurst = useMemo(() => {
    const out = new Array<boolean>(n).fill(false);
    for (const k of burst ?? NONE) if (k >= 0 && k < n) out[k] = true;
    return out;
  }, [burst, n]);
  const burstList = useMemo(() => (burst ?? NONE).filter((k) => k >= 0 && k < n), [burst, n]);
  const burstMid = useMemo(() => centreOf(burstList, rects), [burstList, rects]);
  const pathList = useMemo(() => (path ?? NONE).filter((k) => k >= 0 && k < n), [path, n]);
  const still = useMemo(() => levels?.slice() ?? new Array<number>(n).fill(0), [levels, n]);
  const lattice = useMemo(
    () => ({ col: rects.x.map((x) => Math.round(x / geo.pitch)), row: rects.y.map((y) => Math.round(y / geo.pitch)) }),
    [rects, geo.pitch],
  );
  const knotSpan = useMemo(
    () => (knotWindow ? [knotWindow.from, knotWindow.to] : null),
    [knotWindow],
  );
  const sparkShape: SparkShape = useMemo(
    () => ({ count: 8, sizePt: Math.max(2, Math.min(4, Math.round(geo.pitch * 0.22))), lengthPt: 0, radiusPt: Math.max(14, geo.pitch * 1.5) }),
    [geo.pitch],
  );
  const W = geo.width;
  const H = geo.height;
  const pitch = geo.pitch;
  const toX = rects.x;
  const toY = rects.y;
  const toS = rects.size;
  const gap = Math.max(1, pitch - toS);
  const pw = pathWidth(pitch);
  const msPerSec = replay && span > 0 ? REPLAY_MS / span : 0;
  const zero = useSharedValue(0);
  const head = playhead ?? zero;
  const popper = pop ?? zero;
  const pick = selected ?? -1;
  const liveCursor = cursor ?? -1;
  const flashRole = replay === null;

  const picture = useDerivedValue(() => {
    const t = clock.value;
    const g = glide.value;
    const br = breath.value;
    const rs = rings.value;
    const up = popper.value;
    const tau = head.value;
    const ft = flipT.value;
    const k = replay ? frameAt(replay.t, tau) : -1;
    const knotOn = knotSpan === null || (tau >= knotSpan[0]! && tau <= knotSpan[1]!);
    const at = replay ? replayCursor(replay, k) : liveCursor;
    const col = inks.palette.map((h) => Skia.Color(h));
    const size = from.size + (toS - from.size) * g;
    const count = toX.length;
    const popMs = up * POP_MS;
    const popGrow = up > 0 && up < 1 ? Math.sin(Math.PI * phase(popMs, 0, POP_GROW_MS)) : 0;

    const px = (i: number) => from.x[i]! + (toX[i]! - from.x[i]!) * g;
    const py = (i: number) => from.y[i]! + (toY[i]! - from.y[i]!) * g;

    // The replay's trail: [cell, frame, ...], newest first, and each trail cell's light.
    const trail = replay ? trailAt(replay, k, PATH_FILES, TRAIL_BACK) : NONE;
    const lit = new Array<number>(count).fill(0);
    if (replay && msPerSec > 0) {
      for (let q = 0; q < trail.length; q += 2) {
        const age = (tau - replay.t[trail[q + 1]!]!) * msPerSec;
        lit[trail[q]!] = trailFade(age, TRAIL_MS);
      }
    }

    return createPicture(
      (canvas) => {
        const fill = Skia.Paint();
        fill.setAntiAlias(true);
        const line = Skia.Paint();
        line.setAntiAlias(true);
        line.setStyle(PaintStyle.Stroke);
        line.setStrokeCap(StrokeCap.Round);
        line.setStrokeJoin(StrokeJoin.Round);

        // ------------------------------------------------ each island's ground over the sea
        fill.setColor(col[inks.bg]!);
        for (let i = 0; i < count; i++) {
          if (phase(t, delays[i]!, CELL_MS) <= 0) continue;
          canvas.drawRect(Skia.XYWHRect(px(i) - gap, py(i) - gap, size + gap * 2, size + gap * 2), fill);
        }

        // ------------------------------------------------ the path, under the cells
        const stroke = (pts: number[], widths: number[], closed: boolean, ink: number) => {
          // A dark casing first (Strava's halo, turned for a dark map), then the line.
          for (let pass = 0; pass < 2; pass++) {
            line.setColor(col[pass === 0 ? inks.bg : ink]!);
            for (let s = 0; s + 3 < pts.length; s += 2) {
              line.setStrokeWidth(widths[s / 2]! + (pass === 0 ? 3 : 0));
              canvas.drawLine(pts[s]!, pts[s + 1]!, pts[s + 2]!, pts[s + 3]!, line);
            }
            if (closed && pts.length >= 6) {
              line.setStrokeWidth(widths[0]! + (pass === 0 ? 3 : 0));
              canvas.drawLine(pts[pts.length - 2]!, pts[pts.length - 1]!, pts[0]!, pts[1]!, line);
            }
          }
        };
        const mid = (i: number): [number, number] => [px(i) + size / 2, py(i) + size / 2];

        if (replay) {
          // The trail, from the oldest of the six to the head, thinning back (ShapeGrid).
          const m = trail.length / 2;
          if (m >= 2) {
            const pts: number[] = [];
            const widths: number[] = [];
            for (let j = m - 1; j >= 0; j--) {
              const [x, y] = mid(trail[j * 2]!);
              pts.push(x, y);
              if (j < m - 1) widths.push(pw * (0.3 + 0.7 * trailStrength(j, m - 1)));
            }
            stroke(pts, widths, false, inks.accent);
          }
        } else if (pathList.length >= 2) {
          // The live path traces on from its oldest file once the map has landed.
          const trace = ease(phase(t, landed, PATH_MS));
          if (trace > 0) {
            const all: number[] = [];
            for (const c of pathList) {
              const [x, y] = mid(c);
              all.push(x, y);
            }
            let total = 0;
            for (let s = 0; s + 3 < all.length; s += 2) total += Math.hypot(all[s + 2]! - all[s]!, all[s + 3]! - all[s + 1]!);
            let left = total * trace;
            const pts: number[] = [all[0]!, all[1]!];
            const widths: number[] = [];
            for (let s = 0; s + 3 < all.length && left > 0; s += 2) {
              const dx = all[s + 2]! - all[s]!;
              const dy = all[s + 3]! - all[s + 1]!;
              const len = Math.hypot(dx, dy);
              const f = len > 0 ? Math.min(1, left / len) : 1;
              pts.push(all[s]! + dx * f, all[s + 1]! + dy * f);
              widths.push(pw);
              left -= len;
            }
            if (pts.length >= 4) stroke(pts, widths, false, inks.accent);
          }
        }

        // The knot, closed into a loop, while it is on and its files are lit.
        let knotLit = knotOn && knotList.length > 0;
        for (const c of knotList) {
          if (phase(t, delays[c]!, CELL_MS) < 1) knotLit = false;
          if (replay && replayLevel(replay, k, c) === 0) knotLit = false;
        }
        if (knotLit && knotList.length >= 2) {
          const pts: number[] = [];
          const widths: number[] = [];
          for (const c of knotList) {
            const [x, y] = mid(c);
            pts.push(x, y);
            widths.push(pw);
          }
          stroke(pts, widths, knotList.length >= 3, inks.accent);
        }

        // Pixels from here on: square corners on every outline.
        line.setStrokeCap(StrokeCap.Butt);
        line.setStrokeJoin(StrokeJoin.Miter);

        // ------------------------------------------------ the glow, under the cells
        const blurs: (SkMaskFilter | null)[] = [null, null, null];
        const blurFor = (step: number) => {
          if (!blurs[step]) blurs[step] = Skia.MaskFilter.MakeBlur(BlurStyle.Normal, Math.max(1.5, pitch * (0.3 + step * 0.18)), true);
          return blurs[step]!;
        };
        for (let i = 0; i < count; i++) {
          if (phase(t, delays[i]!, CELL_MS) < 1) continue;
          const lv = replay ? replayLevel(replay, k, i) : still[i]!;
          if (lv === 0) continue;
          const knotted = isKnot[i]! && knotOn;
          let glow = glowOf(lv) + lit[i]! * 0.45;
          if (knotted) glow = Math.max(glow, pulsing ? 0.55 + 0.45 * br : 0.7);
          if (glow <= 0.2) continue;
          const step = glow >= 0.95 ? 2 : glow >= 0.6 ? 1 : 0;
          const grow = pitch * (0.12 + step * 0.12);
          fill.setMaskFilter(blurFor(step));
          fill.setColor(col[knotted ? inks.accent : inks.ink[i]!]!);
          canvas.drawRect(Skia.XYWHRect(px(i) - grow, py(i) - grow, size + grow * 2, size + grow * 2), fill);
        }
        fill.setMaskFilter(null);

        // ------------------------------------------------ the cells
        for (let i = 0; i < count; i++) {
          const a = phase(t, delays[i]!, CELL_MS);
          if (a <= 0) continue;
          const lv = replay ? replayLevel(replay, k, i) : still[i]!;
          const failing = replay ? replayFailing(replay, k, i) : false;
          let face = lv;
          let tall = 1;
          let dip = 1;
          if (!reduce) {
            if (replay) {
              const first = replay.firstTouch[i]!;
              if (first <= k && msPerSec > 0) {
                const age = (tau - replay.t[first]!) * msPerSec;
                if (age < FLIP_MS) {
                  const f = flipAt(age / FLIP_MS);
                  tall = f[0];
                  dip = f[2];
                  if (f[1] === 0) face = 0;
                }
              }
            } else if (flipFrom[i]! >= 0) {
              const p = phase(ft, flipDelay[i]!, FLIP_MS);
              if (p < 1) {
                const f = flipAt(p);
                tall = f[0];
                dip = f[2];
                if (f[1] === 0) face = flipFrom[i]!;
              }
            }
          }
          const knotted = isKnot[i]! && knotOn && lv > 0;
          let s = size * bloomSize(a) * dip;
          if (knotted && pulsing) s *= 1 + 0.14 * br;
          if (isBurst[i] && popGrow > 0) s *= 1 + 0.25 * popGrow;
          const w = s;
          const h = s * tall;
          const cx = px(i) + size / 2;
          const cy = py(i) + size / 2;
          const x = cx - w / 2;
          const y = cy - h / 2;

          if (bloomFlash(a)) {
            fill.setColor(col[flashRole ? inks.ink[i]! : inks.dim]!);
            canvas.drawRect(Skia.XYWHRect(x, y, w, h), fill);
            continue;
          }
          if (knotted) {
            fill.setColor(col[inks.accent]!);
            canvas.drawRect(Skia.XYWHRect(x, y, w, h), fill);
            continue;
          }
          if (failing && face > 0) {
            fill.setColor(col[inks.fail]!);
            canvas.drawRect(Skia.XYWHRect(x, y, w, h), fill);
            continue;
          }
          if (face >= 3) {
            // Changed: filled, the partner once it has moved on, the ink while it is warm.
            fill.setColor(col[face === 3 ? inks.partner[i]! : inks.ink[i]!]!);
            canvas.drawRect(Skia.XYWHRect(x, y, w, h), fill);
            continue;
          }
          // Only read, or not touched yet: hollow. Under 8 points a hollow square is a smudge,
          // so it is a small filled square instead.
          const ink = face === 0 ? inks.slot : face === 1 ? inks.partner[i]! : inks.ink[i]!;
          if (s < 8) {
            const q = s * (face === 0 ? 0.34 : 0.5);
            fill.setColor(col[ink]!);
            canvas.drawRect(Skia.XYWHRect(cx - q / 2, cy - (q * tall) / 2, q, q * tall), fill);
          } else {
            const sw = face === 0 ? 1 : Math.max(1.5, Math.round(s * 0.16 * 2) / 2);
            line.setStrokeWidth(sw);
            line.setColor(col[ink]!);
            canvas.drawRect(Skia.XYWHRect(x + sw / 2, y + sw / 2, Math.max(0, w - sw), Math.max(0, h - sw)), line);
          }
        }

        // ------------------------------------------------ the knot's rings (MagicRings)
        if (knotLit) {
          let l = Number.POSITIVE_INFINITY;
          let tp = Number.POSITIVE_INFINITY;
          let r = Number.NEGATIVE_INFINITY;
          let b = Number.NEGATIVE_INFINITY;
          for (const c of knotList) {
            l = Math.min(l, px(c));
            tp = Math.min(tp, py(c));
            r = Math.max(r, px(c) + size);
            b = Math.max(b, py(c) + size);
          }
          if (pulsing) {
            const cx = (l + r) / 2;
            const cy = (tp + b) / 2;
            const base = Math.max(r - l, b - tp) / 2 + pitch * 0.35;
            line.setColor(col[inks.accent]!);
            for (let ri = 0; ri < 3; ri++) {
              const ring = ringAt(rs, ri);
              const sw = RING_STROKE * ring[1];
              if (sw < 0.3) continue;
              const hh = base + ring[0] * RING_REACH * pitch;
              line.setStrokeWidth(sw);
              canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(cx - hh, cy - hh, hh * 2, hh * 2), pitch * 0.35, pitch * 0.35), line);
            }
          } else {
            // Still: each knot file outlined in the session's hue.
            line.setColor(col[inks.accent]!);
            line.setStrokeWidth(1.5);
            for (const c of knotList) canvas.drawRect(Skia.XYWHRect(px(c) - 2.25, py(c) - 2.25, size + 4.5, size + 4.5), line);
          }
        }

        // ------------------------------------------------ the file it is on
        line.setColor(col[inks.text]!);
        line.setStrokeWidth(1.5);
        if (at >= 0 && at < count && phase(t, delays[at]!, CELL_MS) >= 1) {
          canvas.drawRect(Skia.XYWHRect(px(at) - 2.25, py(at) - 2.25, size + 4.5, size + 4.5), line);
        }

        // ------------------------------------------------ the ripple at the end (PixelBlast)
        const rt = popMs / 1000;
        if (burstMid && up > 0 && up < 1 && rt < RIPPLE.lifeS) {
          fill.setColor(col[inks.text]!);
          for (let i = 0; i < count; i++) {
            const dx = px(i) + size / 2 - burstMid[0];
            const dy = py(i) + size / 2 - burstMid[1];
            const feed = rippleAt(Math.sqrt(dx * dx + dy * dy) / Math.max(1, H), rt);
            if (!rippleLit(feed, bayer8(lattice.col[i]!, lattice.row[i]!))) continue;
            canvas.drawRect(Skia.XYWHRect(px(i), py(i), size, size), fill);
          }
        }

        // ------------------------------------------------ the burst's sparks (ClickSpark)
        const e = ease(phase(popMs, 0, SPARK_MS));
        if (up > 0 && e > 0 && e < 1) {
          for (const c of burstList) {
            const cx = px(c) + size / 2;
            const cy = py(c) + size / 2;
            fill.setColor(col[inks.ink[c]!]!);
            for (let j = 0; j < sparkShape.count; j++) {
              const q = sparkPixel(j, e, sparkShape);
              if (q[2] <= 0) continue;
              canvas.drawRect(Skia.XYWHRect(cx + q[0] - q[2] / 2, cy + q[1] - q[2] / 2, q[2], q[2]), fill);
            }
          }
        }

        // ------------------------------------------------ the picked cell: four corner ticks
        if (pick >= 0 && pick < count) {
          const x = px(pick) - 4;
          const y = py(pick) - 4;
          const edge = size + 8;
          const tk = Math.max(3, Math.min(6, edge / 4));
          const tick = Skia.Path.Make();
          tick.moveTo(x, y + tk).lineTo(x, y).lineTo(x + tk, y);
          tick.moveTo(x + edge - tk, y).lineTo(x + edge, y).lineTo(x + edge, y + tk);
          tick.moveTo(x + edge, y + edge - tk).lineTo(x + edge, y + edge).lineTo(x + edge - tk, y + edge);
          tick.moveTo(x + tk, y + edge).lineTo(x, y + edge).lineTo(x, y + edge - tk);
          line.setColor(col[inks.text]!);
          line.setStrokeWidth(2);
          canvas.drawPath(tick, line);
        }
      },
      { width: W, height: H },
    );
  }, [
    replay,
    still,
    isKnot,
    isBurst,
    knotList,
    burstList,
    burstMid,
    pathList,
    from,
    toX,
    toY,
    toS,
    W,
    H,
    knotSpan,
    pick,
    liveCursor,
    pulsing,
    delays,
    landed,
    inks,
    flipFrom,
    flipDelay,
    lattice,
    sparkShape,
    msPerSec,
    reduce,
    flashRole,
  ]);

  // ---------------------------------------------------------------- the finger
  const [spark, setSpark] = useState<{ x: number; y: number; key: number; hue: HueName }>({ x: 0, y: 0, key: 0, hue: hue.name });
  const pickAt = useCallback(
    (x: number, y: number) => {
      if (!onSelect) return;
      const hit = hitTest(rects, x, y, Math.max(TAP_REACH, geo.pitch));
      if (hit !== null && hit !== selected) {
        select();
        const role = layout.cells[hit]!.role;
        setSpark((s) => ({ x: rects.x[hit]! + rects.size / 2, y: rects.y[hit]! + rects.size / 2, key: s.key + 1, hue: ROLE_HUE[role] ?? hue.name }));
      }
      onSelect(hit === selected ? null : hit);
    },
    [onSelect, rects, geo.pitch, selected, layout, hue.name],
  );
  const onTap = useCallback((p: FieldPoint) => pickAt(p.x, p.y), [pickAt]);
  const onPress = useCallback((e: GestureResponderEvent) => pickAt(e.nativeEvent.locationX, e.nativeEvent.locationY), [pickAt]);

  const labelsIn = useAnimatedStyle(() => ({ opacity: ease(phase(clock.value, landed, 320)) }));

  const body = (
    <>
      {/* The sea: react-bits DotGrid in the session's hue. It takes the taps while it can shove. */}
      <DotGrid width={W} height={H} hue={hue.name} reveal={sea} interactive={!reduce && Boolean(onSelect)} onTap={onTap} />
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { width: W, height: H }]}>
        <Canvas style={{ width: W, height: H }}>
          <Picture picture={picture} />
        </Canvas>
      </View>
      {placed.length ? (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { width: W, height: H }, labelsIn]}>
          {placed.map((l) => (
            <Text
              key={l.folder}
              allowFontScaling={false}
              numberOfLines={1}
              style={[type.label, styles.label, { left: l.x, top: l.y, width: l.width, color: roleInk(l.role).ink }]}
            >
              {roleWord(l.role)}
            </Text>
          ))}
        </Animated.View>
      ) : null}
      <SparkBurst x={spark.x} y={spark.y} playKey={spark.key} hue={spark.hue} variant="pixel" radius={Math.max(18, geo.pitch * 1.4)} />
    </>
  );

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel} accessibilityHint={accessibilityHint} style={{ width: W, height: H }}>
      {reduce && onSelect ? (
        // Under Reduce Motion the dots hold still and take no touch, so a press picks instead.
        <Pressable onPress={onPress} style={{ width: W, height: H }}>
          {body}
        </Pressable>
      ) : (
        body
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { position: 'absolute', textAlign: 'center' },
});

/**
 * The codebase map, drawn in Skia: one square cell per file on the islands `layout.ts` places,
 * each cell a step of the amber ramp `heat.ts` picks.
 *
 * One `Picture` recorded on the UI thread from shared values, so the pulse, the glide and the
 * replay never re-render React: the live map draws once per refresh (and every frame only
 * while a knot pulses or the islands glide); the time lapse draws every frame it plays.
 *
 *   knot     the files it keeps rewriting pulse between amber and bright amber, one breath
 *            every PULSE_MS; under Reduce Motion they hold bright and outlined, and nothing moves
 *   cursor   the file the agent is on: a 1.5pt outline in `text`, the only outline besides the
 *            still knot, never amber (an amber outline is the tinted chip the brief bans)
 *   glide    a refresh that moves islands (a new folder, a folder that grew) glides each cell
 *            from where it was over GLIDE_MS, so a file keeps its identity on screen; new cells
 *            simply appear. Reduce Motion: it lands
 *   pop      the burst at the end of the time lapse: its cells grow a quarter and settle, once
 *   select   a tap picks the nearest cell (a thumb is wider than a cell) and marks it with four
 *            corner ticks; the screen says what happened to that file
 */
import { useIsFocused } from '@react-navigation/native';
import { Canvas, createPicture, PaintStyle, Picture, Skia } from '@shopify/react-native-skia';
import React, { useEffect, useMemo, useRef } from 'react';
import { Pressable, View, type GestureResponderEvent } from 'react-native';
import {
  cancelAnimation,
  Easing,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { ROLE_NOUN } from '../copy/plain';
import type { PlainRole } from '../generated/live';
import { select, T, timing, useColors, useReduceMotion } from '../ui';
import { frameAt, LEVEL_EDIT, LEVEL_HOT, replayCursor, replayFailing, replayLevel, type Replay } from './heat';
import { cellRects, fitGeometry, hitTest, placeLabels, type MapLayout } from './layout';

/** Room round the shape inside the canvas, points. */
export const MAP_MARGIN = 12;

/** One breath of the knot: the brief's "pulse only those, 2s". */
export const PULSE_MS = 2000;

/** A refresh's layout change settles like SNAP (DESIGN-DIRECTION 3.5: settle, layout): 400ms. */
export const GLIDE_MS = 400;

/** How far a tap may land from a cell and still pick it: half a 44pt tap target. */
const TAP_REACH = 22;

/** The role label's line: the `label` type role, 12pt at 1.2. */
const LABEL_HEIGHT = 15;

/** A role label's words: the engine's collective noun without its article ("test suite"). */
export function mapRoleWord(role: PlainRole): string {
  return ROLE_NOUN[role][2].replace(/^(the|your) /, '');
}

/** A conservative width for a label at 12pt semibold: labels are placed before they are drawn. */
function measureLabel(role: PlainRole): number {
  return mapRoleWord(role).length * 6.8 + 2;
}

export interface MapCanvasProps {
  layout: MapLayout;
  /** The column the map sits in, points. */
  width: number;
  /** The tallest the canvas may be. */
  maxHeight: number;
  /** The live map: one level per cell. */
  levels?: readonly number[];
  /** The time lapse: levels come from the replay at `playhead` seconds. */
  replay?: Replay | null;
  playhead?: SharedValue<number>;
  /** Cells that pulse. */
  knot: readonly number[];
  /** The replay's knot pulses only while the playhead is inside this stretch, seconds. */
  knotWindow?: { from: number; to: number } | null;
  /** The live map's cursor; the replay finds its own. */
  cursor?: number | null;
  /** Cells that pop when `pop` runs 0, 1, 0. */
  burst?: readonly number[];
  pop?: SharedValue<number>;
  selected?: number | null;
  onSelect?: (cell: number | null) => void;
  /** Place role labels on the biggest islands. */
  labels?: boolean;
  accessibilityLabel: string;
  accessibilityHint?: string;
}

export function MapCanvas({
  layout,
  width,
  maxHeight,
  levels,
  replay = null,
  playhead,
  knot,
  knotWindow = null,
  cursor = null,
  burst,
  pop,
  selected = null,
  onSelect,
  labels = true,
  accessibilityLabel,
  accessibilityHint,
}: MapCanvasProps) {
  const c = useColors();
  const reduce = useReduceMotion();

  const geo = useMemo(() => fitGeometry(layout, width, maxHeight, MAP_MARGIN), [layout, width, maxHeight]);
  const rects = useMemo(() => cellRects(layout, geo), [layout, geo]);
  const placed = useMemo(
    () => (labels ? placeLabels(layout, geo, rects, measureLabel, LABEL_HEIGHT) : []),
    [labels, layout, geo, rects],
  );

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

  // ---------------------------------------------------------------- the pulse
  // Only while the screen is the one on top: a pulse under another screen redraws for nobody.
  const focused = useIsFocused();
  const pulse = useSharedValue(0);
  const pulsing = knot.length > 0 && !reduce && focused;
  useEffect(() => {
    if (!pulsing) {
      cancelAnimation(pulse);
      pulse.value = 0;
      return;
    }
    pulse.value = 0;
    pulse.value = withRepeat(withTiming(1, { duration: PULSE_MS / 2, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => cancelAnimation(pulse);
  }, [pulsing, pulse]);

  // ---------------------------------------------------------------- what the worklet reads
  const isKnot = useMemo(() => {
    const out = new Array<boolean>(layout.cells.length).fill(false);
    for (const k of knot) if (k >= 0 && k < out.length) out[k] = true;
    return out;
  }, [knot, layout]);
  const isBurst = useMemo(() => {
    const out = new Array<boolean>(layout.cells.length).fill(false);
    for (const k of burst ?? []) if (k >= 0 && k < out.length) out[k] = true;
    return out;
  }, [burst, layout]);
  const still = useMemo(() => levels?.slice() ?? new Array<number>(layout.cells.length).fill(0), [levels, layout]);
  const palette = c.graph.slice();
  const ink = { text: c.text, fail: c.data.del };
  const W = geo.width;
  const H = geo.height;
  const toX = rects.x;
  const toY = rects.y;
  const toS = rects.size;
  const knotFrom = knotWindow?.from ?? null;
  const knotTo = knotWindow?.to ?? null;
  const knotSpan = useMemo(() => (knotFrom === null || knotTo === null ? null : [knotFrom, knotTo]), [knotFrom, knotTo]);
  const zero = useSharedValue(0);
  const head = playhead ?? zero;
  const popper = pop ?? zero;
  const pick = selected ?? -1;
  const liveCursor = cursor ?? -1;

  const picture = useDerivedValue(() => {
    const g = glide.value;
    const p = pulse.value;
    const up = popper.value;
    const tau = head.value;
    const k = replay ? frameAt(replay.t, tau) : -1;
    const knotOn = knotSpan === null || (tau >= knotSpan[0]! && tau <= knotSpan[1]!);
    const at = replay ? replayCursor(replay, k) : liveCursor;
    const colors = palette.map((h) => Skia.Color(h));
    const failColor = Skia.Color(ink.fail);
    const textColor = Skia.Color(ink.text);
    const size = from.size + (toS - from.size) * g;
    return createPicture(
      (canvas) => {
        const paint = Skia.Paint();
        const n = toX.length;
        for (let i = 0; i < n; i++) {
          let x = from.x[i]! + (toX[i]! - from.x[i]!) * g;
          let y = from.y[i]! + (toY[i]! - from.y[i]!) * g;
          let s = size;
          if (up > 0 && isBurst[i]) {
            const grow = s * 0.25 * up;
            x -= grow / 2;
            y -= grow / 2;
            s += grow;
          }
          const lv = replay ? replayLevel(replay, k, i) : still[i]!;
          const knotted = isKnot[i] && knotOn && lv > 0;
          if (knotted && pulsing) {
            // One breath: amber to bright amber and a seventh larger, and back.
            const breath = s * 0.14 * p;
            x -= breath / 2;
            y -= breath / 2;
            s += breath;
          }
          paint.setAlphaf(1);
          if (replay && replayFailing(replay, k, i)) paint.setColor(failColor);
          else paint.setColor(colors[knotted ? (pulsing ? LEVEL_EDIT : LEVEL_HOT) : lv]!);
          canvas.drawRect(Skia.XYWHRect(x, y, s, s), paint);
          if (knotted && pulsing) {
            paint.setColor(colors[LEVEL_HOT]!);
            paint.setAlphaf(p);
            canvas.drawRect(Skia.XYWHRect(x, y, s, s), paint);
            paint.setAlphaf(1);
          }
        }
        // Outlines: the cursor, and the knot when it cannot pulse.
        const stroke = Skia.Paint();
        stroke.setStyle(PaintStyle.Stroke);
        stroke.setStrokeWidth(1.5);
        stroke.setColor(textColor);
        const outline = (i: number) => {
          const x = from.x[i]! + (toX[i]! - from.x[i]!) * g;
          const y = from.y[i]! + (toY[i]! - from.y[i]!) * g;
          canvas.drawRect(Skia.XYWHRect(x - 2.25, y - 2.25, size + 4.5, size + 4.5), stroke);
        };
        if (at >= 0 && at < n) outline(at);
        if (!pulsing && knotOn) {
          for (let i = 0; i < n; i++) if (isKnot[i] && i !== at) outline(i);
        }
        // The selection: four corner ticks just outside the cell.
        if (pick >= 0 && pick < n) {
          const x = toX[pick]! - 4;
          const y = toY[pick]! - 4;
          const e = toS + 8;
          const t = Math.max(3, Math.min(6, e / 4));
          const tick = Skia.Path.Make();
          tick.moveTo(x, y + t).lineTo(x, y).lineTo(x + t, y);
          tick.moveTo(x + e - t, y).lineTo(x + e, y).lineTo(x + e, y + t);
          tick.moveTo(x + e, y + e - t).lineTo(x + e, y + e).lineTo(x + e - t, y + e);
          tick.moveTo(x + t, y + e).lineTo(x, y + e).lineTo(x, y + e - t);
          stroke.setStrokeWidth(2);
          canvas.drawPath(tick, stroke);
        }
      },
      { width: W, height: H },
    );
  }, [replay, still, isKnot, isBurst, from, toX, toY, toS, W, H, knotSpan, pick, liveCursor, pulsing]);

  const onPress = (e: GestureResponderEvent) => {
    if (!onSelect) return;
    const hit = hitTest(rects, e.nativeEvent.locationX, e.nativeEvent.locationY, Math.max(TAP_REACH, geo.pitch));
    if (hit !== null && hit !== selected) select();
    onSelect(hit === selected ? null : hit);
  };

  return (
    <Pressable
      onPress={onSelect ? onPress : undefined}
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      style={{ width: W, height: H }}
    >
      <Canvas style={{ width: W, height: H }}>
        <Picture picture={picture} />
      </Canvas>
      {placed.length ? (
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: W, height: H }}>
          {placed.map((l) => (
            <T
              key={l.folder}
              role="label"
              tone="dim"
              align="center"
              numberOfLines={1}
              style={{ position: 'absolute', left: l.x, top: l.y, width: l.width }}
            >
              {mapRoleWord(l.role)}
            </T>
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}

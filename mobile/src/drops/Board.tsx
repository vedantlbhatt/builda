/**
 * The board: every drop you have shared, laid out by what it is about, on a dotted field you
 * pan and zoom. The owner asked for "a mind map kinda thing" with "auto clustering", and this is
 * it: `cluster.ts` decides what belongs together, `layout.ts` decides where, and this draws it.
 *
 * WHAT IS DRAWN, bottom up:
 *
 *   the field    dots on a 24 unit lattice, in the ground's border grey, PART OF THE MAP: they
 *                pan and scale with it, so the dots are paper rather than wallpaper and the
 *                distance between two drops is always legible against them.
 *   the threads  each member tied to its cluster's hub, in the cluster's hue at a hairline. Drawn
 *                under the nodes, so a sigil always sits on top of its own thread.
 *   the sigils   each drop's generated pixel glyph (`sigil.ts`), in its kind's hue. An unread
 *                drop is drawn in the warm grey: colour on this board always means something was
 *                understood.
 *   the words    hub labels, and each drop's title once you are zoomed in past `TITLE_SCALE`.
 *                React Native text over the canvas, sharing the same transform.
 *
 * ONE PICTURE, ONE TRANSFORM. The whole board is recorded once, in board coordinates, and the
 * pan and the pinch move a Skia `Group` around it on the UI thread. Nothing re-renders while you
 * move, so a hundred drops pan at the same cost as three.
 *
 * TAPPING A DROP ZOOMS THE MAP TO IT rather than pushing a screen (the owner: "it zooms in on
 * the reel"). The same shared values the gesture writes are the ones the zoom animates, so the
 * two can never fight over the transform, and the detail opens anchored on the node that is now
 * in the middle of the screen.
 *
 * NO GRADIENTS ANYWHERE, and no box whose fill, border and text are three tints of one hue: the
 * hue is the ink of the mark, the ground is the ground, and the words are the warm greys.
 */
import { Canvas, createPicture, Group, PaintStyle, Picture, Skia, StrokeCap } from '@shopify/react-native-skia';
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { dropHue, type Hue } from '../theme';
import { T } from '../ui/Text';
import { useColors } from '../ui/scheme';
import { board as clusterBoard, type Cluster } from './cluster';
import { fit, focus, layout, type Board as BoardShape, type Placed } from './layout';
import { cells as sigilCells, grow, SIZE as SIGIL_SIZE } from './sigil';
import type { DropRow, MoveRow } from './types';

/** Points per board unit at scale 1. A node is one unit, so this is a sigil's side. */
export const UNIT = 46;
/** Board units between dots on the field. */
const DOT_PITCH = 0.5;
const DOT_R = 0.028;
/** Past this scale, every drop shows its title. Below it, the hub words carry the map. */
export const TITLE_SCALE = 1.15;
/** Where a tap lands you. Far enough in that the drop fills the eye, not so far that its
 * neighbours vanish and you lose where you were. */
export const ZOOM_SCALE = 2.1;
const MIN_SCALE = 0.35;
const MAX_SCALE = 3.5;
/** A tap has to land within this many units of a node's centre to count as that node. A thumb
 * is wider than a sigil, so this is generous and the nearest one wins. */
const TAP_RADIUS = 0.9;

export interface BoardProps {
  drops: DropRow[];
  moves: MoveRow[];
  /** Which drop is open, or null. The board zooms to it and dims everything else. */
  selected: string | null;
  onSelect: (id: string | null) => void;
}

export function DropsBoard({ drops, moves, selected, onSelect }: BoardProps) {
  const c = useColors();
  const { width, height } = useWindowDimensions();
  const viewport = useMemo(() => ({ width, height }), [width, height]);

  const clusters: Cluster[] = useMemo(
    () =>
      clusterBoard(
        drops.map((d) => ({
          kind: d.kind,
          title: d.title,
          summary: d.summary,
          tags: d.resolution?.plan?.tags ?? [],
        })),
      ),
    [drops],
  );
  const shape: BoardShape = useMemo(() => layout(clusters), [clusters]);

  const start = useMemo(() => fit(shape.extent, viewport, UNIT), [shape.extent, viewport]);
  const scale = useSharedValue(start.scale);
  const tx = useSharedValue(start.x);
  const ty = useSharedValue(start.y);
  const savedScale = useSharedValue(start.scale);
  const savedX = useSharedValue(start.x);
  const savedY = useSharedValue(start.y);
  const [zoomed, setZoomed] = useState(start.scale >= TITLE_SCALE);

  /** Which drops are running something: the one motion allowed on the board. */
  const running = useMemo(() => {
    const ids = new Set<string>();
    for (const m of moves) if (m.status === 'running' || m.status === 'queued') ids.add(m.drop_id);
    return ids;
  }, [moves]);

  const picture = useMemo(
    () => record(shape, drops, running, c, selected),
    [shape, drops, running, c, selected],
  );

  const tap = useCallback(
    (px: number, py: number) => {
      // Screen back to board units, then the nearest node inside the thumb's reach.
      const bx = (px - tx.value) / (UNIT * scale.value);
      const by = (py - ty.value) / (UNIT * scale.value);
      let best: Placed | null = null;
      let bestD = TAP_RADIUS;
      for (const n of shape.nodes) {
        const d = Math.hypot(n.x - bx, n.y - by);
        if (d < bestD) {
          bestD = d;
          best = n;
        }
      }
      if (!best) {
        onSelect(null);
        return;
      }
      const target = focus(best, viewport, UNIT, ZOOM_SCALE);
      scale.value = withTiming(target.scale, { duration: 420 });
      tx.value = withTiming(target.x, { duration: 420 });
      ty.value = withTiming(target.y, { duration: 420 });
      savedScale.value = target.scale;
      savedX.value = target.x;
      savedY.value = target.y;
      setZoomed(true);
      onSelect(drops[best.index]?.id ?? null);
    },
    [drops, onSelect, savedScale, savedX, savedY, scale, shape.nodes, tx, ty, viewport],
  );

  const pan = Gesture.Pan()
    .averageTouches(true)
    .onUpdate((e) => {
      tx.value = savedX.value + e.translationX;
      ty.value = savedY.value + e.translationY;
    })
    .onEnd(() => {
      savedX.value = tx.value;
      savedY.value = ty.value;
    });

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, savedScale.value * e.scale));
      // Zoom about the fingers, not the origin, or the board slides out from under the pinch.
      const k = next / scale.value;
      tx.value = e.focalX - (e.focalX - tx.value) * k;
      ty.value = e.focalY - (e.focalY - ty.value) * k;
      scale.value = next;
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      savedX.value = tx.value;
      savedY.value = ty.value;
      runOnJS(setZoomed)(scale.value >= TITLE_SCALE);
    });

  const single = Gesture.Tap()
    .maxDuration(300)
    .onEnd((e) => {
      runOnJS(tap)(e.x, e.y);
    });

  const gesture = Gesture.Simultaneous(Gesture.Race(single, pan), pinch);

  const groupTransform = useDerivedValue(() => [
    { translateX: tx.value },
    { translateY: ty.value },
    { scale: scale.value },
  ]);

  const wordsStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <View style={[styles.fill, { backgroundColor: c.surface.bg }]}>
        <Canvas style={styles.fill}>
          <Group transform={groupTransform}>
            <Picture picture={picture} />
          </Group>
        </Canvas>
        {/* Words ride the same transform. `pointerEvents none`: the canvas underneath owns
            every touch, so a label can never swallow a tap meant for the node it names. */}
        <Animated.View style={[styles.words, wordsStyle]} pointerEvents="none">
          {shape.hubs.map((h) => (
            <T
              key={`hub.${h.cluster}`}
              role="label"
              style={[
                styles.hubWord,
                {
                  left: h.x * UNIT - 60,
                  top: (h.y - (h.radius || 0.62) - 0.55) * UNIT,
                  color: c.surface.textDim,
                },
              ]}
            >
              {h.label.toUpperCase()}
            </T>
          ))}
          {zoomed
            ? shape.nodes.map((n) => {
                const d = drops[n.index];
                if (!d) return null;
                return (
                  <T
                    key={`title.${d.id}`}
                    role="meta"
                    numberOfLines={2}
                    style={[
                      styles.nodeWord,
                      {
                        left: n.x * UNIT - 56,
                        top: n.y * UNIT + UNIT * 0.56,
                        color: selected === d.id ? c.surface.text : c.surface.textDim,
                      },
                    ]}
                  >
                    {d.title ?? hostOf(d.url)}
                  </T>
                );
              })
            : null}
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

/** The host, for a drop nobody has read yet: something true to print before the title exists. */
export function hostOf(url: string): string {
  const m = /^https:\/\/([^/]+)/.exec(url);
  return (m?.[1] ?? url).replace(/^www\./, '');
}

/**
 * Record the whole board once, in board units multiplied up by UNIT.
 *
 * Everything that moves is the Group's transform, so this runs when the DROPS change and never
 * while a finger is down.
 */
function record(
  shape: BoardShape,
  drops: DropRow[],
  running: Set<string>,
  c: ReturnType<typeof useColors>,
  selected: string | null,
) {
  const { minX, minY, maxX, maxY } = shape.extent;
  return createPicture((canvas) => {
    const dot = Skia.Paint();
    dot.setAntiAlias(true);
    dot.setColor(Skia.Color(c.surface.border));

    // The field. One extra pitch each way so the dots run under everything rather than stopping
    // at the bounding box of the drops, which would draw the box.
    for (let x = Math.floor(minX) - 2; x <= Math.ceil(maxX) + 2; x += DOT_PITCH) {
      for (let y = Math.floor(minY) - 2; y <= Math.ceil(maxY) + 2; y += DOT_PITCH) {
        canvas.drawCircle(x * UNIT, y * UNIT, DOT_R * UNIT, dot);
      }
    }

    // Threads, under the sigils.
    const thread = Skia.Paint();
    thread.setStyle(PaintStyle.Stroke);
    thread.setStrokeWidth(1);
    thread.setStrokeCap(StrokeCap.Round);
    thread.setAntiAlias(true);
    for (const n of shape.nodes) {
      if (n.isHub) continue;
      const hub = shape.hubs[n.cluster];
      if (!hub) continue;
      const d = drops[n.index];
      const hue = d?.kind ? dropHue(d.kind) : null;
      thread.setColor(Skia.Color(hue?.partner ?? c.surface.border));
      canvas.drawLine(hub.x * UNIT, hub.y * UNIT, n.x * UNIT, n.y * UNIT, thread);
    }

    // Sigils.
    const cell = Skia.Paint();
    cell.setAntiAlias(false);
    const ring = Skia.Paint();
    ring.setStyle(PaintStyle.Stroke);
    ring.setStrokeWidth(1.5);
    ring.setAntiAlias(true);

    for (const n of shape.nodes) {
      const d = drops[n.index];
      if (!d) continue;
      const hue: Hue | null = d.kind ? dropHue(d.kind) : null;
      const ink = hue?.ink ?? c.surface.textFaint;
      const partner = hue?.partner ?? c.surface.border;
      const grid = grow(d.url);
      const unit = UNIT / SIGIL_SIZE;
      const ox = n.x * UNIT - UNIT / 2;
      const oy = n.y * UNIT - UNIT / 2;
      // A drop whose Mac has not read it yet is drawn at half its cells, so a waiting board
      // looks like a board that is still filling in rather than a board of grey squares.
      const partial = d.status === 'waiting' || d.status === 'resolving';
      const list = sigilCells(grid);
      const upto = partial ? Math.ceil(list.length * 0.55) : list.length;
      for (let i = 0; i < upto; i++) {
        const s = list[i];
        cell.setColor(Skia.Color(s.tone === 1 ? ink : partner));
        canvas.drawRect(
          Skia.XYWHRect(ox + s.c * unit, oy + s.r * unit, unit + 0.5, unit + 0.5),
          cell,
        );
      }
      // The two states worth marking on the map itself: the one you have open, and the ones
      // with work in flight. Both are a ring, which is the only shape here that is not a pixel.
      if (selected === d.id) {
        ring.setColor(Skia.Color(ink));
        canvas.drawCircle(n.x * UNIT, n.y * UNIT, UNIT * 0.78, ring);
      } else if (running.has(d.id)) {
        ring.setColor(Skia.Color(c.surface.accent));
        canvas.drawCircle(n.x * UNIT, n.y * UNIT, UNIT * 0.68, ring);
      }
    }
  });
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  words: { ...StyleSheet.absoluteFillObject },
  hubWord: {
    position: 'absolute',
    width: 120,
    textAlign: 'center',
    letterSpacing: 1.4,
  },
  nodeWord: {
    position: 'absolute',
    width: 112,
    textAlign: 'center',
  },
});

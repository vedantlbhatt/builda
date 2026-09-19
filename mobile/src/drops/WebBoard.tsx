/**
 * The board: every drop you have shared, as a web.
 *
 * WHAT THIS REPLACED, and why, twice.
 *
 * The first board was one generated pixel glyph per drop on a dotted field. The glyphs were the
 * problem — a mark grown from a URL tells you nothing about the post — and in removing them I also
 * removed the field, which was not the problem. The second board was a wall of piles with a
 * PILES / GRID switch, and it lost the one thing the clustering actually knows: how MUCH two drops
 * have to do with each other. A pile says "these four are about garlic" and cannot say that two of
 * them are nearly the same video, or that the fifth nearly belongs. Two ways to look at a wall is
 * also not a feature; it is a decision handed back to the person twice a day.
 *
 * So: nodes and strands, settled by forces (`force.ts`), with the reel's own frame as the node.
 * Things that belong together end up near each other because something pulled them there, and you
 * can see the strand that did it. There is one view and no switch.
 *
 * WHAT YOUR HANDS DO. Drag the background to pan and pinch to zoom, which is what every map has
 * taught everyone. Drag a NODE and it comes with your finger while the web reorganises live around
 * it — the simulation only runs while you are holding something, so the board is still when you
 * are reading it and alive when you are not. Let go and it settles. Tap a node to open the drop.
 *
 * Nothing here draws a gradient, a chip, or a box whose fill, border and text are three tints of
 * one hue.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Line } from 'react-native-svg';

import { T } from '../ui/Text';
import { select } from '../ui/haptics';
import { useColors } from '../ui/scheme';
import { board as clusterBoard, similarityMatrix, type Cluster } from './cluster';
import {
  boundsOf,
  edgesOf,
  FORCE,
  NODE_H,
  NODE_W,
  seedRing,
  separate,
  settle,
  step,
  type Edge,
  type Node,
} from './force';
import { WebNode } from './WebNode';
import type { DropRow, MoveRow } from './types';

const AnimatedLine = Animated.createAnimatedComponent(Line);

/** Every node's place, shared with the UI thread so a drag does not re-render React at 60fps. */
type Places = { x: number; y: number }[];

export interface WebBoardProps {
  drops: DropRow[];
  moves: MoveRow[];
  onOpenCard: (id: string) => void;
  /** Rows the search narrowed to, or null for all of them. Narrowing DIMS, it does not remove. */
  only?: Set<string> | null;
}

export function DropsWeb({ drops, moves, onOpenCard, only = null }: WebBoardProps) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  const busy = useMemo(() => {
    const ids = new Set<string>();
    for (const m of moves) if (m.status === 'running' || m.status === 'queued') ids.add(m.drop_id);
    return ids;
  }, [moves]);

  const clusterable = useMemo(
    () =>
      drops.map((d) => ({
        kind: d.kind,
        title: d.title,
        summary: d.summary,
        tags: d.resolution?.plan?.tags ?? [],
      })),
    [drops],
  );

  /**
   * The web's shape. Computed once per SET of drops, not per render: settling is a few hundred
   * ticks and re-running it because a move changed status would make the board twitch.
   */
  const key = useMemo(() => drops.map((d) => d.id).join(','), [drops]);
  const { edges, start, groups } = useMemo(() => {
    const sim = similarityMatrix(clusterable);
    const e = edgesOf(sim);
    const n = settle(seedRing(drops.length), e);
    return { edges: e, start: n, groups: clusterBoard(clusterable) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  /** The live simulation, and the places the views read. */
  const sim = useRef<Node[]>(start);
  const places = useSharedValue<Places>(start.map((p) => ({ x: p.x, y: p.y })));
  useEffect(() => {
    sim.current = start;
    places.value = start.map((p) => ({ x: p.x, y: p.y }));
    setSettled(start.map((p) => ({ x: p.x, y: p.y })));
  }, [start, places]);

  /** A copy in React state, for the things that only need to know where the web ended up. */
  const [settledAt, setSettled] = useState<Places>(() => start.map((p) => ({ x: p.x, y: p.y })));

  // ─────────────────────────────────────────────────────────── the camera
  /**
   * Where the camera starts: the whole web on screen, centred on what is actually there.
   *
   * Centred on the web's BOUNDS and not on the origin. Gravity pulls every node toward the middle
   * but the mass is never symmetric — one big cluster on the left and two singletons on the right
   * settles with its middle well off the origin — so a board centred on the origin opens with the
   * web pushed into a corner and empty space opposite it.
   */
  /** MEASURED, not derived. The board's height is the screen less a header and a tab bar whose
   *  heights this component has no business knowing, and a guess at them is a guess at the zoom. */
  const [view, setView] = useState({ w: width, h: height * 0.6 });

  const fitted = useMemo(() => {
    const b = boundsOf(start);
    // Room for the frame itself, and for a cluster's word, which hangs above and to both sides of
    // the nodes it names. Without it the words are the thing that ends up cut off the edge.
    const padX = NODE_W / 2 + REGION_W / 2;
    const padY = NODE_H / 2 + 40;
    const w = b.maxX - b.minX + padX * 2;
    const h = b.maxY - b.minY + padY * 2;
    const s = Math.min(1.15, Math.min(view.w / Math.max(1, w), view.h / Math.max(1, h)));
    return {
      scale: Math.max(0.4, s),
      cx: (b.minX + b.maxX) / 2,
      cy: (b.minY + b.maxY) / 2 - 8,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, view.w, view.h]);

  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const scale = useSharedValue(fitted.scale);
  const startTx = useSharedValue(0);
  const startTy = useSharedValue(0);
  const startScale = useSharedValue(1);

  useEffect(() => {
    scale.value = withTiming(fitted.scale, { duration: 260 });
    tx.value = withTiming(-fitted.cx * fitted.scale, { duration: 260 });
    ty.value = withTiming(-fitted.cy * fitted.scale, { duration: 260 });
  }, [fitted, scale, tx, ty]);

  const pan = Gesture.Pan()
    .averageTouches(true)
    .onBegin(() => {
      startTx.value = tx.value;
      startTy.value = ty.value;
    })
    .onUpdate((e) => {
      tx.value = startTx.value + e.translationX;
      ty.value = startTy.value + e.translationY;
    });

  const pinch = Gesture.Pinch()
    .onBegin(() => {
      startScale.value = scale.value;
    })
    .onUpdate((e) => {
      scale.value = Math.max(0.3, Math.min(2.4, startScale.value * e.scale));
    });

  const camera = Gesture.Simultaneous(pan, pinch);

  const world = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  // ───────────────────────────────────────────────── the web, while held
  const frame = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
  const holding = useRef<number | null>(null);

  const run = useCallback(() => {
    const tick = () => {
      step(sim.current, edges);
      places.value = sim.current.map((p) => ({ x: p.x, y: p.y }));
      frame.current = requestAnimationFrame(tick);
    };
    if (frame.current == null) frame.current = requestAnimationFrame(tick);
  }, [edges, places]);

  const stop = useCallback(() => {
    if (frame.current != null) cancelAnimationFrame(frame.current);
    frame.current = null;
    setSettled(sim.current.map((p) => ({ x: p.x, y: p.y })));
  }, []);

  useEffect(() => () => stop(), [stop]);

  const grab = useCallback(
    (i: number) => {
      holding.current = i;
      const p = sim.current[i];
      if (p) p.pinned = true;
      run();
    },
    [run],
  );

  const move = useCallback((i: number, x: number, y: number) => {
    const p = sim.current[i];
    if (!p) return;
    p.x = x;
    p.y = y;
  }, []);

  const drop = useCallback(
    (i: number) => {
      const p = sim.current[i];
      if (p) p.pinned = false;
      holding.current = null;
      // Let it fall into place rather than stopping dead, then rest.
      let left = 90;
      const ease = () => {
        step(sim.current, edges);
        places.value = sim.current.map((q) => ({ x: q.x, y: q.y }));
        if (--left > 0) {
          frame.current = requestAnimationFrame(ease);
        } else {
          separate(sim.current, FORCE.floor);
          places.value = sim.current.map((q) => ({ x: q.x, y: q.y }));
          stop();
        }
      };
      if (frame.current != null) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(ease);
    },
    [edges, places, stop],
  );

  const open = useCallback(
    (i: number) => {
      const d = drops[i];
      if (d) onOpenCard(d.id);
    },
    [drops, onOpenCard],
  );

  return (
    <GestureDetector gesture={camera}>
      <View
        style={styles.fill}
        collapsable={false}
        onLayout={(e) => {
          const { width: w, height: h } = e.nativeEvent.layout;
          setView((was) => (Math.abs(was.w - w) < 1 && Math.abs(was.h - h) < 1 ? was : { w, h }));
        }}
      >
        <Animated.View style={[styles.world, world]} pointerEvents="box-none">
          {/* The strands, under everything.
              A FIXED, HUGE CANVAS rather than an auto sized one. A node's place is relative to
              the middle of the web and is routinely negative, and an `Svg` clips to its own box
              whatever `overflow` says — so half the strands simply were not drawn. This box is
              `SKY` across with the origin at its centre, which is far larger than any web a phone
              will hold, and every coordinate is offset into it. */}
          <Svg width={SKY} height={SKY} viewBox={`0 0 ${SKY} ${SKY}`} style={styles.strands} pointerEvents="none">
            {edges.map((e) => (
              <Strand
                key={`${e.a}.${e.b}`}
                edge={e}
                places={places}
                ink={c.textFaint}
                lit={!only || (!!drops[e.a] && only.has(drops[e.a]!.id) && !!drops[e.b] && only.has(drops[e.b]!.id))}
              />
            ))}
          </Svg>

          {/* The cluster's own word, at the middle of where its drops ended up. Behind the nodes,
              in the display face, low enough in contrast to read as a region and not as a label. */}
          {groups.map((g) => (
            <Region key={`${g.label}.${g.size}`} group={g} at={settledAt} ink={c.text} />
          ))}

          {drops.map((d, i) => (
            <NodeView
              key={d.id}
              index={i}
              drop={d}
              busy={busy.has(d.id)}
              dim={!!only && !only.has(d.id)}
              places={places}
              scale={scale}
              onGrab={grab}
              onMove={move}
              onDrop={drop}
              onOpen={open}
            />
          ))}
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

/** One strand, following both its ends. */
function Strand({
  edge,
  places,
  ink,
  lit,
}: {
  edge: Edge;
  places: Animated.SharedValue<Places>;
  ink: string;
  lit: boolean;
}) {
  const props = useAnimatedProps(() => {
    const a = places.value[edge.a];
    const b = places.value[edge.b];
    return {
      x1: MID + (a?.x ?? 0) + HALF,
      y1: MID + (a?.y ?? 0) + HALF_H,
      x2: MID + (b?.x ?? 0) + HALF,
      y2: MID + (b?.y ?? 0) + HALF_H,
    };
  });
  // A stronger resemblance is a brighter strand. Weight, never colour: colour on this board means
  // what KIND a drop is, and one thing may only mean one thing.
  const alpha = (lit ? 1 : 0.15) * (0.3 + Math.min(1, Math.max(0, edge.w)) * 0.55);
  return (
    <AnimatedLine
      animatedProps={props}
      stroke={ink}
      strokeOpacity={alpha}
      strokeWidth={0.6 + edge.w * 1.6}
      strokeLinecap="round"
    />
  );
}

const HALF = NODE_W / 2;
const HALF_H = NODE_H / 2;
/** How wide a cluster's word may run before it wraps. */
const REGION_W = 190;
/** The strand canvas, and the offset that puts the web's origin at the middle of it. */
const SKY = 4000;
const MID = SKY / 2;

/** One node: a frame that follows the simulation, can be dragged, and opens on a tap. */
function NodeView({
  index,
  drop,
  busy,
  dim,
  places,
  scale,
  onGrab,
  onMove,
  onDrop,
  onOpen,
}: {
  index: number;
  drop: DropRow;
  busy: boolean;
  dim: boolean;
  places: Animated.SharedValue<Places>;
  scale: Animated.SharedValue<number>;
  onGrab: (i: number) => void;
  onMove: (i: number, x: number, y: number) => void;
  onDrop: (i: number) => void;
  onOpen: (i: number) => void;
}) {
  const [held, setHeld] = useState(false);
  const from = useSharedValue({ x: 0, y: 0 });
  const lift = useSharedValue(0);

  const drag = Gesture.Pan()
    .onStart(() => {
      const p = places.value[index];
      from.value = { x: p?.x ?? 0, y: p?.y ?? 0 };
      lift.value = withSpring(1, { damping: 16, stiffness: 240 });
      runOnJS(setHeld)(true);
      runOnJS(onGrab)(index);
    })
    .onUpdate((e) => {
      // The world is scaled, so a finger's travel is worth less of the web the further out it is.
      runOnJS(onMove)(index, from.value.x + e.translationX / scale.value, from.value.y + e.translationY / scale.value);
    })
    .onFinalize(() => {
      lift.value = withSpring(0, { damping: 18, stiffness: 240 });
      runOnJS(setHeld)(false);
      runOnJS(onDrop)(index);
    });

  // Declared together, arbitrated by the library. A `Pressable` inside a detector is React
  // Native's responder system inside gesture handler's, and the two do not negotiate.
  const tap = Gesture.Tap()
    .maxDuration(400)
    .onEnd((_e, ok) => {
      if (ok) {
        runOnJS(select)();
        runOnJS(onOpen)(index);
      }
    });

  const style = useAnimatedStyle(() => {
    const p = places.value[index] ?? { x: 0, y: 0 };
    return {
      transform: [{ translateX: p.x }, { translateY: p.y }, { scale: 1 + lift.value * 0.16 }],
      opacity: dim ? 0.16 : 1,
      zIndex: lift.value > 0.01 ? 40 : 1,
    };
  }, [dim]);

  return (
    <GestureDetector gesture={Gesture.Exclusive(drag, tap)}>
      <Animated.View
        accessibilityRole="button"
        accessibilityLabel={drop.title ?? drop.url}
        style={[styles.node, style]}
      >
        <WebNode drop={drop} busy={busy} held={held} />
      </Animated.View>
    </GestureDetector>
  );
}

/**
 * A cluster's word, over the top of its own nodes.
 *
 * ABOVE, not at the centroid. The centroid of two nodes is the gap between them, so the word sat
 * across the frames it was naming and the board read as a caption printed on a photograph. It
 * hangs over the highest node in the group instead, which is where a label belongs and where
 * nothing else is.
 *
 * It is quiet on purpose. The word names a REGION of the web, and a region is something you
 * notice while looking at something else; a label loud enough to read first would be competing
 * with the frames, which are the point.
 */
function Region({ group, at, ink }: { group: Cluster; at: Places; ink: string }) {
  if (!group.label || group.members.length < 2) return null;
  const pts = group.members.map((i) => at[i]).filter(Boolean) as { x: number; y: number }[];
  if (!pts.length) return null;
  const x = pts.reduce((s, p) => s + p.x, 0) / pts.length + HALF;
  const y = Math.min(...pts.map((p) => p.y));
  // TRANSLATED, not `left`/`top`. Every place on this board is measured from the middle of the
  // web, and the nodes get there by translating a centred view. A `left` is measured from the
  // parent's top left corner instead, so the words came out half a viewport up and to the left of
  // the frames they name — which reads as the labels belonging to some other cluster.
  return (
    <View
      pointerEvents="none"
      style={[styles.region, { transform: [{ translateX: x - REGION_W / 2 }, { translateY: y - 36 }] }]}
    >
      <T role="title" numberOfLines={1} style={{ color: ink, opacity: 0.3, textAlign: 'center', letterSpacing: 1.2 }}>
        {group.label.toUpperCase()}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, overflow: 'hidden' },
  // The web's origin sits at the middle of the viewport; every node's place is relative to it.
  world: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  strands: { position: 'absolute' },
  node: { position: 'absolute' },
  region: { position: 'absolute', width: REGION_W, alignItems: 'center' },
});

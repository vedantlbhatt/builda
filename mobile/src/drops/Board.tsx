/**
 * The board: every drop you have shared, as its own frame, piled by what it is about.
 *
 * WHAT THIS REPLACED, and why. The first board was one generated pixel glyph per drop on a dotted
 * field. A glyph grown from a URL says nothing about the post, a field of identical little marks
 * is the exact look this app has a rule against, and forty of them is a starfield rather than a
 * map. A drop is a video somebody made: the card is its frame, and a cluster is a pile of them.
 *
 * A PHONE IS A COLUMN, so the board is a wall that flows down one (`layout.flow`). Panning in two
 * directions to read something is how a map stops being read; here the only gesture is the one the
 * device already is. Pinch still works, and a pile still sits where it sat.
 *
 * THREE DEPTHS, and each one is a tap:
 *
 *   the wall     piles, each with its cluster's own word above it.
 *   a pile open  its cards spread over the dimmed wall, which is where you pick one.
 *   a card open  the post fills the screen and the sheet comes up over it (`DropSheet.tsx`).
 *
 * Nothing here draws a gradient, a chip, or a box whose fill, border and text are three tints of
 * one hue.
 */
import { BlurView } from 'expo-blur';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getKv, setKv } from '../data/cache';
import { T } from '../ui/Text';
import { commit, select } from '../ui/haptics';
import { useColors } from '../ui/scheme';
import { board as clusterBoard, type Cluster } from './cluster';
import { CARD_H, CARD_W, OPEN_GAP, spread, spreadSize } from './card';
import { DropCard } from './CardView';
import { FlyIn } from './FlyIn';
import {
  applyOrder,
  board as layoutBoard,
  cardScaleFor,
  extentOf,
  GUTTER,
  reorder,
  seats,
  slotAt,
  type StackSpot,
} from './layout';
import { arrivalMs, portalPoint, schedule } from './portal';
import { PortalPill } from './PortalPill';
import { StackView } from './StackView';
import type { DropRow, MoveRow } from './types';

/** A cluster, plus where on the wall it insists on being (`layout.Box.band`). */
type Pile = Cluster & { band?: -1 | 0 | 1 };

/** Where the wall's arrangement lives on this device. */
const ORDER_KEY = 'drops.wall.order.v1';

export interface BoardProps {
  drops: DropRow[];
  moves: MoveRow[];
  /** A card the person opened, or null. The sheet lives above this component. */
  onOpenCard: (id: string) => void;
  /** Rows the search box has narrowed to, or null for all of them. */
  only?: Set<string> | null;
}

export function DropsBoard({ drops, moves, onOpenCard, only = null }: BoardProps) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [openCluster, setOpenCluster] = useState<number | null>(null);
  /** A pile is in somebody's hand, so the wall underneath it holds still. */
  const [holding, setHolding] = useState(false);

  const shown = useMemo(
    () => (only ? drops.filter((d) => only.has(d.id)) : drops),
    [drops, only],
  );

  /**
   * The piles.
   *
   * A DROP WITH NO WORDS IN IT IS NOT CLUSTERED. It has no title, no summary and no tags, so its
   * vector is empty, and an empty vector is similar to nothing: it lands in a pile of one under a
   * label made of no words at all. The first version shipped that, and a reel you had just shared
   * arrived into a blank space with no word over it, which reads as the board breaking at the
   * exact moment you are watching it.
   *
   * Two piles take them, by the only thing known about each: the ones still being read, and the
   * ones nobody could read. Both are held at the top, because both are the board asking for your
   * attention rather than holding a thing you asked for. A drop leaves JUST IN on the same poll
   * that fills in its title, and joins whichever cluster its words put it in.
   */
  const clusters: Pile[] = useMemo(() => {
    const landing: number[] = [];
    const closed: number[] = [];
    const read: number[] = [];
    shown.forEach((d, i) => {
      if (d.status === 'waiting' || d.status === 'resolving') landing.push(i);
      else if (!d.title) closed.push(i);
      else read.push(i);
    });
    const groups = clusterBoard(
      read.map((i) => {
        const d = shown[i] as DropRow;
        return {
          kind: d.kind,
          title: d.title,
          summary: d.summary,
          tags: d.resolution?.plan?.tags ?? [],
        };
      }),
    ).map((g) => ({
      label: g.label,
      members: g.members.map((j) => read[j] as number),
      size: g.size,
    }));
    const out: Pile[] = [...groups];
    if (landing.length) {
      out.unshift({ label: 'JUST IN', members: landing, size: landing.length, band: -1 });
    }
    if (closed.length) {
      out.push({ label: 'NO WAY IN', members: closed, size: closed.length, band: 1 });
    }
    return out;
  }, [shown]);

  /**
   * The wall, in the order somebody dragged it into (`layout.applyOrder`).
   *
   * Kept per device rather than on the server, on purpose: where a pile sits is about this screen
   * and this thumb, and a wall that rearranges itself because you moved something on a different
   * phone is a wall you stop trusting.
   */
  const [order, setOrder] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    void getKv(ORDER_KEY).then((raw: string | null) => {
      if (!live || !raw) return;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) setOrder(parsed.filter((v) => typeof v === 'string'));
      } catch {
        // A wall arrangement is not worth a crash. It goes back to the clustering's order.
      }
    });
    return () => {
      live = false;
    };
  }, []);

  const walled = useMemo(() => applyOrder(clusters, order), [clusters, order]);
  const spots = useMemo(
    () => layoutBoard(walled, width, order.length > 0),
    [walled, width, order.length],
  );

  const move = useCallback(
    (cluster: number, to: { x: number; y: number }) => {
      const from = spots.findIndex((s) => s.cluster === cluster);
      const into = slotAt(to, spots);
      if (from < 0 || from === into) return;
      const next = reorder(walled, from, into).map((c) => c.label);
      commit();
      setOrder(next);
      void setKv(ORDER_KEY, JSON.stringify(next));
    },
    [spots, walled],
  );
  const cardScale = useMemo(() => cardScaleFor(walled, width), [walled, width]);
  const extent = useMemo(() => extentOf(spots, width), [spots, width]);

  const busy = useMemo(() => {
    const ids = new Set<string>();
    for (const m of moves) if (m.status === 'running' || m.status === 'queued') ids.add(m.drop_id);
    return ids;
  }, [moves]);

  /**
   * The arrival.
   *
   * Cards fly out of the Dynamic Island the first time the board is seen, and again whenever a
   * drop lands that was not there before: a drop came from somewhere else, and it should arrive
   * rather than appear. The key changes only when the SET of drops changes, so a poll that
   * refreshes the same eight does not throw them all back out of the island.
   */
  const [wallTop, setWallTop] = useState(0);
  const key = useMemo(() => shown.map((d) => d.id).sort().join(','), [shown]);
  const [play, setPlay] = useState(0);
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    if (key === lastKey.current) return;
    lastKey.current = key;
    if (key) setPlay((n) => n + 1);
  }, [key]);

  /** The island, in the board's own coordinates: negative, because it is above the board. */
  const portal = useMemo(() => {
    const p = portalPoint(width, insets.top);
    return { x: p.x, y: p.y - wallTop };
  }, [width, insets.top, wallTop]);

  /**
   * While the cards are in the air.
   *
   * The wall does not scroll during it, because the overlay draws in the screen's coordinates and
   * the wall in the scroller's: a flick mid flight would slide one out from under the other. It
   * lasts exactly as long as the schedule says the arrival does.
   */
  const [flying, setFlying] = useState(false);
  useEffect(() => {
    if (!play || !shown.length || !wallTop) return;
    setFlying(true);
    const id = setTimeout(() => setFlying(false), arrivalMs(shown.length) + 60);
    return () => clearTimeout(id);
  }, [play, shown.length, wallTop]);

  /** Whose turn it is to leave, top pile first, so the board fills the way you read it. */
  const delays = useMemo(() => {
    const leaving = spots.flatMap((s) => s.members);
    const times = schedule(leaving.length);
    const out: Record<string, number> = {};
    leaving.forEach((index, i) => {
      const id = shown[index]?.id;
      if (id) out[id] = times[i] ?? 0;
    });
    return out;
  }, [spots, shown]);

  const open = openCluster === null ? null : spots.find((s) => s.cluster === openCluster) ?? null;

  // The wall dims and pulls back a little while a pile is open, so the pile reads as being in
  // front of it rather than beside it.
  const back = useSharedValue(1);
  useEffect(() => {
    back.value = withSpring(open ? 0.94 : 1, { damping: 18, stiffness: 160 });
  }, [open, back]);
  const wallStyle = useAnimatedStyle(() => ({ transform: [{ scale: back.value }] }));

  const close = useCallback(() => {
    select();
    setOpenCluster(null);
  }, []);

  return (
    /**
     * `onLayout` HERE, on the board's own root, and not on the scroller inside it.
     *
     * It was on the scroller, whose y within this component is 0, so `wallTop` was always zero
     * and everything measured from the island — the portal's mouth and the pill drawn at it —
     * came out one header lower than the island itself. The board is a sibling of the header, so
     * its own y in the screen IS the header's height, which is exactly the offset both need.
     */
    <View style={styles.fill} onLayout={(e) => setWallTop(e.nativeEvent.layout.y)}>
      <ScrollView
        style={styles.fill}
        contentContainerStyle={{
          height: extent.maxY + insets.bottom + 92,
          paddingTop: 0,
        }}
        showsVerticalScrollIndicator={false}
        scrollEnabled={open === null}
      >
        <Animated.View style={[styles.wall, wallStyle]}>
          {spots.map((s) => (
            <StackView
              key={`${s.cluster}.${s.label}`}
              spot={s}
              drops={shown}
              busy={busy}
              dim={open !== null && open.cluster !== s.cluster}
              cardScale={cardScale}
              arriving={flying}
              onMove={move}
              onHold={setHolding}
              onOpen={setOpenCluster}
            />
          ))}
        </Animated.View>
      </ScrollView>

      {/* THE ARRIVAL, over the scroller rather than inside it.
          A UIScrollView clips to its own bounds, and the island is ABOVE the board's frame, so a
          card that flew from the island was invisible for the whole first half of its flight and
          appeared to be born a third of the way down the wall. Drawn here it is not clipped by
          anything, and the seats it lands in were held open by the piles underneath. */}
      {flying ? (
        <Arrival
          spots={spots}
          drops={shown}
          busy={busy}
          cardScale={cardScale}
          portal={portal}
          delays={delays}
          playKey={play}
        />
      ) : null}

      {/* The island, opening. Over everything, because it is the top of the phone. */}
      <PortalPill width={width} topInset={insets.top} offsetY={-wallTop} playKey={play} />

      {open ? (
        <OpenPile
          spot={open}
          drops={shown}
          busy={busy}
          onPick={(id) => {
            setOpenCluster(null);
            onOpenCard(id);
          }}
          onClose={close}
        />
      ) : null}
    </View>
  );
}

/**
 * The cards, in the air.
 *
 * One layer over the whole board, outside the scroller, holding a copy of every card mid flight.
 * Each one starts at the island the size of a stamp, spinning, and lands in the seat its pile is
 * holding open; when the last one is down this unmounts and the wall's own cards take over, in
 * the same place, at the same size, so the handover is not a frame anybody can see.
 *
 * It draws in the SCREEN's coordinates: a seat's place on the wall plus how far down the screen
 * the wall starts. That is the whole reason it exists — the island is above the wall, and the
 * wall clips.
 */
function Arrival({
  spots,
  drops,
  busy,
  cardScale,
  portal,
  delays,
  playKey,
}: {
  spots: StackSpot[];
  drops: DropRow[];
  busy: Set<string>;
  cardScale: number;
  /** The island, in the BOARD's coordinates: this layer fills the board, not the screen. */
  portal: { x: number; y: number };
  delays: Record<string, number>;
  playKey: number;
}) {
  const ids = useMemo(() => drops.map((d) => d.id), [drops]);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {spots.flatMap((spot) =>
        seats(spot, ids, cardScale).map((seat) => {
          const drop = drops[seat.index];
          if (!drop) return null;
          const x = seat.homeX - seat.width / 2;
          const y = seat.homeY - seat.height / 2;
          return (
            <View
              key={drop.id}
              style={[
                styles.flier,
                {
                  left: x,
                  top: y,
                  width: seat.width,
                  height: seat.height,
                  transform: [{ rotate: `${seat.rotate}deg` }],
                  zIndex: 10 - seat.depth,
                },
              ]}
            >
              <FlyIn
                dx={portal.x - seat.homeX}
                dy={portal.y - seat.homeY}
                delay={delays[drop.id] ?? 0}
                playKey={playKey}
              >
                <DropCard
                  drop={drop}
                  busy={busy.has(drop.id)}
                  dim={seat.depth === 0 ? 1 : 0.9 - seat.depth * 0.12}
                  words={seat.depth === 0}
                  scale={cardScale}
                />
              </FlyIn>
            </View>
          );
        }),
      )}
    </View>
  );
}

/**
 * A pile, opened: its cards spread over the wall, two across, scrollable when there are many.
 *
 * Over the wall rather than in it. Reflowing the wall to make room would move every other pile,
 * and a board that rearranges itself when you tap something is a board you lose your place in.
 */
function OpenPile({
  spot,
  drops,
  busy,
  onPick,
  onClose,
}: {
  spot: { label: string; size: number; members: number[] };
  drops: DropRow[];
  busy: Set<string>;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const cards = spread(spot.members);
  const size = spreadSize(spot.members.length);
  const left = Math.max(GUTTER, (width - size.width) / 2);

  return (
    <Animated.View
      entering={FadeIn.duration(160)}
      exiting={FadeOut.duration(120)}
      style={styles.sheetBack}
    >
      {/* Over the wall, not instead of it: the pile you opened is in front of the board you were
          looking at, and the board stays visible behind so you do not lose where you were. */}
      <BlurView intensity={28} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(16,14,12,0.80)' }]} />
      <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Close" onPress={onClose} />
      <View style={[styles.openHead, { paddingTop: insets.top + 10 }]}>
        <T role="display" numberOfLines={1} style={{ color: c.text, flex: 1 }}>
          {spot.label ? spot.label : 'Drops'}
        </T>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={14}>
          <T role="label" style={{ color: c.textFaint, letterSpacing: 1.4 }}>
            CLOSE
          </T>
        </Pressable>
      </View>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          paddingBottom: insets.bottom + 80,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ height: size.height, marginLeft: left }}>
          {cards.map((p, i) => {
            const drop = drops[p.index];
            if (!drop) return null;
            return (
              <Animated.View
                key={drop.id}
                entering={FadeIn.duration(220).delay(i * 34)}
                style={{ position: 'absolute', left: p.x, top: p.y, width: CARD_W, height: CARD_H }}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={drop.title ?? drop.url}
                  onPress={() => {
                    select();
                    onPick(drop.id);
                  }}
                >
                  <DropCard drop={drop} busy={busy.has(drop.id)} />
                </Pressable>
              </Animated.View>
            );
          })}
        </View>
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  flier: { position: 'absolute' },
  wall: { flex: 1 },
  sheetBack: { ...StyleSheet.absoluteFillObject },
  openHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: GUTTER,
    paddingBottom: 16,
  },
});

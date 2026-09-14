/**
 * THE SESSION SWARM: every session of one project as a dot on a time axis, its area its active
 * time, packed without overlap (`geometry.beeswarm`, biggest first, each at the free height
 * nearest the axis). A dot is the project's hue; round its rim runs an arc in the builder's own
 * hue (the accent, their creature's), clockwise from 12 o'clock, as far round as the share of the
 * session they were there for. A run nobody attended has no arc at all: the robot's hours, drawn
 * as the robot's.
 *
 * FOUND ON THE SIMULATOR (2026-09-13, the real corpus): the first version put the builder's share
 * INSIDE the dot, as an inner dot whose area was that share. It was true and it hid the project:
 * this builder was there for 87% of an average session, so the swarm read as the accent with a
 * rim of the project's hue. The arc keeps the dot the project's colour and the length of the arc
 * as honest as the area was.
 *
 * When the swarm comes on screen the dots DROP INTO PLACE, left to right in the order they happened,
 * each falling in from above and landing on the page's spring (about 4% past, then still); the arc
 * sweeps round a beat after. Then one still picture replaces the moving one (`drawClock.ts`), so a
 * swarm at rest costs nothing a frame. A tap on a dot rings it and opens that session
 * (`/session/<id>`). The axis starts at the project's first session, so a stretch with no dot on
 * this phone reads as a stretch, not as the start of the project.
 *
 * Borrowed: the dots of a person's own activity sized by effort are Strava's training log
 * (design-md/fitness/strava: the log's bubbles, one an activity); the fall and the land are
 * react-bits BounceCards' entrance (from above, a spring with a small overshoot), by David Haz, MIT
 * + Commons Clause (the notice is in `src/ui/bits/effects/ClickSpark.tsx`; used as part of this
 * application, not redistributed), here one Skia picture for every dot on the block's clock.
 */
import { Canvas, Circle, createPicture, PaintStyle, Picture, Skia, StrokeCap, type SkCanvas } from '@shopify/react-native-skia';
import { useRouter } from 'expo-router';
import React, { useCallback, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import Animated, { useDerivedValue, useSharedValue } from 'react-native-reanimated';

import { ease, phase, spring } from '../insights/motion';
import { GROUND } from '../insights/palette';
import { select } from '../ui';
import { dayOf } from '../you/numbers';
import { useDrawClock } from './drawClock';
import { beeswarm, dotAt } from './geometry';
import type { SwarmSession } from './model';

/** How long a dot takes to fall, the spread of the whole cascade, and the arc's beat after it lands. */
const FALL_MS = 560;
const CASCADE_MS = 1100;
const CORE_AT = 380;
const ARC_MS = 420;
const AXIS_ROOM = 22;
/** Air between two dots: room for each one's arc and a hair of ground between them. */
const RING_ROOM = 5;
/** The arc: its stroke, and how far outside the rim it runs. */
const RING_W = 1.75;
const RING_OUT = 2;
/** The ring a press puts round a dot: this far outside its rim, 2 points wide. */
const HOT_OUT = RING_OUT + 3;
/**
 * What a dot draws past its radius, at the most: the press ring's outer edge. The layout keeps it
 * inside the width (`geometry.SwarmOptions.rim`) and the height leaves it room, so no mark is ever
 * cut flat by the canvas's edge (FOUND IN THE CAPTURE PASS, 2026-09-14).
 */
const RIM = HOT_OUT + 1;
/** Read once, so the UI thread gets a number. */
const BUTT = StrokeCap.Butt;

type Dot = { x: number; y: number; r: number; share: number; at: number };

// A worklet helper, defined before every worklet that calls it (two crashes on 2026-09-13).

/** The swarm at clock `t`: the axis, and each dot fallen as far as its own start says, its arc after. */
function drawSwarm(canvas: SkCanvas, t: number, dots: readonly Dot[], width: number, axis: number, ink: string, core: string, lineAt: number): void {
  'worklet';
  const line = Skia.Paint();
  line.setAntiAlias(true);
  line.setStyle(PaintStyle.Stroke);
  line.setStrokeWidth(1);
  line.setColor(Skia.Color(GROUND.border));
  canvas.drawLine(0, axis, width * ease(phase(t, lineAt, 500)), axis, line);
  const fill = Skia.Paint();
  fill.setAntiAlias(true);
  fill.setColor(Skia.Color(ink));
  const arc = Skia.Paint();
  arc.setAntiAlias(true);
  arc.setStyle(PaintStyle.Stroke);
  arc.setStrokeWidth(RING_W);
  arc.setStrokeCap(BUTT);
  arc.setColor(Skia.Color(core));
  for (let i = 0; i < dots.length; i++) {
    const d = dots[i]!;
    const p = phase(t, d.at, FALL_MS);
    if (p <= 0) continue;
    // From above the top edge to its place, landing on the spring.
    const y = d.y - (1 - spring(p)) * (d.y + d.r + 14);
    canvas.drawCircle(d.x, y, d.r, fill);
    if (d.share > 0) {
      const sweep = ease(phase(t, d.at + CORE_AT, ARC_MS));
      if (sweep > 0) {
        const R = d.r + RING_OUT;
        canvas.drawArc(Skia.XYWHRect(d.x - R, y - R, R * 2, R * 2), -90, Math.max(2, 360 * d.share * sweep), false, arc);
      }
    }
  }
}

export function Swarm({
  sessions,
  width,
  ink,
  core,
  from,
  to,
  delay = 80,
}: {
  sessions: readonly SwarmSession[];
  width: number;
  ink: string;
  core: string;
  /** The axis's ends: the project's first session and its last, as the report has them. */
  from?: string | null;
  to?: string | null;
  delay?: number;
}) {
  const router = useRouter();
  const lo = from ? Date.parse(from) : Number.NaN;
  const hi = to ? Date.parse(to) : Number.NaN;
  const swarm = useMemo(
    () =>
      beeswarm(
        sessions.map((s) => ({ id: s.id, at: s.at, size: s.activeSeconds })),
        width,
        { rMin: 3, rMax: Math.min(16, Math.round(width * 0.042)), gap: RING_ROOM, pad: 4, rim: RIM },
        Number.isFinite(lo) ? lo : undefined,
        Number.isFinite(hi) ? hi : undefined,
      ),
    [sessions, width, lo, hi],
  );
  const half = Math.max(24, Math.ceil(swarm.extent + RIM) + 1);
  const height = half * 2;
  const axis = half;

  const byId = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions]);
  // Plain numbers for the UI thread, in the order the sessions happened.
  const dots: Dot[] = useMemo(
    () =>
      swarm.dots.map((d) => {
        const s = byId.get(d.id)!;
        const share = s.unattended ? 0 : s.attendedShare;
        return { x: d.x, y: axis + d.dy, r: d.r, share, at: delay + (d.x / Math.max(1, width)) * CASCADE_MS };
      }),
    [swarm, byId, axis, delay, width],
  );
  const total = delay + CASCADE_MS + FALL_MS + CORE_AT + ARC_MS;
  const { clock, box, landed } = useDrawClock(total);

  const moving = useDerivedValue(() => {
    const t = clock.value;
    return createPicture((canvas) => drawSwarm(canvas, t, dots, width, axis, ink, core, delay - 60), { width, height });
  }, [dots, width, height, axis, ink, core, delay]);
  // Recorded once, on this thread, the moment the drop has landed: nothing is drawn a frame after.
  const still = useMemo(
    () => (landed ? createPicture((canvas) => drawSwarm(canvas, total, dots, width, axis, ink, core, delay - 60), { width, height }) : null),
    [landed, dots, width, height, axis, ink, core, delay, total],
  );

  // The ring round a pressed dot, on its own: a press never re-records the swarm.
  const hotX = useSharedValue(0);
  const hotY = useSharedValue(0);
  const hotR = useSharedValue(0);
  const hotOn = useSharedValue(0);
  const pressed = useRef<string | null>(null);
  const find = useCallback((e: GestureResponderEvent) => dotAt(swarm.dots, axis, e.nativeEvent.locationX, e.nativeEvent.locationY, 8), [swarm, axis]);
  const onPressIn = useCallback(
    (e: GestureResponderEvent) => {
      const d = find(e);
      pressed.current = d?.id ?? null;
      if (!d) return;
      hotX.value = d.x;
      hotY.value = axis + d.dy;
      hotR.value = d.r + HOT_OUT;
      hotOn.value = 1;
      select();
    },
    [find, axis, hotX, hotY, hotR, hotOn],
  );
  const onPressOut = useCallback(() => {
    // The ring stays a moment, so the dot that opened is the one seen going.
    setTimeout(() => {
      hotOn.value = 0;
    }, 260);
  }, [hotOn]);
  const onPress = useCallback(() => {
    const id = pressed.current;
    if (id) router.push(`/session/${id}`);
  }, [router]);

  const ticks = useMemo(() => {
    if (!sessions.length || swarm.to <= swarm.from) return [];
    const n = Math.min(5, Math.max(2, Math.floor(width / 80)));
    const out: { x: number; label: string }[] = [];
    for (let i = 0; i < n; i++) {
      const at = swarm.from + ((swarm.to - swarm.from) * i) / (n - 1);
      const label = dayOf(new Date(at).toISOString(), at) ?? '';
      if (out.some((o) => o.label === label)) continue;
      out.push({ x: 4 + ((width - 8) * i) / (n - 1), label });
    }
    return out;
  }, [sessions, swarm, width]);

  if (!sessions.length) return null;
  return (
    <View>
      <Animated.View ref={box} collapsable={false} style={{ width, height }}>
        <Pressable
          onPressIn={onPressIn}
          onPressOut={onPressOut}
          onPress={onPress}
          accessibilityRole="image"
          accessibilityLabel={`${sessions.length} sessions, each a dot as big as its active time. The session list opens each one too.`}
          style={{ width, height }}
        >
          <Canvas style={{ width, height }}>
            <Picture picture={still ?? moving} />
            <Circle cx={hotX} cy={hotY} r={hotR} style="stroke" strokeWidth={2} color={GROUND.text} opacity={hotOn} />
          </Canvas>
        </Pressable>
      </Animated.View>
      <View style={{ height: AXIS_ROOM, width }}>
        {ticks.map((t, i) => {
          const w = 60;
          const left = Math.min(width - w, Math.max(0, t.x - w / 2));
          return (
            <Text key={t.label} allowFontScaling={false} style={[styles.tick, { left, width: w, textAlign: i === 0 ? 'left' : i === ticks.length - 1 ? 'right' : 'center' }]}>
              {t.label}
            </Text>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tick: { position: 'absolute', top: 4, fontSize: 11, fontWeight: '600', color: GROUND.faint, fontVariant: ['tabular-nums'] },
});

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
 * When the block arrives the dots DROP INTO PLACE, left to right in the order they happened, each
 * falling in from above and landing on the page's spring (about 4% past, then still); the arc
 * sweeps round a beat after. A tap on a dot rings it and opens that session (`/session/<id>`).
 *
 * Borrowed: the dots of a person's own activity sized by effort are Strava's training log
 * (design-md/fitness/strava: the log's bubbles, one an activity); the fall and the land are
 * react-bits BounceCards' entrance (from above, a spring with a small overshoot), by David Haz, MIT
 * + Commons Clause (the notice is in `src/ui/bits/effects/ClickSpark.tsx`; used as part of this
 * application, not redistributed), here one Skia picture for every dot on the block's clock.
 */
import { Canvas, createPicture, PaintStyle, Picture, Skia, StrokeCap } from '@shopify/react-native-skia';
import { useRouter } from 'expo-router';
import React, { useCallback, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import { useDerivedValue, useSharedValue } from 'react-native-reanimated';

import { ease, phase, spring } from '../insights/motion';
import { GROUND } from '../insights/palette';
import { useClock } from '../insights/reveal';
import { select } from '../ui';
import { dayOf } from '../you/numbers';
import { beeswarm, dotAt } from './geometry';
import type { SwarmSession } from './model';

/** How long a dot takes to fall, the spread of the whole cascade, and the inner dot's beat. */
const FALL_MS = 560;
const CASCADE_MS = 1100;
const CORE_AT = 380;
const AXIS_ROOM = 22;
/** Air between two dots: room for each one's arc and a hair of ground between them. */
const RING_ROOM = 5;
/** The arc: its stroke, and how far outside the rim it runs. */
const RING_W = 1.75;
const RING_OUT = 2;
/** Read once, so the UI thread gets a number. */
const BUTT = StrokeCap.Butt;

export function Swarm({ sessions, width, ink, core, delay = 80 }: { sessions: readonly SwarmSession[]; width: number; ink: string; core: string; delay?: number }) {
  const clock = useClock();
  const router = useRouter();
  const swarm = useMemo(
    () =>
      beeswarm(
        sessions.map((s) => ({ id: s.id, at: s.at, size: s.activeSeconds })),
        width,
        { rMin: 3, rMax: Math.min(16, Math.round(width * 0.042)), gap: RING_ROOM, pad: 4 },
      ),
    [sessions, width],
  );
  const half = Math.max(24, Math.ceil(swarm.extent) + 6);
  const height = half * 2;
  const axis = half;

  const byId = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions]);
  // Plain numbers for the UI thread, in the order the sessions happened.
  const dots = useMemo(
    () =>
      swarm.dots.map((d) => {
        const s = byId.get(d.id)!;
        const share = s.unattended ? 0 : s.attendedShare;
        return { x: d.x, y: axis + d.dy, r: d.r, share, at: delay + (d.x / Math.max(1, width)) * CASCADE_MS };
      }),
    [swarm, byId, axis, delay, width],
  );
  const hot = useSharedValue(-1);

  const picture = useDerivedValue(() => {
    const t = clock.value;
    const h = hot.value;
    return createPicture(
      (canvas) => {
        const line = Skia.Paint();
        line.setAntiAlias(true);
        line.setStyle(PaintStyle.Stroke);
        line.setStrokeWidth(1);
        line.setColor(Skia.Color(GROUND.border));
        canvas.drawLine(0, axis, width * ease(phase(t, delay - 60, 500)), axis, line);
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
            const sweep = ease(phase(t, d.at + CORE_AT, 420));
            if (sweep > 0) {
              const R = d.r + RING_OUT;
              canvas.drawArc(Skia.XYWHRect(d.x - R, y - R, R * 2, R * 2), -90, Math.max(2, 360 * d.share * sweep), false, arc);
            }
          }
        }
        if (h >= 0 && h < dots.length) {
          const d = dots[h]!;
          const ring = Skia.Paint();
          ring.setAntiAlias(true);
          ring.setStyle(PaintStyle.Stroke);
          ring.setStrokeWidth(2);
          ring.setColor(Skia.Color(GROUND.text));
          canvas.drawCircle(d.x, d.y, d.r + RING_OUT + 3, ring);
        }
      },
      { width, height },
    );
  }, [dots, width, height, axis, ink, core, delay]);

  const pressed = useRef<string | null>(null);
  const find = useCallback((e: GestureResponderEvent) => dotAt(swarm.dots, axis, e.nativeEvent.locationX, e.nativeEvent.locationY, 8), [swarm, axis]);
  const onPressIn = useCallback(
    (e: GestureResponderEvent) => {
      const d = find(e);
      pressed.current = d?.id ?? null;
      hot.value = d ? swarm.dots.indexOf(d) : -1;
      if (d) select();
    },
    [find, swarm, hot],
  );
  const onPressOut = useCallback(() => {
    // The ring stays a moment, so the dot that opened is the one seen going.
    setTimeout(() => {
      hot.value = -1;
    }, 260);
  }, [hot]);
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
      <Pressable
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        onPress={onPress}
        accessibilityRole="image"
        accessibilityLabel={`${sessions.length} sessions, each a dot as big as its active time. The session list opens each one too.`}
        style={{ width, height }}
      >
        <Canvas style={{ width, height }}>
          <Picture picture={picture} />
        </Canvas>
      </Pressable>
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

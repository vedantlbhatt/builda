/**
 * What you build with most, as a cloud of bubbles: each thing a disc of its brand's colour with
 * its mark on it, the disc's AREA its sessions (`layout.packBubbles`), the biggest carrying their
 * count. They grow in with a spring's give, biggest first, when the block arrives, then stand
 * still. A tap picks one: it gives under the finger, a ring marks it, sparks leave its rim in its
 * brand colour, and the line under the cloud says its story.
 *
 * Borrowed, with the numbers kept or said:
 *   - the discs of brand colour with the mark reversed out are Simple Icons' own brand cards and
 *     Grammarly's orb (design-md/productivity/grammarly: a 36 pt green circle, the white mark);
 *   - a cloud of circles you tap is Apple Music's artist picker; the grow in from about a third
 *     with a 4% overshoot is this app's `spring` (motion.ts), never from nothing (the skill's rule,
 *     and BounceCards' `fromScale`);
 *   - "the UI borrows colour from content" is Spotify's (design-md/music/spotify: the art is the
 *     only colour, the chrome recedes);
 *   - the sparks are react-bits ClickSpark (`SparkBurst`, David Haz, MIT + Commons Clause; the
 *     notice is in `src/ui/bits/effects/ClickSpark.tsx`), drawn BEHIND the disc with a long ray so
 *     only the part past the rim shows: a burst from the edge in the brand's colour, which on the
 *     disc itself would be invisible.
 */
import React, { memo, useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, useAnimatedStyle } from 'react-native-reanimated';

import { figure, type, Words } from '../insights/kit';
import { phase, spring } from '../insights/motion';
import { Num } from '../insights/Num';
import { GROUND, ON_HUE, SPECTRUM, type HueName } from '../insights/palette';
import { useClock, useReducedSV } from '../insights/reveal';
import { hue as themeHue } from '../theme';
import { select, usePressFeedback } from '../ui';
import { SparkBurst } from '../ui/bits/effects';
import { bubbleFace, packBubbles, type Bubble } from './layout';
import { brandInk, discOf } from './marks';
import { MarkView } from './Mark';
import type { StackThing } from './model';

/** How long one bubble takes to grow in, and the step between one and the next. */
const GROW_MS = 640;
const STEP_MS = 70;

export interface BubblesProps {
  things: readonly StackThing[];
  width: number;
  /** The hue of each category's chapter: a monogram's disc wears it. */
  hueOf: (t: StackThing) => HueName;
  /** What the cloud says before a bubble is picked. */
  line: string | null;
  delay?: number;
}

function discFor(t: StackThing, h: HueName): { fill: string; mark: string } {
  return t.mark?.kind === 'logo' ? discOf(t.mark.hex) : { fill: SPECTRUM[h].ink, mark: ON_HUE };
}

export function Bubbles({ things, width, hueOf, line, delay = 120 }: BubblesProps) {
  const cloud = useMemo(
    () =>
      packBubbles(
        things.map((t) => ({ key: t.id, value: t.sessions })),
        width,
        { rMax: Math.min(84, Math.round(width * 0.235)), rMin: 26, gap: 6, squash: 1.35 },
      ),
    [things, width],
  );
  const byId = useMemo(() => new Map(things.map((t) => [t.id as string, t])), [things]);
  const [picked, setPicked] = useState<string | null>(null);
  const [burst, setBurst] = useState<{ key: number; x: number; y: number; r: number; ink: string; hue: HueName }>({ key: 0, x: 0, y: 0, r: 0, ink: GROUND.text, hue: 'tide' });

  const onPick = useCallback(
    (b: Bubble) => {
      const t = byId.get(b.key);
      if (!t) return;
      select();
      setPicked((p) => (p === b.key ? null : b.key));
      const h = hueOf(t);
      setBurst((s) => ({ key: s.key + 1, x: b.x, y: b.y, r: b.r, ink: t.mark?.kind === 'logo' ? brandInk(t.mark.hex) : SPECTRUM[h].ink, hue: h }));
    },
    [byId, hueOf],
  );

  const chosen = picked ? byId.get(picked) ?? null : null;
  const sparkHue = useMemo(() => ({ ...themeHue(burst.hue), ink: burst.ink }), [burst.hue, burst.ink]);

  return (
    <View>
      <View style={{ width, height: cloud.height }}>
        {/* Behind the discs, so only the rays past each rim are seen. Always mounted: a burst plays when its key changes. */}
        <SparkBurst x={burst.x} y={burst.y} playKey={burst.key} hue={sparkHue} radius={burst.r + 26} length={burst.r + 10} count={12} />
        {cloud.bubbles.map((b, i) => {
          const t = byId.get(b.key)!;
          return <BubbleView key={b.key} bubble={b} thing={t} disc={discFor(t, hueOf(t))} delay={delay + i * STEP_MS} picked={picked === b.key} onPick={onPick} />;
        })}
      </View>
      <View style={styles.detail}>
        {chosen ? (
          <Animated.View key={chosen.id} entering={FadeIn.duration(180)} style={styles.detailInner}>
            <View style={styles.detailHead}>
              <MarkView mark={chosen.mark} size={20} color={chosen.mark?.kind === 'logo' ? brandInk(chosen.mark.hex) : SPECTRUM[hueOf(chosen)].ink} />
              <Text maxFontSizeMultiplier={1.4} style={type.lead}>
                {chosen.name}
              </Text>
            </View>
            <Words style={type.dim}>{chosen.story}</Words>
          </Animated.View>
        ) : line ? (
          <Words style={type.dim}>{line}</Words>
        ) : null}
      </View>
    </View>
  );
}

const BubbleView = memo(function BubbleView({
  bubble,
  thing,
  disc,
  delay,
  picked,
  onPick,
}: {
  bubble: Bubble;
  thing: StackThing;
  disc: { fill: string; mark: string };
  delay: number;
  picked: boolean;
  onPick: (b: Bubble) => void;
}) {
  const clock = useClock();
  const reduced = useReducedSV();
  const fb = usePressFeedback(0.94);
  const { r } = bubble;
  // Every bubble carries its count (`bubbleFace`): a mark with no number reads as never counted.
  const { markSize, font } = bubbleFace(r);

  // Grows from a third to whole with the spring's give; its colour snaps in over the first
  // quarter, because a hue half faded over the warm ground reads brown (DESIGN-V2 1.3).
  const grow = useAnimatedStyle(() => {
    const p = phase(clock.value, delay, GROW_MS);
    return { opacity: Math.min(1, p * 4), transform: [{ scale: reduced.value ? 1 : 0.34 + 0.66 * spring(p) }] };
  });

  return (
    <Animated.View style={[styles.bubble, { left: bubble.x - r, top: bubble.y - r, width: r * 2, height: r * 2 }, grow]}>
      {picked ? <View pointerEvents="none" style={[styles.ring, { borderRadius: r + 5, left: -5, top: -5, right: -5, bottom: -5 }]} /> : null}
      <Pressable
        onPress={() => onPick(bubble)}
        onPressIn={fb.onPressIn}
        onPressOut={fb.onPressOut}
        accessibilityRole="button"
        accessibilityLabel={`${thing.name}, ${thing.ofAll}`}
        accessibilityState={{ selected: picked }}
        hitSlop={4}
      >
        <Animated.View style={[styles.disc, { width: r * 2, height: r * 2, borderRadius: r, backgroundColor: disc.fill }, fb.animatedStyle]}>
          <MarkView mark={thing.mark} size={markSize} color={disc.mark} />
          <Num spec={thing.count} textStyle={figure(font, disc.mark)} delay={delay + 180} style={styles.count} />
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  bubble: { position: 'absolute' },
  ring: { position: 'absolute', borderWidth: 2, borderColor: GROUND.text, borderCurve: 'continuous' },
  disc: { alignItems: 'center', justifyContent: 'center', borderCurve: 'continuous' },
  count: { marginTop: 2 },
  detail: { marginTop: 18, minHeight: 64 },
  detailInner: { gap: 6 },
  detailHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});

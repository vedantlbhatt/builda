/**
 * ProfileCard: "this is you". Your creature on a slow field in its own hue, your name, and your
 * archetype when there is one, on a card that arrives with a pop and leans toward your finger.
 * The end of onboarding ("That's me") and the You page's share (DESIGN-V2 3.2 and 4.3, row 20).
 *
 * Ported from react-bits `Components/ProfileCard/ProfileCard.tsx` by David Haz, composed with
 * this folder's TiltedCard and the slow field from react-bits `Backgrounds/Dither`.
 * react-bits is MIT + Commons Clause (Copyright (c) 2026 David Haz): the notice is kept here
 * as the licence asks, and the port is used as part of this application only; it is not to be
 * redistributed as a component.
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a copy of this
 *   software and associated documentation files (the "Software"), to deal in the Software
 *   without restriction, including without limitation the rights to use, copy, modify,
 *   merge, publish, and distribute the Software as part of an application, website, or
 *   product, subject to the following conditions: The above copyright notice and this
 *   permission notice shall be included in all copies or substantial portions of the
 *   Software. Commons Clause Restriction: You may use this Software, including for any
 *   commercial purpose, so long as you do not sell, sublicense, or redistribute the
 *   components themselves, whether alone, in a bundle, or as a ported version.
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
 *
 * What changed in the port (DESIGN-V2 4.3: "composed, not ported"):
 * - Kept: the card's proportion (0.718), the pointer tilt and its arrival sweep (from 70 in
 *   and 60 down, home over 1.2s), the avatar over the name and title.
 * - The avatar is your pixel creature at 64pt, the one moving creature on screen; behind it is
 *   not the holographic gradient, the grain image and the behind glow (all three are the banned
 *   look), but react-bits Dither's wave in three levels of your creature's hue, drifting at the
 *   ambient 20 fps and cut away one cell around the creature so it never sits on its own hue.
 *   The field lives in the top band only, never behind the words.
 * - The handle, the online status and the Contact button are gone; the device orientation tilt
 *   is gone (DESIGN-V2 4.3: not used). The glare is the stepped band, three flat steps.
 * - One hue for the whole card, your creature's: the archetype is words in `textDim`, never a
 *   second identity hue on the same object (DESIGN-V2 1.3).
 *
 * Reduce Motion: the card is simply there, the field is one still frame, the creature is still,
 * and nothing leans.
 */
import React, { useEffect, useMemo, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { PixelAnimal } from '../../../pixel/PixelAnimal';
import { PixelSprite } from '../../../pixel/PixelSprite';
import { tokens } from '../../../generated/tokens';
import { creatureHue, space, type CreatureId } from '../../../theme';
import { EASE, POP, useReduceMotion } from '../../motion';
import { useColors, useScheme } from '../../scheme';
import { SHAPE } from '../../shape';
import { T } from '../../Text';
import { clearBoxFor } from './fills';
import { HueField, useAmbientClock } from './layers';
import { PROFILE } from './spec';
import { TiltedCard } from './TiltedCard';

export interface ProfileCardProps {
  /** Your creature: Bit or one of the eight animals. The card wears its hue. */
  creature: CreatureId;
  name: string;
  /** Your archetype, in words ("the architect"). Omit while there is none. */
  archetype?: string | null;
  /** The line over the name. Default "this is you". */
  caption?: string;
  width: number;
  /** Default `width / 0.718`, react-bits' proportion. */
  height?: number;
  /** Lean toward the finger. Default on. */
  tilt?: boolean;
  /** The stepped glare while held. Default on. */
  glare?: boolean;
  /** Arrive with `POP` and the tilt's sweep home. Default on. */
  arrive?: boolean;
  /** The field drifts only while this is true: pass the screen's focus. Default true. */
  active?: boolean;
  /** The creature moves. Default on: this card is the one moving creature on its screen. */
  creatureMoves?: boolean;
  /** Replaces the built in field, for a caller that brings its own (the kit's FieldDither). */
  ground?: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function ProfileCard({
  creature,
  name,
  archetype,
  caption = 'this is you',
  width,
  height: heightProp,
  tilt = true,
  glare = true,
  arrive = true,
  active = true,
  creatureMoves = true,
  ground,
  onPress,
  style,
}: ProfileCardProps) {
  const c = useColors();
  const scheme = useScheme();
  const reduce = useReduceMotion();
  const tone = useMemo(() => creatureHue(creature, scheme), [creature, scheme]);
  const height = heightProp ?? Math.round(width / PROFILE.aspect);
  const band = Math.round(height * PROFILE.artShare);
  const cell = tokens.dither.cell;
  const size = PROFILE.creature;
  // The creature sits on whole cells, so its hole in the field lands on the grid.
  const cx = Math.round((width - size) / 2 / cell) * cell;
  const cy = Math.round((band - size) / 2 / cell) * cell;
  const clear = useMemo(() => clearBoxFor(cx, cy, size, cell), [cx, cy, size, cell]);
  const t = useAmbientClock(active && ground === undefined);

  // The arrival: from 0.94 on POP, its opacity snapping in, while the tilt sweeps home.
  const shown = useSharedValue(arrive && !reduce ? 0 : 1);
  useEffect(() => {
    if (!arrive || reduce) {
      shown.value = 1;
      return;
    }
    shown.value = withSpring(1, { ...POP, reduceMotion: ReduceMotion.Never });
  }, [arrive, reduce, shown]);
  const opacity = useSharedValue(arrive && !reduce ? 0 : 1);
  useEffect(() => {
    if (!arrive || reduce) {
      opacity.value = 1;
      return;
    }
    opacity.value = withTiming(1, { duration: PROFILE.snapMs, easing: EASE, reduceMotion: ReduceMotion.Never });
  }, [arrive, reduce, opacity]);
  const pop = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ scale: 0.94 + 0.06 * shown.value }] }));

  const creatureNode =
    creature === 'bit' ? (
      <PixelSprite state="idle" size={size} scheme={scheme} paused={!creatureMoves} />
    ) : (
      <PixelAnimal animal={creature} size={size} scheme={scheme} paused={!creatureMoves} />
    );

  return (
    <Animated.View style={[{ width, height }, style, pop]}>
      <TiltedCard
        width={width}
        height={height}
        glare={glare}
        intro={arrive}
        lean={tilt}
        onPress={onPress}
        haptic={onPress ? 'commit' : undefined}
        accessibilityLabel={[caption, name, archetype ?? ''].filter(Boolean).join(', ')}
      >
        <View style={{ width, height, backgroundColor: c.card }}>
          <View style={{ width, height: band }}>
            {ground ?? <HueField width={width} height={band} hue={tone} t={t} clearBox={clear} density={PROFILE.density} />}
            <View style={{ position: 'absolute', left: cx, top: cy, width: size, height: size }}>{creatureNode}</View>
          </View>
          <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, gap: space.xs }}>
            <T role="meta" weight={600} style={{ color: tone.text }}>
              {caption}
            </T>
            <T role="hero" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
              {name}
            </T>
            {archetype ? (
              <T role="body" tone="dim" numberOfLines={2}>
                {archetype}
              </T>
            ) : null}
          </View>
          {/* The hairline goes over the art, so the field never draws on the card's edge. */}
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width,
              height,
              borderWidth: 1,
              borderColor: c.border,
              borderRadius: SHAPE.wrapped,
              borderCurve: 'continuous',
            }}
          />
        </View>
      </TiltedCard>
    </Animated.View>
  );
}

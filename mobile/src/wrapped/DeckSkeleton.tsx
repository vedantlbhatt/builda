/**
 * The loading state, shaped like the result: the stack of cards, each with its dashed
 * outline and window dots, the header and the three lines of text as quiet blocks where the
 * dither and the words will be. Static: no shimmer (the slop list), and the one thing that
 * moves on the screen while it waits is Bit, thinking, under it.
 */
import React from 'react';
import { View } from 'react-native';

import { space } from '../theme';
import { DashedFrame, Dots, SHAPE, useColors } from '../ui';
import { WINDOW_DOT } from '../ui/shape';
import { restPose, type SlotIndex } from './deck';

function Block({ width, height, radius }: { width: number | `${number}%`; height: number; radius: number }) {
  const c = useColors();
  return <View style={{ width, height, borderRadius: radius, borderCurve: 'continuous', backgroundColor: c.raised }} />;
}

function SkeletonCard({ width, height }: { width: number; height: number }) {
  const c = useColors();
  const pad = space.lg;
  return (
    <View
      style={{
        width,
        height,
        backgroundColor: c.card,
        borderRadius: SHAPE.wrapped,
        borderCurve: 'continuous',
        padding: pad,
        overflow: 'hidden',
        justifyContent: 'space-between',
      }}
    >
      <DashedFrame />
      <View style={{ gap: space.tile }}>
        <Dots />
        <Block width="100%" height={Math.floor(height / 2 - pad - space.tile - WINDOW_DOT.size)} radius={SHAPE.inner} />
      </View>
      <View style={{ gap: space.sm }}>
        <Block width="62%" height={15} radius={SHAPE.mark} />
        <Block width="44%" height={48} radius={SHAPE.mark} />
        <Block width="86%" height={17} radius={SHAPE.mark} />
      </View>
    </View>
  );
}

/** Two cards fanned behind the front one, in the stack's own rest poses. */
export function DeckSkeleton({ boxWidth, boxHeight, width, height }: { boxWidth: number; boxHeight: number; width: number; height: number }) {
  const left = (boxWidth - width) / 2;
  const top = (boxHeight - height) / 2;
  const behind: SlotIndex[] = [2, 1];
  return (
    <View style={{ width: boxWidth, height: boxHeight }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {behind.map((slot) => {
        const pose = restPose(slot, width);
        return (
          <View
            key={slot}
            style={{
              position: 'absolute',
              left,
              top,
              transform: [{ translateX: pose.x }, { translateY: pose.y }, { rotate: `${pose.rotation}deg` }, { scale: pose.scale }],
            }}
          >
            <SkeletonCard width={width} height={height} />
          </View>
        );
      })}
      <View style={{ position: 'absolute', left, top }}>
        <SkeletonCard width={width} height={height} />
      </View>
    </View>
  );
}

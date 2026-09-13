/**
 * The builder's creature on a Wrapped card: printed pixel by pixel in the band's dark ink as the
 * card arrives (the analysis page's `CreaturePrint`: a random order biased to the top), then, the
 * way Duolingo lets Duo be a personality rather than a decoration, it blinks once (the owl's
 * 167 ms, measured in Appllama's welcome screen study) and makes its one signature gesture (the
 * pack's last frame), and rests for good. One Skia picture, recorded on the UI thread off the
 * card's reveal clock, so it costs nothing once the clock stops.
 *
 * Still (the grid, the share card, a card seen before): the rest pose, drawn once (`CreatureMark`).
 * Reduce Motion: the clock is at its end the moment the card arrives, so it is simply there.
 */
import { Canvas, createPicture, Picture, Skia } from '@shopify/react-native-skia';
import React, { useMemo } from 'react';
import { View } from 'react-native';
import { useDerivedValue } from 'react-native-reanimated';

import { CreatureMark } from '../insights/Creature';
import { useClock } from '../insights/reveal';
import type { Animal } from '../pixel/animals';
import { creaturePlan, STAGE } from './story';

const GRID = 16;

export interface PrintedCreatureProps {
  animal: Animal;
  /** Snapped down to whole points per pixel. */
  size: number;
  color: string;
  /** When it starts printing, in ms of the card's clock. */
  at?: number;
  spread?: number;
  /** Blink and gesture: off for a card that only rests (a refusal). */
  lively?: boolean;
}

export function PrintedCreature({ animal, size, color, at = STAGE.creature, spread = STAGE.creatureSpread, lively = true }: PrintedCreatureProps) {
  const clock = useClock();
  const px = Math.max(1, Math.floor(size / GRID));
  const drawn = px * GRID;
  const plan = useMemo(() => creaturePlan(animal, at, spread), [animal, at, spread]);
  const blinkFrom = lively ? at + (STAGE.blink - STAGE.creature) : Number.POSITIVE_INFINITY;
  const gestureFrom = lively ? at + (STAGE.gesture - STAGE.creature) : Number.POSITIVE_INFINITY;
  const blinkTo = blinkFrom + STAGE.blinkMs;
  const gestureTo = gestureFrom + STAGE.gestureMs;

  const picture = useDerivedValue(() => {
    const t = clock.value;
    return createPicture(
      (canvas) => {
        const paint = Skia.Paint();
        paint.setAntiAlias(false);
        paint.setColor(Skia.Color(color));
        const gesturing = t >= gestureFrom && t < gestureTo;
        for (let i = 0; i < plan.rest.length; i++) {
          const c = plan.rest[i]!;
          if (t < c.at) continue;
          if (gesturing && plan.drop[i]) continue;
          canvas.drawRect(Skia.XYWHRect(c.x * px, c.y * px, px, px), paint);
        }
        if (t >= blinkFrom && t < blinkTo) {
          for (let i = 0; i < plan.eyes.length; i++) {
            const e = plan.eyes[i]!;
            canvas.drawRect(Skia.XYWHRect(e.x * px, e.y * px, px, px), paint);
          }
        }
        if (gesturing) {
          for (let i = 0; i < plan.add.length; i++) {
            const a = plan.add[i]!;
            canvas.drawRect(Skia.XYWHRect(a.x * px, a.y * px, px, px), paint);
          }
        }
      },
      { width: drawn, height: drawn },
    );
  }, [plan, px, drawn, color, blinkFrom, blinkTo, gestureFrom, gestureTo]);

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={`${animal}, your creature`} style={{ width: drawn, height: drawn }}>
      <Canvas style={{ width: drawn, height: drawn }}>
        <Picture picture={picture} />
      </Canvas>
    </View>
  );
}

/** The rest pose, still: whole pixels, drawn once. */
export function StillCreature({ animal, size, color }: { animal: Animal; size: number; color: string }) {
  const px = Math.max(1, Math.floor(size / GRID));
  return <CreatureMark animal={animal} size={px * GRID} color={color} />;
}

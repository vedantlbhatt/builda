import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import * as cache from '../src/data/cache';
import { PixelAnimal, PixelAnimalIcon } from '../src/pixel/PixelAnimal';
import { ANIMALS, type Animal } from '../src/pixel/animals';
import { openOn, step, view } from '../src/pixel/carousel';
import { colors, layout, space } from '../src/theme';
import { Button, haptics, Surface, SymbolIcon, T } from '../src/ui';

const c = colors('dark');

/** Where the chosen creature lives. Local: it is a preference, not a fact about the work. */
export const ANIMAL_KEY = 'profile.animal.v1';

/** The creature in the middle: a multiple of 16, so every cell is whole device pixels. */
const STAGE_CREATURE = 128;
/** A neighbour beside a chevron, still: 32pt, the smallest size a creature reads at. */
const NEIGHBOUR = 32;

/**
 * Pick your creature: one animated in the middle, a chevron either side.
 *
 * The animation runs on the CENTRE one only. Eight looping sprites on one screen is a
 * fairground, and the point of this screen is to look at one creature properly and decide
 * whether it is you. The neighbours are drawn as still first frames so the chevrons say
 * what they lead to without competing.
 *
 * Every wrap and fallback decision is in `src/pixel/carousel.ts` so `bun test` covers it:
 * an off-by-one at the seam sends one chevron press to the wrong creature, which a person
 * hits on their first pass through the pack and no screenshot would ever show.
 */
export default function IconScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [animal, setAnimal] = useState<Animal>(ANIMALS[0]!);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const stored = await cache.getKv(ANIMAL_KEY);
      // No suggestion is passed yet: the archetype lives on the profile response and this
      // screen is reachable before the first sync. `openOn` already falls back for both.
      setAnimal(openOn(stored, null));
      setReady(true);
    })();
  }, []);

  const v = view(animal);

  async function choose() {
    await cache.setKv(ANIMAL_KEY, animal);
    router.back();
  }

  /** A chevron press passes a step: the selection tick, on the same frame as the swap. */
  function move(by: -1 | 1) {
    haptics.select();
    setAnimal(step(animal, by));
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: c.bg,
        paddingHorizontal: layout.gutter,
        paddingTop: space.md,
        paddingBottom: insets.bottom + space.md,
        gap: space.lg,
      }}
    >
      {/* Left aligned, like every heading. Only the creature is centred: it is the thing
          being looked at. No caption over this line: the bar already says "Your creature",
          and a "pick your creature" under it said it twice. */}
      <T role="body" tone="dim">
        It goes on your profile and on everything you post. You can change it whenever.
      </T>

      {/* The stage sits under the sentence that introduces it, and the free space collects
          above the button, where a form's space goes. Centred in the leftover height it
          floated with 190pt of nothing on either side. */}
      <View style={{ flex: 1, gap: space.md }}>
        {/* The stage: a plain card, no amber outline. The creature carries the colour. */}
        <Surface
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingVertical: space.lg,
          }}
        >
          <Chevron dir="left" neighbour={v.previous} onPress={() => move(-1)} />
          <View style={{ width: STAGE_CREATURE, height: STAGE_CREATURE, alignItems: 'center', justifyContent: 'center' }}>
            {/* Only this one moves. Eight looping sprites at once is a fairground. */}
            {ready && <PixelAnimal animal={animal} size={STAGE_CREATURE} />}
          </View>
          <Chevron dir="right" neighbour={v.next} onPress={() => move(1)} />
        </Surface>

        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.md }}>
          <T role="title" style={{ flex: 1 }} accessibilityLiveRegion="polite">
            {v.label}
          </T>
          <T role="meta" tone="dim">
            {v.position} of {v.total}
          </T>
        </View>
      </View>

      <Button label={`Choose the ${v.label}`} onPress={() => void choose()} />
    </View>
  );
}

/**
 * One chevron, with the creature it leads to drawn small and still under it.
 *
 * A bare arrow makes somebody press it to find out what is there. Showing the neighbour
 * turns eight presses into one glance, and a still frame keeps it from competing with the
 * one in the middle. The chevron is chrome, so it is an SF Symbol in `textDim`, not amber.
 */
function Chevron({
  dir,
  neighbour,
  onPress,
}: {
  dir: 'left' | 'right';
  neighbour: Animal;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${dir === 'left' ? 'Previous' : 'Next'} creature, the ${neighbour}`}
      hitSlop={space.md}
      style={({ pressed }) => ({ alignItems: 'center', gap: space.sm, opacity: pressed ? 0.5 : 1 })}
    >
      <SymbolIcon name={dir === 'left' ? 'chevron.left' : 'chevron.right'} size={22} weight="semibold" tone="dim" />
      <PixelAnimalIcon animal={neighbour} size={NEIGHBOUR} style={{ opacity: 0.45 }} />
    </Pressable>
  );
}

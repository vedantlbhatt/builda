import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import * as cache from '../src/data/cache';
import { type Animal } from '../src/pixel/animals';
import { openOn } from '../src/pixel/carousel';
import { CREATURE, creatureCaption, ICON } from '../src/onboarding/copy';
import { CreatureCarousel, CreaturePager, type CreatureCarouselHandle } from '../src/onboarding/CreatureCarousel';
import { loadArchetype } from '../src/onboarding/facts';
import { STAGE_CREATURE } from '../src/onboarding/flow';
import { ANIMAL_KEY } from '../src/onboarding/keys';
import { loadAnimal, saveAnimal, suggestedAnimal } from '../src/onboarding/selection';
import { colors, layout, space } from '../src/theme';
import { Button, T } from '../src/ui';

const c = colors('dark');

/** Where the chosen creature lives. Still exported here: the You tab and the live debug screen import it from this file. */
export { ANIMAL_KEY };

/**
 * Pick your creature: the same stage onboarding's creature step uses (`CreatureCarousel`),
 * laid out the same way, the caption over the stage and the stage over its pager: the
 * chosen creature alive in the middle, its neighbours small and still either side, a finger
 * or the chevrons to move.
 *
 * The animation runs on the CENTRE one only. Eight looping sprites on one screen is a
 * fairground, and the point of this screen is to look at one creature properly and decide
 * whether it is you.
 *
 * It opens on their own choice, else on the creature their archetype earned (what the app has
 * cached, else the builder profile the You tab reads: `loadArchetype`), else the default.
 * Every wrap and fallback decision is in `src/pixel/carousel.ts`, so `bun test` covers it.
 */
export default function IconScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const stage = useRef<CreatureCarouselHandle>(null);
  const [opened, setOpened] = useState<Animal | null>(null);
  const [animal, setAnimal] = useState<Animal | null>(null);
  const [suggestion, setSuggestion] = useState<Animal | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const [stored, archetype] = await Promise.all([loadAnimal(cache), loadArchetype()]);
      if (!live) return;
      const suggested = suggestedAnimal(archetype);
      const first = openOn(stored, suggested);
      setSuggestion(suggested);
      setAnimal(first);
      setOpened(first);
    })();
    return () => {
      live = false;
    };
  }, []);

  const choose = useCallback(async () => {
    if (!animal) return;
    await saveAnimal(cache, animal);
    router.back();
  }, [animal, router]);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: c.bg,
        paddingHorizontal: layout.gutter,
        paddingTop: space.md,
        paddingBottom: insets.bottom + space.sm,
        gap: space.sm,
      }}
    >
      {/* Left aligned, like every heading. Only the creature is centred: it is the thing
          being looked at. The bar already says "Your creature". */}
      <T role="body" tone="dim">
        {ICON.body}
      </T>
      <View style={{ gap: space.xs, marginTop: space.md }}>
        <T role="title" accessibilityLiveRegion="polite">
          {animal ? creatureCaption(null, animal) : ' '}
        </T>
        <T role="meta" tone="dim" style={{ opacity: animal !== null && suggestion === animal ? 1 : 0 }}>
          {CREATURE.suggested}
        </T>
      </View>

      {/* The stage runs edge to edge, so the neighbours slide off the screen, not into a box. */}
      <View style={{ flex: 1, justifyContent: 'center', marginHorizontal: -layout.gutter, gap: space.lg }}>
        {opened && (
          <CreatureCarousel key={opened} ref={stage} initial={opened} width={width} size={STAGE_CREATURE} onChange={setAnimal} />
        )}
        <CreaturePager stage={stage} animal={animal} />
      </View>

      <Button label={ICON.choose} onPress={() => void choose()} disabled={!opened} />
    </View>
  );
}

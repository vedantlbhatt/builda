import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import * as cache from '../src/data/cache';
import { fitSize } from '../src/insights/format';
import { ON_HUE } from '../src/insights/palette';
import { RevealPage, Section } from '../src/insights/reveal';
import { DEFAULT_ANIMAL, type Animal } from '../src/pixel/animals';
import { openOn } from '../src/pixel/carousel';
import { CREATURE, creatureCaption, ICON } from '../src/onboarding/copy';
import { CreatureCarousel, CreaturePager, type CreatureCarouselHandle } from '../src/onboarding/CreatureCarousel';
import { loadArchetype } from '../src/onboarding/facts';
import { GUTTER, STAGE_CREATURE } from '../src/onboarding/flow';
import { HueButton } from '../src/onboarding/HueButton';
import { ANIMAL_KEY } from '../src/onboarding/keys';
import { loadAnimal, saveAnimal, suggestedAnimal } from '../src/onboarding/selection';
import { StepBand } from '../src/onboarding/StepBand';
import { useStepPage } from '../src/onboarding/stepPage';
import { CREATURE_NAME, display } from '../src/onboarding/type';
import { setAccentCreature } from '../src/theme/accent';
import { colors, creatureHue, space } from '../src/theme';
import { T } from '../src/ui';

const c = colors('dark');

/** Where the chosen creature lives. Still exported here: the You tab and the live debug screen import it from this file. */
export { ANIMAL_KEY };

/**
 * Pick your creature, and so the app's colour: the same stage onboarding's creature step uses
 * (`CreatureCarousel`), in the house style (design-refs/HOUSE-STYLE.md). The screen under the bar
 * is one band in the hue of the creature in the middle, and it re-prints itself in the next one's
 * hue, cell by cell, as the stage moves; the creatures are printed on it in its dark ink, the
 * neighbours small and still in its partner tone, only the centre one alive. The accent follows
 * the stage while it moves (a preview); "Use this creature" keeps it, and leaving without it puts
 * the saved one back (the root layout reads the creature again when this screen is left).
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
  const page = useStepPage(opened !== null);

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

  const onChange = useCallback((a: Animal) => {
    setAnimal(a);
    setAccentCreature(a);
  }, []);

  const choose = useCallback(async () => {
    if (!animal) return;
    setAccentCreature(animal);
    await saveAnimal(cache, animal);
    router.back();
  }, [animal, router]);

  const current = animal ?? opened ?? DEFAULT_ANIMAL;
  const hue = creatureHue(current);
  const size = fitSize(creatureCaption(null, 'octopus'), width - 2 * GUTTER, CREATURE_NAME.max, CREATURE_NAME.min);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <RevealPage page={page}>
        <Section style={{ flex: 1 }}>
          <StepBand hue={hue} inset={space.md} fill>
            {/* Left aligned, like every heading. Only the creature is centred: it is the thing
                being looked at. The bar already says "Your creature". */}
            <T role="body" weight={500} style={{ color: ON_HUE }}>
              {ICON.body}
            </T>
            <View style={{ gap: space.xs, marginTop: space.md }}>
              <T role="display" numberOfLines={1} accessibilityLiveRegion="polite" style={[display(size), { color: ON_HUE }]}>
                {animal ? creatureCaption(null, animal) : ' '}
              </T>
              <T role="meta" weight={600} style={{ color: ON_HUE }}>
                {animal !== null && suggestion === animal ? `${CREATURE.suggested}. ${CREATURE.theme}` : CREATURE.theme}
              </T>
            </View>

            {/* The stage runs edge to edge, so the neighbours slide off the screen, not into a box. */}
            <View style={{ flex: 1, justifyContent: 'center', marginHorizontal: -GUTTER }}>
              <View style={{ minHeight: STAGE_CREATURE + 16 }}>
                {opened && (
                  <CreatureCarousel
                    key={opened}
                    ref={stage}
                    initial={opened}
                    width={width}
                    size={STAGE_CREATURE}
                    onChange={onChange}
                    ink={ON_HUE}
                    dim={hue.partner}
                    liveTone="selected"
                  />
                )}
              </View>
            </View>
            <CreaturePager stage={stage} animal={animal} tone="onAccent" />
          </StepBand>
          <View style={{ paddingHorizontal: GUTTER, paddingTop: space.sm, paddingBottom: insets.bottom + space.sm }}>
            <HueButton label={ICON.choose} hue={hue} onPress={() => void choose()} disabled={!opened} />
          </View>
        </Section>
      </RevealPage>
    </View>
  );
}

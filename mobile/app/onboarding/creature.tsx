import { useLocalSearchParams, useNavigation, useRouter, type Href } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';

import * as cache from '../../src/data/cache';
import { fitSize } from '../../src/insights/format';
import { ON_HUE } from '../../src/insights/palette';
import { getLocalName } from '../../src/nav/name';
import { ANIMALS, DEFAULT_ANIMAL, type Animal } from '../../src/pixel/animals';
import { openOn } from '../../src/pixel/carousel';
import { CONTINUE, CREATURE, creatureWord } from '../../src/onboarding/copy';
import { CreatureCarousel, CreaturePager, type CreatureCarouselHandle } from '../../src/onboarding/CreatureCarousel';
import { currentDraft, setDraftAnimal } from '../../src/onboarding/draft';
import { currentFacts, useFacts } from '../../src/onboarding/facts';
import { GUTTER, NAME_TO_CREATURE_MS, pathFor, STAGE_CREATURE } from '../../src/onboarding/flow';
import { HueButton } from '../../src/onboarding/HueButton';
import { useLanded } from '../../src/onboarding/landing';
import { Wipe } from '../../src/onboarding/Rise';
import { loadAnimal, saveAnimal, suggestedAnimal } from '../../src/onboarding/selection';
import { StepBand } from '../../src/onboarding/StepBand';
import { StepFrame, useBandInset } from '../../src/onboarding/StepFrame';
import { BAND_TITLE, CREATURE_NAME, display } from '../../src/onboarding/type';
import { setAccentCreature } from '../../src/theme/accent';
import { creatureHue, space } from '../../src/theme';
import { RotatingText, type RotatingTextRef } from '../../src/ui/bits/text/RotatingText';
import { T } from '../../src/ui';

/** The longest thing the second line can say, so its size never changes as the stage moves. */
const LONGEST_WORD = ANIMALS.map((a) => creatureWord(a)).reduce((a, b) => (b.length > a.length ? b : a), '');

/** The pack in stage order, starting at `first`: the word that turns over opens on it. */
function orderFrom(first: Animal): Animal[] {
  const i = ANIMALS.indexOf(first);
  return [...ANIMALS.slice(i), ...ANIMALS.slice(0, i)];
}

/**
 * Step 2: your creature, and with it the app's colour (the owner, 2026-09-13: "what even is the
 * theme of this app?"; the theme is now the creature's hue, so picking a creature picks it).
 *
 * The whole step is one band in the hue of the creature in the middle of the stage. Swipe, and
 * as the next creature takes the middle the band re-prints itself in ITS hue, cell by cell in a
 * random order (react-bits PixelTransition's order, `StepBand`), on the same frame as the
 * selection tick; the chrome's bars and the Continue change with it (the accent store, repainted
 * at once), so the step is a preview of the whole app in that colour: "Vedant, the crab" on a
 * rose band with a rose Continue.
 *
 * On the band, in its dark ink: the name from the step before over the creature's name, which
 * rolls over to the next one as the stage moves (react-bits RotatingText, the kit's port, both
 * words moving at once); the line that says what the colour is for; and the stage, the creatures
 * printed large (192pt, twelve points a cell) in the band's ink, the neighbours small and still
 * in its partner tone (`CreatureCarousel`). Only the centre one moves. The chevrons under it are
 * the accessible path and do the same.
 *
 * It opens on their own earlier choice, else the creature their archetype earned when the account
 * has one (said so while it is the one in the middle), else the default. The pick is saved the
 * moment the stage comes to rest, so going back and forward keeps it. Arriving from the name step
 * it cross fades in around the name (the band already the colour, so it holds still), then the
 * creature's name wipes in and the stage cuts in as the fade lands.
 */
export default function CreatureStep() {
  const router = useRouter();
  const navigation = useNavigation();
  const { via } = useLocalSearchParams<{ via?: string }>();
  const fromName = via === 'name';
  const { width } = useWindowDimensions();
  const inset = useBandInset();
  const facts = useFacts();
  const stage = useRef<CreatureCarouselHandle>(null);
  const word = useRef<RotatingTextRef>(null);

  const draft = currentDraft();
  const known = draft.primed || draft.name !== null;
  const [name, setName] = useState<string | null>(draft.name);
  const [opened, setOpened] = useState<{ animal: Animal; chosen: boolean } | null>(() =>
    known ? { animal: openOn(draft.animal, suggestedAnimal(currentFacts().archetype?.id)), chosen: draft.animal !== null } : null,
  );
  const [animal, setAnimal] = useState<Animal | null>(opened?.animal ?? null);

  const suggestion = suggestedAnimal(facts.archetype?.id);

  // A deep link straight here, before hello primed anything: read the kv.
  useEffect(() => {
    if (opened) return;
    let live = true;
    void (async () => {
      const [n, stored] = await Promise.all([getLocalName(cache), loadAnimal(cache)]);
      if (!live) return;
      const first = openOn(stored, suggestedAnimal(currentFacts().archetype?.id));
      setName(n);
      setAnimal(first);
      setOpened({ animal: first, chosen: stored !== null });
    })();
    return () => {
      live = false;
    };
    // Read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The stage appears when the page has landed: a cut, on the frame the fade ends (a push
  // from anywhere else carries it in with the page). It is not even mounted until then: the
  // pixel creatures are a few hundred drawn cells, and building them mid fade stalled the fade.
  // Then this route gets the platform push back for its own pop.
  const landed = useLanded(fromName, NAME_TO_CREATURE_MS + 250, () => navigation.setOptions({ animation: 'default' }));

  // The archetype arrived after the stage opened on the default, and nobody has chosen yet:
  // reopen on the suggestion, once, before the person has touched anything.
  const touched = useRef(false);
  useEffect(() => {
    if (!opened || opened.chosen || touched.current || !suggestion || suggestion === opened.animal) return;
    setAnimal(suggestion);
    setOpened({ animal: suggestion, chosen: false });
  }, [suggestion, opened]);

  // The colour on screen is the app's colour: the chrome and every later step read it.
  const current = animal ?? opened?.animal ?? DEFAULT_ANIMAL;
  const stageKnown = opened !== null;
  useEffect(() => {
    // Not before the stage knows where it opens: a deep link reads the kv first.
    if (stageKnown) setAccentCreature(current);
  }, [current, stageKnown]);

  // The word that turns over opens on the creature the stage opened on, then follows it.
  const order = useMemo(() => orderFrom(opened?.animal ?? DEFAULT_ANIMAL), [opened?.animal]);
  const words = useMemo(() => order.map((a) => creatureWord(a)), [order]);
  useEffect(() => {
    word.current?.jumpTo(order.indexOf(current));
  }, [current, order]);

  const onChange = useCallback((a: Animal) => {
    touched.current = true;
    setAnimal(a);
    setDraftAnimal(a);
  }, []);
  const onSettle = useCallback((a: Animal) => {
    void saveAnimal(cache, a);
  }, []);

  const next = useCallback(async () => {
    if (!animal) return;
    setDraftAnimal(animal);
    setAccentCreature(animal);
    await saveAnimal(cache, animal);
    router.push(pathFor('tools') as Href);
  }, [animal, router]);

  const hue = creatureHue(current);
  const isSuggested = suggestion !== null && animal === suggestion;
  const inner = width - 2 * GUTTER;
  // One size for both lines, fitted to the longer of the name and the longest creature's name.
  const trimmed = name?.trim() ?? '';
  const size = Math.min(
    fitSize(LONGEST_WORD, inner, CREATURE_NAME.max, CREATURE_NAME.min),
    trimmed ? fitSize(`${trimmed},`, inner, CREATURE_NAME.max, CREATURE_NAME.min) : CREATURE_NAME.max,
  );
  const words2 = display(size);

  const band = (
    <StepBand hue={hue} inset={inset} fill print={!fromName}>
      <T role="label" style={[BAND_TITLE, { color: ON_HUE }]}>
        {CREATURE.label}
      </T>
      <View style={{ marginTop: space.sm }} accessible accessibilityRole="header" accessibilityLabel={trimmed ? `${trimmed}, ${creatureWord(current)}` : creatureWord(current)}>
        {trimmed ? (
          <T role="display" numberOfLines={1} style={[words2, { color: ON_HUE }]}>
            {`${trimmed},`}
          </T>
        ) : null}
        {opened ? (
          <Wipe start={landed} style={{ alignSelf: 'flex-start' }}>
            <RotatingText
              key={opened.animal}
              ref={word}
              texts={words}
              auto={false}
              loop
              mode="sync"
              textStyle={words2}
              color={ON_HUE}
            />
          </Wipe>
        ) : (
          <View style={{ height: words2.lineHeight }} />
        )}
      </View>
      <T role="meta" weight={600} style={{ color: ON_HUE, marginTop: space.xs }} accessibilityLiveRegion="polite">
        {isSuggested ? `${CREATURE.suggested}. ${CREATURE.theme}` : CREATURE.theme}
      </T>

      {/* The stage takes the free height and runs edge to edge, so the neighbours slide off
          the screen rather than into a box. */}
      <View style={{ flex: 1, justifyContent: 'center', marginHorizontal: -GUTTER }}>
        <View style={{ minHeight: STAGE_CREATURE + 16 }}>
          {opened && landed && (
            <CreatureCarousel
              key={opened.animal}
              ref={stage}
              initial={opened.animal}
              width={width}
              size={STAGE_CREATURE}
              onChange={onChange}
              onSettle={onSettle}
              ink={ON_HUE}
              dim={hue.partner}
              liveTone="selected"
            />
          )}
        </View>
      </View>
      <CreaturePager stage={stage} animal={animal ?? opened?.animal ?? null} tone="onAccent" />
    </StepBand>
  );

  return (
    // A keyboard frame although nothing here types: arriving from the name step, the keyboard is
    // still going down, and this Continue rides it down with the name step's.
    <StepFrame
      step="creature"
      keyboard
      scroll={false}
      band={band}
      actions={<HueButton label={CONTINUE} hue={hue} onPress={() => void next()} disabled={!opened} />}
    />
  );
}

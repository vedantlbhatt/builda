import { useLocalSearchParams, useNavigation, useRouter, type Href } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useWindowDimensions, View, type LayoutChangeEvent, type NativeSyntheticEvent, type TextLayoutEventData } from 'react-native';

import * as cache from '../../src/data/cache';
import { getLocalName } from '../../src/nav/name';
import { type Animal } from '../../src/pixel/animals';
import { openOn } from '../../src/pixel/carousel';
import { CONTINUE, CREATURE, creatureCaption } from '../../src/onboarding/copy';
import { CreatureCarousel, CreaturePager, type CreatureCarouselHandle } from '../../src/onboarding/CreatureCarousel';
import { currentDraft, setDraftAnimal } from '../../src/onboarding/draft';
import { currentFacts, useFacts } from '../../src/onboarding/facts';
import { useLanded } from '../../src/onboarding/landing';
import { GUTTER, NAME_TO_CREATURE_MS, pathFor, STAGE_CREATURE } from '../../src/onboarding/flow';
import { Headline } from '../../src/onboarding/Headline';
import { Wipe } from '../../src/onboarding/Rise';
import { loadAnimal, saveAnimal, suggestedAnimal } from '../../src/onboarding/selection';
import { StepFrame } from '../../src/onboarding/StepFrame';
import { HEADLINE } from '../../src/onboarding/type';
import { space } from '../../src/theme';
import { Button, T } from '../../src/ui';

/** Room for a two line caption: the stage under it never moves as the creature's name changes. */
const HEADLINE_BLOCK = 2 * (HEADLINE.lineHeight as number);

/**
 * Step 2: your creature (DESIGN-DIRECTION 4). The name from the step before stays where it
 * was and gains its creature: "Vedant" becomes "Vedant, the fox". The step cross fades in
 * around the name (the label changes in place, Continue is drawn exactly where the name
 * step's was), then, as the fade lands, the creature cuts in on the stage and ", the fox"
 * wipes in after the name. The creature cuts rather than fades because amber at partial
 * opacity is brown, and pixels switch; they do not dissolve.
 *
 * The stage under it is the picker `app/icon.tsx` uses (`CreatureCarousel`): swipe or flick,
 * only the centre creature animates, a selection tick per creature passed. The chevrons under
 * it are the accessible path and do the same.
 *
 * Opens on their own earlier choice, else the creature their archetype earned when the account
 * has one (said so under the headline while it is the one in the middle), else the crab. The
 * pick is saved the moment the stage comes to rest, so going back and forward keeps it. All of
 * it is known on the first frame (`src/onboarding/draft.ts`); a deep link straight here reads
 * the kv first.
 */
export default function CreatureStep() {
  const router = useRouter();
  const navigation = useNavigation();
  const { via } = useLocalSearchParams<{ via?: string }>();
  const fromName = via === 'name';
  const { width } = useWindowDimensions();
  const facts = useFacts();
  const stage = useRef<CreatureCarouselHandle>(null);

  const draft = currentDraft();
  const known = draft.primed || draft.name !== null;
  const [name, setName] = useState<string | null>(draft.name);
  const [opened, setOpened] = useState<{ animal: Animal; chosen: boolean } | null>(() =>
    known ? { animal: openOn(draft.animal, suggestedAnimal(currentFacts().archetype)), chosen: draft.animal !== null } : null,
  );
  const [animal, setAnimal] = useState<Animal | null>(opened?.animal ?? null);

  const suggestion = suggestedAnimal(facts.archetype);

  // A deep link straight here, before hello primed anything: read the kv.
  useEffect(() => {
    if (opened) return;
    let live = true;
    void (async () => {
      const [n, stored] = await Promise.all([getLocalName(cache), loadAnimal(cache)]);
      if (!live) return;
      const first = openOn(stored, suggestedAnimal(currentFacts().archetype));
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
  // pixel creatures are a few hundred drawn cells, and building them mid fade stalled the
  // fade. The wipe after the name waits for the stage to have laid out, for the same reason.
  // Then this route gets the platform push back for its own pop.
  const landed = useLanded(fromName, NAME_TO_CREATURE_MS + 250, () => navigation.setOptions({ animation: 'default' }));
  const [stageReady, setStageReady] = useState(!fromName);
  const onStageLayout = useCallback(() => setStageReady(true), []);

  // The archetype arrived after the stage opened on the default, and nobody has chosen yet:
  // reopen on the suggestion, once, before the person has touched anything.
  const touched = useRef(false);
  useEffect(() => {
    if (!opened || opened.chosen || touched.current || !suggestion || suggestion === opened.animal) return;
    setAnimal(suggestion);
    setOpened({ animal: suggestion, chosen: false });
  }, [suggestion, opened]);

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
    await saveAnimal(cache, animal);
    router.push(pathFor('tools') as Href);
  }, [animal, router]);

  // ", the fox" wipes in after the name, which is already on screen from the step before.
  // Where the wipe starts is the width of the name itself, measured off screen in the
  // headline's own style, once; a caption that wraps to two lines simply arrives with the fade.
  const isSuggested = suggestion !== null && animal === suggestion;
  const caption = animal ? creatureCaption(name, animal) : ' ';
  const measuring = fromName && !!name && !!animal;
  const [firstCaption] = useState(caption);
  const [nameWidth, setNameWidth] = useState<number | null>(null);
  const [oneLine, setOneLine] = useState<boolean | null>(null);
  const onNameLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setNameWidth((was) => (was === null ? w : was));
  }, []);
  const onCaptionLayout = useCallback((e: NativeSyntheticEvent<TextLayoutEventData>) => {
    const one = e.nativeEvent.lines.length <= 1;
    setOneLine((was) => (was === null ? one : was));
  }, []);
  const measured = !measuring || (nameWidth !== null && oneLine !== null);

  return (
    // A keyboard frame although nothing here types: arriving from the name step, the
    // keyboard is still going down, and this Continue rides it down with the name step's.
    <StepFrame step="creature" keyboard scroll={false} actions={<Button label={CONTINUE} onPress={() => void next()} disabled={!opened} />}>
      <T role="label" tone="dim">
        {CREATURE.label}
      </T>
      {/* Two lines kept for the caption and the suggestion under it, so a longer creature
          name never moves the stage. */}
      <View style={{ minHeight: HEADLINE_BLOCK, gap: space.xs }}>
        {measuring && !measured ? (
          <View
            style={{ position: 'absolute', left: 0, right: 0, top: 0, opacity: 0 }}
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <View style={{ alignSelf: 'flex-start' }} onLayout={onNameLayout}>
              <Headline>{name}</Headline>
            </View>
            <Headline numberOfLines={2} onTextLayout={onCaptionLayout}>
              {firstCaption}
            </Headline>
          </View>
        ) : null}
        {!measured ? null : measuring && oneLine ? (
          <Wipe from={nameWidth ?? 0} start={landed && stageReady} style={{ alignSelf: 'flex-start' }}>
            <Headline numberOfLines={2} accessibilityLiveRegion="polite">
              {caption}
            </Headline>
          </Wipe>
        ) : (
          <Headline numberOfLines={2} accessibilityLiveRegion="polite">
            {caption}
          </Headline>
        )}
        {isSuggested ? (
          <T role="meta" tone="dim">
            {CREATURE.suggested}
          </T>
        ) : null}
      </View>

      {/* The stage takes the free height and runs edge to edge, so the neighbours slide off
          the screen rather than into a box. */}
      <View style={{ flex: 1, justifyContent: 'center', marginHorizontal: -GUTTER, gap: space.lg }}>
        <View style={{ minHeight: STAGE_CREATURE + 16 }}>
          {opened && landed && (
            <View onLayout={onStageLayout}>
              <CreatureCarousel
                key={opened.animal}
                ref={stage}
                initial={opened.animal}
                width={width}
                size={STAGE_CREATURE}
                onChange={onChange}
                onSettle={onSettle}
              />
            </View>
          )}
        </View>
        <CreaturePager stage={stage} animal={animal ?? opened?.animal ?? null} />
      </View>
    </StepFrame>
  );
}

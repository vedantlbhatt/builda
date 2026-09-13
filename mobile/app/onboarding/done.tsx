import { useNavigation } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import * as cache from '../../src/data/cache';
import { getLocalName } from '../../src/nav/name';
import { completeOnboarding } from '../../src/nav/onboarding';
import { DEFAULT_ANIMAL, type Animal } from '../../src/pixel/animals';
import { HARNESS_MARKS, isMarkSelected } from '../../src/pixel/harness';
import { PixelAnimal, PixelAnimalIcon } from '../../src/pixel/PixelAnimal';
import { creatureCaption, DONE, doneCaption, THATS_ME } from '../../src/onboarding/copy';
import { currentDraft } from '../../src/onboarding/draft';
import { currentFacts } from '../../src/onboarding/facts';
import { burstBox, DONE_CREATURE, FINALE, RISE_PT } from '../../src/onboarding/flow';
import { Headline } from '../../src/onboarding/Headline';
import { useLanded } from '../../src/onboarding/landing';
import { PixelBurst } from '../../src/onboarding/PixelBurst';
import { foundFor, loadAnimal, loadTools, preselect, suggestedAnimal } from '../../src/onboarding/selection';
import { StepFrame } from '../../src/onboarding/StepFrame';
import { space } from '../../src/theme';
import { Button, commit, EASE, exitMs, POP, REDUCED_FADE, T, useReduceMotion } from '../../src/ui';
import { T as DUR } from '../../src/ui/motion';

/** The burst canvas: a square centred on the creature, its corner on the creature's grid. */
const BURST_BOX = burstBox();
/** The live creature settles in over a still twin; the twin goes once it is fully there. */
const TWIN_MS = 260;

interface Picked {
  name: string;
  animal: Animal;
  tools: string[];
}

/**
 * "That's me" (DESIGN-DIRECTION 4): "this is you" over "Vedant, the fox", the same line the
 * creature step ended on, and the creature they picked at the size they picked it.
 *
 * The page slides in with its label only, and the arrival plays when the push has LANDED
 * (`FINALE`): the creature pops in with the one overshoot the app allows itself (`POP`), the
 * name settles over it, and "That's me" comes up from under the screen's edge. Nothing amber
 * fades: the creature cuts in and scales (a still twin under the live one while it settles),
 * the button slides.
 *
 * Pressing "That's me" is the commitment: one Medium haptic on the press and no other, the
 * words fade and the button goes back down the way it came, the creature bursts INTO one ring
 * of pixel squares on its own grid (it is cut on the ring's densest frame), and the gate flips
 * as the ring's last square goes. Flipping the gate IS the replace into the app:
 * `Stack.Protected` drops the whole onboarding group in the same render the tabs arrive
 * (`src/nav/onboarding.ts`), so there is no onboarding route left for back, a swipe or a stale
 * link to reach. From the press on, the edge swipe is off here too.
 */
export default function DoneStep() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const reduced = useReduceMotion();
  const draft = currentDraft();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [committing, setCommitting] = useState(false);
  const [creatureGone, setCreatureGone] = useState(false);
  const [twin, setTwin] = useState(true);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    let live = true;
    void (async () => {
      const [name, animal, tools] = await Promise.all([
        draft.name ?? getLocalName(cache),
        draft.animal ?? loadAnimal(cache),
        loadTools(cache),
      ]);
      if (!live) return;
      // Nothing stored means the tools step was never answered: say what it would have picked.
      const selected = tools ?? preselect(foundFor(currentFacts().counts));
      setPicked({
        name: name ?? '',
        animal: animal ?? suggestedAnimal(currentFacts().archetype) ?? DEFAULT_ANIMAL,
        tools: HARNESS_MARKS.filter((m) => isMarkSelected(selected, m)).map((m) => m.name),
      });
    })();
    const all = timers.current;
    return () => {
      live = false;
      for (const t of all) clearTimeout(t);
    };
    // Read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const landed = useLanded(true, FINALE.landFallbackMs);
  const ready = landed && picked !== null;

  // ─── the arrival ───
  const shown = useSharedValue(0);
  const arrive = useSharedValue(0);
  const nameIn = useSharedValue(0);
  const actionIn = useSharedValue(0);
  const actionDrop = 52 + insets.bottom + space.sm;
  useEffect(() => {
    if (!ready) return;
    shown.value = 1;
    const twinTimer = setTimeout(() => setTwin(false), TWIN_MS);
    timers.current.push(twinTimer);
    if (reduced) {
      const fade = { duration: REDUCED_FADE, easing: EASE, reduceMotion: ReduceMotion.Never };
      arrive.value = 1;
      nameIn.value = withTiming(1, fade);
      actionIn.value = 1;
      return;
    }
    // Never: this step handles Reduce Motion itself (the branch above), from the live setting.
    // Reanimated's own `System` mode reads the setting once at launch and would skip these.
    const never = { reduceMotion: ReduceMotion.Never };
    arrive.value = withSpring(1, { ...POP, ...never });
    nameIn.value = withDelay(FINALE.nameAtMs, withTiming(1, { duration: DUR.enter, easing: EASE, ...never }));
    actionIn.value = withDelay(FINALE.actionAtMs, withTiming(1, { duration: DUR.enter, easing: EASE, ...never }));
  }, [ready, reduced, shown, arrive, nameIn, actionIn]);

  const creatureStyle = useAnimatedStyle(() => ({
    // A cut, never a fade: amber at partial opacity is brown.
    opacity: shown.value,
    // Ends at exactly 1: the resting creature is on whole device pixels.
    transform: [{ scale: 0.6 + 0.4 * arrive.value }],
  }));

  // ─── the press ───
  const wordsOut = useSharedValue(1);
  const actionOut = useSharedValue(0);
  const wordsStyle = useAnimatedStyle(() => ({
    opacity: nameIn.value * wordsOut.value,
    transform: [{ translateY: reduced ? 0 : (1 - nameIn.value) * RISE_PT }],
  }));
  const labelStyle = useAnimatedStyle(() => ({ opacity: wordsOut.value }));
  const actionStyle = useAnimatedStyle(() => ({
    // Always opaque: it slides up from under the screen's edge and back down the same way.
    transform: [{ translateY: (1 - actionIn.value + actionOut.value) * actionDrop }],
  }));

  // Once, whichever of the ring's end and the fallback comes first.
  const finished = useRef(false);
  const finish = useCallback(async () => {
    if (finished.current) return;
    finished.current = true;
    await completeOnboarding();
  }, []);

  const onThatsMe = useCallback(() => {
    if (committing) return;
    commit();
    setCommitting(true);
    navigation.setOptions({ gestureEnabled: false });
    const out = { duration: exitMs(DUR.enter), easing: EASE, reduceMotion: ReduceMotion.Never };
    wordsOut.value = withTiming(0, out);
    actionOut.value = reduced ? 1 : withTiming(1, out);
    const later = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));
    if (reduced) {
      // No burst: the creature goes with the words, and the flow finishes after them.
      later(0, () => setCreatureGone(true));
      later(exitMs(DUR.enter), () => void finish());
      return;
    }
    later(FINALE.creatureCutMs, () => setCreatureGone(true));
    // The ring's own end flips the gate (`onDone` below); this is only the belt.
    later(FINALE.flipFallbackMs, () => void finish());
  }, [committing, navigation, wordsOut, actionOut, reduced, finish]);

  const caption = picked ? doneCaption(picked.tools) : '';

  return (
    <StepFrame
      step="done"
      scroll={false}
      actions={
        <Animated.View style={actionStyle} pointerEvents={committing || !ready ? 'none' : 'auto'}>
          <Button label={THATS_ME} onPress={onThatsMe} disabled={!picked} />
        </Animated.View>
      }
    >
      <Animated.View style={labelStyle}>
        <T role="label" tone="dim">
          {DONE.label}
        </T>
      </Animated.View>
      <Animated.View style={[{ gap: space.sm }, wordsStyle]}>
        <Headline numberOfLines={2}>{picked ? creatureCaption(picked.name, picked.animal) : ' '}</Headline>
        {caption ? (
          <T role="body" tone="dim">
            {caption}
          </T>
        ) : null}
      </Animated.View>

      {/* The creature is the one centred thing, in the free space under the words. */}
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: DONE_CREATURE, height: DONE_CREATURE }}>
          {picked && !creatureGone && (
            <Animated.View style={[{ width: DONE_CREATURE, height: DONE_CREATURE }, creatureStyle]}>
              {twin && (
                <View style={{ position: 'absolute' }}>
                  <PixelAnimalIcon animal={picked.animal} size={DONE_CREATURE} tone="rest" />
                </View>
              )}
              {ready && (
                <View style={{ position: 'absolute' }}>
                  <PixelAnimal animal={picked.animal} size={DONE_CREATURE} />
                </View>
              )}
            </Animated.View>
          )}
          <PixelBurst
            size={BURST_BOX}
            play={committing && !reduced}
            onDone={() => void finish()}
            style={{ position: 'absolute', left: (DONE_CREATURE - BURST_BOX) / 2, top: (DONE_CREATURE - BURST_BOX) / 2 }}
          />
        </View>
      </View>
    </StepFrame>
  );
}

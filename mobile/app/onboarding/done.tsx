import { useNavigation } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import * as cache from '../../src/data/cache';
import { fitSize } from '../../src/insights/format';
import { ON_HUE } from '../../src/insights/palette';
import { RevealPage, Section } from '../../src/insights/reveal';
import { getLocalName } from '../../src/nav/name';
import { completeOnboarding } from '../../src/nav/onboarding';
import { DEFAULT_ANIMAL, type Animal } from '../../src/pixel/animals';
import { HARNESS_MARKS, isMarkSelected, type HarnessMark } from '../../src/pixel/harness';
import { HarnessLogo } from '../../src/pixel/HarnessLogo';
import { PixelAnimal, PixelAnimalIcon } from '../../src/pixel/PixelAnimal';
import { creatureCaption, creatureWord, DONE, doneCaption, THATS_ME } from '../../src/onboarding/copy';
import { currentDraft } from '../../src/onboarding/draft';
import { currentFacts, useFacts } from '../../src/onboarding/facts';
import { burstBox, chromeIndex, DONE_CREATURE, FINALE, GUTTER, RISE_PT } from '../../src/onboarding/flow';
import { ACTION_HEIGHT, HueButton, LEDGE } from '../../src/onboarding/HueButton';
import { useLanded } from '../../src/onboarding/landing';
import { PixelBurst } from '../../src/onboarding/PixelBurst';
import { Pop } from '../../src/onboarding/Pop';
import { foundFor, loadAnimal, loadTools, preselect, suggestedAnimal } from '../../src/onboarding/selection';
import { StepBand } from '../../src/onboarding/StepBand';
import { ChromeTracker } from '../../src/onboarding/StepFrame';
import { useStepPage } from '../../src/onboarding/stepPage';
import { BAND_TITLE, CREATURE_NAME, display } from '../../src/onboarding/type';
import { setAccentCreature } from '../../src/theme/accent';
import { colors, creatureHue, space } from '../../src/theme';
import { ProfileCard } from '../../src/ui/bits/components/ProfileCard';
import { archetypeWords } from '../../src/you/archetype';
import { PROFILE } from '../../src/ui/bits/components/spec';
import { ClickSpark } from '../../src/ui/bits/effects/ClickSpark';
import { Magnet } from '../../src/ui/bits/effects/Magnet';
import { PixelTransition } from '../../src/ui/bits/effects/PixelTransition';
import { EASE, exitMs, POP, REDUCED_FADE, T, useReduceMotion } from '../../src/ui';
import { T as DUR } from '../../src/ui/motion';

const c = colors('dark');

/** The burst canvas: a square centred on the creature, its corner on the creature's grid. */
const BURST_BOX = burstBox();
/** The live creature settles in over a still twin; the twin goes once it is fully there. */
const TWIN_MS = 260;
/** The widest the card is drawn (react-bits' card is 0.718 as wide as it is tall). */
const CARD_MAX = 300;
/** The marks of the tools, on the band under the card (32pt, a whole-cell size for Aider's pixel glyph). */
const MARK = 32;
/** Room the band keeps for its title, the marks and the gaps, around the stage. */
const BAND_CHROME = 20 + space.md + MARK + space.lg + space.md;
/** The spark flies past the action's own edge, onto the ground. */
const SPARK_REACH = 2;

interface Picked {
  name: string;
  animal: Animal;
  marks: HarnessMark[];
}

/**
 * "That's me", the finale, on a band in the creature's own hue (the app's colour from here on).
 *
 * It arrives when the push has LANDED (`FINALE`): the band prints itself, the creature a person
 * picked pops onto it at the size they picked it (192pt, in the band's dark ink, `POP`, the one
 * overshoot the app allows itself) under "Vedant, the crab", the line the creature step ended on,
 * and "That's me" comes up from under the screen's edge. Then the stage turns over in pixels
 * (react-bits PixelTransition, 300ms on and 300ms off, the cells in the colour's partner tone)
 * into react-bits ProfileCard in the same hue: the creature alive on its slow field, the
 * creature's name over the person's, the archetype when there is one, the card leaning toward a
 * finger. Under it on the band the tools' real marks drop in one after another (yazio's pops).
 *
 * Pressing "That's me" is the commitment: one Medium haptic, react-bits ClickSpark sparks in the
 * creature's hue from the finger (the action leans toward the thumb first, react-bits Magnet),
 * the words fade and the action goes back down the way it came, the card is cut on the densest
 * frame of one ring of pixel squares in the band's ink (`PixelBurst`), and the gate flips as the
 * ring's last square goes. Flipping the gate IS the replace into the app: `Stack.Protected` drops
 * the whole onboarding group in the same render the tabs arrive (`src/nav/onboarding.ts`), so
 * there is no onboarding route left for back, a swipe or a stale link to reach. From the press
 * on, the edge swipe is off here too.
 *
 * Reduce Motion: the band, the creature and the card are simply there (the card replaces the
 * creature with a fade), nothing leans, no sparks and no burst.
 */
export default function DoneStep() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const reduced = useReduceMotion();
  const draft = currentDraft();
  const facts = useFacts();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [committing, setCommitting] = useState(false);
  const [stageGone, setStageGone] = useState(false);
  const [twin, setTwin] = useState(true);
  const [card, setCard] = useState(false);
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
      const chosen = animal ?? suggestedAnimal(currentFacts().archetype?.id) ?? DEFAULT_ANIMAL;
      setAccentCreature(chosen);
      setPicked({
        name: name ?? '',
        animal: chosen,
        marks: HARNESS_MARKS.filter((m) => isMarkSelected(selected, m)),
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
  const page = useStepPage(ready);

  // ─── the arrival ───
  const shown = useSharedValue(0);
  const arrive = useSharedValue(0);
  const nameIn = useSharedValue(0);
  const actionIn = useSharedValue(0);
  const actionDrop = ACTION_HEIGHT + LEDGE + insets.bottom + space.sm;
  useEffect(() => {
    if (!ready) return;
    const later = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));
    later(FINALE.nameAtMs + TWIN_MS, () => setTwin(false));
    later(FINALE.cardAtMs, () => setCard(true));
    if (reduced) {
      const fade = { duration: REDUCED_FADE, easing: EASE, reduceMotion: ReduceMotion.Never };
      shown.value = 1;
      arrive.value = 1;
      nameIn.value = withTiming(1, fade);
      actionIn.value = 1;
      return;
    }
    // Never: this step handles Reduce Motion itself (the branch above), from the live setting.
    // Reanimated's own `System` mode reads the setting once at launch and would skip these.
    const never = { reduceMotion: ReduceMotion.Never };
    // The creature cuts in (a dark ink at partial opacity is a smudge) and pops, once the band
    // under it has printed most of its cells.
    shown.value = withDelay(FINALE.nameAtMs, withTiming(1, { duration: 1, ...never }));
    arrive.value = withDelay(FINALE.nameAtMs, withSpring(1, { ...POP, ...never }));
    nameIn.value = withDelay(FINALE.nameAtMs, withTiming(1, { duration: DUR.enter, easing: EASE, ...never }));
    actionIn.value = withDelay(FINALE.actionAtMs, withTiming(1, { duration: DUR.enter, easing: EASE, ...never }));
  }, [ready, reduced, shown, arrive, nameIn, actionIn]);

  const creatureStyle = useAnimatedStyle(() => ({
    opacity: shown.value,
    // Ends at exactly 1: the resting creature is on whole device pixels.
    transform: [{ scale: 0.6 + 0.4 * arrive.value }],
  }));

  // ─── the press ───
  const wordsOut = useSharedValue(1);
  const actionOut = useSharedValue(0);
  const risePt = RISE_PT;
  const wordsStyle = useAnimatedStyle(() => ({
    opacity: nameIn.value * wordsOut.value,
    transform: [{ translateY: (1 - nameIn.value) * risePt }],
  }));
  const titleStyle = useAnimatedStyle(() => ({ opacity: wordsOut.value }));
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
    setCommitting(true);
    navigation.setOptions({ gestureEnabled: false });
    const out = { duration: exitMs(DUR.enter), easing: EASE, reduceMotion: ReduceMotion.Never };
    wordsOut.value = withTiming(0, out);
    actionOut.value = reduced ? 1 : withTiming(1, out);
    const later = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));
    if (reduced) {
      // No burst: the card goes with the words, and the flow finishes after them.
      later(0, () => setStageGone(true));
      later(exitMs(DUR.enter), () => void finish());
      return;
    }
    later(FINALE.creatureCutMs, () => setStageGone(true));
    // The ring's own end flips the gate (`onDone` below); this is only the belt.
    later(FINALE.flipFallbackMs, () => void finish());
  }, [committing, navigation, wordsOut, actionOut, reduced, finish]);

  // ─── the stage ───
  const hue = creatureHue(picked?.animal ?? DEFAULT_ANIMAL);
  const room = height - insets.top - space.md - BAND_CHROME - 36 - (ACTION_HEIGHT + LEDGE + space.sm * 2 + insets.bottom);
  const stageH = Math.max(DONE_CREATURE + 120, Math.min(Math.round(Math.min(CARD_MAX, width - 2 * GUTTER) / PROFILE.aspect), room));
  const cardW = Math.round(stageH * PROFILE.aspect);
  // Where the creature sits: in the middle of the stage before the card, in the middle of the
  // card's art band after (ProfileCard's own layout), so the ring leaves from it either way.
  const art = Math.round(stageH * PROFILE.artShare);
  const burstY = card ? art / 2 : stageH - DONE_CREATURE / 2 - space.md;
  const captionSize = picked ? fitSize(creatureCaption(picked.name, picked.animal).split(', ')[0] ?? '', cardW, CREATURE_NAME.max, CREATURE_NAME.min) : CREATURE_NAME.min;
  // The type every other screen names (the Mac's, else the server's, which says so).
  const typeWords = archetypeWords(facts.archetype);
  const caption = picked ? doneCaption(picked.marks.map((m) => m.name)) : '';

  const first = picked ? (
    <View style={{ width: cardW, height: stageH, justifyContent: 'space-between' }}>
      <Animated.View style={wordsStyle}>
        <T role="display" numberOfLines={2} style={[display(captionSize), { color: ON_HUE }]}>
          {creatureCaption(picked.name, picked.animal)}
        </T>
      </Animated.View>
      <View style={{ alignItems: 'center', paddingBottom: space.md }}>
        <Animated.View style={[{ width: DONE_CREATURE, height: DONE_CREATURE }, creatureStyle]}>
          {twin && (
            <View style={{ position: 'absolute' }}>
              <PixelAnimalIcon animal={picked.animal} size={DONE_CREATURE} tone="selected" />
            </View>
          )}
          {ready && (
            <View style={{ position: 'absolute' }}>
              <PixelAnimal animal={picked.animal} size={DONE_CREATURE} tone="selected" />
            </View>
          )}
        </Animated.View>
      </View>
    </View>
  ) : (
    <View style={{ width: cardW, height: stageH }} />
  );

  const second = picked ? (
    <ProfileCard
      creature={picked.animal}
      name={picked.name || creatureWord(picked.animal)}
      caption={picked.name ? creatureWord(picked.animal) : DONE.label}
      archetype={typeWords}
      width={cardW}
      height={stageH}
      active={!committing}
    />
  ) : (
    <View style={{ width: cardW, height: stageH }} />
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      {/* The finale's place in the flow: the chevron fades and the bars go as this page arrives. */}
      <ChromeTracker index={chromeIndex('done')} />
      <RevealPage page={page}>
        <Section style={{ flex: 1 }}>
          <StepBand hue={hue} inset={insets.top + space.md} fill>
            <Animated.View style={titleStyle}>
              <T role="label" style={[BAND_TITLE, { color: ON_HUE }]}>
                {DONE.label}
              </T>
            </Animated.View>
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ width: cardW, height: stageH }}>
                {!stageGone ? (
                  <PixelTransition
                    first={first}
                    second={second}
                    active={card}
                    hue={{ ...hue, ink: hue.partner }}
                    style={{ width: cardW, height: stageH }}
                  />
                ) : null}
                <PixelBurst
                  size={BURST_BOX}
                  ink={ON_HUE}
                  play={committing && !reduced}
                  onDone={() => void finish()}
                  style={{ position: 'absolute', left: (cardW - BURST_BOX) / 2, top: burstY - BURST_BOX / 2 }}
                />
              </View>
            </View>
            <Animated.View
              style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.md, minHeight: MARK, marginTop: space.md }, titleStyle]}
              accessible={caption.length > 0}
              accessibilityLabel={caption || undefined}
            >
              {picked?.marks.map((m, i) => (
                <Pop key={m.id} index={i} delay={FINALE.logosAtMs} play={ready}>
                  <HarnessLogo harness={m.harnesses[0]!} size={MARK} color={ON_HUE} />
                </Pop>
              ))}
            </Animated.View>
          </StepBand>
          <Animated.View
            style={[{ marginHorizontal: GUTTER, marginTop: space.sm, marginBottom: insets.bottom + space.sm }, actionStyle]}
            pointerEvents={committing || !ready ? 'none' : 'auto'}
          >
            <Magnet disabled={committing}>
              <ClickSpark hue={hue} extraScale={SPARK_REACH} disabled={committing}>
                <HueButton label={THATS_ME} hue={hue} onPress={onThatsMe} disabled={!picked} haptic="commit" />
              </ClickSpark>
            </Magnet>
          </Animated.View>
        </Section>
      </RevealPage>
    </View>
  );
}

import { Stack, useSegments } from 'expo-router';
import React, { useEffect } from 'react';
import { View } from 'react-native';
import { ReanimatedScreenProvider } from 'react-native-screens/reanimated';

import * as cache from '../../src/data/cache';
import { OnboardingChrome } from '../../src/onboarding/Chrome';
import { chromeAt } from '../../src/onboarding/chromeProgress';
import { primeDraft, resetDraft } from '../../src/onboarding/draft';
import { loadFacts } from '../../src/onboarding/facts';
import { isFlowStep, NAME_TO_CREATURE_MS } from '../../src/onboarding/flow';
import { PixelDissolve } from '../../src/onboarding/PixelDissolve';
import { nav } from '../../src/nav/Skeleton';

/**
 * Onboarding: seven routes on one native stack (DESIGN-DIRECTION 4). Every step is a push, so
 * the edge swipe and the chevron go back one step; nothing here blocks back.
 *
 *   hello, through the pixel dissolve, to name, a cross fade to creature, then pushes to
 *   tools, connect, notify and done
 *
 * Above the stack, drawn once: the chrome (back chevron and the segmented progress bar, which
 * stays put while the steps push under it and fills with them, `StepFrame`) and the pixel
 * dissolve that carries hello into the name step. The name step arrives with no native animation, because the dissolve IS its
 * transition; the creature step arrives as a cross fade, so the name typed on one step stays
 * where it is and becomes the start of the next step's caption. Each restores the platform
 * push for its own pop afterwards.
 *
 * The whole group sits behind `Stack.Protected guard={!onboarded}` in the root layout.
 * "That's me" on `done` flips the gate, which removes this group from the root stack in the
 * same render the tabs arrive, so there is no onboarding route left for back, a swipe or a
 * stale link to reach. A deep link into a step (`builder://onboarding/name`) lands with
 * `hello` underneath, so back from it still walks the flow.
 */
export const unstable_settings = { initialRouteName: 'hello' };

/**
 * How far in from the left edge a back swipe may start on the creature step. react-native-screens
 * reads `end` as the furthest x a full screen swipe may begin at (and `start` as the nearest).
 */
const EDGE_SWIPE = 24;

type Via = { via?: string } | undefined;

export default function OnboardingLayout() {
  const segments = useSegments() as string[];
  const leaf = segments[segments.length - 1];
  const step = isFlowStep(leaf) ? leaf : null;

  // Account facts (name, session counts, archetype) and what an earlier run of the flow
  // stored load while Bit says hello, so every step after it draws its first frame whole.
  useEffect(() => {
    resetDraft();
    void primeDraft(cache);
    void loadFacts();
    // A new run of the flow starts on hello, with the chrome there too.
    if (step === 'hello' || step === null) chromeAt.value = 0;
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: nav.bg }}>
      {/* The steps report their native transition progress on the UI thread (react-native-screens'
          Reanimated screens), and the chrome above the stack is drawn from it. */}
      <ReanimatedScreenProvider>
        <Stack
          screenOptions={{
            headerShown: false,
            gestureEnabled: true,
            fullScreenGestureEnabled: true,
            contentStyle: { backgroundColor: nav.bg },
          }}
        >
          <Stack.Screen name="hello" />
          {/* Under the pixel cells it arrives with no animation of its own; without them (no
              picture of hello yet, a deep link) it fades in. */}
          <Stack.Screen
            name="name"
            options={({ route }) => ({
              animation: (route.params as Via)?.via === 'cells' ? 'none' : 'fade',
            })}
          />
          {/* From the name step it cross fades (the name stays put, the page changes around it).
              The stage pans both ways, so back is a swipe from the left edge here, not from
              anywhere on the screen: a drag that starts on a creature moves the creatures. */}
          <Stack.Screen
            name="creature"
            options={({ route }) => ({
              animation: (route.params as Via)?.via === 'name' ? 'fade' : 'default',
              animationDuration: NAME_TO_CREATURE_MS,
              gestureResponseDistance: { end: EDGE_SWIPE },
            })}
          />
          <Stack.Screen name="tools" />
          <Stack.Screen name="connect" />
          <Stack.Screen name="notify" />
          <Stack.Screen name="done" />
        </Stack>
      </ReanimatedScreenProvider>
      <OnboardingChrome step={step} />
      <PixelDissolve />
    </View>
  );
}

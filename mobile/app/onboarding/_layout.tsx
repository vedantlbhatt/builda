import { Stack } from 'expo-router';
import React from 'react';

import { nav } from '../../src/nav/Skeleton';

/**
 * Onboarding: six steps on a native stack, pushed one after another so the edge swipe and back
 * go to the previous step (DESIGN-DIRECTION 4). No navigation bar: each step draws its own
 * progress and title.
 *
 * The whole group sits behind `Stack.Protected guard={!onboarded}` in the root layout.
 * Finishing flips the guard, which removes this group from the root stack entirely, so there
 * is no route left for back to return to. A deep link into a step (`builder://onboarding/name`)
 * lands with `hello` underneath, so back from it still walks the flow.
 */
export const unstable_settings = { initialRouteName: 'hello' };

export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        gestureEnabled: true,
        fullScreenGestureEnabled: true,
        contentStyle: { backgroundColor: nav.bg },
      }}
    >
      <Stack.Screen name="hello" />
      <Stack.Screen name="name" />
      <Stack.Screen name="creature" />
      <Stack.Screen name="tools" />
      <Stack.Screen name="connect" />
      <Stack.Screen name="notify" />
    </Stack>
  );
}

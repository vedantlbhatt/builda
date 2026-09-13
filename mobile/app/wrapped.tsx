import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { Text } from 'react-native';

import { clampCard, WRAPPED_CARDS } from '../src/nav/rules';
import { nav, QuietButton, RouteSkeleton } from '../src/nav/Skeleton';

/**
 * Wrapped: the fifteen cards as a story, one at a time. Presented full screen over the tabs
 * with its own Close (immersive content, the skill's navigation law 2). `?card=N` opens on
 * card N, 1 to 15, so the screenshot harness can reach any card directly.
 *
 * Skeleton; the design is DESIGN-DIRECTION 6 (anatomy, the dither header, the card stack).
 */
export default function WrappedScreen() {
  const router = useRouter();
  const { card } = useLocalSearchParams<{ card?: string }>();
  const n = clampCard(card);
  return (
    <RouteSkeleton title="Wrapped" note="Fifteen questions about how you build, one card each." headerless>
      <Text style={{ color: nav.text, fontSize: 17, fontWeight: '600', fontVariant: ['tabular-nums'] }}>
        {`card ${n} of ${WRAPPED_CARDS}`}
      </Text>
      <QuietButton
        label="Close"
        onPress={() => (router.canGoBack() ? router.back() : router.dismissTo('/you'))}
      />
    </RouteSkeleton>
  );
}

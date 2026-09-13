import { useRouter } from 'expo-router';
import React, { type ReactNode } from 'react';
import { Text, View } from 'react-native';

import { nextOnboardingStep, onboardingPosition, type OnboardingStep } from './rules';
import { PrimaryButton, RouteSkeleton, nav } from './Skeleton';

/**
 * One onboarding step as a skeleton: title, where it is in the flow, the route params, any
 * step-specific body, and Continue pushing the next step. The real steps replace this file's
 * callers one by one (DESIGN-DIRECTION 4 has the design for each).
 */
export function OnboardingStepSkeleton({
  step,
  title,
  note,
  children,
  action,
}: {
  step: OnboardingStep;
  title: string;
  note?: string;
  children?: ReactNode;
  /** Replaces the default Continue (which pushes the next step). */
  action?: ReactNode;
}) {
  const router = useRouter();
  const next = nextOnboardingStep(step);
  const { n, of } = onboardingPosition(step);
  return (
    <RouteSkeleton title={title} note={note} headerless>
      <Text
        style={{
          color: nav.textDim,
          fontSize: 12,
          fontWeight: '600',
          letterSpacing: 0.2,
          fontVariant: ['tabular-nums'],
        }}
      >
        {`step ${n} of ${of}`}
      </Text>
      {children}
      <View style={{ marginTop: 8 }}>
        {action ?? (next ? <PrimaryButton onPress={() => router.push(next)} /> : null)}
      </View>
    </RouteSkeleton>
  );
}

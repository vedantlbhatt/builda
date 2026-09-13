import React from 'react';

import { OnboardingStepSkeleton } from '../../src/nav/OnboardingStep';

/**
 * Step 4: connect your Mac. Skeleton; the design embeds the pairing flow from `app/pair.tsx`
 * (DESIGN-DIRECTION 4, "Connect"). Pairing needs an account and onboarding must not, so the
 * real step offers sign in here and lets "Continue" skip both.
 */
export default function ConnectStep() {
  return (
    <OnboardingStepSkeleton
      step="connect"
      title="Connect your Mac"
      note="Scan the code the Mac shows. You can do this later from Settings."
    />
  );
}

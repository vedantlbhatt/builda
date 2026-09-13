import React from 'react';

import { OnboardingStepSkeleton } from '../../src/nav/OnboardingStep';

/**
 * Step 2: your creature. Skeleton; the design reuses `app/icon.tsx` and `src/pixel/carousel.ts`
 * with a pan (DESIGN-DIRECTION 4, "Your creature") and stores the pick under the same key.
 */
export default function CreatureStep() {
  return (
    <OnboardingStepSkeleton
      step="creature"
      title="Your creature"
      note="One of eight pixel animals. It goes on your profile and on everything you share."
    />
  );
}

import React from 'react';

import { OnboardingStepSkeleton } from '../../src/nav/OnboardingStep';

/** Step 0: Bit says hello. Skeleton; the design is DESIGN-DIRECTION 4, "Hello". */
export default function HelloStep() {
  return (
    <OnboardingStepSkeleton
      step="hello"
      title="Builder"
      note="Your build sessions, with a shape and a story. This step becomes Bit's hello."
    />
  );
}

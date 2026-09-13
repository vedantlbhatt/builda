import * as Haptics from 'expo-haptics';
import React, { useCallback, useState } from 'react';

import { completeOnboarding } from '../../src/nav/onboarding';
import { OnboardingStepSkeleton } from '../../src/nav/OnboardingStep';
import { PrimaryButton } from '../../src/nav/Skeleton';

/**
 * Step 5: stay in the loop, then "That's me". Skeleton; the design is the priming timeline and
 * the creature's arrival (DESIGN-DIRECTION 4, "Stay in the loop").
 *
 * Finishing is the one-way door. `completeOnboarding` flips the gate, the root stack swaps the
 * onboarding group for the tabs in one render and lands on Now, and no onboarding route is
 * left in history for back, the edge swipe or a stale link to reach. This screen does not
 * navigate itself: by the time a navigation could run, this route no longer exists.
 */
export default function NotifyStep() {
  const [done, setDone] = useState(false);

  const finish = useCallback(async () => {
    if (done) return;
    setDone(true);
    // A commitment (DESIGN-DIRECTION 3.6): Medium, on the same frame as the press.
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    await completeOnboarding();
  }, [done]);

  return (
    <OnboardingStepSkeleton
      step="notify"
      title="Stay in the loop"
      note="A tap when a session finishes and when an agent needs you. Live on your lock screen while one runs."
      action={<PrimaryButton label="That's me" onPress={() => void finish()} disabled={done} />}
    />
  );
}

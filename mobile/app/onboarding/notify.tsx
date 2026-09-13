import * as Notifications from 'expo-notifications';
import { useRouter, type Href } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';

import { api } from '../../src/data/client';
import { CONTINUE, NOT_NOW, NOTIFY } from '../../src/onboarding/copy';
import { pathFor } from '../../src/onboarding/flow';
import { Headline } from '../../src/onboarding/Headline';
import { StepFrame } from '../../src/onboarding/StepFrame';
import { Timeline, type TimelineRow } from '../../src/onboarding/Timeline';
import { registerForPush } from '../../src/push/push';
import { space } from '../../src/theme';
import { Button, T } from '../../src/ui';

const ROWS: readonly TimelineRow[] = [
  { symbol: 'flag.checkered', ...NOTIFY.rows[0] },
  { symbol: 'hand.raised', ...NOTIFY.rows[1] },
  { symbol: 'lock.iphone', ...NOTIFY.rows[2] },
];

/**
 * Step 5: stay in the loop (DESIGN-DIRECTION 4). What Builda will tap you about, as the
 * paywall studies' trial timeline (three rows on a 3pt connector), before iOS asks. Continue
 * raises the system prompt; "Not now" is a text button of equal weight and asks nothing, so
 * the prompt is never spent on someone who has already said no.
 *
 * With permission and an account, the APNs token is registered at once (`registerForPush`,
 * which on the simulator stops at "no token" by design). Either way the flow moves on to
 * "That's me". It arrives with the push and nothing else.
 */
export default function NotifyStep() {
  const router = useRouter();
  const asking = useRef(false);
  const [busy, setBusy] = useState(false);

  const next = useCallback(() => {
    router.push(pathFor('done') as Href);
  }, [router]);

  const ask = useCallback(async () => {
    if (asking.current) return;
    asking.current = true;
    setBusy(true);
    try {
      const now = await Notifications.getPermissionsAsync();
      let granted = now.granted;
      if (!granted && now.canAskAgain) {
        granted = (await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } }))
          .granted;
      }
      if (granted && (await api.isSignedIn())) void registerForPush(api).catch(() => undefined);
    } catch {
      // A prompt that failed to show is the same as "not now": the flow goes on.
    } finally {
      asking.current = false;
      setBusy(false);
    }
    next();
  }, [next]);

  return (
    <StepFrame
      step="notify"
      actions={
        <>
          <Button label={CONTINUE} onPress={() => void ask()} busy={busy} />
          <Button kind="secondary" label={NOT_NOW} onPress={next} disabled={busy} />
        </>
      }
    >
      <T role="label" tone="dim">
        {NOTIFY.label}
      </T>
      <Headline>{NOTIFY.headline}</Headline>
      <View style={{ marginTop: space.lg }}>
        <Timeline rows={ROWS} />
      </View>
    </StepFrame>
  );
}

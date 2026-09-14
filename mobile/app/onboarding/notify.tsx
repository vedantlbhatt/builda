import * as Notifications from 'expo-notifications';
import { useRouter, type Href } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';

import { api } from '../../src/data/client';
import { BandWords } from '../../src/insights/Band';
import { ON_HUE } from '../../src/insights/palette';
import { CONTINUE, NOT_NOW, NOTIFY } from '../../src/onboarding/copy';
import { pathFor } from '../../src/onboarding/flow';
import { HueButton } from '../../src/onboarding/HueButton';
import { useLanded } from '../../src/onboarding/landing';
import { StepBand } from '../../src/onboarding/StepBand';
import { StepFrame, useBandInset } from '../../src/onboarding/StepFrame';
import { Timeline, type TimelineRow } from '../../src/onboarding/Timeline';
import { BAND_TITLE, HEADLINE } from '../../src/onboarding/type';
import { registerForPush } from '../../src/push/push';
import { useAccent } from '../../src/theme/accent';
import { space } from '../../src/theme';
import { T } from '../../src/ui';

/** In the order they happen to a session: it runs, it stops to ask, it finishes. */
const ROWS: readonly TimelineRow[] = [
  { symbol: 'lock.iphone', ...NOTIFY.rows[0] },
  { symbol: 'hand.raised', ...NOTIFY.rows[1] },
  { symbol: 'flag.checkered', ...NOTIFY.rows[2] },
];

/** How long to wait for the push to land before the rows arrive anyway (a deep link). */
const LAND_FALLBACK_MS = 450;

/**
 * Step 5: stay in the loop, as a chapter. The band in the builder's colour says it in four
 * words; under it, on the ground, what Builda will tap you about, primed the way facetune primes
 * its trial (appllama-top-paywall-screens): a timeline in the order it happens, "while it runs",
 * "when it stops to ask", "when it finishes", on facetune's geometry, the rows arriving one
 * after another as react-bits AnimatedList's do once the push has landed (`Timeline`).
 *
 * Continue raises the system prompt; "Not now" is a text button of equal weight and asks
 * nothing, so the prompt is never spent on someone who has already said no. With permission and
 * an account, the APNs token is registered at once (`registerForPush`, which on the simulator
 * stops at "no token" by design). Either way the flow moves on to "That's me".
 */
export default function NotifyStep() {
  const router = useRouter();
  const accent = useAccent();
  const inset = useBandInset();
  const landed = useLanded(true, LAND_FALLBACK_MS);
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

  const band = (
    <StepBand hue={accent} inset={inset}>
      <T role="label" style={[BAND_TITLE, { color: ON_HUE }]}>
        {NOTIFY.label}
      </T>
      <BandWords delay={260}>
        <T role="display" accessibilityRole="header" style={[HEADLINE, { color: ON_HUE, marginTop: space.sm }]}>
          {NOTIFY.headline}
        </T>
      </BandWords>
    </StepBand>
  );

  return (
    <StepFrame
      step="notify"
      band={band}
      actions={
        <>
          <HueButton label={CONTINUE} hue={accent} onPress={() => void ask()} busy={busy} />
          <HueButton kind="secondary" label={NOT_NOW} hue={accent} onPress={next} disabled={busy} />
        </>
      }
    >
      <View style={{ marginTop: space.sm }}>{landed ? <Timeline rows={ROWS} hue={accent} /> : null}</View>
    </StepFrame>
  );
}

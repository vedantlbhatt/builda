import { Redirect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import * as cache from '../src/data/cache';
import { api } from '../src/data/client';
import { loadOnboarded, resetOnboarding, sendPendingName, setOnboarded, useOnboarded } from '../src/nav/onboarding';
import { devAuthLanding, parseDevAuth } from '../src/nav/rules';
import { nav, QuietButton } from '../src/nav/Skeleton';
import { registerForPush } from '../src/push/push';

/**
 * `builder://dev-auth?access=<jwt>&refresh=<token>[&onboarded=1|&reset=1][&signout=1][&to=/path]`
 *
 * Signs the simulator in without Apple or Google, for end to end runs and the screenshot
 * harness (usage in `src/nav/DEEPLINKS.md`). The tokens go through `api.setTokens`, the one
 * call every real sign-in ends with, so storage is the Api's own and nothing is duplicated;
 * then the same follow-ups a real sign-in makes (push registration, the pending name).
 *
 * DEV ONLY, twice over: the root layout registers this route only when `__DEV__` is true, so a
 * release build has no such route and the link lands nowhere; and if it were ever rendered in
 * a release build it touches nothing and redirects. Tokens are never shown or logged.
 */
export default function DevAuthRoute() {
  if (!__DEV__) return <Redirect href="/now" />;
  return <DevAuth />;
}

type Phase =
  | { kind: 'working' }
  | { kind: 'applied'; target: string; gate: boolean }
  | { kind: 'refused'; message: string };

function DevAuth() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const gate = useOnboarded();
  const [phase, setPhase] = useState<Phase>({ kind: 'working' });

  // A second link while this screen is focused replaces the params in place; key on content.
  const key = JSON.stringify(params);
  const req = useMemo(() => parseDevAuth(params), [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    setPhase({ kind: 'working' });
    (async () => {
      if (req.problem) {
        setPhase({ kind: 'refused', message: req.problem });
        return;
      }
      if (req.signOut) {
        // Exactly what Settings' sign-out does.
        await api.clearTokens();
        await cache.clear();
      }
      if (req.tokens) {
        await api.setTokens(req.tokens.access, req.tokens.refresh);
        void registerForPush(api).catch(() => {});
      }
      if (req.onboarded === true) await setOnboarded(true);
      if (req.onboarded === false) await resetOnboarding();
      if (req.tokens) void sendPendingName();
      const now = await loadOnboarded();
      if (!cancelled) setPhase({ kind: 'applied', target: devAuthLanding(now, req.to), gate: now });
    })().catch((e: unknown) => {
      if (!cancelled) setPhase({ kind: 'refused', message: e instanceof Error ? e.message : 'failed' });
    });
    return () => {
      cancelled = true;
    };
  }, [req]);

  // Leave only once the root layout has committed the gate this link produced, so the
  // destination is a route the navigator has. `dismissTo` pops back to the tabs when they are
  // already underneath and replaces this screen when they are not, so dev-auth never stays in
  // history and never stacks a second copy of the tabs.
  useEffect(() => {
    if (phase.kind !== 'applied' || gate !== phase.gate) return;
    router.dismissTo(phase.target as Href);
  }, [phase, gate, router]);

  return (
    <View style={{ flex: 1, backgroundColor: nav.bg, paddingHorizontal: 16, paddingTop: 96, gap: 8 }}>
      <Text style={{ color: nav.text, fontSize: 22, fontWeight: '700' }}>Dev auth</Text>
      <Text style={{ color: phase.kind === 'refused' ? nav.text : nav.textDim, fontSize: 15 }}>
        {phase.kind === 'refused' ? `Refused: ${phase.message}` : 'Applying the link'}
      </Text>
      {/* A refused link applied nothing; leave to wherever the app already was. */}
      {phase.kind === 'refused' && (
        <QuietButton
          label="Close"
          onPress={() => router.dismissTo(devAuthLanding(gate ?? false, null) as Href)}
        />
      )}
    </View>
  );
}

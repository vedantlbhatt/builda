import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { RefreshControl, ScrollView } from 'react-native';

import type { SessionDetail } from '../../src/data/api';
import * as cache from '../../src/data/cache';
import { api } from '../../src/data/client';
import { LiveSessions } from '../../src/live/LiveSessions';
import { PixelBadge } from '../../src/pixel/PixelBadge';
import { colors, layout, space } from '../../src/theme';
import { Row, Surface } from '../../src/ui';

const c = colors('dark');

/** Same cadence as Sessions and the Mac's live upload. */
const LIVE_REFRESH_MS = 60_000;

/**
 * Now: what is running. For this build it is the existing live list, the empty state from
 * DESIGN-DIRECTION 7.1 and the way into mission control (`/live`); the two-per-row tiles
 * replace the list when mission control is built.
 *
 * Cache first, then a sync while focused, exactly as Sessions does, so switching tabs never
 * shows a spinner and only the focused tab polls.
 */
export default function NowScreen() {
  const router = useRouter();
  const [live, setLive] = useState<SessionDetail[] | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  // The last sync failed. With no live rows cached, "Nothing needs you" would be a claim
  // about the sessions made without having seen them; the screen says it could not check.
  const [syncError, setSyncError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const cached = await cache.listLive();
    setLive(cached);
    const isIn = await api.isSignedIn();
    setSignedIn(isIn);
    if (!isIn) return;
    try {
      await cache.sync(api);
      setSyncError(null);
    } catch (e) {
      // Cached live rows are still the answer when there are some.
      setSyncError(e instanceof Error ? e.message : 'Builder is not reachable right now.');
    }
    setLive(await cache.listLive());
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load();
      const timer = setInterval(() => void load(), LIVE_REFRESH_MS);
      return () => clearInterval(timer);
    }, [load])
  );

  const open = (id: string) => router.push(`/session/${id}`);
  const nothing = live !== null && live.length === 0;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={
        signedIn ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.accent} /> : undefined
      }
      contentContainerStyle={{
        paddingHorizontal: layout.gutter,
        paddingTop: space.md,
        paddingBottom: space.xxl,
        gap: layout.sectionGap,
      }}
    >
      <LiveSessions sessions={live ?? []} onPress={open} />

      {nothing && signedIn === false && (
        <PixelBadge
          state="sleeping"
          size={64}
          title="Nothing running that we can see."
          text="Sign in from Settings, the gear on You, and running sessions show up here."
          style={{ padding: 0 }}
        />
      )}
      {nothing && signedIn === true && syncError === null && (
        <PixelBadge
          state="sleeping"
          size={64}
          title="Nothing needs you."
          text="Go do something else. We'll tap you when that changes."
          style={{ padding: 0 }}
        />
      )}
      {nothing && signedIn === true && syncError !== null && (
        <PixelBadge
          state="sleeping"
          size={64}
          title="Could not check what is running."
          text={`${syncError} Pull down to try again.`}
          style={{ padding: 0 }}
        />
      )}

      <Surface padding={0}>
        <Row
          title="Mission control"
          meta={live && live.length > 0 ? `${live.length} running` : 'every running session, full screen'}
          chevron
          onPress={() => router.push('/live')}
        />
      </Surface>
    </ScrollView>
  );
}

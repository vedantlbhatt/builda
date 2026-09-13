import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, useWindowDimensions, View } from 'react-native';

import { api, SAMPLE_SESSION } from '../../src/data/client';
import * as cache from '../../src/data/cache';
import type { SessionDetail } from '../../src/data/api';
import { LiveSessions } from '../../src/live/LiveSessions';
import { PixelBadge } from '../../src/pixel/PixelBadge';
import { recapEligible } from '../../src/recap/format';
import { TimelineStrip } from '../../src/strip/TimelineStrip';
import { decodeMarks } from '../../src/strip/decode';
import { colors, dayLabel, duration, hitSlopToReach, layout, space } from '../../src/theme';
import { Row, SHAPE, Surface, T } from '../../src/ui';

const c = colors('dark');

/** The Recap capsule's height; its hit area grows to the 44pt floor. */
const RECAP_HEIGHT = 22;

/** How often the list re-syncs while it is on screen; matches the Mac's live upload cadence. */
const LIVE_REFRESH_MS = 60_000;

export default function SessionsScreen() {
  const { width } = useWindowDimensions();
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionDetail[]>([]);
  const [live, setLive] = useState<SessionDetail[]>([]);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Cache first, always. On a cold launch over cellular this is the difference between
    // real content immediately and a spinner — and if the network is gone, stale data is
    // a far better answer than an empty screen.
    const cached = await cache.listSessions(50);
    if (cached.length) setSessions(cached);
    setLive(await cache.listLive());

    const isIn = await api.isSignedIn();
    setSignedIn(isIn);
    if (!isIn) {
      setSessions(cached.length ? cached : [SAMPLE_SESSION]);
      setLive([]);
      return;
    }

    try {
      await cache.sync(api);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not reach the server');
    }
    // Whatever the sync managed to save is shown, banner or not.
    setSessions(await cache.listSessions(50));
    setLive(await cache.listLive());
  }, []);

  // On focus, not on mount: coming back from Settings after signing in should show the
  // user's own sessions without a manual pull-to-refresh. While focused, re-sync once a
  // minute so a live session's numbers move; the interval dies on blur.
  useFocusEffect(
    useCallback(() => {
      void load();
      const timer = setInterval(() => {
        void load();
      }, LIVE_REFRESH_MS);
      return () => clearInterval(timer);
    }, [load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (signedIn === null) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: c.bg }}>
        <ActivityIndicator color={c.accent} />
      </View>
    );
  }

  // The strip runs inside a row inside a surface: the gutter both sides, the surface's
  // hairline, and the row's own gutter both sides.
  const stripWidth = width - layout.gutter * 2 - 2 - layout.gutter * 2;
  // One clock for the whole list, so two rows never disagree about "the last hour".
  const now = Date.now();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        paddingHorizontal: layout.gutter,
        paddingTop: space.md,
        paddingBottom: space.xxl,
        gap: layout.sectionGap,
      }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.accent} />}
    >
      {/* The Feed / Profile / Settings pills that sat here are gone: Profile is the You tab,
          Settings is the gear on You, and the feed is out of the navigation (brief: no
          social layer for now; the routes still exist and open by link). */}
      <LiveSessions sessions={live} onPress={(id) => router.push(`/session/${id}`)} />

      {/* A note, not an alarm: Bit and two lines on the canvas, the same block Now and You
          open with when there is nothing of yours yet. Not a card: the list under it is the
          one card on this screen. */}
      {!signedIn && (
        <PixelBadge
          state="waving"
          size={64}
          title="You are browsing a sample session."
          text="Sign in from Settings, the gear on You, to see your own. Nothing syncs until you do."
          style={{ padding: 0 }}
        />
      )}

      {/* A failed sync over saved sessions is a footnote; over nothing it is the screen,
          so it gets the same block every empty tab opens with, and says what to do. The
          message is the client's own sentence (src/data/api.ts), never fetch's. */}
      {error && sessions.length > 0 && (
        <T role="meta" tone="dim">
          Showing saved sessions. {error}
        </T>
      )}
      {error && sessions.length === 0 && (
        <PixelBadge
          state="sleeping"
          size={64}
          title="Could not load your sessions."
          text={`${error} Pull down to try again.`}
          style={{ padding: 0 }}
        />
      )}

      {signedIn && sessions.length === 0 && !error && (
        <PixelBadge
          state="waving"
          size={64}
          title="No sessions yet."
          text="Pair your Mac in Settings and the first one you finish lands here."
          style={{ padding: 0 }}
        />
      )}

      {sessions.length > 0 && (
        <Surface padding={0}>
          {sessions.map((s, i) => (
            <Row
              key={s.id}
              title={s.title ?? duration(s.active_seconds)}
              // A session title is a sentence; cut at one line it lost its verb ("Wire live
              // vehicle positions into the guid…"). Two lines, then it truncates.
              titleLines={2}
              meta={[s.repo_name ?? 'private repo', dayLabel(s.started_at, now), s.unattended ? 'unattended' : null]
                .filter(Boolean)
                .join(' · ')}
              value={duration(s.active_seconds)}
              trailing={
                // Finished in the last hour and not yet posted: the recap a push would have
                // opened, for the person who dismissed the banner or never got one. A solid
                // amber capsule with dark ink: an action, not a tinted badge.
                recapEligible(s, now) ? <RecapButton onPress={() => router.push(`/session/${s.id}?recap=1`)} /> : null
              }
              below={
                s.strip ? (
                  <TimelineStrip
                    cols={s.strip.cols}
                    marks={decodeMarks(s.strip.marks)}
                    spanMs={Math.max(1, s.strip.t1_ms - s.strip.t0_ms)}
                    preset="row"
                    width={stripWidth}
                  />
                ) : (
                  // A header-only session has no per-event detail: Cursor drops message
                  // bodies at about 60 days. Saying so is better than drawing an empty bar
                  // that reads as a bug.
                  <T role="meta" tone="dim">
                    timeline not available for this session
                  </T>
                )
              }
              onPress={() => router.push(`/session/${s.id}`)}
              hairline={i < sessions.length - 1}
            />
          ))}
        </Surface>
      )}
    </ScrollView>
  );
}

function RecapButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      hitSlop={hitSlopToReach(RECAP_HEIGHT)}
      accessibilityRole="button"
      accessibilityLabel="Open the recap for this session"
      onPress={onPress}
      style={({ pressed }) => ({
        height: RECAP_HEIGHT,
        justifyContent: 'center',
        paddingHorizontal: space.sm,
        borderRadius: SHAPE.action,
        borderCurve: 'continuous',
        backgroundColor: pressed ? c.accentPressed : c.accent,
      })}
    >
      <T role="label" tone="onAccent">
        Recap
      </T>
    </Pressable>
  );
}

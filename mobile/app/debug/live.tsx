import { Redirect, Stack, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text } from 'react-native';

import * as cache from '../../src/data/cache';
import { activityFor, endAllLiveActivities, liveActivitiesAvailable, renderLivePreviews, syncLiveActivities, type SyncResult } from '../../src/live/activity';
import { debugSessions, DEBUG_TODAY, parseDebugLive, type DebugLiveRequest } from '../../src/live/fixtures';
import { buildWidgetSnapshot } from '../../src/live/surface';
import { writeWidgetSnapshot } from '../../src/live/widget';
import { resolveAnimal } from '../../src/pixel/animals';
import { colors, space } from '../../src/theme';
import { ANIMAL_KEY } from '../icon';

/**
 * `builder://debug/live?state=working|needsYou|done|stalled|end&n=1..4[&widget=1][&render=1]
 *  [&creature=owl][&stale=10]`
 *
 * Drives the Live Activity, the Dynamic Island and the Home Screen widget with no tap, for
 * `scripts/sim/capture.sh` and for looking at them on a device. It goes through the real path,
 * `syncLiveActivities` and its planner, with the realistic sessions in `src/live/fixtures.ts`
 * (the engine's own sentences, this repository and RideGT). The ids are fixed, so
 * state=working and then state=needsYou moves the same session into needs you and the alert
 * fires; state=done starts the session first if nothing shows it, so there is a card to finish.
 * The app must be in the foreground to START an activity (ActivityKit), which opening a link
 * guarantees.
 *
 *   widget=1   also writes the widget snapshot (alone: only the snapshot)
 *   render=1   renders every state to Documents/live-previews with ImageRenderer
 *   stale=10   the content goes stale after 10 s, to photograph "Not updating"
 *
 * DEV ONLY. A release build renders nothing here and redirects, touching no activity. (The root
 * layout does not list this route, because another change owns that file; listing it in the
 * `__DEV__` group there is the follow up.)
 */
export default function DebugLiveRoute() {
  if (!__DEV__) return <Redirect href="/now" />;
  return <DebugLive />;
}

const c = colors('dark');

function DebugLive() {
  const params = useLocalSearchParams();
  // A second link while this screen is up replaces the params in place; key on content.
  const key = JSON.stringify(params);
  const req = useMemo(() => parseDebugLive(params as Record<string, string | string[] | undefined>), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const [lines, setLines] = useState<string[]>(['working']);

  useEffect(() => {
    let cancelled = false;
    run(req)
      .then((out) => !cancelled && setLines(out))
      .catch((e: unknown) => !cancelled && setLines([`failed: ${e instanceof Error ? e.message : String(e)}`]));
    return () => {
      cancelled = true;
    };
  }, [req]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: space.md, gap: space.sm }}>
      <Stack.Screen options={{ title: 'Live surfaces' }} />
      {lines.map((line, i) => (
        <Text key={i} style={{ color: i === 0 ? c.text : c.textDim, fontSize: i === 0 ? 17 : 13, fontWeight: i === 0 ? '600' : '500' }}>
          {line}
        </Text>
      ))}
    </ScrollView>
  );
}

function describe(label: string, r: SyncResult): string {
  const parts = [`${r.started} started`, `${r.updated} updated`, `${r.ended} ended`, `${r.notified} notified`];
  if (r.widget) parts.push('widget written');
  return `${label}: ${parts.join(', ')}${r.errors.length ? `; ${r.errors.join('; ')}` : ''}`;
}

async function run(req: DebugLiveRequest): Promise<string[]> {
  if (req.problem) return [req.problem];
  const out: string[] = [];
  const nowMs = Date.now();
  const creature = req.creature ?? resolveAnimal(await cache.getKv(ANIMAL_KEY).catch(() => null));
  out.push(liveActivitiesAvailable() ? 'Live Activities are on' : 'Live Activities are off or not in this build');

  if (req.state === 'end') {
    await endAllLiveActivities();
    out.push('ended every Builder Live Activity');
  } else if (req.state) {
    const common = { creature, today: DEBUG_TODAY, nowMs, staleInSeconds: req.staleInSeconds ?? undefined };
    if (req.state === 'done' && !activityFor('debug-builder')) {
      const first = debugSessions('working', req.n, nowMs);
      out.push(describe('working first', await syncLiveActivities(first.sessions, first.liveStates, { ...common, writeWidget: false })));
    }
    const s = debugSessions(req.state, req.n, nowMs);
    const r = await syncLiveActivities(s.sessions, s.liveStates, { ...common, finished: s.finished, writeWidget: req.widget });
    out.push(describe(req.state, r));
  } else if (req.widget) {
    const s = debugSessions('working', req.n, nowMs);
    const ok = writeWidgetSnapshot(buildWidgetSnapshot({ sessions: s.sessions, liveStates: s.liveStates, creature, today: DEBUG_TODAY, nowMs }));
    out.push(ok ? `wrote the widget snapshot (${s.sessions.length} running)` : 'no widget storage in this build');
  }

  if (req.render) {
    try {
      const paths = await renderLivePreviews();
      out.push(`rendered ${paths.length} previews into Documents/live-previews`);
    } catch (e) {
      out.push(`render failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}

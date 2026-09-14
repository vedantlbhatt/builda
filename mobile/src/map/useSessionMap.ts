/**
 * The session both screens draw: `GET /v1/sessions/{id}`, which carries the FULL live state
 * (map and frames) while the session runs (docs/overnight-integration.md 3.4).
 *
 * The saved copy first, so a screen opens on what it showed last time rather than on a
 * skeleton, then the server. Which state the screen is in (loading, signed out, missing,
 * error, ready or stale) is `session/load.ts`'s one rule, the same the session screen reads,
 * so the two screens cannot disagree about a failed refresh.
 *
 * `sample` is the built in sample: this module's own variants (`sample.ts`), else the session
 * screen's (`session/samples.ts`), so a link from its sample opens the sample it was showing.
 *
 * `poll`: the map re-reads a running session every LIVE_REFRESH_MS while it is on screen, the
 * rate the tabs poll at. The time lapse does not: new frames arriving mid replay would move
 * the ground under the playhead, and pulling down fetches the latest when asked.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import { ApiError, OFFLINE_MESSAGE, type SessionDetail } from '../data/api';
import * as cache from '../data/cache';
import { api, SAMPLE_SESSION } from '../data/client';
import { LIVE_REFRESH_MS } from '../live/LiveSessions';
import { resolveSessionLoad, type LoadFailure, type SessionLoad } from '../session/load';
import { parseSampleVariant, sampleOutcome } from '../session/samples';
import { mapSample, mapSampleVariant } from './sample';

export interface SessionMapLoad {
  load: SessionLoad;
  refresh: () => Promise<void>;
  refreshing: boolean;
  /** When the session on screen was fetched or built, epoch ms; ages "updated N minutes ago". */
  now: number;
}

function sampleFor(variant: string | string[] | undefined, nowMs: number): { session: SessionDetail | null; failure: LoadFailure | null } {
  const mine = mapSampleVariant(variant);
  if (mine) return { session: mapSample(SAMPLE_SESSION, mine, nowMs), failure: null };
  return sampleOutcome(SAMPLE_SESSION, parseSampleVariant(variant), nowMs, OFFLINE_MESSAGE);
}

export function useSessionMap(
  id: string | undefined,
  variant: string | string[] | undefined,
  { poll }: { poll: boolean },
): SessionMapLoad {
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // The sample is built once per variant, so a refresh never moves its clock under the replay.
  const sample = useRef<{ key: string; session: SessionDetail | null; failure: LoadFailure | null } | null>(null);

  const load = useCallback(async () => {
    setNow(Date.now());
    if (!id) {
      setFailure({ status: 404, message: 'no session id in the link' });
      return;
    }
    if (id === 'sample') {
      const key = String(variant ?? '');
      if (sample.current?.key !== key) sample.current = { key, ...sampleFor(variant, Date.now()) };
      setSession(sample.current.session);
      setFailure(sample.current.failure);
      return;
    }
    const cached = await cache.getDetail(id);
    if (cached) setSession(cached);
    if (!(await api.isSignedIn())) {
      setFailure({ status: 401, message: 'not signed in' });
      return;
    }
    try {
      const fresh = await api.session(id);
      await cache.putDetail(fresh);
      setSession(fresh);
      setFailure(null);
      setNow(Date.now());
    } catch (e) {
      // A saved copy stays on screen and the stale line says why; with none, the error state.
      setFailure(e instanceof ApiError ? { status: e.status, message: e.message } : { status: 0, message: OFFLINE_MESSAGE });
    }
  }, [id, variant]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const live = session?.state === 'live';
  useFocusEffect(
    useCallback(() => {
      if (!poll || !live || id === 'sample') return;
      const timer = setInterval(() => void load(), LIVE_REFRESH_MS);
      return () => clearInterval(timer);
    }, [poll, live, id, load]),
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return { load: resolveSessionLoad(session, failure), refresh, refreshing, now };
}

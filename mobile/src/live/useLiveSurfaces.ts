import { usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import type { SessionDetail } from '../data/api';
import * as cache from '../data/cache';
import { api } from '../data/client';
import { loadRepoNames } from '../data/repoNames';
import { ANIMAL_KEY } from '../onboarding/keys';
import { resolveAnimal } from '../pixel/animals';
import { CREW_WINDOW } from '../session/useCrew';
import { endAllLiveActivities, syncLiveActivities, type SyncResult } from './activity';
import { liveStatesOf } from './mission';
import { finishedSince, todayFromProfile } from './surface';
import { clearWidgetSnapshot } from './widget';
import { announceFinished, publishLive, resumeDemos } from '../island/feeds';
import { crewFor } from './crew';
import { offerLastWeek } from '../share/weekOffer';

/**
 * The app's foreground poll for the Lock Screen, the Dynamic Island and the Home Screen widget
 * (docs/overnight-integration.md 3.5): every LIVE_SURFACE_MS while the app is in front, the
 * live rows and each one's `live_state` go to `syncLiveActivities`, so a card follows the real
 * session and not a fixture. Mounted once, at the root, so it runs whichever tab is open (Now
 * and Sessions poll only while focused; a card must not freeze because the person is reading
 * Wrapped).
 *
 * It reads the cache and syncs the cache itself only when nobody else did recently: Now's own
 * 60 s poll runs `cache.sync` too, and two passes a minute over one list would double every
 * detail fetch for nothing.
 *
 * Off while a debug route drives the surfaces with its fixtures (`app/debug/live.tsx`): a real
 * sync would take their sample cards down as "gone from the live list" within a minute. Signed
 * out, it takes every card down and empties the widget once.
 */

/** Mission control's cadence (`LiveSessions.LIVE_REFRESH_MS`) and the Mac's live upload, 60 s. */
export const LIVE_SURFACE_MS = 60_000;
/** A cache sync younger than this is fresh enough to read as it is: half the cadence. */
export const FRESH_SYNC_MS = LIVE_SURFACE_MS / 2;

let lastLive: string[] = [];
let wasSignedIn = false;
let last: SyncResult | null = null;

/** The last pass's result, for the debug route and the tests. */
export function lastSurfaceSync(): SyncResult | null {
  return last;
}

/** One pass: what the poll does each tick. Exported so a screen can run one on demand. */
export async function refreshLiveSurfaces(nowMs = Date.now()): Promise<SyncResult | null> {
  const signedIn = await api.isSignedIn();
  if (!signedIn) {
    if (wasSignedIn) {
      wasSignedIn = false;
      lastLive = [];
      await endAllLiveActivities();
      clearWidgetSnapshot();
      publishLive([], nowMs);
    }
    return null;
  }
  wasSignedIn = true;
  const synced = Date.parse((await cache.lastSyncAt()) ?? '');
  if (!Number.isFinite(synced) || nowMs - synced > FRESH_SYNC_MS) {
    try {
      await cache.sync(api);
    } catch {
      // The cards keep what the cache has; they go stale on their own clock (STALE_SECONDS).
    }
  }
  const live = await cache.listLive();
  const gone = finishedSince(lastLive, live);
  lastLive = live.map((s) => s.id);
  const finished = (await Promise.all(gone.map((id) => cache.getDetail(id)))).filter(
    (s): s is SessionDetail => s !== null && s.state === 'final'
  );
  const [animal, details, activities, profile, saved, names] = await Promise.all([
    cache.getKv(ANIMAL_KEY).catch(() => null),
    cache.getLockScreenDetails(),
    cache.getLiveActivities(),
    cache.getProfile(),
    // The rows the Sessions list steps each session's creature against, so a card's creature
    // is the one its row and its tile wear.
    cache.listSessions(CREW_WINDOW).catch((): SessionDetail[] => []),
    // What a card calls a private project: the number the Projects tab gives it. A card's
    // repository is fixed for its life, so it is read before any card starts.
    loadRepoNames().catch(() => null),
  ]);
  // The island inside the app says what the system island says outside it, from the same rows.
  publishLive(live, nowMs, names);
  void resumeDemos(names, nowMs).catch(() => null);
  // Monday to Wednesday, once: last week's card, made without being asked (`share/weekOffer`).
  void offerLastWeek(resolveAnimal(animal), nowMs).catch(() => null);
  if (finished.length > 0) {
    const crew = crewFor([...finished, ...saved]);
    for (const s of finished) announceFinished(s, crew.get(s.id) ?? resolveAnimal(animal), names);
  }
  last = await syncLiveActivities(live, liveStatesOf(live), {
    creature: resolveAnimal(animal),
    around: saved,
    finished,
    today: todayFromProfile(profile?.graph, nowMs),
    details,
    activities,
    pushTokens: true,
    names,
    nowMs,
  });
  return last;
}

/** Mount once, at the root. */
export function useLiveSurfaces(enabled: boolean): void {
  const pathname = usePathname();
  const debug = pathname.startsWith('/debug');
  const busy = useRef(false);

  useEffect(() => {
    if (!enabled || debug) return;
    let active = AppState.currentState === 'active';
    const tick = () => {
      if (!active || busy.current) return;
      busy.current = true;
      void refreshLiveSurfaces()
        .catch(() => null)
        .finally(() => {
          busy.current = false;
        });
    };
    tick();
    const timer = setInterval(tick, LIVE_SURFACE_MS);
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      const was = active;
      active = s === 'active';
      // Back in front: the cards have been frozen since the app left, so update them now.
      if (active && !was) tick();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [enabled, debug]);
}

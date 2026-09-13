/**
 * What the analysis page reads: the builder profile and the profile, the two responses the rest
 * of the app already fetches (`api.builderProfile()`, `api.profile()`), the saved copies first so
 * the page opens on what it showed last time, then fresh ones. The saved builder profile is the
 * You tab's own key, so opening either warms the other.
 *
 * The four states are the You pages' (`src/you/load.ts`): loading with nothing saved, signed
 * out, an error with nothing saved to fall back on, and ready, stale when a refresh failed and
 * the page is what was saved.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import * as cache from '../data/cache';
import { api } from '../data/client';
import { OFFLINE_MESSAGE, type BuilderProfileResponse, type Profile } from '../data/api';
import { ANIMAL_KEY, BUILDER_PROFILE_KEY } from '../onboarding/keys';

export type AnalysisLoad =
  | { kind: 'loading' }
  | { kind: 'signedOut' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; builder: BuilderProfileResponse; profile: Profile | null; stale: string | null };

function messageOf(e: unknown): string {
  return e instanceof Error && e.message ? e.message : OFFLINE_MESSAGE;
}

function parse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function useAnalysis(): { load: AnalysisLoad; chosenAnimal: string | null; refresh: () => Promise<void>; refreshing: boolean } {
  const [builder, setBuilder] = useState<BuilderProfileResponse | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosenAnimal, setChosenAnimal] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const live = useRef(true);
  // What is on screen, as JSON: a refresh that brings back the same answer changes nothing, so
  // no chapter re-renders under a number that is counting.
  const shownBuilder = useRef<string | null>(null);
  const shownProfile = useRef<string | null>(null);

  const load = useCallback(async () => {
    const [raw, savedProfile, animal] = await Promise.all([cache.getKv(BUILDER_PROFILE_KEY), cache.getProfile(), cache.getKv(ANIMAL_KEY)]);
    if (!live.current) return;
    const saved = parse<BuilderProfileResponse>(raw);
    if (saved && shownBuilder.current === null) {
      shownBuilder.current = raw;
      setBuilder(saved);
    }
    if (savedProfile && shownProfile.current === null) {
      shownProfile.current = JSON.stringify(savedProfile);
      setProfile(savedProfile);
    }
    setChosenAnimal(animal);
    const ok = await api.isSignedIn();
    if (!live.current) return;
    setSignedIn(ok);
    if (!ok) return;
    const [b, p] = await Promise.allSettled([api.builderProfile(), api.profile()]);
    if (!live.current) return;
    if (b.status === 'fulfilled') {
      const json = JSON.stringify(b.value);
      if (json !== shownBuilder.current) {
        shownBuilder.current = json;
        setBuilder(b.value);
        void cache.setKv(BUILDER_PROFILE_KEY, json);
      }
      setError(null);
    } else {
      setError(messageOf(b.reason));
    }
    if (p.status === 'fulfilled') {
      const json = JSON.stringify(p.value);
      if (json !== shownProfile.current) {
        shownProfile.current = json;
        setProfile(p.value);
        void cache.putProfile(p.value);
      }
    }
  }, []);

  useEffect(() => {
    live.current = true;
    void load();
    return () => {
      live.current = false;
    };
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  let state: AnalysisLoad;
  if (signedIn === false) state = { kind: 'signedOut' };
  else if (builder) state = { kind: 'ready', builder, profile, stale: error };
  else if (error) state = { kind: 'error', message: error };
  else state = { kind: 'loading' };

  return { load: state, chosenAnimal, refresh, refreshing };
}

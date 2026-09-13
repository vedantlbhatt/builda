/**
 * What the You pages read, and the two preferences they keep. Every hook reads the saved copy
 * first, so a page opens on what it showed last time rather than on a spinner, then asks the
 * server while the page is focused (the rule the tabs already follow).
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import * as cache from '../data/cache';
import { api } from '../data/client';
import { OFFLINE_MESSAGE, type BuilderProfileResponse, type Profile } from '../data/api';
import { getLocalName } from '../nav/name';
import { ANIMAL_KEY } from '../onboarding/keys';
import { resolveAnimal, type Animal } from '../pixel/animals';
import { snap, success } from '../ui';
import { BUILDER_KEY, BUILDER_SAVED_AT_KEY, MONEY_MASK_KEY, REVEALED_KEY } from './keys';
import { parseSavedAt, resolveLoad, type LoadInputs, type YouLoad } from './load';

function messageOf(e: unknown): string {
  return e instanceof Error && e.message ? e.message : OFFLINE_MESSAGE;
}

function parse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // A saved blob from an older shape is dropped, not repaired.
    return null;
  }
}

/** `GET /v1/profile/builder`: the corpus, the report, the per session aggregate. */
export function useBuilderProfile(): {
  load: YouLoad<BuilderProfileResponse>;
  refresh: () => Promise<void>;
  refreshing: boolean;
} {
  const [inputs, setInputs] = useState<LoadInputs<BuilderProfileResponse>>({
    data: null,
    savedAt: null,
    signedIn: null,
    error: null,
  });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [raw, saved] = await Promise.all([cache.getKv(BUILDER_KEY), cache.getKv(BUILDER_SAVED_AT_KEY)]);
    const stored = parse<BuilderProfileResponse>(raw);
    const signedIn = await api.isSignedIn();
    setInputs((s) => ({ ...s, data: stored ?? s.data, savedAt: parseSavedAt(saved) ?? s.savedAt, signedIn }));
    if (!signedIn) return;
    try {
      const fresh = await api.builderProfile();
      const now = Date.now();
      await cache.setKv(BUILDER_KEY, JSON.stringify(fresh));
      await cache.setKv(BUILDER_SAVED_AT_KEY, String(now));
      setInputs({ data: fresh, savedAt: now, signedIn: true, error: null });
    } catch (e) {
      // The saved page stays; the stale line says the refresh failed and when it was saved.
      setInputs((s) => ({ ...s, error: messageOf(e) }));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return { load: resolveLoad(inputs), refresh, refreshing };
}

/** `GET /v1/profile`: the active hours graph, totals, projects. The cache's own table. */
export function useProfile(): { load: YouLoad<Profile>; reload: () => Promise<void> } {
  const [inputs, setInputs] = useState<LoadInputs<Profile>>({ data: null, savedAt: null, signedIn: null, error: null });

  const load = useCallback(async () => {
    const stored = await cache.getProfile();
    const signedIn = await api.isSignedIn();
    setInputs((s) => ({ ...s, data: stored ?? s.data, signedIn }));
    if (!signedIn) return;
    try {
      const fresh = await api.profile();
      await cache.putProfile(fresh);
      setInputs({ data: fresh, savedAt: Date.now(), signedIn: true, error: null });
    } catch (e) {
      setInputs((s) => ({ ...s, error: messageOf(e) }));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return { load: resolveLoad(inputs), reload: load };
}

/**
 * The builder's own creature and name, for the top of the You tab. The creature is their pick,
 * else the one their archetype earned; the name is the one typed in onboarding, else the
 * account's display name, else none (the row shows the creature alone rather than a
 * placeholder name).
 */
export function useIdentity(archetype: string | null): { animal: Animal; name: string | null } {
  const [chosen, setChosen] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      void (async () => {
        const [pick, local] = await Promise.all([cache.getKv(ANIMAL_KEY), getLocalName(cache)]);
        if (!live) return;
        setChosen(pick);
        if (local) {
          setName(local);
          return;
        }
        if (!(await api.isSignedIn())) return;
        try {
          const me = await api.getMe();
          if (live) setName(me.display_name?.trim() || me.handle || null);
        } catch {
          // No name is a fine answer offline: the row shows the creature alone.
        }
      })();
      return () => {
        live = false;
      };
    }, []),
  );

  return { animal: resolveAnimal(chosen, archetype), name };
}

/**
 * The dollar mask: long press a dollar figure to show `$•••` everywhere dollars appear, and
 * again to bring them back (SYNTHESIS 5, technique 2). Masked until the saved choice is read, so
 * a person who hid the figure never sees it flash on the way in. A light impact on each toggle.
 */
export function useMoneyMask(): { masked: boolean; toggle: () => void } {
  const [masked, setMasked] = useState<boolean | null>(null);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      void cache.getKv(MONEY_MASK_KEY).then((v) => {
        if (live) setMasked(v === '1');
      });
      return () => {
        live = false;
      };
    }, []),
  );

  // The latest value in a ref, so the toggle's write and haptic run once per press and never
  // inside a state updater, which React may call twice.
  const current = useRef<boolean | null>(masked);
  current.current = masked;
  const toggle = useCallback(() => {
    const next = !(current.current ?? true);
    current.current = next;
    setMasked(next);
    void cache.setKv(MONEY_MASK_KEY, next ? '1' : '0');
    snap();
  }, []);

  return { masked: masked ?? true, toggle };
}

/**
 * Whether the archetype's name should play its reveal: once per archetype per account, the
 * first time the tab shows it, and never again until the type changes. `phase` is `unknown`
 * until the saved id is read, so the name never flashes in full and then scrambles.
 * `revealed()` records it and fires the one success haptic the design allows for it.
 */
export function useFirstReveal(id: string | null): { phase: 'unknown' | 'play' | 'still'; revealed: () => void } {
  const [phase, setPhase] = useState<'unknown' | 'play' | 'still'>('unknown');
  const fired = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    if (!id) {
      setPhase('still');
      return;
    }
    setPhase('unknown');
    void cache.getKv(REVEALED_KEY).then((seen) => {
      if (live) setPhase(seen === id ? 'still' : 'play');
    });
    return () => {
      live = false;
    };
  }, [id]);

  const revealed = useCallback(() => {
    if (!id || fired.current === id) return;
    fired.current = id;
    void cache.setKv(REVEALED_KEY, id);
    success();
    setPhase('still');
  }, [id]);

  return { phase, revealed };
}

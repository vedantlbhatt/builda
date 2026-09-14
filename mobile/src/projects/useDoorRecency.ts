/**
 * What the phone holds about when each project on the Projects tab was last worked on, for its
 * door to reconcile with the Mac's report (`recency.ts`): the newest saved row under each key, the
 * newest start the server listed for it on the last `/v1/profile` this phone saved, and every live
 * row. All three are read from the phone's own store, never the network: the tab already reads the
 * profile's report, and a door that waited on a request per project would be a door that flickers.
 * Read on focus and every 30 seconds while the tab is in front, so "Running now" goes when the
 * session does.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import * as cache from '../data/cache';
import type { PhoneSession } from './recency';

const EVERY_MS = 30_000;

export interface DoorPhone {
  /** By full key: the newest finished row saved under it, when there is one. */
  finals: Record<string, PhoneSession[]>;
  /** By full key: the newest start `/v1/profile` listed for it (which keys projects by their first 12 characters). */
  listed: Record<string, string>;
  live: PhoneSession[];
}

export function useDoorRecency(keys: readonly string[]): DoorPhone {
  const [state, setState] = useState<DoorPhone>({ finals: {}, listed: {}, live: [] });
  const joined = keys.join(',');
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      const read = async () => {
        const all = joined ? joined.split(',') : [];
        const [live, profile, rows] = await Promise.all([cache.listLive(), cache.getProfile(), Promise.all(all.map((k) => cache.listSessionsForRepo(k, 1)))]);
        const finals: Record<string, PhoneSession[]> = {};
        const listed: Record<string, string> = {};
        all.forEach((k, i) => {
          finals[k] = rows[i] ?? [];
          const p = profile?.projects.find((x) => x.key.length >= 12 && k.startsWith(x.key));
          if (p?.last_at) listed[k] = p.last_at;
        });
        if (alive) setState({ finals, listed, live });
      };
      void read();
      const timer = setInterval(() => void read(), EVERY_MS);
      return () => {
        alive = false;
        clearInterval(timer);
      };
    }, [joined]),
  );
  return state;
}

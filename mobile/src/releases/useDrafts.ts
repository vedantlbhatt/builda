/**
 * Which of my projects have a release draft waiting, read on focus: the Projects tab says so on the
 * row, so a draft the Mac wrote is seen where the project is, not only on its page.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { api } from '../data/client';

export function useDraftKeys(): ReadonlySet<string> {
  const [keys, setKeys] = useState<ReadonlySet<string>>(new Set());
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void (async () => {
        if (!(await api.isSignedIn())) return;
        try {
          const r = await api.myReleases(undefined, 'draft');
          if (alive) setKeys(new Set(r.releases.map((x) => x.project_key)));
        } catch {
          // A read that failed says nothing, never "no drafts".
        }
      })();
      return () => {
        alive = false;
      };
    }, []),
  );
  return keys;
}

/** How many releases came out this week from what I starred and who I follow, for the door. */
export function useFollowingCount(): number | null {
  const [n, setN] = useState<number | null>(null);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void (async () => {
        if (!(await api.isSignedIn())) return;
        try {
          const r = await api.followingReleases();
          const week = Date.now() - 7 * 86_400_000;
          if (alive) setN(r.releases.filter((x) => x.published_at && Date.parse(x.published_at) >= week).length);
        } catch {
          if (alive) setN(null);
        }
      })();
      return () => {
        alive = false;
      };
    }, []),
  );
  return n;
}

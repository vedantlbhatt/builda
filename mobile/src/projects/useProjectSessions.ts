/**
 * One project's sessions for its page's swarm: the rows `GET /v1/projects/{key}` sends (its final,
 * visible sessions, newest first) and every row this phone has saved whose `repo_key` is this
 * project's, each once (`model.swarmSessions`). Read on focus, the rule the tabs follow; the saved
 * rows first, so the swarm is there before the network answers.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import * as cache from '../data/cache';
import { api } from '../data/client';
import { OFFLINE_MESSAGE, type SessionDetail } from '../data/api';
import { swarmSessions, type SwarmSession } from './model';

/** How many saved rows the swarm reads, at most. */
const SAVED = 5000;

export function useProjectSessions(key: string | null): { sessions: SwarmSession[] | null; error: string | null } {
  const [state, setState] = useState<{ sessions: SwarmSession[] | null; error: string | null }>({ sessions: null, error: null });
  useFocusEffect(
    useCallback(() => {
      if (!key) return undefined;
      let live = true;
      void (async () => {
        const saved = await cache.listSessions(SAVED);
        const fromCache = saved.filter((s) => s.repo_key === key || (key.length < 64 && typeof s.repo_key === 'string' && s.repo_key.startsWith(key)));
        const full = fromCache[0]?.repo_key ?? key;
        if (live && fromCache.length) setState((s) => ({ ...s, sessions: swarmSessions([], fromCache, full) }));
        if (!(await api.isSignedIn())) {
          if (live) setState({ sessions: swarmSessions([], fromCache, full), error: null });
          return;
        }
        try {
          const slice = await api.project(key);
          if (live) setState({ sessions: swarmSessions(slice.sessions as SessionDetail[], saved, slice.key), error: null });
        } catch (e) {
          if (live) setState({ sessions: swarmSessions([], fromCache, full), error: e instanceof Error && e.message ? e.message : OFFLINE_MESSAGE });
        }
      })();
      return () => {
        live = false;
      };
    }, [key]),
  );
  return state;
}

/**
 * One project's sessions for its page's swarm: every page `GET /v1/projects/{key}` has (its final,
 * visible sessions, newest first), back to the project's first session or `SWARM_MAX`, whichever
 * comes first, and the rows this phone has saved under its `repo_key`, each once
 * (`model.swarmSessions`). Read on focus, the rule the tabs follow; the saved rows first, so the
 * swarm is there before the network answers.
 *
 * FOUND IN REVIEW (2026-09-13): the first version read one page of 50 and every saved row, and
 * the saved rows are the newest 50 NOTABLE sessions, so before the last fortnight every dot was a
 * notable one and the axis began at the first dot, hiding the weeks it had not read. It also parsed
 * up to 5,000 saved rows on every focus; SQLite now picks this project's rows by key.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import * as cache from '../data/cache';
import { api } from '../data/client';
import { OFFLINE_MESSAGE, type SessionDetail } from '../data/api';
import { SWARM_MAX } from './geometry';
import { swarmSessions, type SwarmSession } from './model';

/** One page of a project's sessions: the most the route gives at once. */
const PAGE = 200;

export interface ProjectSessions {
  /** Newest first when capped, the swarm's order otherwise; null until the first read. */
  sessions: SwarmSession[] | null;
  /** How many the server holds for this project in all, or null when it did not say. */
  total: number | null;
  error: string | null;
}

/**
 * `key` is the project's full key (or a prefix the route resolves); `firstAt` is the project's
 * first session as the report has it, where paging may stop.
 */
export function useProjectSessions(key: string | null, firstAt: string | null): ProjectSessions {
  const [state, setState] = useState<ProjectSessions>({ sessions: null, total: null, error: null });
  useFocusEffect(
    useCallback(() => {
      if (!key) return undefined;
      let live = true;
      void (async () => {
        const full = key.length === 64 ? key : null;
        const saved = full ? await cache.listSessionsForRepo(full, SWARM_MAX) : [];
        if (live && saved.length) setState((s) => ({ ...s, sessions: swarmSessions([], saved, full!) }));
        if (!(await api.isSignedIn())) {
          if (live) setState({ sessions: full ? swarmSessions([], saved, full) : [], total: null, error: null });
          return;
        }
        const rows: SessionDetail[] = [];
        let total: number | null = null;
        let resolved = full;
        let before: string | null = null;
        const stopAt = firstAt ? Date.parse(firstAt) : Number.NaN;
        try {
          for (;;) {
            const page = await api.project(key, { before, limit: PAGE });
            resolved = page.key;
            total = page.sessions_total ?? total;
            rows.push(...page.sessions);
            before = page.next_before ?? null;
            const oldest = rows.length ? Date.parse(rows[rows.length - 1]!.started_at) : Number.NaN;
            if (!before || rows.length >= SWARM_MAX || (Number.isFinite(stopAt) && Number.isFinite(oldest) && oldest <= stopAt)) break;
          }
          const k = resolved ?? key;
          const cached = full ? saved : await cache.listSessionsForRepo(k, SWARM_MAX);
          if (live) setState({ sessions: swarmSessions(rows, cached, k), total, error: null });
        } catch (e) {
          if (live)
            setState({
              sessions: rows.length || saved.length ? swarmSessions(rows, saved, resolved ?? key) : [],
              total,
              error: e instanceof Error && e.message ? e.message : OFFLINE_MESSAGE,
            });
        }
      })();
      return () => {
        live = false;
      };
    }, [key, firstAt]),
  );
  return state;
}

/**
 * The sessions a session's creature is stepped against (`crew.ts`): the ones this phone saved,
 * finished and running, the same rows the Sessions list asks the crew rule over, so a session
 * wears one creature in the list and on its page (and `LiveSessions.crewFor` remembers it). Null
 * until the saved list has been read once (a few milliseconds of SQLite), so the hero never paints
 * one hue and then another.
 */
import { useEffect, useState } from 'react';

import * as cache from '../data/cache';
import type { SessionDetail } from '../data/api';

/** Rows the list shows, the same window the crew rule runs over on both screens. */
export const CREW_WINDOW = 50;

export function useCrewAround(): SessionDetail[] | null {
  const [around, setAround] = useState<SessionDetail[] | null>(null);
  useEffect(() => {
    let alive = true;
    Promise.all([cache.listSessions(CREW_WINDOW), cache.listLive()])
      .then(([finals, live]) => {
        if (alive) setAround([...live, ...finals]);
      })
      .catch(() => {
        // An unreadable cache is no neighbours: the session wears its own creature.
        if (alive) setAround([]);
      });
    return () => {
      alive = false;
    };
  }, []);
  return around;
}

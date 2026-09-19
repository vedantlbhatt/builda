/**
 * The island's data: the same live rows the Now tab reads (`GET /v1/sessions/live`), the wall
 * (`GET /v1/drops`), and the sessions this window saw leave the live list, polled while the
 * island window is up. The island window is its own page, so it keeps its own clock; the main
 * window can be closed and the island still knows.
 *
 * It polls faster than the Now tab (5 s against 60 s), because it is the one surface whose whole
 * job is noticing a wait, and a wait noticed a minute late is a minute of an agent doing nothing.
 */
import { useEffect, useRef, useState } from 'react';

import type { SessionDetail } from '../../data/api';
import { api } from '../../data/client';
import { loadRepoNames } from '../../data/repoNames';
import type { RepoNames } from '../../copy/repoLabel';
import type { DropRow, MoveRow } from '../../drops/types';
import { crewFor } from '../../live/crew';
import { desktopBridge } from '../bridge';
import { activitiesOf, lead, notificationFor, sampleActivity, type Activity, type SampleKind } from './model';

export const LIVE_POLL_MS = 5_000;
export const DROPS_POLL_MS = 12_000;
const NAMES_POLL_MS = 5 * 60_000;

export function useIsland(sample: SampleKind | null): { activity: Activity | null; signedIn: boolean | null } {
  const [activity, setActivity] = useState<Activity | null>(() => (sample ? sampleActivity(sample) : null));
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const state = useRef<{
    live: SessionDetail[];
    drops: DropRow[];
    moves: MoveRow[];
    names: RepoNames | null;
    finished: { session: SessionDetail; atMs: number }[];
    lastNames: number;
    lastDrops: number;
    shown: Activity | null;
  }>({ live: [], drops: [], moves: [], names: null, finished: [], lastNames: 0, lastDrops: 0, shown: null });

  useEffect(() => {
    if (sample) {
      setActivity(sampleActivity(sample));
      return;
    }
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const s = state.current;
      try {
        const yes = await api.isSignedIn();
        if (!live) return;
        setSignedIn(yes);
        if (!yes) {
          setActivity(null);
          return;
        }
        const now = Date.now();
        if (now - s.lastNames > NAMES_POLL_MS) {
          s.names = await loadRepoNames().catch(() => s.names);
          s.lastNames = now;
        }
        const before = new Set(s.live.map((r) => r.id));
        const { sessions } = await api.liveSessions();
        // A session that left the live list finished; ask for its final row once, for the beat.
        const gone = [...before].filter((id) => !sessions.some((r) => r.id === id));
        for (const id of gone) {
          const row = await api.session(id).catch(() => null);
          if (row && row.state !== 'live' && !row.unattended) s.finished = [{ session: row, atMs: Date.now() }, ...s.finished].slice(0, 4);
        }
        s.live = sessions;
        if (now - s.lastDrops > DROPS_POLL_MS) {
          const board = await api.dropsBoard().catch(() => null);
          if (board) {
            s.drops = board.drops;
            s.moves = board.moves;
          }
          s.lastDrops = now;
        }
        const next = lead(
          activitiesOf({ live: s.live, crew: crewFor(s.live), drops: s.drops, moves: s.moves, names: s.names, finished: s.finished, nowMs: Date.now() }),
        );
        const note = notificationFor(s.shown, next);
        if (note) desktopBridge()?.notify(note);
        s.shown = next;
        if (live) setActivity(next);
      } catch {
        // Offline or the API down: keep saying the last thing, which ages honestly (its words
        // carry their own "as of"), rather than blinking out.
      } finally {
        if (live) timer = setTimeout(tick, LIVE_POLL_MS);
      }
    };
    void tick();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [sample]);

  return { activity, signedIn };
}

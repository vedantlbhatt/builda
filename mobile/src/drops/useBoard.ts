/**
 * The board's data: load, poll while something is in flight, and act optimistically.
 *
 * POLLING IS CONDITIONAL, not constant. A board where nothing is waiting and nothing is running
 * is a board that cannot change without you, so it does not poll at all. It polls only while a
 * drop is waiting for the Mac or a move is queued or running, which is exactly the window where
 * the answer arrives from somewhere else.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '../data/client';
import { tellThemItFinished, tellThemItWasRead } from './localNotify';
import { worthSaying } from './news';
import { pollDelay, startEach, startTook } from './boardRules';
import type { BoardResponse, DropRow, MoveRow } from './types';

export { inFlight } from './boardRules';

export interface BoardState {
  drops: DropRow[];
  moves: MoveRow[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** True when every move went (or was already going); false when the server refused one. */
  start: (dropId: string, moveIds: string[], adjustment: string | null, repoKeys?: Record<string, string>) => Promise<boolean>;
  archive: (dropId: string) => Promise<void>;
}

export function useBoard(): BoardState {
  const [board, setBoard] = useState<BoardResponse>({ drops: [], moves: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Bumped after every read, failed or not, so the next one is scheduled either way.
  const [reads, setReads] = useState(0);
  const failed = useRef(false);

  const seen = useRef<BoardResponse | null>(null);

  /** One read of the board: the board it read, or null when the read failed. */
  const read = useCallback(async (): Promise<BoardResponse | null> => {
    try {
      const next = await api.dropsBoard();
      // The phone is the only thing watching before an APNs key exists, and it is watching
      // anyway while something is in flight. Same words as the server's push, same identifier,
      // so the two replace each other rather than stacking (`notifyCopy.ts`).
      const news = worthSaying(seen.current, next);
      for (const d of news.read) {
        void tellThemItWasRead(d, next.moves.filter((m) => m.drop_id === d.id).length);
      }
      for (const m of news.finished) void tellThemItFinished(m);
      seen.current = next;
      setBoard(next);
      setError(null);
      failed.current = false;
      return next;
    } catch (e) {
      failed.current = true;
      if (__DEV__) console.warn('[drops] the board did not load', e instanceof Error ? e.message : e);
      setError(e instanceof Error ? e.message : 'could not load the board');
      return null;
    } finally {
      setLoading(false);
      setReads((n) => n + 1);
    }
  }, []);
  const refresh = useCallback(async () => {
    await read();
  }, [read]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const ms = pollDelay(board, failed.current);
    if (ms === null) return;
    const t = setTimeout(() => void refresh(), ms);
    return () => clearTimeout(t);
  }, [board, reads, refresh]);

  const start = useCallback(
    async (dropId: string, moveIds: string[], adjustment: string | null, repoKeys: Record<string, string> = {}) => {
      // Optimistic: the row says `queued` the moment the thumb lifts, and the read after puts
      // back whatever the server refused. The answer goes to the caller, which says it.
      setBoard((b) => ({
        ...b,
        moves: b.moves.map((m) =>
          // A failed move tried again drops its last run's words, as the server does.
          moveIds.includes(m.id) ? { ...m, status: 'queued', queued_at: new Date().toISOString(), outcome: null } : m,
        ),
      }));
      const sent = await startEach((d, m, body) => api.startMove(d, m, body), dropId, moveIds, adjustment, repoKeys);
      const after = await read();
      return sent && (after === null || startTook(moveIds, after));
    },
    [read],
  );

  const archive = useCallback(
    async (dropId: string) => {
      setBoard((b) => ({ ...b, drops: b.drops.filter((d) => d.id !== dropId) }));
      try {
        await api.archiveDrop(dropId, true);
      } catch {
        await refresh();
      }
    },
    [refresh],
  );

  return { drops: board.drops, moves: board.moves, loading, error, refresh, start, archive };
}

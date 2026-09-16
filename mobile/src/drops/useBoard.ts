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
import type { BoardResponse, DropRow, MoveRow } from './types';

/** While something is in flight. Short enough that a resolution feels answered. */
const BUSY_POLL_MS = 4000;

export interface BoardState {
  drops: DropRow[];
  moves: MoveRow[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  start: (dropId: string, moveIds: string[], adjustment: string | null, repoKeys?: Record<string, string>) => Promise<void>;
  archive: (dropId: string) => Promise<void>;
}

/** Is anything going to change without the person doing something? */
export function inFlight(board: BoardResponse): boolean {
  return (
    board.drops.some((d) => d.status === 'waiting' || d.status === 'resolving') ||
    board.moves.some((m) => m.status === 'queued' || m.status === 'running')
  );
}

export function useBoard(): BoardState {
  const [board, setBoard] = useState<BoardResponse>({ drops: [], moves: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const seen = useRef<BoardResponse | null>(null);

  const refresh = useCallback(async () => {
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
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not load the board');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!inFlight(board)) return;
    timer.current = setTimeout(() => void refresh(), BUSY_POLL_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [board, refresh]);

  const start = useCallback(
    async (dropId: string, moveIds: string[], adjustment: string | null, repoKeys: Record<string, string> = {}) => {
      // Optimistic: the row says `queued` the moment the thumb lifts. A 409 means it was
      // already going, which is not an error and is left alone; anything else puts it back.
      setBoard((b) => ({
        ...b,
        moves: b.moves.map((m) =>
          moveIds.includes(m.id) ? { ...m, status: 'queued', queued_at: new Date().toISOString() } : m,
        ),
      }));
      for (const id of moveIds) {
        try {
          await api.startMove(dropId, id, { adjustment, repo_key: repoKeys[id] ?? null });
        } catch (e) {
          const status = (e as { status?: number }).status;
          if (status !== 409) setError(e instanceof Error ? e.message : 'could not start it');
        }
      }
      await refresh();
    },
    [refresh],
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

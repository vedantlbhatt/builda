/**
 * What changed between two boards that is worth a banner. PURE, so `bun test` holds it without
 * importing React Native, which is the rule every other rule in `src/drops/` follows.
 *
 * The interesting part is what does NOT count. A drop appearing (you just shared it, you know), a
 * move being queued or starting (you tapped it), a re-read of something already read (the content
 * moved, the fact that it has been read did not). What counts is a drop being READ for the first
 * time and a move FINISHING, which are the two moments a person actually waits through, and they
 * are the same two the server pushes (`server/builder/drops_notify.py`).
 */
import type { BoardResponse, DropRow, MoveRow } from './types';

export function worthSaying(
  before: BoardResponse | null,
  after: BoardResponse,
): { read: DropRow[]; finished: MoveRow[] } {
  if (!before) return { read: [], finished: [] };
  const wasUnread = new Set(
    before.drops.filter((d) => d.status === 'waiting' || d.status === 'resolving').map((d) => d.id),
  );
  const read = after.drops.filter(
    (d) => wasUnread.has(d.id) && (d.status === 'planned' || d.status === 'refused'),
  );
  const wasRunning = new Set(
    before.moves.filter((m) => m.status === 'running' || m.status === 'queued').map((m) => m.id),
  );
  const finished = after.moves.filter(
    (m) => wasRunning.has(m.id) && (m.status === 'done' || m.status === 'failed'),
  );
  return { read, finished };
}

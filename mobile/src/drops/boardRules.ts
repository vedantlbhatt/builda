/**
 * The board's two decisions that are not React: when to read it again, and whether a Start went.
 *
 * FOUND IN REVIEW (2026-09-19), both. The next read was scheduled only when the board CHANGED, so
 * one failed read while a move ran (a lift, a tunnel) left nothing scheduled and the card said
 * "running" until the person pulled. And a Start the server refused set an error that the read
 * after it wiped, so the wall said "Sent to your Mac" over a move that had flipped back to offered.
 */
import type { BoardResponse, MoveRow } from './types';

/** While something is in flight. Short enough that a resolution feels answered. */
export const BUSY_POLL_MS = 4000;
/** After a read that failed: still trying, without hammering a phone that has no signal. */
export const FAILED_POLL_MS = 15_000;

/** Is anything going to change without the person doing something? */
export function inFlight(board: BoardResponse): boolean {
  return (
    board.drops.some((d) => d.status === 'waiting' || d.status === 'resolving') ||
    board.moves.some((m) => m.status === 'queued' || m.status === 'running')
  );
}

/**
 * How long until the next read, or null for none. Asked after EVERY read, failed ones included:
 * a failed read changes nothing on the board, and the last board it had says what is in flight.
 */
export function pollDelay(board: BoardResponse, lastReadFailed: boolean): number | null {
  if (!inFlight(board)) return null;
  return lastReadFailed ? FAILED_POLL_MS : BUSY_POLL_MS;
}

type Send = (dropId: string, moveId: string, body: { adjustment: string | null; repo_key: string | null }) => Promise<unknown>;

/**
 * Start each move; true when every one is going. A 409 means it was already going, which is not a
 * failure. Every move is tried even after one fails, so one refusal does not hold back the rest.
 */
export async function startEach(
  send: Send,
  dropId: string,
  moveIds: string[],
  adjustment: string | null,
  repoKeys: Record<string, string>,
): Promise<boolean> {
  let all = true;
  for (const id of moveIds) {
    try {
      await send(dropId, id, { adjustment, repo_key: repoKeys[id] ?? null });
    } catch (e) {
      if ((e as { status?: number }).status !== 409) all = false;
    }
  }
  return all;
}

/**
 * What the island says after a Start, or nothing. A start from the wall names the move either way;
 * one from the open sheet says only a failure, because the sheet already shows the move running.
 */
export function startLine(went: boolean, title: string | null): { text: string; state: 'working' | 'error' } | null {
  if (went) return title ? { text: `Sent to your Mac: ${title}`, state: 'working' } : null;
  return { text: title ? `${title} did not reach your Mac. Try it again.` : 'That did not reach your Mac. Try it again.', state: 'error' };
}

/**
 * Whether a tap may start this move: one never started, or one that failed and can be tried again
 * (the server's `start_move` takes the same two). Queued, running, done and passed on are not.
 */
export function canStart(m: Pick<MoveRow, 'status'>): boolean {
  return m.status === 'offered' || m.status === 'failed';
}

/**
 * Whether the moves a Start sent are going, from the board read after it. A 409 answers both a
 * double tap ("already queued") and a move that cannot start from where it is (it finished, or a
 * server from before failed moves could be tried again). FOUND ON THE SIMULATOR (2026-09-19): the
 * second kind was counted as the first, and a Start that did nothing said nothing. Only the board
 * after says which; a move no longer on it (the drop was re read) is left to the 404 it got.
 */
export function startTook(moveIds: readonly string[], after: BoardResponse): boolean {
  return moveIds.every((id) => {
    const m = after.moves.find((x) => x.id === id);
    return !m || m.status === 'queued' || m.status === 'running' || m.status === 'done';
  });
}

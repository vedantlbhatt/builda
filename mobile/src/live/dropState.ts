/**
 * The drop Live Activity's card, as the phone computes it from its own poll (docs/drop-island.md).
 * PURE: no React Native, no native module, so `__tests__/dropActivity.test.ts` holds it to
 * `spec/fixtures/drops/activity_state.json`, the file `server/builder/drop_push.py
 * content_state` is held to as well. The server pushes this card while the app is away and the
 * phone moves it while the app is in front; two rules would flicker between two answers every
 * time a push landed on a card the phone had just drawn.
 */
import type { DropPhase, DropState } from '../../modules/builder-live/src/BuilderLive.types';
import { DROP_DONE_HOLD_MS } from '../island/model';

/** `drop_push.PHASE_OF_STATUS`: the card's phase for a drop status; archived has no card. */
export const DROP_PHASE_OF_STATUS: Readonly<Record<string, DropPhase>> = {
  waiting: 'sent',
  resolving: 'reading',
  planned: 'planned',
  refused: 'refused',
};

/** `drop_push.RANK`: a card only ever moves forward. */
export const DROP_RANK: Readonly<Record<DropPhase, number>> = { sent: 0, reading: 1, planned: 2, refused: 2, started: 3 };

/** `drop_push.NEEDS_A_REPO`: a move the island cannot start, because you pick the repository. */
export const NEEDS_A_REPO = 'existing_repo';

/** `drop_push.READING_STALE_SECONDS`: unanswered past this, the card says "waiting for your Mac". */
export const READING_STALE_SECONDS = 600;

/** `drop_push.RELEVANCE`: under needs you (100), over a session merely running (50). */
export const DROP_RELEVANCE = 60;

/**
 * An answered card holds this long and comes down: the in-app island's own beat
 * (`DROP_DONE_HOLD_MS`), so the two islands step aside together.
 */
export const DROP_HOLD_MS = DROP_DONE_HOLD_MS;

export interface DropLike {
  status: string;
  title: string | null;
  kind: string | null;
}

export interface MoveLike {
  id: string;
  position: number;
  status: string;
  title: string;
  target: string;
}

/**
 * Where a link came from, as a person reads it: the host without a leading `www.`, which is what
 * the in-app island says ("Reading instagram.com") and `drop_push.host_of` sends.
 */
export function dropHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return 'the post';
  }
}

/**
 * `drop_push.content_state`, line for line. Null for a drop no card shows. Before an answer the
 * card knows only where it stands: title, kind and the moves are absent then, never a guess.
 */
export function dropState(
  drop: DropLike,
  moves: readonly MoveLike[],
  opts: { nowMs: number; phase?: DropPhase; startedMoveId?: string | null }
): DropState | null {
  const phase: DropPhase | undefined = opts.startedMoveId ? 'started' : (opts.phase ?? DROP_PHASE_OF_STATUS[drop.status]);
  if (!phase) return null;
  const state: DropState = {
    phase,
    title: null,
    moves: 0,
    firstMoveTitle: null,
    firstMoveId: null,
    kind: null,
    updatedEpoch: Math.round(opts.nowMs / 1000),
  };
  if (phase === 'sent' || phase === 'reading') return state;
  state.title = drop.title || null;
  state.kind = drop.kind || null;
  if (phase === 'refused') return state;
  const offered = moves.filter((m) => m.status === 'offered').sort((a, b) => a.position - b.position);
  state.moves = offered.length;
  if (phase === 'started') {
    const started = moves.find((m) => m.id === opts.startedMoveId);
    if (started) {
      state.firstMoveTitle = started.title;
      state.firstMoveId = started.id;
    }
    return state;
  }
  const first = offered[0];
  if (first) {
    state.firstMoveTitle = first.title;
    state.firstMoveId = first.target === NEEDS_A_REPO ? null : first.id;
  }
  return state;
}

/** An answer, or a start: the card has nothing more to wait for. */
export function isAnswered(phase: string): boolean {
  return phase === 'planned' || phase === 'refused' || phase === 'started';
}

/**
 * The drop cards to take down now, when the app comes to the front: answered at least `holdMs`
 * ago, or past their stale date. A card the server moved while the app was away, one whose Start
 * ended the beat without the process surviving to end it, or one still "waiting for your Mac"
 * long after the Mac went quiet, comes down rather than sitting in the island all day
 * (docs/motion.md: an island that shows what has not changed is one you learn to ignore). The
 * board in front of you says the rest.
 */
export function dropsToEnd(
  cards: readonly { dropId: string; state: string; phase: string; updatedEpoch: number }[],
  nowMs: number,
  holdMs = DROP_HOLD_MS
): string[] {
  return cards
    .filter(
      (c) =>
        c.state === 'stale' || (c.state === 'active' && isAnswered(c.phase) && nowMs - c.updatedEpoch * 1000 >= holdMs)
    )
    .map((c) => c.dropId);
}

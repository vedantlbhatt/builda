/**
 * A reel you shared, on the Lock Screen and in the Dynamic Island while your Mac reads it
 * (docs/drop-island.md). The phone's half: the server starts and moves the card by push while
 * the app is away; this starts it when the APP itself lands a drop (paste, a deep link, the
 * drained share queue) while it is in front, moves it from the poll `trackDrop` already runs, and
 * takes an answered card down after the in-app island's beat.
 *
 * Why the app starts one at all when the in-app island already shows the drop: iOS never shows
 * your own app's Live Activity while the app is in front, so this card is for the moment you
 * leave. Share, go back to Instagram, and the system island carries on from where the in-app
 * one was (docs/motion.md, "One object in three places").
 *
 * The switches are the session cards' (`activity.ts`): no card unless Live Activities AND Lock
 * Screen details are on (a drop's title is a stranger's words on your Lock Screen), and the
 * server may push only for a signed in phone with both on. `syncDropSurfaces` hears them on
 * every foreground sync; until the first one this starts nothing.
 *
 * Every native call is optional-chained: the module is null on web and in Expo Go, and a build
 * from before these functions existed has none of them.
 */
import * as RN from 'react-native';

import BuilderLive from '../../modules/builder-live';
import type { DropPhase, DropState } from '../../modules/builder-live/src/BuilderLive.types';
import type { PushEnvironment } from '../data/api';
import { platformOf } from '../drops/urls';
import {
  DROP_HOLD_MS,
  DROP_RANK,
  DROP_RELEVANCE,
  READING_STALE_SECONDS,
  dropHost,
  dropState,
  dropsToEnd,
  isAnswered,
  type DropLike,
  type MoveLike,
} from './dropState';

function native() {
  return RN.Platform?.OS === 'ios' ? BuilderLive : null;
}

/** What the last foreground sync heard. False until one has: nothing starts on a guess. */
let cardsAllowed = false;
let pushAllowed = false;
/** The phase each drop's card was last moved to by this process, so a poll tick that changed
 * nothing does not update ActivityKit, and a card never moves backwards. */
const shown = new Map<string, DropPhase>();
const ending = new Set<string>();

function opts(phase: DropPhase) {
  return {
    relevance: DROP_RELEVANCE,
    staleInSeconds: isAnswered(phase) ? undefined : READING_STALE_SECONDS,
  };
}

/**
 * Called by `syncLiveActivities` on every foreground tick: hear the switches, hand the server
 * whatever token it has not taken, and take down answered cards past their beat. Never throws;
 * what went wrong is returned for the SyncResult's errors.
 */
export async function syncDropSurfaces(s: {
  enabled: boolean;
  push: boolean;
  environment: PushEnvironment;
  nowMs: number;
}): Promise<string[]> {
  const errors: string[] = [];
  const mod = native();
  cardsAllowed = s.enabled;
  pushAllowed = s.enabled && s.push;
  if (!mod) return errors;
  try {
    await mod.setDropPush?.(pushAllowed, s.environment);
    if (pushAllowed) await mod.flushDropTokens?.();
  } catch (e) {
    errors.push(`drop tokens: ${String(e)}`);
  }
  try {
    for (const dropId of dropsToEnd(mod.listDrops?.() ?? [], s.nowMs)) await endNow(dropId);
  } catch (e) {
    errors.push(`drop sweep: ${String(e)}`);
  }
  return errors;
}

/**
 * The app just landed a drop and is watching it (`trackDrop`). Starts its card when the app is
 * in front and the switches allow; a card the server already started by push is adopted rather
 * than doubled (`startDrop` in the module keeps one card per drop).
 */
export async function dropLanded(dropId: string, url: string, nowMs = Date.now()): Promise<boolean> {
  const mod = native();
  if (!mod?.startDrop || !cardsAllowed || RN.AppState?.currentState !== 'active') return false;
  const host = dropHost(url);
  const state = dropState({ status: 'waiting', title: null, kind: null }, [], { nowMs });
  if (!state) return false;
  try {
    await mod.startDrop({ dropId, host, platform: platformOf(host) }, state, { ...opts('sent'), push: pushAllowed });
    shown.set(dropId, 'sent');
    return true;
  } catch {
    // Live Activities off in iOS Settings, or ActivityKit refused: the in-app island still has it.
    return false;
  }
}

/**
 * One poll of the drop (`trackDrop`'s tick): move its card forward when the phase changed, and
 * take it down after the beat once it is answered.
 */
export async function dropMoved(drop: DropLike & { id: string }, moves: readonly MoveLike[], nowMs = Date.now()): Promise<DropState | null> {
  const mod = native();
  const state = dropState(drop, moves, { nowMs });
  const was = shown.get(drop.id);
  if (!mod?.updateDrop || !state || was === undefined || DROP_RANK[state.phase] <= DROP_RANK[was]) return null;
  try {
    if (!(await mod.updateDrop(drop.id, state, opts(state.phase)))) {
      // Swiped away, or the push-started card this process never saw: nothing to move.
      shown.delete(drop.id);
      return null;
    }
    shown.set(drop.id, state.phase);
  } catch {
    return null;
  }
  if (isAnswered(state.phase)) endAfterBeat(drop.id);
  return state;
}

function endAfterBeat(dropId: string): void {
  if (ending.has(dropId)) return;
  ending.add(dropId);
  setTimeout(() => void endNow(dropId), DROP_HOLD_MS);
}

async function endNow(dropId: string): Promise<void> {
  try {
    await native()?.endDrop?.(dropId, null, { dismissAfterSeconds: 0 });
  } catch {
    // Already gone.
  } finally {
    ending.delete(dropId);
    shown.delete(dropId);
  }
}

/** DEBUG and tests: what this process has moved, and forget it all. */
export function shownDrops(): ReadonlyMap<string, DropPhase> {
  return shown;
}

export function resetDropSurfacesForTests(): void {
  cardsAllowed = false;
  pushAllowed = false;
  shown.clear();
  ending.clear();
}

// ------------------------------------------------------------------ DEBUG (app/debug/live.tsx)

const DEBUG_DROP = 'debug-drop';
const DEBUG_REEL = 'https://www.instagram.com/reel/DGxvBNzR8vC';

/**
 * Drive one sample drop's card to `phase`, with no server: the same `dropState` a real poll
 * builds, from rows shaped like the server's, so the Lock Screen and the island can be looked at
 * on a simulator. `staleInSeconds` shortens the stale date to photograph "waiting for your Mac".
 */
export async function debugDropCard(
  phase: DropPhase | 'end',
  staleInSeconds?: number,
  nowMs = Date.now(),
  real?: { dropId: string; moveId: string | null }
): Promise<string> {
  const mod = native();
  if (!mod?.startDrop) return 'no drop Live Activity in this build';
  // A real drop's ids, so the card's Start button starts a move the server has.
  const dropId = real?.dropId ?? DEBUG_DROP;
  const firstMove = real?.moveId ?? 'debug-move-1';
  if (phase === 'end') {
    await mod.endDrop?.(dropId, null, { dismissAfterSeconds: 0 });
    shown.delete(dropId);
    return 'ended the sample drop card';
  }
  const status = phase === 'sent' ? 'waiting' : phase === 'reading' ? 'resolving' : phase === 'started' ? 'planned' : phase;
  const answered = phase === 'planned' || phase === 'started';
  const drop = {
    status,
    title: answered ? '5 beginner Claude Skills to install' : null,
    kind: answered ? 'skill' : null,
  };
  const moves: MoveLike[] = answered
    ? [
        { id: firstMove, position: 0, status: phase === 'started' ? 'queued' : 'offered', title: 'Go find the 5 skills', target: 'this_machine' },
        { id: 'debug-move-2', position: 1, status: 'offered', title: 'Try one in a scratch clone', target: 'this_machine' },
        { id: 'debug-move-3', position: 2, status: 'offered', title: 'Keep the list', target: 'none' },
      ]
    : [];
  const state = dropState(drop, moves, { nowMs, startedMoveId: phase === 'started' ? firstMove : null });
  if (!state) return `no card for ${phase}`;
  const host = dropHost(DEBUG_REEL);
  const o = { ...opts(state.phase), ...(staleInSeconds ? { staleInSeconds } : {}) };
  const id = await mod.startDrop({ dropId, host, platform: platformOf(host) }, state, o);
  shown.set(dropId, state.phase);
  return `drop card ${id}: ${state.phase}, ${state.moves} moves${state.firstMoveId ? `, Start ${state.firstMoveId}` : ''}`;
}

/**
 * A demo you asked your Mac for, on the Lock Screen and in the Dynamic Island (docs/demo-island.md).
 * The phone's half: this starts the card the moment "Request a demo" is answered (the app is in
 * front then, so no push-to-start is needed), moves it from the poll `trackDemo` already runs,
 * and takes an answered card down after the in-app island's beat. The server moves it by push
 * while the app is away: the Mac picking the request up, and the kit landing.
 *
 * Why the app starts one at all when the in-app island already shows the request: iOS never shows
 * your own app's Live Activity while the app is in front, so this card is for the moment you
 * leave. A demo takes minutes; you ask, go back to what you were doing, and the system island
 * carries on from where the in-app one was (docs/motion.md, "One object in three places").
 *
 * The switches are the session and drop cards' (`activity.ts`): no card unless Live Activities
 * AND Lock Screen details are on (the card names your project on the Lock Screen), and the
 * server may push only for a signed in phone with both on. `syncDemoSurfaces` hears them on every
 * foreground sync; until the first one this starts nothing.
 *
 * Every native call is optional-chained: the module is null on web and in Expo Go, and a build
 * from before these functions existed has none of them.
 */
import * as RN from 'react-native';

import BuilderLive from '../../modules/builder-live';
import type { DemoPhase, DemoState } from '../../modules/builder-live/src/BuilderLive.types';
import type { PushEnvironment } from '../data/api';
import { DEMO_HOLD_MS, DEMO_RANK, DEMO_RELEVANCE, demoState, demosToEnd, isAnswered, staleAfter, type DemoRequestLike } from './demoState';

function native() {
  return RN.Platform?.OS === 'ios' ? BuilderLive : null;
}

/** A request row as the demos routes return it (`DemoRequestRow`), the fields the card reads. */
export interface DemoRequestCard extends DemoRequestLike {
  id: string;
  project_key: string;
  hue: string | null;
}

/** What the last foreground sync heard. False until one has: nothing starts on a guess. */
let cardsAllowed = false;
let pushAllowed = false;
/** The phase each request's card was last moved to by this process, and its project, so a poll
 * tick that changed nothing does not update ActivityKit and a card never moves backwards. */
const shown = new Map<string, { phase: DemoPhase; projectKey: string }>();
/** Answered cards waiting out the beat; an end that comes sooner (taken back) calls theirs off. */
const ending = new Map<string, ReturnType<typeof setTimeout>>();

function opts(phase: DemoPhase) {
  return { relevance: DEMO_RELEVANCE, staleInSeconds: staleAfter(phase) };
}

/**
 * Called by `syncLiveActivities` on every foreground tick: hear the switches, hand the server
 * whatever token it has not taken, and take down answered cards past their beat and any card
 * past its stale date. Never throws; what went wrong is returned for the SyncResult's errors.
 */
export async function syncDemoSurfaces(s: {
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
    await mod.setDemoPush?.(pushAllowed, s.environment);
    if (pushAllowed) await mod.flushDemoTokens?.();
  } catch (e) {
    errors.push(`demo tokens: ${String(e)}`);
  }
  try {
    for (const requestId of demosToEnd(mod.listDemos?.() ?? [], s.nowMs)) await endNow(requestId);
  } catch (e) {
    errors.push(`demo sweep: ${String(e)}`);
  }
  return errors;
}

/**
 * The phone just asked for a demo and the server answered with the request (`useKit.request`,
 * through `trackDemo`). Starts its card when the app is in front and the switches allow. A request
 * the server answered with an existing live one is the same card, moved to where that one is.
 */
export async function demoAsked(req: DemoRequestCard, title: string, nowMs = Date.now()): Promise<boolean> {
  const mod = native();
  if (!mod?.startDemo || !cardsAllowed || RN.AppState?.currentState !== 'active') return false;
  const state = demoState(req, { nowMs });
  if (!state) return false;
  try {
    await mod.startDemo(
      { requestId: req.id, projectKey: req.project_key, title, hue: req.hue },
      state,
      { ...opts(state.phase), push: pushAllowed }
    );
    shown.set(req.id, { phase: state.phase, projectKey: req.project_key });
  } catch {
    // Live Activities off in iOS Settings, or ActivityKit refused: the in-app island still has it.
    return false;
  }
  if (isAnswered(state.phase)) endAfterBeat(req.id);
  return true;
}

/**
 * One poll of the request (`trackDemo`'s tick): move its card forward when the phase changed,
 * take it down after the beat once answered, and at once when the request was taken back.
 */
export async function demoMoved(req: DemoRequestCard, nowMs = Date.now()): Promise<DemoState | null> {
  const mod = native();
  if (!mod) return null;
  const state = demoState(req, { nowMs });
  if (!state) {
    // Taken back (on this phone or another): there is nothing left to say.
    if (shown.has(req.id)) await endNow(req.id);
    return null;
  }
  const was = shown.get(req.id);
  if (!mod.updateDemo || was === undefined || DEMO_RANK[state.phase] <= DEMO_RANK[was.phase]) return null;
  try {
    if (!(await mod.updateDemo(req.id, state, opts(state.phase)))) {
      // Swiped away: nothing to move.
      shown.delete(req.id);
      return null;
    }
    shown.set(req.id, { phase: state.phase, projectKey: was.projectKey });
  } catch {
    return null;
  }
  if (isAnswered(state.phase)) endAfterBeat(req.id);
  return state;
}

/** The request was taken back on this phone (`untrackDemo`): every card of the project, now. */
export async function demoTakenBack(projectKey: string): Promise<void> {
  const mod = native();
  if (!mod) return;
  const ids = new Set<string>();
  for (const [id, s] of shown) if (s.projectKey === projectKey) ids.add(id);
  try {
    for (const c of mod.listDemos?.() ?? []) if (c.projectKey === projectKey && (c.state === 'active' || c.state === 'stale')) ids.add(c.requestId);
  } catch {
    // The list is a courtesy; the ones this process started are already in `ids`.
  }
  for (const id of ids) await endNow(id);
}

function endAfterBeat(requestId: string): void {
  if (ending.has(requestId)) return;
  ending.set(requestId, setTimeout(() => void endNow(requestId), DEMO_HOLD_MS));
}

async function endNow(requestId: string): Promise<void> {
  try {
    await native()?.endDemo?.(requestId, null, { dismissAfterSeconds: 0 });
  } catch {
    // Already gone.
  } finally {
    const t = ending.get(requestId);
    if (t) clearTimeout(t);
    ending.delete(requestId);
    shown.delete(requestId);
  }
}

/** DEBUG and tests: what this process has moved, and forget it all. */
export function shownDemos(): ReadonlyMap<string, { phase: DemoPhase; projectKey: string }> {
  return shown;
}

export function resetDemoSurfacesForTests(): void {
  cardsAllowed = false;
  pushAllowed = false;
  shown.clear();
  for (const t of ending.values()) clearTimeout(t);
  ending.clear();
}

// ------------------------------------------------------------------ DEBUG (app/debug/live.tsx)

const DEBUG_REQUEST = 'debug-demo-request';
const DEBUG_PROJECT = 'ab'.repeat(32);

/**
 * Drive one sample request's card to `phase`, with no server and no Mac: the same `demoState` a
 * real poll builds, from a row shaped like the server's, so the Lock Screen and the island can be
 * looked at on a simulator. `staleInSeconds` shortens the stale date to photograph a quiet Mac.
 */
export async function debugDemoCard(phase: DemoPhase | 'end', staleInSeconds?: number, nowMs = Date.now()): Promise<string> {
  const mod = native();
  if (!mod?.startDemo) return 'no demo Live Activity in this build';
  if (phase === 'end') {
    await mod.endDemo?.(DEBUG_REQUEST, null, { dismissAfterSeconds: 0 });
    shown.delete(DEBUG_REQUEST);
    return 'ended the sample demo card';
  }
  const status = { asked: 'queued', filming: 'claimed', ready: 'done', failed: 'failed' }[phase];
  const row: DemoRequestCard = {
    id: DEBUG_REQUEST,
    project_key: DEBUG_PROJECT,
    status,
    refusal: phase === 'failed' ? 'capture_failed' : null,
    hue: 'orchid',
    // Asked four minutes ago, so the timer has something to count.
    created_at: new Date(nowMs - 4 * 60_000).toISOString(),
  };
  const state = demoState(row, { nowMs });
  if (!state) return `no card for ${phase}`;
  const o = { ...opts(state.phase), ...(staleInSeconds ? { staleInSeconds } : {}) };
  const id = await mod.startDemo({ requestId: row.id, projectKey: row.project_key, title: 'builda', hue: row.hue }, state, o);
  shown.set(row.id, { phase: state.phase, projectKey: row.project_key });
  return `demo card ${id}: ${state.phase}${state.failure ? `, ${state.failure}` : ''}`;
}

import { Platform } from 'react-native';

import BuilderLive from '../../modules/builder-live';
import type { SessionDetail } from '../data/api';
import { scheduleFinished, scheduleNeedsYou } from '../push/local';
import {
  buildWidgetSnapshot,
  planSync,
  retryAfter,
  type LiveStates,
  type Tracked,
  type WidgetToday,
} from './surface';
import { writeWidgetSnapshot } from './widget';

/**
 * Keep the Lock Screen, the Dynamic Island and the Home Screen widget in step with the
 * sessions that are running. Call it on each foreground tick with the live rows (and the
 * engine's live_state per row when the server sends it); it is safe to call as often as the
 * tick runs, because nothing reaches ActivityKit unless a surface would show something new.
 *
 * All the deciding is in `surface.ts` (`planSync`, pure and tested); this carries the plan to
 * the native module and remembers, per session, which activity shows it. Activities outlive
 * this process, so the first sync of a launch adopts whatever the system is still showing:
 * `start` for a session that already has one returns the existing id.
 *
 * ActivityKit starts activities only while the app is in the foreground, and nothing updates
 * them once it backgrounds until the server sends ActivityKit pushes (not built). The stale
 * date covers that honestly: after STALE_SECONDS without an update the surfaces say "Not
 * updating" instead of showing old work as current.
 *
 * Not wired into any screen yet (a later step does, from the live poll). Exported for it.
 */

export interface SyncOptions {
  /** The builder's creature id (their pick, else their archetype's): `resolveAnimal(...)`. */
  creature?: string | null;
  /** Rows that just went final, for the counts on their finished card. */
  finished?: SessionDetail[];
  /** For the widget's idle layout: today's attended time and the week's levels. */
  today?: WidgetToday | null;
  /** Write the widget snapshot too. Default true. */
  writeWidget?: boolean;
  /** Post the fallback notifications `planSync` asks for. Default true. */
  notify?: boolean;
  /** Seconds until "Not updating". Default STALE_SECONDS; only the debug route shortens it. */
  staleInSeconds?: number;
  nowMs?: number;
}

export interface SyncResult {
  started: number;
  updated: number;
  ended: number;
  notified: number;
  widget: boolean;
  /** Never thrown: a tick must not fail because one activity could not update. */
  errors: string[];
}

const tracked = new Map<string, Tracked>();
let adopted = false;
let queue: Promise<unknown> = Promise.resolve();

function native() {
  return Platform.OS === 'ios' ? BuilderLive : null;
}

/** Whether this build and this phone can show Live Activities at all. */
export function liveActivitiesAvailable(): boolean {
  try {
    return native()?.areActivitiesEnabled() ?? false;
  } catch {
    return false;
  }
}

/** The activity id showing `sessionId`, if one does. */
export function activityFor(sessionId: string): string | null {
  return tracked.get(sessionId)?.activityId ?? null;
}

/** Serialised: a tick that fires while the last sync is still talking to ActivityKit waits for it. */
export function syncLiveActivities(
  liveSessions: SessionDetail[],
  liveStates?: LiveStates,
  opts: SyncOptions = {}
): Promise<SyncResult> {
  const run = queue.then(
    () => sync(liveSessions, liveStates, opts),
    () => sync(liveSessions, liveStates, opts)
  );
  queue = run.catch(() => undefined);
  return run;
}

async function sync(liveSessions: SessionDetail[], liveStates: LiveStates | undefined, opts: SyncOptions): Promise<SyncResult> {
  const nowMs = opts.nowMs ?? Date.now();
  const result: SyncResult = { started: 0, updated: 0, ended: 0, notified: 0, widget: false, errors: [] };
  const mod = native();
  const enabled = liveActivitiesAvailable();

  if (mod && !adopted) {
    adopted = true;
    try {
      for (const a of mod.list()) {
        if ((a.state === 'active' || a.state === 'stale') && !tracked.has(a.sessionId)) {
          tracked.set(a.sessionId, { sessionId: a.sessionId, activityId: a.id, phase: 'working', key: '', state: null, attrs: null });
        }
      }
    } catch (e) {
      result.errors.push(`list: ${String(e)}`);
    }
  }

  const plan = planSync({
    sessions: liveSessions,
    liveStates,
    finished: opts.finished,
    tracked,
    activitiesEnabled: Boolean(mod) && enabled,
    creature: opts.creature,
    staleInSeconds: opts.staleInSeconds,
    nowMs,
  });
  const next = plan.tracked;

  for (const action of plan.actions) {
    try {
      switch (action.kind) {
        case 'start': {
          const id = await mod!.start(action.attrs, action.state, action.opts);
          const t = next.get(action.sessionId);
          if (t) next.set(action.sessionId, { ...t, activityId: id, retryAfterMs: undefined });
          result.started += 1;
          break;
        }
        case 'update':
          await mod!.update(action.activityId, action.state, action.opts);
          result.updated += 1;
          break;
        case 'end':
          await mod!.end(action.activityId, action.state, action.opts);
          result.ended += 1;
          break;
        case 'notify':
          if (opts.notify === false) break;
          if (action.which === 'needsYou') await scheduleNeedsYou(action.session, action.state.sentence);
          else await scheduleFinished(action.session);
          result.notified += 1;
          break;
      }
    } catch (e) {
      result.errors.push(`${action.kind} ${action.sessionId}: ${String(e)}`);
      const t = next.get(action.sessionId);
      // A start that failed waits a minute; an update whose activity is gone (the person
      // swiped it away) forgets it, so the next tick starts a fresh one.
      if (t && action.kind === 'start') next.set(action.sessionId, { ...t, activityId: null, retryAfterMs: retryAfter(nowMs) });
      if (t && action.kind === 'update') next.set(action.sessionId, { ...t, activityId: null });
    }
  }

  tracked.clear();
  for (const [k, v] of next) tracked.set(k, v);

  if (opts.writeWidget !== false) {
    result.widget = writeWidgetSnapshot(
      buildWidgetSnapshot({ sessions: liveSessions, liveStates, creature: opts.creature, today: opts.today, nowMs })
    );
  }
  return result;
}

/** End every Builder activity now and forget them (sign out; the debug route's state=end). */
export async function endAllLiveActivities(): Promise<void> {
  tracked.clear();
  try {
    await native()?.endAll();
  } catch {
    // nothing was running
  }
}

/** DEBUG: every surface's states as PNGs in Documents/live-previews. Paths, or [] without the module. */
export async function renderLivePreviews(): Promise<string[]> {
  const mod = native();
  return mod ? mod.renderPreviews() : [];
}

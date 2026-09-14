import { Platform } from 'react-native';

import BuilderLive from '../../modules/builder-live';
import type { RepoNames } from '../copy/repoLabel';
import type { PushEnvironment, SessionDetail } from '../data/api';
import { api } from '../data/client';
import { scheduleFinished, scheduleNeedsYou } from '../push/local';
import { crewFor } from './crew';
import { visibleRows } from './mission';
import {
  buildWidgetSnapshot,
  endedKey,
  normalizeCreature,
  planSync,
  retryAfter,
  type LiveStates,
  type Tracked,
  type WidgetToday,
} from './surface';
import { LiveTokens } from './tokens';
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
 * ActivityKit starts activities only while the app is in the foreground. Once it backgrounds,
 * the server's ActivityKit pushes (`server/builder/live_push.py`) move a card on a phase or
 * trajectory change: every activity starts with `push: true`, and its token goes to the server
 * through `tokens.ts` (details on and signed in only). The stale date covers the rest honestly:
 * after STALE_SECONDS without an update the surfaces say "Not updating" instead of showing old
 * work as current.
 *
 * Driven by `useLiveSurfaces` (the app's foreground poll, mounted at the root) with the real
 * live rows, and by the debug route with its fixtures.
 */

export interface SyncOptions {
  /**
   * The builder's own creature id (their pick, else their archetype's): `resolveAnimal(...)`. The
   * idle widget's, and a push token's when its session is unknown. No session wears it.
   */
  creature?: string | null;
  /**
   * Each session's creature by id. Default: `crewFor` over the live rows, the rows that just
   * finished and `around`, remembered for the process, so a card wears its tile's colour.
   */
  crew?: ReadonlyMap<string, string>;
  /**
   * The saved rows the crew rule steps a session's creature against (the Sessions list's window,
   * `session/useCrew.CREW_WINDOW`), so a creature picked here is the one the list picks.
   */
  around?: readonly SessionDetail[];
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
  /**
   * Settings > Show details on Lock Screen (`cache.getLockScreenDetails`). Default on. Off: the
   * cards say "Builda · N running", and since a card's attributes (its repository) cannot
   * change, a move of the switch ends every card for the next sync to start again.
   */
  details?: boolean;
  /**
   * Settings > Live Activities (`cache.getLiveActivities`). Default on. Off: every card comes
   * down on the first sync that hears it (a card from before this launch included, which is the
   * one a person swiped out of the app to get rid of), none starts while it stays off, and the
   * server forgets their push tokens. The widget and the fallback notifications carry on: with
   * no card up, the plan already notifies needs you and a finish that is news.
   */
  activities?: boolean;
  /**
   * Hand the server each activity's push token, so it can move the card while the app is in
   * the background. Only for a signed in account with details on; the debug route never does.
   */
  pushTokens?: boolean;
  /**
   * The phone's project names and numbers (`data/repoNames.loadRepoNames`), so a card names a
   * private project as the Projects tab does ("Private project 2"). Without them, "private repo".
   */
  names?: RepoNames | null;
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
/** The details switch as the last sync saw it; a move ends every card (attributes are fixed). */
let lastDetails: boolean | null = null;
/** Settings > Live Activities as the last sync heard it: null before the first sync. */
let lastActivities: boolean | null = null;

/**
 * The environment an ActivityKit token was issued for: a debug build is signed with the
 * development `aps-environment` and gets sandbox tokens, as `push.ts` says of the device token.
 */
const ENVIRONMENT: PushEnvironment = __DEV__ ? 'sandbox' : 'production';

/** The server's copy of this phone's activity tokens (`tokens.ts`). Off until a sync turns it on. */
const tokens = new LiveTokens(
  {
    register: (body) => api.registerLiveActivity(body),
    forget: (activityId) => api.forgetLiveActivity(activityId),
  },
  { enabled: false, environment: ENVIRONMENT, creature: 'bit' }
);
let listening = false;

function native() {
  return Platform.OS === 'ios' ? BuilderLive : null;
}

/**
 * Subscribe once to the module's token and state events: a token goes to the server, and an
 * activity that ended or that the person swiped away is forgotten there.
 */
function listen(mod: NonNullable<ReturnType<typeof native>>): void {
  if (listening) return;
  listening = true;
  try {
    mod.addListener('onPushToken', (e) => {
      void tokens.onToken(e);
    });
    mod.addListener('onActivityState', (e) => {
      if (e.state === 'ended' || e.state === 'dismissed') void tokens.onEnded(e.activityId);
    });
  } catch {
    // A module without events (a build from before prebuild): no pushes, the cards still run.
  }
}

/** Activity ids whose push token the server holds, for the debug route. */
export function registeredActivityTokens(): string[] {
  return tokens.registered();
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

type Module = NonNullable<ReturnType<typeof native>>;

/**
 * Start a card that can take the server's pushes, when the server may push to it. A build or a
 * phone that cannot issue an ActivityKit push token (no Push Notifications capability, or a
 * simulator that refuses) throws on `pushType: .token`; the card is then started without one,
 * because a card the app updates in the foreground beats no card at all.
 */
async function startActivity(
  mod: Module,
  attrs: Parameters<Module['start']>[0],
  state: Parameters<Module['start']>[1],
  opts: NonNullable<Parameters<Module['start']>[2]>,
  push: boolean
): Promise<string> {
  if (!push) return mod.start(attrs, state, opts);
  try {
    return await mod.start(attrs, state, { ...opts, push: true });
  } catch {
    return mod.start(attrs, state, opts);
  }
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
  const details = opts.details !== false;
  const activities = opts.activities !== false;

  if (mod) listen(mod);
  // Every session's own creature (DESIGN-V2 2.2): the one its tile wears, remembered.
  const crew = opts.crew ?? crewFor([...liveSessions, ...(opts.finished ?? []), ...(opts.around ?? [])]);
  // Details off, or signed out: the server forgets every token this process gave it, before
  // anything else, so no push can land on the card after the person turned details off. Each
  // token carries its session's creature, so a card the server moves keeps its colour.
  await tokens.update({
    enabled: Boolean(opts.pushTokens) && details && activities,
    environment: ENVIRONMENT,
    creature: normalizeCreature(opts.creature),
    crew: Object.fromEntries([...crew].map(([id, c]) => [id, normalizeCreature(c)])),
  });

  if (mod && lastDetails !== null && lastDetails !== details) {
    // A card's repository is an attribute, fixed for its life: the switch moved, so every card
    // comes down now and this same sync starts them again with the new name.
    try {
      await mod.endAll();
    } catch (e) {
      result.errors.push(`endAll: ${String(e)}`);
    }
    for (const t of tracked.values()) if (t.activityId) void tokens.onEnded(t.activityId);
    tracked.clear();
  }
  lastDetails = details;

  if (mod && !activities && lastActivities !== false) {
    // Settings > Live Activities is off, heard for the first time this process: every card
    // comes down, the ones adopted from before this launch too, and the plan below starts none.
    try {
      await mod.endAll();
    } catch (e) {
      result.errors.push(`endAll: ${String(e)}`);
    }
    for (const t of tracked.values()) if (t.activityId) void tokens.onEnded(t.activityId);
    tracked.clear();
  }
  lastActivities = activities;

  if (mod && !adopted && activities) {
    adopted = true;
    try {
      for (const a of mod.list()) {
        if ((a.state === 'active' || a.state === 'stale') && !tracked.has(a.sessionId)) {
          tracked.set(a.sessionId, { sessionId: a.sessionId, activityId: a.id, phase: 'working', key: '', state: null, attrs: null });
        } else if (a.state === 'ended' && !tracked.has(endedKey(a.id))) {
          // A finished card from before this launch, still on the Lock Screen: remembered so
          // the first running session takes it down instead of stacking under it. When it
          // ended is not known, so it counts from now (the system dismisses it on its own).
          tracked.set(endedKey(a.id), {
            sessionId: a.sessionId, activityId: a.id, phase: 'done', key: '', state: null, attrs: null, endedAtMs: nowMs,
          });
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
    activitiesEnabled: Boolean(mod) && enabled && activities,
    crew,
    staleInSeconds: opts.staleInSeconds,
    details,
    names: opts.names,
    nowMs,
  });
  const next = plan.tracked;

  for (const action of plan.actions) {
    try {
      switch (action.kind) {
        case 'start': {
          const id = await startActivity(mod!, action.attrs, action.state, action.opts, tokens.enabled);
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
          void tokens.onEnded(action.activityId);
          result.ended += 1;
          break;
        case 'notify':
          if (opts.notify === false) break;
          if (action.which === 'needsYou') await scheduleNeedsYou(action.session, action.body);
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
    // The rows mission control shows: a finished turn leaves the widget when it leaves the grid.
    const shown = visibleRows(liveSessions, [], new Map(), nowMs);
    result.widget = writeWidgetSnapshot(
      buildWidgetSnapshot({ sessions: shown, liveStates, creature: opts.creature, crew, today: opts.today, names: opts.names, nowMs })
    );
  }
  return result;
}

/**
 * End every Builda activity now and forget them (sign out; the debug route's state=end).
 *
 * In the same queue as the syncs. FOUND IN CAPTURE (2026-09-13): this cleared the memory
 * outside it, so a sync already in flight (a link iOS delivered late) started an activity
 * that the end then killed, or wrote its memory back over the cleared one, and the next
 * link's run reported "0 started" against a card that no longer existed.
 */
export function endAllLiveActivities(): Promise<void> {
  const run = queue.then(endAll, endAll);
  queue = run.catch(() => undefined);
  return run;
}

async function endAll(): Promise<void> {
  tracked.clear();
  // Nothing may push to a card that is gone, or to an account that signed out.
  await tokens.forgetAll();
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

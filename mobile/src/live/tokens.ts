/**
 * The server's list of ActivityKit tokens it may push a Live Activity update to
 * (docs/overnight-integration.md 3.6: `POST /v1/push/live-activity`, `DELETE
 * /v1/push/live-activity/{activity_id}`).
 *
 * The phone starts an activity with `push: true`, ActivityKit hands `onPushToken` a token for
 * it, and this posts `{kind: 'activity', session_id, activity_id, token, environment,
 * creature}`: the server stores no creature, and the card's ContentState needs one. The creature
 * is THAT SESSION's crew creature (`crew.ts`, DESIGN-V2 2.2), so a card the server moves in the
 * background keeps the colour the phone drew it in, and the server needs no copy of the crew
 * rule. When the phone ends an activity, or the person swipes it away, the token is forgotten on
 * the server too, so nothing pushes to a card that is gone.
 *
 * Settings > Show details on Lock Screen OFF means no token is registered and every one this
 * process registered is forgotten: a server push carries the repository and the engine's
 * sentence (`live_push.content_state`), which is exactly what the person turned off. FOUND IN
 * INTEGRATION (2026-09-13): WP-E and the push package both recorded that the switch lived only
 * on the phone, so the server would have kept writing to a Lock Screen the person had asked to
 * keep quiet.
 *
 * Pure, no React Native: the sink is injected (`activity.ts` hands it the api), so
 * `__tests__/liveTokens.test.ts` pins every rule.
 */

import type { Creature } from '../generated/live';
import type { LiveActivityRegistration, PushEnvironment } from '../data/api';

/** What ActivityKit's `pushTokenUpdates` hands `onPushToken` (BuilderLiveModule.swift). */
export interface TokenEvent {
  activityId: string;
  /** `BuilderSessionAttributes.sessionId`: the server's session uuid (`surface.toAttrs`). */
  sessionId: string;
  /** Hex, as the module formats it. */
  token: string;
}

export interface TokenSink {
  register(body: LiveActivityRegistration): Promise<void>;
  forget(activityId: string): Promise<void>;
}

export interface TokenSettings {
  /** Details on the Lock Screen AND signed in: only then may the server push to a card. */
  enabled: boolean;
  environment: PushEnvironment;
  /** The builder's own creature: a token whose session `crew` does not name. */
  creature: Creature;
  /** Each session's crew creature by session id: what its card is drawn in. */
  crew?: Readonly<Record<string, Creature>>;
}

interface Held {
  sessionId: string;
  token: string;
  /** Posted, and the server said yes. False while a post has not succeeded yet. */
  posted: boolean;
  /** The creature the server holds for it, once posted. */
  creature?: Creature;
  /** A post of this token is on its way: ActivityKit hands the same token over twice. */
  posting?: boolean;
}

export class LiveTokens {
  private held = new Map<string, Held>();
  private settings: TokenSettings;

  constructor(
    private readonly sink: TokenSink,
    settings: TokenSettings
  ) {
    this.settings = { ...settings };
  }

  get enabled(): boolean {
    return this.settings.enabled;
  }

  /** The creature a session's card wears: its crew creature, else the builder's. */
  private creatureFor(sessionId: string): Creature {
    return this.settings.crew?.[sessionId] ?? this.settings.creature;
  }

  /** The body a token is registered with. Exported through the class for the tests. */
  registration(e: TokenEvent): LiveActivityRegistration {
    return {
      kind: 'activity',
      session_id: e.sessionId,
      activity_id: e.activityId,
      token: e.token.toLowerCase(),
      environment: this.settings.environment,
      creature: this.creatureFor(e.sessionId),
    };
  }

  /**
   * A token for a running activity. Posted once per (activity, token): iOS sends it again on
   * every launch that re-observes the activity, and a rotated token is a new one. Off, it is
   * remembered and not sent, so turning details back on can register it without a new start.
   */
  async onToken(e: TokenEvent): Promise<'registered' | 'held' | 'failed' | 'known'> {
    const prev = this.held.get(e.activityId);
    const token = e.token.toLowerCase();
    // SEEN ON THE SIMULATOR (2026-09-13): one new activity, two registration posts a moment
    // apart and one token row. The same token already posted, or on its way, is known.
    if (prev && prev.token === token && (prev.posted || prev.posting)) return 'known';
    this.held.set(e.activityId, { sessionId: e.sessionId, token, posted: false });
    if (!this.settings.enabled) return 'held';
    return this.post(e.activityId);
  }

  /** The activity ended or was dismissed: the server forgets its token. */
  async onEnded(activityId: string): Promise<boolean> {
    const h = this.held.get(activityId);
    this.held.delete(activityId);
    if (!h?.posted) return false;
    try {
      await this.sink.forget(activityId);
      return true;
    } catch {
      // The server ends the token itself when the session finalises (`live_push._ends`), and
      // a push to an ended activity is dropped by ActivityKit: nothing is left showing.
      return false;
    }
  }

  /**
   * New settings, every sync tick. Turning the switch off (or signing out) forgets every
   * registered token on the server; turning it on posts the ones held back, and a tick with
   * the switch on retries any post that failed. The creature rides on the token, so a token
   * whose session's creature moved re-registers (the server upserts on the token).
   */
  async update(next: TokenSettings): Promise<void> {
    const was = this.settings;
    this.settings = { ...next };
    if (!next.enabled) {
      if (was.enabled) {
        for (const [id, h] of this.held) {
          if (!h.posted) continue;
          h.posted = false;
          try {
            await this.sink.forget(id);
          } catch {
            // best effort: with details off the phone stops starting pushable activities too
          }
        }
      }
      return;
    }
    const redo = was.environment !== next.environment;
    for (const [id, h] of this.held) {
      if (!h.posted || redo || h.creature !== this.creatureFor(h.sessionId)) await this.post(id);
    }
  }

  /** Every card came down (sign out, the debug route's end): forget all, on the server too. */
  async forgetAll(): Promise<void> {
    const ids = [...this.held.keys()];
    for (const id of ids) await this.onEnded(id);
  }

  /** Activity ids whose token the server holds now. */
  registered(): string[] {
    return [...this.held].filter(([, h]) => h.posted).map(([id]) => id);
  }

  private async post(activityId: string): Promise<'registered' | 'failed'> {
    const h = this.held.get(activityId);
    if (!h) return 'failed';
    h.posting = true;
    try {
      const body = this.registration({ activityId, sessionId: h.sessionId, token: h.token });
      await this.sink.register(body);
      h.posted = true;
      h.creature = body.creature;
      return 'registered';
    } catch {
      h.posted = false;
      return 'failed';
    } finally {
      h.posting = false;
    }
  }
}

/**
 * The demo Live Activity's card, as the phone computes it from a request row (docs/demo-island.md).
 * PURE: no React Native, no native module, so `__tests__/demoActivity.test.ts` holds it to
 * `spec/fixtures/demos/activity_state.json`, the file `server/builder/demo_push.py content_state`
 * is held to as well. The server pushes this card while the app is away and the phone moves it
 * while the app is in front; two rules would flicker between two answers every time a push
 * landed on a card the phone had just drawn.
 *
 * WHERE A REQUEST STANDS IS ONE RULE: `demoStepFor` (src/island/model.ts), the function the
 * in-app island's `trackDemo` reads. The card's phase is that step renamed for the card, so the
 * island inside the app and the one outside it cannot disagree about a request.
 *
 * DONE IS NOT THE SAME AS UP: the step `ready` is the card's `ready` only when `kitFromRequest`
 * (src/shipkit/model.ts, the kit screen's and the in-app island's rule) says a kit came of this
 * request; otherwise the Mac made it and kept it, `made`.
 */
import type { DemoPhase, DemoState } from '../../modules/builder-live/src/BuilderLive.types';
import { SHIPKIT_REFUSALS } from '../generated/shipkit';
import { DEMO_FOR_MS, DROP_DONE_HOLD_MS, demoStepFor, type DemoStep } from '../island/model';
import { kitFromRequest } from '../shipkit/model';

/**
 * `demo_push.PHASE_OF_STATUS`: the card's phase for the in-app island's step; `clear` has no card.
 * `ready` becomes `made` in `demoState` when no kit came of the request.
 */
export const DEMO_PHASE_OF_STEP: Readonly<Record<Exclude<DemoStep, 'clear'>, DemoPhase>> = {
  waiting: 'asked',
  filming: 'filming',
  ready: 'ready',
  failed: 'failed',
};

/**
 * `demo_push.RANK`: a card only ever moves forward. Made is below ready, so a kit published after
 * the Mac finished can still move the card on; ready and failed are both final.
 */
export const DEMO_RANK: Readonly<Record<DemoPhase, number>> = { asked: 0, filming: 1, made: 2, ready: 3, failed: 3 };

/**
 * `demo_push.ASKED_STALE_SECONDS`: asked and not picked up past this, the Mac is not looking. The
 * worker looks every 30 s, and this is the in-app island's own give up (`DEMO_FOR_MS`), so the two
 * islands stop claiming a request is on its way at the same moment.
 */
export const ASKED_STALE_SECONDS = DEMO_FOR_MS / 1000;

/**
 * `demo_push.FILMING_STALE_SECONDS`: the worker's three ceilings end to end (capture 60 min, the
 * build post 5, the kit 20, `capture/shipkit/watch.py`). Past them the worker has finished the
 * request one way or the other, so a card still filming means the Mac went quiet, and it says so.
 */
export const FILMING_STALE_SECONDS = 85 * 60;

/**
 * `demo_push.ANSWER_STALE_SECONDS`: a ready or failed card's stale date, which is also how long the
 * server leaves it up while Builda stays closed (`demo_push.ANSWER_HOLD_SECONDS`).
 */
export const ANSWER_STALE_SECONDS = 15 * 60;

/**
 * `demo_push.RELEVANCE`: the in-app island's order (docs/motion.md PRIORITY), demo under a drop
 * (60) and over a session merely running (50); a run that needs you (100) beats both.
 */
export const DEMO_RELEVANCE = 55;

/**
 * An answered card holds this long while the app is in front and comes down: the in-app island's
 * own beat for a ready kit (`trackDemo` posts it for `DROP_DONE_HOLD_MS`), so the two step aside
 * together.
 */
export const DEMO_HOLD_MS = DROP_DONE_HOLD_MS;

export interface DemoRequestLike {
  status: string;
  refusal: string | null;
  created_at: string;
  /** When the Mac took it; what a kit is measured against (`kitFromRequest`). */
  claimed_at?: string | null;
}

/** Whole Unix seconds, as `demo_push.js_round` rounds them. */
function seconds(ms: number): number {
  return Math.round(ms / 1000);
}

/**
 * `demo_push.content_state`, line for line. Null for a request no card shows (taken back, or no
 * row at all). The failure words are the kit screen's for the request's code, and null for any
 * phase but failed. `kitPublishedAt` is the project's shown kit (`GET /v1/projects/{key}/kit`
 * published_at); left out, a done request is `made`, the phase that promises less.
 */
export function demoState(req: DemoRequestLike | null | undefined, opts: { nowMs: number; kitPublishedAt?: string | null }): DemoState | null {
  const step = demoStepFor(req?.status);
  if (step === 'clear' || !req) return null;
  let phase = DEMO_PHASE_OF_STEP[step];
  if (phase === 'ready' && !kitFromRequest({ claimed_at: req.claimed_at ?? null, created_at: req.created_at }, opts.kitPublishedAt ?? null)) phase = 'made';
  const asked = Date.parse(req.created_at);
  const words = phase === 'failed' && req.refusal ? (SHIPKIT_REFUSALS as Readonly<Record<string, string>>)[req.refusal] : undefined;
  return {
    phase,
    sinceEpoch: seconds(Number.isFinite(asked) ? asked : opts.nowMs),
    failure: words ?? null,
    updatedEpoch: seconds(opts.nowMs),
  };
}

/**
 * Nothing more can happen to it: the kit is up, or it could not be made. These come down after
 * the in-app island's beat. Made is not final: a publish on the Mac can still move it to ready,
 * so it stays until its stale date or that push.
 */
export function isFinal(phase: string): boolean {
  return phase === 'ready' || phase === 'failed';
}

/** The stale date a phase is sent with, in seconds from now. Made takes an answer's. */
export function staleAfter(phase: DemoPhase): number {
  if (phase === 'asked') return ASKED_STALE_SECONDS;
  if (phase === 'filming') return FILMING_STALE_SECONDS;
  return ANSWER_STALE_SECONDS;
}

/**
 * The demo cards to take down now, when the app comes to the front: final at least `holdMs`
 * ago, or past their stale date (a made card whose kit was never published, among them). A kit that landed while Builda was closed has been seen by the
 * time you open Builda, and the kit screen says the rest (docs/motion.md: an island that shows
 * what has not changed is one you learn to ignore).
 */
export function demosToEnd(
  cards: readonly { requestId: string; state: string; phase: string; updatedEpoch: number }[],
  nowMs: number,
  holdMs = DEMO_HOLD_MS
): string[] {
  return cards
    .filter((c) => c.state === 'stale' || (c.state === 'active' && isFinal(c.phase) && nowMs - c.updatedEpoch * 1000 >= holdMs))
    .map((c) => c.requestId);
}

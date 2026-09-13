/**
 * The live engine's other words: the decision feed, the ETA's refusals, and the Lock Screen
 * line with details off.
 *
 * The one sentence per running session is `src/live/sentence.ts` (the live surface's). This
 * module holds the rest of what `analysis/live.py` says about a running session, ported from
 * the wire (`spec/live.v1.json`): a decision is a kind and a count, a refused ETA is a code
 * with `n` and `needed`, and the phone writes the words.
 */

import type { DecisionKind, LiveDecision, LiveEta } from '../generated/live';
import { DECISION_SENTENCES } from './catalog';
import { mins } from './numbers';

/** `live.decision_sentence(d, names=False)`. Null for a kind this build does not know. */
export function decisionSentence(kind: DecisionKind | string): string | null {
  return (DECISION_SENTENCES as Record<string, string>)[kind] ?? null;
}

/** The decision feed: one line per kind, hardest to undo first, as the engine ranked them. */
export function decisionLines(decisions: readonly LiveDecision[] | null | undefined): string[] {
  return (decisions ?? []).map((d) => decisionSentence(d.kind)).filter((s): s is string => s !== null);
}

/**
 * Why there is no ETA, in `live._eta`'s words, from the code and the numbers beside it. Null
 * when there is an ETA, and for a code this build does not know. `elapsed_s` is the one the
 * engine compared at, never the phone's clock: the refusal is about that moment.
 */
export function etaRefusal(eta: LiveEta): string | null {
  const noun = (k: number) =>
    eta.unattended ? (k === 1 ? 'unattended run' : 'unattended runs') : k === 1 ? 'session' : 'sessions';
  switch (eta.reason) {
    case null:
    case undefined:
      return null;
    case 'no_active_time':
      return 'the active time of this session was not supplied';
    case 'repo_unresolved':
      return 'the repository this session runs in could not be resolved';
    case 'no_history':
      return 'no finished sessions were supplied to compare this one against';
    case 'too_few_sessions': {
      if (typeof eta.n !== 'number') return null;
      return `${eta.n} finished ${noun(eta.n)} on this repository, ${eta.needed} needed`;
    }
    case 'too_few_survivors': {
      if (typeof eta.n !== 'number' || typeof eta.elapsed_s !== 'number') return null;
      return `${eta.n} finished ${noun(eta.n)} on this repository ran at least ${mins(eta.elapsed_s)}, ${eta.needed} needed`;
    }
    default:
      return null;
  }
}

/**
 * The Lock Screen with Settings > Show details on Lock Screen OFF (DESIGN-DIRECTION 7.2):
 * "Builder · 2 running", and nothing about which repository or what it is doing. The Lock
 * Screen is public; this is what a person who turned details off agreed it may say.
 */
export function lockScreenWithoutDetails(running: number): string {
  return `Builder · ${running} running`;
}

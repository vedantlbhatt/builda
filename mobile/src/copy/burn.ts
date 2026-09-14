/**
 * Where the tokens went, in plain English, written on the phone.
 *
 * Two readers of `analysis/burn.py`:
 *
 *   - ONE SESSION (`SessionDetail.burn`, contract v4): `explainBurn` is a line for line port
 *     of `burn.explain`, the plain English summary under a session. Every number it says
 *     comes from the wire block, and the shares arrive UNROUNDED so this rounds once, as
 *     `burn._unrounded` does on the Mac. Pinned to Python by `spec/fixtures/burn/
 *     session.json` in `__tests__/sessionCopy.test.ts`.
 *   - THE CORPUS (`BuilderReport.burn`, report v2): `corpusBurnLine` is the profile's own
 *     fact (`profile.headline_facts`, `barren_token_share`) and `corpusBurnRefusal` its
 *     refusals, from the block's code and numbers.
 *
 * Deliberately not a scolding, like the module it ports: a stretch that spent a lot and
 * produced nothing is described by what it was doing, never called a failure.
 */

import type { BurnCause, BurnRepeat, SessionBurn, SessionBurnCause, SessionBurnSpike } from '../generated/contract';
import type { ReportBurn } from '../generated/report';
import {
  BARREN_REFUSALS,
  CAUSE_SENTENCES,
  CAUSE_SENTENCES_ONE,
  CONTEXT_REPLAY_MIN_SHARE,
  HARNESS_ANALYSIS_NAME,
  REPEAT_SENTENCES,
  SAY_SHARE_AT,
  UNREADABLE_VERDICT,
  USAGE_READERS,
} from './catalog';
import { about, capital, commas, fill, human, shareWords, tally } from './numbers';

// ------------------------------------------------------------------ causes

/**
 * `burn._phrase`: the phrase one cause adds to the spike sentence, with its count. A
 * repeated call is said by what repeated: "the same command" is true only of a shell call.
 */
export function causePhrase(cause: BurnCause, k: number | null | undefined, repeat?: BurnRepeat | null): string | null {
  const template =
    cause === 'repeated_call'
      ? REPEAT_SENTENCES[repeat ?? 'other']
      : ((k === 1 ? CAUSE_SENTENCES_ONE[cause] : undefined) ?? CAUSE_SENTENCES[cause]);
  if (!template) return null;
  if (!template.includes('{n}')) return template;
  if (typeof k !== 'number' || !Number.isFinite(k)) return null;
  return template.replace('{n}', Number.isInteger(k) ? commas(k) : String(k));
}

/**
 * `burn._dominant` over a spike's causes: the one claiming the most tokens, ties to the
 * first, and never one that claims none. The wire lists causes most tokens first, so this
 * is `causes[0]` whenever it claims a token; the loop keeps it true of any order.
 */
export function dominantCause(causes: readonly SessionBurnCause[]): SessionBurnCause | null {
  let best: SessionBurnCause | null = null;
  for (const c of causes) {
    if (!c.tokens) continue;
    if (best === null || c.tokens > (best.tokens as number)) best = c;
  }
  return best;
}

/** `burn._verdict`: what a stretch produced, never a number it does not have. */
export function spikeVerdict(s: SessionBurnSpike): string {
  if (s.barren) return 'nothing was written';
  if (s.lines_added) return `it wrote ${tally(s.lines_added, 'line')}`;
  if (s.lines_removed) return `it removed ${tally(s.lines_removed, 'line')}`;
  if (s.files_changed) return `it changed ${tally(s.files_changed, 'file')}`;
  if (s.commits) return `it made ${tally(s.commits, 'commit')}`;
  if (s.unreadable) return UNREADABLE_VERDICT;
  return 'nothing was written';
}

// ------------------------------------------------------------------ one session

/**
 * `burn._work_clause`: what the session did to files, for the first sentence. The lines it
 * added and removed when either is counted; else the files or commits; else, when some
 * stretch ran something the transcript cannot see into, that it cannot say.
 */
function workClause(b: SessionBurn): string {
  const added = b.lines_added ?? 0;
  const removed = b.lines_removed ?? 0;
  if (added || removed) return `, added ${tally(added, 'line')} and removed ${commas(removed)}`;
  if (b.files_changed) return ` and changed ${tally(b.files_changed, 'file')} with no line count`;
  if (b.commits) return ` and made ${tally(b.commits, 'commit')}`;
  // The engine asks whether any stretch was unreadable; the wire says how many tokens went
  // into such stretches, so a stretch that was unreadable AND cost nothing reads as none.
  if (b.unreadable_share) return ', and whether it changed any file cannot be read from this transcript';
  return ', and nothing was written';
}

/**
 * Whether burn reads this harness's token counts. `harness` is the session's own, as the upload
 * spells it; `USAGE_READERS` is in the engine's names, so it is mapped first
 * (`HARNESS_ANALYSIS_NAME`, generated from `capture/harnesses.py`). FOUND IN REVIEW (2026-09-13):
 * the upload says `gemini_cli` where burn says `gemini`, so a Gemini session with no counts was
 * told its tool is not read yet. The one rule for burn's sentence and the call chart's.
 */
export function countsRead(harness: string): boolean {
  return USAGE_READERS.includes(HARNESS_ANALYSIS_NAME[harness] ?? harness);
}

/**
 * `burn.explain` for one session: the sentences, in order. `harness` is the session's own
 * (`SessionDetail.harness`), because a tool whose counts burn does not read yet is told so
 * differently from a transcript that holds none.
 */
export function explainBurn(b: SessionBurn, harness: string): string[] {
  if (b.reason === 'not_segmented') return ['Nothing in this transcript could be read yet, so there is no cost to show.'];
  if (b.reason === 'no_token_counts') {
    if (!countsRead(harness)) return ['Cost is not shown for this tool yet.'];
    return ['This transcript does not record token counts, so cost cannot be shown.'];
  }

  const total = b.tokens ?? 0;
  const lines = [`This session used ${human(total)} tokens${workClause(b)}.`];

  const cache = b.cache_read_share;
  if (typeof cache === 'number' && cache >= CONTEXT_REPLAY_MIN_SHARE) {
    lines.push(
      `${capital(shareWords(cache))} of that was the conversation re-reading itself, which is normal in a long session and is the main reason cost climbs the longer you go.`
    );
  }

  const barren = b.barren_share;
  if (typeof barren === 'number' && barren >= SAY_SHARE_AT) {
    lines.push(`${about(barren)} went into stretches where nothing was written. That is not always wasted, but it is where to look first.`);
  }

  const unreadable = b.unreadable_share;
  if (typeof unreadable === 'number' && unreadable >= SAY_SHARE_AT) {
    lines.push(`${about(unreadable)} went into stretches whose commands or helper agents may have changed files this transcript does not show.`);
  }

  // Only the most expensive spike may be called "the most expensive stretch".
  const top = b.spikes?.[0];
  if (top) {
    const cost = human(top.tokens);
    const dominant = dominantCause(top.causes);
    const phrase = dominant ? causePhrase(dominant.cause, dominant.n, dominant.repeat) : null;
    if (phrase && dominant?.tokens && top.tokens) {
      // From the unrounded claim, so this share and the cause's own can never differ.
      const share = dominant.tokens / top.tokens;
      lines.push(`The most expensive stretch cost ${cost} tokens, ${shareWords(share)} of it ${phrase}, and ${spikeVerdict(top)}.`);
    } else {
      lines.push(`The most expensive stretch cost ${cost} tokens, and ${spikeVerdict(top)}.`);
    }
  }
  return lines;
}

/**
 * Why a session's burn block names no spike, when it names none: the engine's own reason
 * (`burn_report`'s `missing`). Null when spikes were measured, or the block is refused.
 */
export function spikesMissing(b: SessionBurn): string | null {
  if (b.reason != null || b.spikes != null) return null;
  const needed = b.spikes_needed;
  if (typeof needed !== 'number') return null;
  return `fewer than ${needed} segments, so a median segment cost would be an accident rather than a baseline`;
}

// ------------------------------------------------------------------ the corpus

/**
 * The profile's barren token fact, from the report's burn block: "At least 3% of your tokens
 * went into stretches where nothing was written". A floor unless every other token is known
 * to have been judged, and never "at least" before words that already bound it. Null on a
 * refusal and on a measured zero, which is no fact at all.
 */
export function corpusBurnLine(b: ReportBurn): string | null {
  if (b.share == null || !b.barren_tokens) return null;
  const share = b.tokens ? b.barren_tokens / b.tokens : b.share;
  const said = shareWords(share);
  const floor = b.unreadable_tokens !== 0 && !said.startsWith('under') && !said.startsWith('over');
  return capital(`${floor ? 'at least ' : ''}${said} of your tokens went into stretches where nothing was written`);
}

/**
 * The corpus block's refusal, in `profile.BARREN_REFUSALS`'s words for its code (`{n}` the
 * sessions with counts, `{needed}` the floor). Null for a code this build does not know.
 */
export function corpusBurnRefusal(b: ReportBurn): string | null {
  const template = b.reason == null ? undefined : BARREN_REFUSALS[b.reason];
  return template === undefined ? null : fill(template, { n: b.sessions, needed: b.needed ?? null });
}

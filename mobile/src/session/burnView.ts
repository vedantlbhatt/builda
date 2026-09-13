/**
 * WHERE ONE SESSION'S TOKENS WENT, as the session screen lays it out: the numbers of the burn
 * block (contract v4 `burn`, computed on the machine by `analysis/burn.py`), its costliest
 * stretches with their causes in words, and every refusal as a sentence.
 *
 * The sentences about the whole session are the paragraph's (`summary.ts`, which places
 * `burn.explain`); this is the forensics under it, so it says numbers and short phrases and
 * repeats none of those sentences. Every phrase comes from the engine's tables through
 * `src/copy/burn.ts` (`causePhrase`, `spikeVerdict`, `spikesMissing`), every share through
 * `shareWords` from the unrounded share (a positive share never reads 0%, a share short of
 * all of it never reads 100%), and every token count through `human` (`burn._human`).
 *
 * Absent is null, never 0: a block the producer did not compute is `absent`, a refusal is its
 * own sentence, a cost per line exists only where a line was counted, and a cause that claims
 * no token is never listed as a cost.
 *
 * Pure: no React Native, so `bun test` runs it.
 */

import { causePhrase, spikesMissing, spikeVerdict } from '../copy/burn';
import { capital, commas, human, mins, n as said, pyRound, shareWords } from '../copy/numbers';
import { spoken } from '../copy/plain';
import type { SessionDetail } from '../data/api';
import type { SessionBurn, SessionBurnSpike } from '../generated/contract';
import { burnRefusal } from './summary';

/** One number over its label: the shape the kit's `StatItem` takes. */
export interface BurnStat {
  value: string;
  label: string;
}

export interface SpikeView {
  /** "23.4M tokens" */
  title: string;
  /** How long the stretch ran, from its prompt to its last event: "38 minutes". */
  duration: string;
  /** "8.1 times a typical stretch · 52k tokens a line", the parts that exist. */
  meta: string;
  /** "97% of it re-reading the conversation so far", one per cause that claims a token. */
  causes: string[];
  /** What it produced, plainly: "It wrote 412 lines." or "Nothing was written." */
  verdict: string;
  barren: boolean;
}

export type BurnView =
  /** No block: the producer that sent this session does not compute one. */
  | { kind: 'absent'; sentence: string }
  /** The block's own refusal, in the engine's words. */
  | { kind: 'refused'; sentence: string }
  | {
      kind: 'ready';
      stats: BurnStat[];
      /** Why the token count here can differ from the one under Numbers, when it does. */
      ledgerNote: string | null;
      spikes: SpikeView[];
      /** Why no stretch is named, when none is. */
      spikesNote: string | null;
      /** Shown when a stretch lists two causes or more: their shares overlap. */
      overlapNote: string | null;
    };

/** No block at all. Not a refusal: nothing was computed, so nothing is claimed. */
export const ABSENT_SENTENCE = 'No cost breakdown was sent with this session.';

/**
 * `nothing_inside_segments`: the transcript recorded usage and none of it fell inside a
 * stretch. `burn.explain` has no refusal for this code and says "This session used 0
 * tokens", a measured zero about the stretches; beside the ledger's own total under Numbers
 * it would read as two answers to one question, so the section says what the zero is about.
 */
export const NOTHING_INSIDE_SENTENCE =
  'This session recorded tokens, but none fell inside a stretch from one prompt of yours to the next, so there is nothing to break down.';

/** `spikes` measured and empty: enough stretches, none far above the typical one. */
export const NO_SPIKE_SENTENCE = 'No single stretch stood out from the rest.';

/**
 * `burn.Segment.attribution`'s own caveat, said once: "one turn can count toward two"
 * (the CLI's WHERE IT WENT header). A reader adding the shares up would count a turn twice.
 */
export const OVERLAP_SENTENCE = 'One turn can count toward two causes, so these shares overlap.';

/**
 * Why no stretch is named when too few were measured. WHEN is burn's own rule, through
 * `spikesMissing` (the port of `burn_report`'s missing reason: no refusal, no spikes, and
 * `spikes_needed` known); the WORDS are the same two numbers said without "segment" and
 * "median", which the CLI can say and this screen, written for anyone, should not.
 */
export function tooFewStretches(b: SessionBurn): string | null {
  if (spikesMissing(b) === null || typeof b.spikes_needed !== 'number') return null;
  return `No stretch is singled out: it takes ${spoken(b.spikes_needed)} before one can stand out from the rest, and this session has ${spoken(b.segments)}.`;
}

/** Tokens over the lines a stretch or a session changed, as `burn.Segment.cost_per_line`. */
export function tokensPerLine(tokens: number | null | undefined, added: number | null | undefined, removed: number | null | undefined): string | null {
  const lines = (added ?? 0) + (removed ?? 0);
  if (typeof tokens !== 'number' || tokens <= 0 || lines <= 0) return null;
  return `${human(pyRound(tokens / lines))} tokens a line`;
}

/**
 * One cause as a line under its stretch: its claim over the stretch's tokens and the
 * engine's phrase, "46% of it on running the same command 4 times". Null when the cause
 * claims no token (never listed as a cost it is not in) or has no phrase this build knows.
 */
export function causeLine(c: SessionBurnSpike['causes'][number], stretchTokens: number): string | null {
  if (!c.tokens || c.tokens <= 0 || stretchTokens <= 0) return null;
  const phrase = causePhrase(c.cause, c.n, c.repeat);
  if (!phrase) return null;
  return `${shareWords(c.tokens / stretchTokens)} of it ${phrase}`;
}

export function spikeView(s: SessionBurnSpike): SpikeView {
  const meta = [`${said(s.multiple)} times a typical stretch`, tokensPerLine(s.tokens, s.lines_added, s.lines_removed)]
    .filter((x): x is string => x !== null)
    .join(' · ');
  const causes = s.causes.map((c) => causeLine(c, s.tokens)).filter((x): x is string => x !== null);
  return {
    title: `${human(s.tokens)} tokens`,
    duration: mins(s.seconds),
    meta,
    causes,
    verdict: `${capital(spikeVerdict(s))}.`,
    barren: s.barren,
  };
}

/** The ledger's total on this session's stats, as the Numbers grid and the card say it. */
function ledgerTokens(stats: SessionDetail['stats']): number | null {
  if (!stats || !stats.tokens_reported) return null;
  const parts = [stats.tok_in, stats.tok_out, stats.tok_cache_read, stats.tok_cache_w5m, stats.tok_cache_w1h];
  if (parts.every((p) => p == null)) return null;
  return parts.reduce<number>((sum, p) => sum + (p ?? 0), 0);
}

function stats(b: SessionBurn, tokens: number): BurnStat[] {
  const out: BurnStat[] = [{ value: human(tokens), label: 'tokens' }];
  if (typeof b.cache_read_share === 'number') out.push({ value: shareWords(b.cache_read_share), label: 're-reading the conversation' });
  if (typeof b.barren_share === 'number') out.push({ value: shareWords(b.barren_share), label: 'where nothing was written' });
  const perLine = tokensPerLine(tokens, b.lines_added, b.lines_removed);
  if (perLine) out.push({ value: perLine.replace(/ tokens a line$/, ''), label: 'tokens a line' });
  // Neither barren nor productive: a script or a helper may have written what the transcript
  // cannot show. Said only when some was; a measured zero here is no finding.
  if (typeof b.unreadable_share === 'number' && b.unreadable_share > 0) {
    out.push({ value: shareWords(b.unreadable_share), label: 'could not be judged' });
  }
  // A stretch is one prompt of yours to the next (`burn.segments`), the unit every line above
  // and every row below is about.
  out.push({ value: commas(b.segments), label: b.segments === 1 ? 'stretch' : 'stretches' });
  return out;
}

export function burnView(s: Pick<SessionDetail, 'burn' | 'harness' | 'stats'>): BurnView {
  const b = s.burn;
  if (!b) return { kind: 'absent', sentence: ABSENT_SENTENCE };
  if (b.reason === 'nothing_inside_segments') return { kind: 'refused', sentence: NOTHING_INSIDE_SENTENCE };
  const refusal = burnRefusal(s);
  if (refusal !== null) return { kind: 'refused', sentence: refusal };
  if (b.reason != null || typeof b.tokens !== 'number') {
    // A code this build has no sentence for, or an answered block with no count: say what is
    // true, that this session carries no breakdown it can read, rather than a zero.
    return { kind: 'absent', sentence: ABSENT_SENTENCE };
  }

  // The ledger (`stats`, capture's token_ledger) and burn count differently: burn counts from
  // the first prompt on, every message once. MEASURED on the overnight corpus: 2 of 78
  // sessions differ (57.6M against 41.6M on one). Two figures for one quantity on one screen
  // get a line saying why, rather than silence.
  const ledger = ledgerTokens(s.stats);
  const ledgerNote =
    ledger !== null && human(ledger) !== human(b.tokens)
      ? `Counted from your first prompt on, each message once, so it can differ from the ${human(ledger)} tokens under numbers.`
      : null;

  const spikes = (b.spikes ?? []).map(spikeView);
  let spikesNote: string | null = null;
  if (b.spikes == null) spikesNote = tooFewStretches(b);
  else if (b.spikes.length === 0) spikesNote = NO_SPIKE_SENTENCE;

  return {
    kind: 'ready',
    stats: stats(b, b.tokens),
    ledgerNote,
    spikes,
    spikesNote,
    overlapNote: spikes.some((v) => v.causes.length >= 2) ? OVERLAP_SENTENCE : null,
  };
}

/**
 * Whether the burn section's token count stands for the session's, so Numbers need not say
 * it again: the block answered and the ledger either agrees to the figure shown or holds no
 * count at all. When the two differ, Numbers keeps its own and the note says why.
 */
export function burnCoversTokens(view: BurnView): boolean {
  return view.kind === 'ready' && view.ledgerNote === null;
}

/** "the costliest stretch" or "the three costliest stretches", for the section's label. */
export function spikesLabel(count: number): string {
  return count === 1 ? 'the costliest stretch' : `the ${spoken(count)} costliest stretches`;
}

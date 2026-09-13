/**
 * THE COSTLY STRETCHES, AS A CHART: burn forensics drawn (`BurnSection.tsx`, `SpikeChart.tsx`).
 *
 * What is measured, and so what may be drawn. The wire carries at most three costly stretches
 * (`burn.spikes`), each with its tokens and `multiple`, its tokens over the session's median
 * stretch to one decimal. It carries no other stretch and no median in tokens. So the chart is in
 * the one unit it has: A TYPICAL STRETCH IS 1, and each costly one stands at its multiple, beside
 * the line burn draws its own bar at (`burn.SPIKE_MULTIPLE`, three times the median, the
 * constant `map/frames.ts` already pins to Python). Nothing else is drawn: not the other
 * stretches, not a median in tokens recomputed from a rounded multiple.
 *
 * Colour is the cause: each bar wears the hue of the cause claiming the most of its tokens
 * (`copy/burn.dominantCause`, burn's `_dominant`), so a page of context replay reads as one
 * colour and the one stretch that went to failing calls stands out. The fill is what the
 * stretch produced, in the same order `spikeVerdict` decides it: solid when it wrote, removed,
 * changed or committed something; an outline when it ran something the transcript cannot show
 * (it cannot be judged); dotted in 1 bit cells when nothing was written. No red for waste: a
 * stretch that produced nothing is described, never scolded (burn.py's rule).
 *
 * The causes under each stretch are separate meters, never a stacked bar: one turn can count
 * toward two causes, so the shares overlap and would not sum to the stretch.
 *
 * Pure: no React Native, so `bun test` holds it.
 */

import { dominantCause } from '../copy/burn';
import { human, mins, n as said, shareWords } from '../copy/numbers';
import type { BurnCause, SessionBurn, SessionBurnSpike } from '../generated/contract';
import { numSpec, type NumSpec } from '../insights/format';
import { SPIKE_MULTIPLE } from '../map/frames';
import type { HueName } from '../theme';
import { causeLine, spikeView, type BurnView } from './burnView';

/**
 * A hue per cause, away from the burn chapter's own band (ember) and from each other, and never
 * the data green or red. Context replay, the conversation re-reading itself, is the cool tide:
 * it is the dominant cause of nearly every stretch (MEASURED over the overnight stack's 78
 * Claude Code sessions), so most bars are tide and the rare other cause is the one that shows.
 */
export const CAUSE_HUE: Record<BurnCause, HueName> = {
  context_replay: 'tide',
  subagent_fanout: 'iris',
  error_loop: 'coral',
  repeated_call: 'brass',
  file_churn: 'orchid',
  compaction: 'heather',
  investigated: 'cobalt',
};

/** A cause as a legend word: short, lower case, the thing itself. */
export const CAUSE_LABEL: Record<BurnCause, string> = {
  context_replay: 're-reading the conversation',
  subagent_fanout: 'helper agents',
  error_loop: 'failing calls and retries',
  repeated_call: 'the same call again',
  file_churn: 'one file rewritten',
  compaction: 'rebuilding the context',
  investigated: 'reading files',
};

export type BarFill = 'solid' | 'hollow' | 'dotted';

export interface ChartBar {
  key: string;
  /** Height, in typical stretches. */
  multiple: number;
  /** Over the bar: "8.1×", "1×". */
  top: string;
  /** Under the bar: "typical", "38 minutes". */
  under: string;
  /** The dominant cause, whose hue the bar wears. Null: the typical bar, or no cause found. */
  cause: BurnCause | null;
  fill: BarFill;
  spike: boolean;
}

export interface CauseMeter {
  cause: BurnCause;
  /** Of the stretch's tokens, 0 to 1, unrounded. */
  share: number;
  /** "97% of it re-reading the conversation so far" (`burnView.causeLine`). */
  text: string;
}

export interface SpikeRow {
  key: string;
  /** "01". */
  index: string;
  tokens: NumSpec;
  /** "tokens in 38 minutes". */
  label: string;
  cause: BurnCause | null;
  fill: BarFill;
  meters: CauseMeter[];
  /** "It wrote 412 lines." (`spikeVerdict`). */
  verdict: string;
  /** "8.1 times a typical stretch · 52k tokens a line". */
  meta: string;
}

export interface BurnChart {
  bars: ChartBar[];
  /** Where burn draws its own bar: a stretch at this many typical ones is a spike. */
  threshold: number;
  /** The tallest bar, in typical stretches, never under the threshold. */
  max: number;
  /**
   * The causes the BARS wear, in the order they first appear: a key says what is drawn above it
   * and nothing else. The meters under each stretch name their own cause in a sentence and need
   * no key. FOUND IN THE FINAL CAPTURE (2026-09-13): six causes listed under three bars that all
   * wore one, because every meter's cause was added too.
   */
  legend: { cause: BurnCause; label: string }[];
  /** Which fills appear, so the key under the chart says only those. */
  fills: BarFill[];
  rows: SpikeRow[];
}

/** What a stretch produced, as a fill: `spikeVerdict`'s own order. */
export function fillOf(s: SessionBurnSpike): BarFill {
  if (s.barren) return 'dotted';
  if (s.lines_added || s.lines_removed || s.files_changed || s.commits) return 'solid';
  if (s.unreadable) return 'hollow';
  return 'dotted';
}

export function meters(s: SessionBurnSpike): CauseMeter[] {
  const out: CauseMeter[] = [];
  for (const c of s.causes) {
    const text = causeLine(c, s.tokens);
    if (text === null || !c.tokens) continue;
    out.push({ cause: c.cause, share: Math.min(1, c.tokens / s.tokens), text });
  }
  return out;
}

/** The key line under the chart: what a dotted and an outlined bar mean, only when one is drawn. */
export function fillKey(fills: readonly BarFill[]): string | null {
  const dotted = fills.includes('dotted');
  const hollow = fills.includes('hollow');
  if (dotted && hollow) return 'A dotted bar wrote nothing, and an outlined one ran something its transcript cannot show.';
  if (dotted) return 'A dotted bar wrote nothing.';
  if (hollow) return 'An outlined bar ran something its transcript cannot show.';
  return null;
}

/**
 * The chart, or null when there is no costly stretch to draw: the block refused, too few
 * stretches were measured, or none stood out (each of those is a sentence, `burnView`'s).
 */
export function burnChart(b: SessionBurn | null | undefined): BurnChart | null {
  if (!b || b.reason != null || !b.spikes || b.spikes.length === 0) return null;
  const spikes = b.spikes;
  const bars: ChartBar[] = [{ key: 'typical', multiple: 1, top: '1×', under: 'typical', cause: null, fill: 'solid', spike: false }];
  const rows: SpikeRow[] = [];
  const legend: { cause: BurnCause; label: string }[] = [];
  const seen = new Set<BurnCause>();
  const note = (c: BurnCause) => {
    if (seen.has(c)) return;
    seen.add(c);
    legend.push({ cause: c, label: CAUSE_LABEL[c] });
  };
  spikes.forEach((s, i) => {
    const dominant = dominantCause(s.causes)?.cause ?? null;
    const fill = fillOf(s);
    const view = spikeView(s);
    const m = meters(s);
    if (dominant) note(dominant);
    bars.push({ key: `s${i}`, multiple: s.multiple, top: `${said(s.multiple)}×`, under: mins(s.seconds), cause: dominant, fill, spike: true });
    rows.push({
      key: `s${i}`,
      index: String(i + 1).padStart(2, '0'),
      tokens: numSpec(s.tokens, human(s.tokens), { kind: 'tokens' }),
      label: `tokens in ${mins(s.seconds)}`,
      cause: dominant,
      fill,
      meters: m,
      verdict: view.verdict,
      meta: view.meta,
    });
  });
  const max = Math.max(SPIKE_MULTIPLE, ...bars.map((x) => x.multiple));
  const fills = [...new Set(bars.filter((x) => x.spike).map((x) => x.fill))];
  return { bars, threshold: SPIKE_MULTIPLE, max, legend, fills, rows };
}

// ------------------------------------------------------------------ the band and the ledger

export interface BurnBand {
  /** The session's tokens, counted up, resting on `human` (`burn._human`). */
  tokens: NumSpec;
  /** "98% of them re-reading the conversation so far", when the share was sent. */
  note: string | null;
}

/** The burn chapter's band: the one big number and the fact that explains most of it. */
export function burnBand(b: SessionBurn): BurnBand | null {
  if (b.reason != null || typeof b.tokens !== 'number') return null;
  const note = typeof b.cache_read_share === 'number' ? `${shareWords(b.cache_read_share)} of them re-reading the conversation so far` : null;
  return { tokens: numSpec(b.tokens, human(b.tokens), { kind: 'tokens' }), note };
}

export interface BurnLedgerLine {
  key: string;
  label: string;
  note: string | null;
  /** Counted up when the value is one plain number ("3%", "85k", "52"). */
  num: NumSpec | null;
  /** Set still when it is words ("under 1%", "over 99%"): a count cannot rest on a word. */
  shown: string;
}

/**
 * A figure that can count: digits with at most a unit after them ("3%", "85k", "1.2M", "52").
 * "under 1%" parses as a number with a prefix, and counting it would say "under 0%" on the way:
 * a claim the block never made. Words are set still.
 */
const PLAIN_FIGURE = /^\d[\d,]*(?:\.\d+)?[%kM]?$/;

/**
 * What the session's stretches are, said so it is true of THIS session. Burn cuts a session at
 * your prompts, and the work before the first prompt is a stretch of its own (`burn.segments`,
 * segment 0), so a session with no prompt is one stretch: the whole of it. FOUND IN THE FINAL
 * CAPTURE (2026-09-13): "1 stretch, each from one prompt of yours to the next" on an agent run
 * with 0 prompts. `prompts` is the session's own count (`human_prompt_count`); null when it did
 * not send one. Where the two counts do not line up the way burn cuts, only the general rule is
 * said, and a single stretch with no count to explain it says nothing.
 */
export function stretchNote(stretches: number, prompts: number | null): string | null {
  if (prompts === 0) return stretches === 1 ? 'the whole session, with no prompt of yours to cut it' : null;
  if (stretches === 1) return prompts === 1 ? 'from your one prompt to the end' : null;
  if (prompts !== null && stretches === prompts + 1) return 'each from one prompt of yours to the next, and the work before the first';
  return 'each from one prompt of yours to the next';
}

/**
 * The block's numbers under the chart, as lines of print: every stat `burnView` says except the
 * two the band already carries (the tokens and the share re-reading the conversation), so no
 * number is said twice on one page. `prompts`: the session's prompt count, for the stretches' note.
 */
export function burnLedger(view: BurnView, prompts: number | null = null): BurnLedgerLine[] {
  if (view.kind !== 'ready') return [];
  return view.stats
    .filter((s) => s.label !== 'tokens' && s.label !== 're-reading the conversation')
    .map((s, i) => {
      const stretches = s.label === 'stretch' || s.label === 'stretches' ? Number(s.value.replace(/,/g, '')) : null;
      return {
        key: `${i}${s.label}`,
        label: s.label,
        note: stretches !== null && Number.isFinite(stretches) ? stretchNote(stretches, prompts) : null,
        num: PLAIN_FIGURE.test(s.value) ? numSpec(0, s.value) : null,
        shown: s.value,
      };
    });
}

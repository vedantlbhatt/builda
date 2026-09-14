/**
 * TOKENS, CALL BY CALL: the owner's question ("I'm confused how 99% is spent reading the cache")
 * answered for every session, from the `call_tokens` block (contract v4 `SessionCallTokens`,
 * computed on the machine by `analysis/calls.py`). `CallsSection.tsx` lays it out and
 * `CallsChart.tsx` draws it; every value and every word is decided here.
 *
 * What is measured, and so what may be said. The wire carries at most 240 points, each the five
 * token counts of `per_point` consecutive calls (1 until a session has more than 240), each call
 * counted once; the calls that came back to an expired cache, with how long they were away and
 * what they wrote again; and what each kind of token would cost at API LIST PRICES, priced on the
 * machine by `analysis/pricing.py`, call by call on each call's own model. The phone prices
 * nothing: it has no price table, and a second one would be a second definition of a dollar.
 *
 * Three parts to every bar, in the hues the session page already gives them: the conversation so
 * far re-read from the cache in tide (burn's colour for re-reading, `burnChart.CAUSE_HUE`), what
 * was new this call in brass (written to the cache, or sent fresh), and the reply in ember.
 *
 * Absent is not zero (CLAUDE.md): a block nobody computed is `absent`, a refusal is its sentence,
 * a price the machine could not name is a sentence and never $0, and a share that rounds to 0% is
 * "under 1%" (`shareWords`). No dash in any string a person reads (`copy/plain.hasDash`).
 *
 * Pure: no React Native, so `bun test` holds it.
 */

import { dollars, readOn } from '../copy/money';
import { capital, commas, floorMins, human, mins, shareWords } from '../copy/numbers';
import { PRICES_READ_ON, USAGE_READERS } from '../copy/catalog';
import type { SessionDetail } from '../data/api';
import type { SessionCallPoint, SessionCallTokens } from '../generated/contract';
import type { HueName } from '../theme';

export type CallPart = 'read' | 'fresh' | 'reply';
export const CALL_PARTS: readonly CallPart[] = ['read', 'fresh', 'reply'];

/** One hue per part, bottom of the bar to the top. */
export const PART_HUE: Record<CallPart, HueName> = { read: 'tide', fresh: 'brass', reply: 'ember' };

/** The chapter's title, on its band. */
export const CALLS_TITLE = 'Tokens, call by call';

/** No block: the producer that sent this session does not compute one. Not a refusal. */
export const CALLS_ABSENT = 'No call by call count was sent with this session.';

export interface CallBar {
  /** The conversation so far, re-read from the cache. */
  read: number;
  /** New this call: written to the cache, or sent fresh. */
  fresh: number;
  /** What the model wrote back. */
  reply: number;
  /** Everything the calls sent: read + fresh. */
  sent: number;
  /** The calls this bar holds, counting from 1. */
  first: number;
  last: number;
  /** Seconds from the session's start to its first call. */
  at: number;
}

export interface RewriteMark {
  /** The bar it is drawn over. */
  index: number;
  call: number;
  /** Over the bar: "68 minutes away". */
  label: string;
}

export interface ShareSegment {
  part: CallPart;
  value: number;
  /** "re-read 99%". */
  text: string;
}

export interface ShareBar {
  key: 'tokens' | 'price';
  /** "Tokens", "At API list prices". */
  label: string;
  /** "31.1M", "$21.07". */
  total: string;
  segments: ShareSegment[];
}

export type CallsView =
  | { kind: 'absent'; sentence: string }
  | { kind: 'refused'; sentence: string }
  | {
      kind: 'ready';
      /** The band's figure: how many calls, and what that number is. */
      calls: number;
      bars: CallBar[];
      /** The tallest bar's everything, never 0. */
      max: number;
      /** Gridlines, from the floor up (the floor itself excluded). */
      ticks: { value: number; label: string }[];
      /** Call numbers under the chart, at bar indexes. */
      axis: { index: number; label: string }[];
      /** "one bar per call" or "each bar is 6 calls, the last one 4". */
      eachBar: string;
      legend: { part: CallPart; label: string }[];
      marks: RewriteMark[];
      /** The largest rewrite in words, and how many more there were. Null with none. */
      rewrite: string | null;
      /** The bar the readout opens on: the last. */
      initial: number;
      shares: ShareBar[];
      /** Why the price bar is missing, when it is. */
      priceNote: string | null;
      /** "At API list prices, read Sep 6. On a subscription you pay your plan, not this." */
      priceBasis: string | null;
      /** Two or three sentences: why re-reading dominates, from this session's numbers. */
      explain: string[];
    };

/** "Claude" for Claude Code, "the model" for every other harness. */
export function modelWord(harness: string): string {
  return harness === 'claude_code' ? 'Claude' : 'the model';
}

function refusal(b: SessionCallTokens, harness: string): string {
  if (b.reason === 'too_few_calls') {
    const n = b.calls ?? 0;
    return `This session made ${commas(n)} call${n === 1 ? '' : 's'} to the model, and a chart of what each one sent needs ${commas(b.calls_needed)}.`;
  }
  // `no_token_counts`: named as burn names it (`copy/burn.explainBurn`), so the two chapters on
  // one page say one thing about one fact.
  if (!USAGE_READERS.includes(harness)) return 'Calls are not drawn for this tool yet.';
  return 'This transcript does not record token counts, so there are no calls to draw.';
}

function barOf(p: SessionCallPoint, i: number, per: number, calls: number): CallBar {
  const fresh = p.cache_write + p.input;
  const first = i * per + 1;
  return { read: p.cache_read, fresh, reply: p.output, sent: p.cache_read + fresh, first, last: Math.min(calls, first + per - 1), at: p.at };
}

/** A gridline step: 1, 2 or 5 times a power of ten, so the tallest bar sits under four lines. */
export function niceStep(max: number): number {
  if (!(max > 0)) return 1;
  const raw = max / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= raw) return m * pow;
  return 10 * pow;
}

/** Up to five call numbers under the chart: the first, the last, and three between. */
export function axisOf(bars: readonly CallBar[], calls: number): { index: number; label: string }[] {
  const n = bars.length;
  const at = n <= 5 ? bars.map((_, i) => i) : [0, Math.round((n - 1) / 4), Math.round((n - 1) / 2), Math.round((3 * (n - 1)) / 4), n - 1];
  return [...new Set(at)].map((i) => ({ index: i, label: i === 0 ? 'call 1' : i === n - 1 ? commas(calls) : commas(bars[i]!.first) }));
}

/** "one bar per call", "each bar is 6 calls", "each bar is 6 calls, the last one 4". */
export function eachBarWords(per: number, calls: number): string {
  if (per <= 1) return 'one bar per call';
  const rest = calls % per;
  return rest ? `each bar is ${commas(per)} calls, the last one ${commas(rest)}` : `each bar is ${commas(per)} calls`;
}

/** How long a lifetime is, as a person says it: "an hour", "five minutes". */
export function lifetimeWords(seconds: number): string {
  if (seconds === 3600) return 'an hour';
  if (seconds === 300) return 'five minutes';
  return mins(seconds);
}

/** When a bar's first call was made: "in the first minute", "42 minutes in", "2h 20m in". */
export function whenWords(seconds: number): string {
  return seconds < 60 ? 'in the first minute' : `${floorMins(seconds)} in`;
}

/**
 * The scrub readout for one bar: "Call 124, 2h 20m in: sent 167,003 tokens, 26,448 re-read and
 * 140,555 new. Claude wrote back 398." A bar of several calls names them all and says what
 * they sent together.
 */
export function readout(bar: CallBar, harness: string): string {
  const who = bar.first === bar.last ? `Call ${commas(bar.first)}` : `Calls ${commas(bar.first)} to ${commas(bar.last)}`;
  const reply = `${capital(modelWord(harness))} wrote back ${commas(bar.reply)}.`;
  return `${who}, ${whenWords(bar.at)}: sent ${commas(bar.sent)} tokens, ${commas(bar.read)} re-read and ${commas(bar.fresh)} new. ${reply}`;
}

/**
 * The largest rewrite in words (the spike a person asks about), then how many more there were:
 * "Call 1 came 68 minutes after the conversation's previous call, before this session began. The
 * cache keeps a conversation for an hour, so it had expired, and 140,553 tokens were written to
 * it again." Null when no call came back to an expired cache.
 */
export function rewriteWords(b: SessionCallTokens): string | null {
  const list = b.rewrites ?? [];
  if (!list.length || b.lifetime_seconds == null) return null;
  const top = list.reduce((a, r) => (r.written > a.written ? r : a));
  const before = top.call === 1 ? ', before this session began' : '';
  const lines = [
    `Call ${commas(top.call)} came ${mins(top.away_seconds)} after the conversation's previous call${before}.`,
    `The cache keeps a conversation for ${lifetimeWords(b.lifetime_seconds)}, so it had expired, and ${commas(top.written)} tokens were written to it again.`,
  ];
  const more = Math.max(0, (b.rewrite_calls ?? list.length) - 1);
  if (more) lines.push(`${capital(commas(more))} more call${more === 1 ? '' : 's'} came back to an expired cache the same way.`);
  return lines.join(' ');
}

function segments(read: number, fresh: number, reply: number, harness: string): ShareSegment[] {
  const total = read + fresh + reply;
  const words: Record<CallPart, string> = { read: 're-read', fresh: 'new', reply: `${modelWord(harness)}'s reply` };
  return ([['read', read], ['fresh', fresh], ['reply', reply]] as const)
    .filter(([, v]) => v > 0)
    .map(([part, v]) => ({ part, value: v, text: `${words[part]} ${shareWords(v / total)}` }));
}

/** Whether the block carries all four dollar figures. */
function priced(b: SessionCallTokens): b is SessionCallTokens & { usd_cache_read: number; usd_cache_write: number; usd_input: number; usd_output: number } {
  return b.price_reason == null && [b.usd_cache_read, b.usd_cache_write, b.usd_input, b.usd_output].every((x) => typeof x === 'number' && Number.isFinite(x));
}

/** The chapter, from a session's block. */
export function callsView(s: Pick<SessionDetail, 'call_tokens' | 'harness'>): CallsView {
  const b = s.call_tokens;
  if (b == null) return { kind: 'absent', sentence: CALLS_ABSENT };
  if (b.reason != null || !b.points || !b.points.length || b.calls == null || b.per_point == null) {
    return { kind: 'refused', sentence: refusal(b, s.harness) };
  }
  const calls = b.calls;
  const per = b.per_point;
  const bars = b.points.map((p, i) => barOf(p, i, per, calls));
  const max = Math.max(1, ...bars.map((x) => x.sent + x.reply));
  const step = niceStep(max);
  const ticks: { value: number; label: string }[] = [];
  for (let v = step; v <= max; v += step) ticks.push({ value: v, label: human(v) });

  const marks: RewriteMark[] = (b.rewrites ?? [])
    .map((r) => ({ index: Math.floor((r.call - 1) / per), call: r.call, label: `${mins(r.away_seconds)} away` }))
    .filter((m) => m.index >= 0 && m.index < bars.length);

  const read = bars.reduce((t, x) => t + x.read, 0);
  const fresh = bars.reduce((t, x) => t + x.fresh, 0);
  const reply = bars.reduce((t, x) => t + x.reply, 0);
  const all = read + fresh + reply;
  const shares: ShareBar[] = [{ key: 'tokens', label: 'Tokens', total: human(all), segments: segments(read, fresh, reply, s.harness) }];
  let priceNote: string | null = null;
  let priceBasis: string | null = null;
  let usdShare: number | null = null;
  if (priced(b)) {
    const usdFresh = b.usd_cache_write + b.usd_input;
    const usd = b.usd_cache_read + usdFresh + b.usd_output;
    if (usd > 0) {
      shares.push({ key: 'price', label: 'At API list prices', total: dollars(usd), segments: segments(b.usd_cache_read, usdFresh, b.usd_output, s.harness) });
      usdShare = b.usd_cache_read / usd;
      const day = readOn(PRICES_READ_ON);
      priceBasis = `What these tokens would cost at API list prices${day ? `, read ${day}` : ''}. On a subscription you pay your plan, not this.`;
    }
  } else if (b.price_reason === 'model_not_in_price_table') {
    priceNote = 'No list price is shown: a call used a model the price table does not have, and it is not priced at a guess.';
  }

  return {
    kind: 'ready',
    calls,
    bars,
    max,
    ticks,
    axis: axisOf(bars, calls),
    eachBar: eachBarWords(per, calls),
    legend: [
      { part: 'read', label: 're-read from the cache' },
      { part: 'fresh', label: 'new this call' },
      { part: 'reply', label: `${modelWord(s.harness)}'s reply` },
    ],
    marks,
    rewrite: rewriteWords(b),
    initial: bars.length - 1,
    shares,
    priceNote,
    priceBasis,
    explain: explainCalls(bars, per, all > 0 ? read / all : null, usdShare),
  };
}

/**
 * Why re-reading dominates, in two or three sentences made from this session's numbers: the
 * mechanism; what it did here (what one call sent at the start against the most any call sent,
 * said only when it grew, and never "only grows" alone: a conversation that is compacted or
 * cleared starts small again, and the sample and real sittings both do); and why the price
 * share is smaller, only when a price was sent.
 */
export function explainCalls(bars: readonly CallBar[], per: number, readShare: number | null, usdShare: number | null): string[] {
  const out = [
    'The model keeps nothing between calls, so every call sends the whole conversation again, and the cache serves the part it has seen before. That is a re-read.',
  ];
  const grows = 'A conversation only grows until it is compacted or cleared, so each call re-reads more than the one before it';
  const perCall = (b: CallBar) => Math.round(b.sent / (b.last - b.first + 1));
  const first = bars[0];
  const peak = bars.length ? Math.max(...bars.map(perCall)) : 0;
  if (first && bars.length > 1 && peak > perCall(first)) {
    out.push(
      per > 1
        ? `${grows}: a call here sent about ${human(perCall(first))} tokens at the start and up to about ${human(peak)}.`
        : `${grows}: the first call here sent ${human(perCall(first))} tokens, and the largest ${human(peak)}.`,
    );
  } else {
    out.push(`${grows}.`);
  }
  if (readShare != null && usdShare != null) {
    out.push(`A re-read is priced far below new tokens and replies, which is why re-reads are ${shareWords(readShare)} of the tokens and ${shareWords(usdShare)} of the list price.`);
  } else if (readShare != null) {
    out.push(`Re-reads are ${shareWords(readShare)} of this session's tokens.`);
  }
  return out;
}

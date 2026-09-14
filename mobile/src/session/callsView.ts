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
 * Three parts to every bar, in hues chosen against the chart directly above it on this page
 * (`PART_HUE`): the conversation so far re-read from the cache in tide, burn's own colour for
 * re-reading the conversation; what was new this call (written to the cache, or sent fresh) in
 * amber; the reply in ember. A bar of several calls is drawn as what ONE call in it sent on
 * average, so the axis is in tokens a call whatever the bar holds, and the readout says the sums.
 *
 * Absent is not zero (CLAUDE.md): a block nobody computed is `absent`, a refusal is its sentence,
 * a price the machine could not name is a sentence and never $0, and a share that rounds to 0% is
 * "under 1%". No dash in any string a person reads (`copy/plain.hasDash`).
 *
 * Pure: no React Native, so `bun test` holds it.
 */
import { countsRead } from '../copy/burn';
import { PRICES_READ_ON } from '../copy/catalog';
import { dollars, readOn } from '../copy/money';
import { capital, commas, floorMins, human, mins, shareWords } from '../copy/numbers';
import type { CallRewriteRead, CallTokensRead, SessionDetail } from '../data/api';
import type { SessionCallPoint } from '../generated/contract';
import type { HueName } from '../theme';

export type CallPart = 'read' | 'fresh' | 'reply';
export const CALL_PARTS: readonly CallPart[] = ['read', 'fresh', 'reply'];

/**
 * One hue per part, bottom of the bar to the top, chosen against burn's costliest stretches, the
 * chart directly above this one (`burnChart.CAUSE_HUE`). Burn draws "re-reading the conversation"
 * in tide, so the re-read is tide here; new and the reply wear amber and ember, the two spectrum
 * hues no cause of burn's uses for anything, so no colour on this page means two things.
 * `__tests__/sessionCalls.test.ts` holds these to CAUSE_HUE, every cause.
 *
 * Money keeps its own scheme (`insights/sections/Money.BUCKET_COLOR`: cache reads in its chapter's
 * ink, output in tide). One page agreeing with itself beats two pages agreeing: the tide re-read
 * sits under burn's tide re-read here, where Money's key is a screen away. FOUND IN REVIEW
 * (2026-09-13): matching Money made tide mean re-reading in burn's chart and the reply in this
 * one, on the same page.
 */
export const PART_HUE: Record<CallPart, HueName> = { read: 'tide', fresh: 'amber', reply: 'ember' };

/** The chapter's title, on its band. */
export const CALLS_TITLE = 'Tokens, call by call';

/** No block: the producer that sent this session does not compute one. Not a refusal. */
export const CALLS_ABSENT = 'No call by call count was sent with this session.';

export interface CallBar {
  /** The conversation so far, re-read from the cache, over the bar's calls. */
  read: number;
  /** New: written to the cache, or sent fresh, over the bar's calls. */
  fresh: number;
  /** What the model wrote back, over the bar's calls. */
  reply: number;
  /** Everything the calls sent: read + fresh. */
  sent: number;
  /** The calls this bar holds, counting from 1, and how many that is. */
  first: number;
  last: number;
  n: number;
  /** Seconds from the session's start to its first call. */
  at: number;
  /**
   * What ONE call in it sent on average, part by part: the bar's height. FOUND IN REVIEW
   * (2026-09-13): a bar of two calls drawn as their sum put `41de4166`'s top gridline at 1.5M
   * beside a sentence saying a call sent up to about 784k, and in 5 of 9 binned sittings the
   * last bar held one call and stood at half height, like a compaction that never happened.
   */
  each: { read: number; fresh: number; reply: number };
}

export interface RewriteMark {
  /** The bar it is drawn over. */
  index: number;
  call: number;
  /** What it wrote to the cache again: the largest keeps its words when two collide. */
  written: number;
  /** Over the bar: "1h 08m away", or "cache expired" for a viewer who may not know how long. */
  label: string;
}

export interface ShareSegment {
  part: CallPart;
  value: number;
  /** Its share of the bar, in whole percents that add up to 100 (`percentWords`): "99%", "under 1%". */
  share: string;
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
      /** The tallest bar's height in tokens a call (`CallBar.each`), never 0. */
      max: number;
      /** Gridlines in tokens a call, from the floor up (the floor itself excluded). */
      ticks: { value: number; label: string }[];
      /** Call numbers under the chart, at bar indexes. */
      axis: { index: number; label: string }[];
      /** "one bar per call" or "each bar the average of 6 calls, the last of 4". */
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
      /** Why these totals differ from burn's band above, when they do (never, as measured). */
      totalNote: string | null;
      /** "What these tokens would cost at API list prices, read Sep 6. On a subscription ..." */
      priceBasis: string | null;
      /** Two or three sentences: why re-reading dominates, from this session's numbers. */
      explain: string[];
    };

/** "Claude" for Claude Code, "the model" for every other harness. */
export function modelWord(harness: string): string {
  return harness === 'claude_code' ? 'Claude' : 'the model';
}

function refusal(b: CallTokensRead, harness: string): string {
  if (b.reason === 'too_few_calls') {
    const n = b.calls ?? 0;
    // 0: the files record counts and none of them fell inside this session (`analysis/calls.py`
    // `recorded`); a window of the harness's own placeholders made no call at all.
    if (n === 0) return 'No call to the model fell inside this session, so there is nothing to draw.';
    return `This session made ${commas(n)} call${n === 1 ? '' : 's'} to the model, and a chart of what each one sent needs ${commas(b.calls_needed)}.`;
  }
  // `no_token_counts`: said as burn says it (`copy/burn.countsRead`, the one mapping from the
  // upload's harness name to the engine's), so the two chapters on one page say one thing.
  if (!countsRead(harness)) return 'Calls are not drawn for this tool yet.';
  return 'This transcript does not record token counts, so there are no calls to draw.';
}

function barOf(p: SessionCallPoint, i: number, per: number, calls: number): CallBar {
  const fresh = p.cache_write + p.input;
  const first = i * per + 1;
  const last = Math.min(calls, first + per - 1);
  const n = Math.max(1, last - first + 1);
  return {
    read: p.cache_read,
    fresh,
    reply: p.output,
    sent: p.cache_read + fresh,
    first,
    last,
    n,
    at: p.at,
    each: { read: p.cache_read / n, fresh: fresh / n, reply: p.output / n },
  };
}

/** A bar's drawn height, in tokens a call. */
export function barHeight(b: CallBar): number {
  return b.each.read + b.each.fresh + b.each.reply;
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

/**
 * "one bar per call", "each bar the average of 6 calls", "each bar the average of 6 calls, the last
 * of 4", and "and the last bar a single call" where it holds one (it read "the last of 1", 60256e3a).
 */
export function eachBarWords(per: number, calls: number): string {
  if (per <= 1) return 'one bar per call';
  const rest = calls % per;
  if (!rest) return `each bar the average of ${commas(per)} calls`;
  return rest === 1
    ? `each bar the average of ${commas(per)} calls, and the last bar a single call`
    : `each bar the average of ${commas(per)} calls, the last of ${commas(rest)}`;
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

/** An index into `n` bars, whatever it was before the bars changed (a live session growing). */
export function clampIndex(i: number, n: number): number {
  if (n <= 0) return 0;
  return Math.min(n - 1, Math.max(0, Math.round(i)));
}

/**
 * The scrub readout for one bar: "Call 124, 2h 20m in: sent 167,003 tokens, 26,448 re-read and
 * 140,555 new. Claude wrote back 398 tokens." A bar of several calls is drawn as their average and
 * said as their sum, with the average beside it so the two agree: "Calls 211 and 212, 2h 47m in:
 * sent 610,000 tokens between them (about 305k each), ...".
 */
export function readout(bar: CallBar, harness: string): string {
  const model = capital(modelWord(harness));
  if (bar.n === 1) {
    return `Call ${commas(bar.first)}, ${whenWords(bar.at)}: sent ${commas(bar.sent)} tokens, ${commas(bar.read)} re-read and ${commas(bar.fresh)} new. ${model} wrote back ${commas(bar.reply)} tokens.`;
  }
  const who = bar.n === 2 ? `Calls ${commas(bar.first)} and ${commas(bar.last)}` : `Calls ${commas(bar.first)} to ${commas(bar.last)}`;
  return `${who}, ${whenWords(bar.at)}: sent ${commas(bar.sent)} tokens between them (about ${human(Math.round(bar.sent / bar.n))} each), ${commas(bar.read)} re-read and ${commas(bar.fresh)} new. ${model} wrote back ${commas(bar.reply)} tokens between them.`;
}

/**
 * Whether a rewrite's previous call was certainly made BEFORE this session began: it came back
 * `away_seconds` after that call, and the call itself was made no later than `latest` seconds
 * into the session, so a gap longer than that reaches back past the start. `latest` is the call's
 * own offset when it is its bar's first call (every call, one to a bar), else the next bar's
 * first call (or the session's length for the last bar); inside that window nothing is claimed.
 * FOUND IN REVIEW (2026-09-13): said only for call 1, while 58 of 59 rewrites reach back before
 * their session ("Call 175 came 46h 45m after the conversation's previous call" in a session
 * 2h 39m long, `8be94bc1`).
 */
export function beforeSession(r: Pick<CallRewriteRead, 'call' | 'away_seconds'>, points: readonly SessionCallPoint[], per: number, span: number | null): boolean {
  if (r.away_seconds == null || per < 1) return false;
  const i = Math.floor((r.call - 1) / per);
  const latest = r.call === i * per + 1 ? points[i]?.at : (points[i + 1]?.at ?? span ?? undefined);
  return typeof latest === 'number' && r.away_seconds > latest;
}

/**
 * The largest rewrite in words (the spike a person asks about), then how many more there were:
 * "Call 1 came 1h 08m after the conversation's previous call, before this session began. The
 * cache keeps a conversation for an hour, so it had expired, and 140,553 tokens were written to
 * it again." A viewer who is not the session's owner gets no `away_seconds` (the server strips
 * it: it would date an earlier, perhaps unshared, session), and hears the rest without it. Null
 * when no call came back to an expired cache.
 */
export function rewriteWords(b: CallTokensRead, span: number | null = null): string | null {
  const list = b.rewrites ?? [];
  if (!list.length || b.lifetime_seconds == null || !b.points || b.per_point == null) return null;
  const top = list.reduce((a, r) => (r.written > a.written ? r : a));
  const lifetime = lifetimeWords(b.lifetime_seconds);
  const lines =
    top.away_seconds != null
      ? [
          `Call ${commas(top.call)} came ${mins(top.away_seconds)} after the conversation's previous call${beforeSession(top, b.points, b.per_point, span) ? ', before this session began' : ''}.`,
          `The cache keeps a conversation for ${lifetime}, so it had expired, and ${commas(top.written)} tokens were written to it again.`,
        ]
      : [`Call ${commas(top.call)} came back after the cache had expired (it keeps a conversation for ${lifetime}), and ${commas(top.written)} tokens were written to it again.`];
  const more = Math.max(0, (b.rewrite_calls ?? list.length) - 1);
  if (more) lines.push(`${capital(commas(more))} more call${more === 1 ? '' : 's'} came back to an expired cache the same way.`);
  return lines.join(' ');
}

/** A share as the whole percent `shareWords` prints for it ("over 99%" is 100 here, set back to words at the end). */
function ownPercent(share: number): number {
  const said = shareWords(share);
  const m = /^(\d+)%$/.exec(said);
  if (m) return Number(m[1]);
  return said.startsWith('over') ? 100 : 0;
}

/**
 * Whole percents for parts of one total, in the house's words at the ends: a part under half a
 * percent is "under 1%", a part the rounding leaves at 0 is "under 1%" too, and a part short of
 * all of it is "over 99%", never "100%".
 *
 * Each part is first said as `shareWords` says a share anywhere else on the page, and moved by a
 * point only when the whole numbers would otherwise miss what they stand for by a point or more:
 * three parts of 75%, 12.5% and 12.5% are 75%, 13% and 12%, never 75%, 13% and 13%. FOUND IN
 * REVIEW (2026-09-13): each part rounded on its own, so 6 of 149 token bars and 27 price bars did
 * not add up (`7b2550af` read 75%, 13% and 13%). FOUND IN THE DEFECTS PASS (2026-09-14): the
 * largest remainder that replaced it gave a part under half a percent none of the remainder, so
 * a re-read of 98.49% took the point that part left and read 99% on a bar under a band and a
 * paragraph saying 98% of the same 134,156,212 tokens (`60256e3a`). Parts said "under 1%" hold
 * what the whole numbers leave, so 98%, 1% and "under 1%" is left as it is.
 *
 * `pinned`: a part that must read exactly as `shareWords` says it, because the same share is said
 * elsewhere on the screen; the other parts take any point that has to move.
 */
export function percentWords(values: readonly number[], pinned: number | null = null): string[] {
  const total = values.reduce((t, v) => t + Math.max(0, v), 0);
  if (!(total > 0)) return values.map(() => '0%');
  const share = values.map((v) => Math.max(0, v) / total);
  const tiny = share.map((s) => s > 0 && s < 0.005);
  const numeric = share.map((s, i) => s > 0 && !tiny[i]);
  const quota = share.map((s) => s * 100);
  const pct = share.map((s, i) => (numeric[i] ? ownPercent(s) : 0));
  // What the whole numbers stand for: everything but the parts said in words.
  const target = quota.reduce((t, q, i) => t + (numeric[i] ? q : 0), 0);
  const movable = pct.map((_, i) => i).filter((i) => numeric[i] && i !== pinned);
  for (let guard = 0; guard < values.length * 2; guard++) {
    const said = pct.reduce((t, p) => t + p, 0);
    if (said - target >= 1 - 1e-9) {
      // One point too many: from the part rounded up the most (a tie, the last of them).
      const i = movable.filter((k) => pct[k]! > 0).sort((a, b) => pct[b]! - quota[b]! - (pct[a]! - quota[a]!) || b - a)[0];
      if (i === undefined) break;
      pct[i]! -= 1;
    } else if (target - said >= 1 - 1e-9) {
      // One point short: to the part rounded down the most (a tie, the first of them).
      const i = movable.sort((a, b) => quota[b]! - pct[b]! - (quota[a]! - pct[a]!) || a - b)[0];
      if (i === undefined) break;
      pct[i]! += 1;
    } else {
      break;
    }
  }
  return pct.map((p, i) => {
    if (i === pinned && share[i]! > 0) return shareWords(share[i]!);
    if (share[i]! > 0 && (tiny[i] || p === 0)) return 'under 1%';
    if (p >= 100 && share[i]! < 1) return 'over 99%';
    return `${p}%`;
  });
}

/**
 * A bar's three parts. `pinRead`: the re-read reads exactly as `shareWords` says it, because the
 * burn band and the paragraph above say the same share of the same tokens (MEASURED, 2026-09-14:
 * burn's total and this block's are equal on all 152 of the overnight stack's sessions that carry
 * both), so the page says one number for it.
 */
function segments(read: number, fresh: number, reply: number, harness: string, pinRead = false): ShareSegment[] {
  const parts = ([['read', read], ['fresh', fresh], ['reply', reply]] as const).filter(([, v]) => v > 0);
  const pin = pinRead ? parts.findIndex(([p]) => p === 'read') : -1;
  const said = percentWords(
    parts.map(([, v]) => v),
    pin >= 0 ? pin : null,
  );
  const words: Record<CallPart, string> = { read: 're-read', fresh: 'new', reply: `${modelWord(harness)}'s reply` };
  return parts.map(([part, v], i) => ({ part, value: v, share: said[i]!, text: `${words[part]} ${said[i]}` }));
}

/** Whether the block carries all four dollar figures. */
function priced(b: CallTokensRead): b is CallTokensRead & { usd_cache_read: number; usd_cache_write: number; usd_input: number; usd_output: number } {
  return b.price_reason == null && [b.usd_cache_read, b.usd_cache_write, b.usd_input, b.usd_output].every((x) => typeof x === 'number' && Number.isFinite(x));
}

/** A share bar's own word for one part, so a sentence says the number the bar shows. */
function wordFor(bar: ShareBar | undefined, part: CallPart): string | null {
  return bar?.segments.find((g) => g.part === part)?.share ?? null;
}

/**
 * How an expired cache mark is drawn over its bar, so it can never be read as the bar's height:
 * its words at the top, a DOTTED leader in the chart's neutral ink (never a bar's hue, never a
 * bar's width) from the words down to a small caret, and the caret's tip `MARK_GAP` points above
 * the bar's own top, so the bar ends where it ends. FOUND IN THE DEFECTS PASS (2026-09-14): the
 * mark was a solid one point stem in the bar's amber from the bar's top to the words, beside bars
 * a point and a half wide, so call 211 of `78b653a5` read as the tallest bar, about 330k, where it
 * sent 118,886, and "9h 34m away" on `60256e3a` read as a bar of about 950k.
 */
export const MARK_GAP = 3;
export const CARET_H = 4;
export const CARET_W = 7;

export interface MarkShape {
  /** The dotted leader's two ends, top first; null when the bar's top is too near the words for one. */
  leader: [number, number] | null;
  /** The caret: its flat top and its tip, which points at the bar and never touches it. */
  caret: { top: number; tip: number };
}

/** `top`: where the words end; `peak`: the bar's drawn top (y grows downward). */
export function markShape(top: number, peak: number): MarkShape {
  const tip = peak - MARK_GAP;
  const caretTop = tip - CARET_H;
  const leaderEnd = caretTop - 2;
  return { leader: leaderEnd - top >= 3 ? [top, leaderEnd] : null, caret: { top: caretTop, tip } };
}

/**
 * Where a rewrite's words go over the chart, the one that wrote the most first: a label that
 * would overlap one already placed keeps its stem and loses its words. `xOf(index)` is a bar's
 * centre; labels are `labelW` wide, kept inside [left, right]. FOUND IN REVIEW (2026-09-13): in
 * 8 of 10 sittings with two or more rewrites the labels sat on each other (`ee94fd02`'s "11h 03m
 * away" and "46h 34m away" at the same x).
 */
export function placeMarkLabels(
  marks: readonly RewriteMark[],
  xOf: (index: number) => number,
  left: number,
  right: number,
  labelW: number,
  gap = 8,
): Map<number, { left: number; align: 'left' | 'center' | 'right' }> {
  const placed = new Map<number, { left: number; align: 'left' | 'center' | 'right' }>();
  const boxes: [number, number][] = [];
  for (const m of [...marks].sort((a, b) => b.written - a.written || a.call - b.call)) {
    const x = xOf(m.index);
    const l = Math.max(left, Math.min(right - labelW, x - labelW / 2));
    if (boxes.some(([a, b]) => l < b + gap && l + labelW > a - gap)) continue;
    boxes.push([l, l + labelW]);
    placed.set(m.call, { left: l, align: l === left ? 'left' : l === right - labelW ? 'right' : 'center' });
  }
  return placed;
}

/** The chapter, from a session's block. */
export function callsView(s: Pick<SessionDetail, 'call_tokens' | 'harness'> & Partial<Pick<SessionDetail, 'started_at' | 'ended_at' | 'burn'>>): CallsView {
  const b = s.call_tokens;
  if (b == null) return { kind: 'absent', sentence: CALLS_ABSENT };
  if (b.reason != null || !b.points || !b.points.length || b.calls == null || b.per_point == null) {
    return { kind: 'refused', sentence: refusal(b, s.harness) };
  }
  const calls = b.calls;
  const per = b.per_point;
  const bars = b.points.map((p, i) => barOf(p, i, per, calls));
  const max = Math.max(1, ...bars.map(barHeight));
  const step = niceStep(max);
  const ticks: { value: number; label: string }[] = [];
  for (let v = step; v <= max; v += step) ticks.push({ value: v, label: human(v) });
  const from = s.started_at ? Date.parse(s.started_at) : Number.NaN;
  const to = s.ended_at ? Date.parse(s.ended_at) : Number.NaN;
  const span = Number.isFinite(from) && Number.isFinite(to) && to >= from ? Math.round((to - from) / 1000) : null;

  const marks: RewriteMark[] = (b.rewrites ?? [])
    .map((r) => ({
      index: Math.floor((r.call - 1) / per),
      call: r.call,
      written: r.written,
      label: r.away_seconds != null ? `${mins(r.away_seconds)} away` : 'cache expired',
    }))
    .filter((m) => m.index >= 0 && m.index < bars.length);

  const read = bars.reduce((t, x) => t + x.read, 0);
  const fresh = bars.reduce((t, x) => t + x.fresh, 0);
  const reply = bars.reduce((t, x) => t + x.reply, 0);
  const tokens: ShareBar = { key: 'tokens', label: 'Tokens', total: human(read + fresh + reply), segments: segments(read, fresh, reply, s.harness, true) };
  const shares: ShareBar[] = [tokens];
  let priceNote: string | null = null;
  // Burn's band above counts the same session's tokens; where the two totals ever part, the
  // shares are of two totals and the page says so rather than showing two figures in silence.
  const burnTokens = s.burn && s.burn.reason == null && typeof s.burn.tokens === 'number' ? s.burn.tokens : null;
  const totalNote =
    burnTokens !== null && human(burnTokens) !== tokens.total
      ? `Counted call by call, so these can differ from the ${human(burnTokens)} tokens under where the tokens went.`
      : null;
  let priceBasis: string | null = null;
  if (priced(b)) {
    const usdFresh = b.usd_cache_write + b.usd_input;
    const usd = b.usd_cache_read + usdFresh + b.usd_output;
    if (usd > 0) {
      shares.push({ key: 'price', label: 'At API list prices', total: dollars(usd), segments: segments(b.usd_cache_read, usdFresh, b.usd_output, s.harness) });
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
    rewrite: rewriteWords(b, span),
    initial: bars.length - 1,
    shares,
    priceNote,
    totalNote,
    priceBasis,
    // The shares as the bars above say them, so a sentence never prints a second number.
    explain: explainCalls(bars, per, wordFor(tokens, 'read'), wordFor(shares[1], 'read')),
  };
}

/**
 * Why re-reading dominates, in two or three sentences made from this session's numbers: the
 * mechanism; what it did here (what one call sent at the start against the most any call sent,
 * said only when it grew, and never "only grows" alone: a conversation that is compacted or
 * cleared starts small again, and the sample and real sittings both do); and why the price
 * share is smaller, only when a price was sent. `readWord` and `usdWord` are the re-read's share
 * as the two bars above say it ("99%", "under 1%").
 */
export function explainCalls(bars: readonly CallBar[], per: number, readWord: string | null, usdWord: string | null): string[] {
  const out = [
    'The model keeps nothing between calls, so every call sends the whole conversation again, and the cache serves the part it has seen before. That is a re-read.',
  ];
  const grows = 'A conversation only grows until it is compacted or cleared, so each call re-reads more than the one before it';
  const perCall = (b: CallBar) => Math.round(b.each.read + b.each.fresh);
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
  if (readWord != null && usdWord != null) {
    out.push(`A re-read is priced far below new tokens and replies, which is why re-reads are ${readWord} of the tokens and ${usdWord} of the list price.`);
  } else if (readWord != null) {
    out.push(`Re-reads are ${readWord} of this session's tokens.`);
  }
  return out;
}

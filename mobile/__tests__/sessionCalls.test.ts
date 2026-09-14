/**
 * Tokens, call by call on the session page (`src/session/callsView.ts`, drawn by `CallsChart.tsx`):
 * every value and word the chapter shows, from the `call_tokens` block `analysis/calls.py` sends.
 *
 * What these protect, each a plausible wrong number or sentence nobody would question:
 *   - a bar of several calls is labelled with exactly the calls it holds, the last one too, and
 *     stands as high as one of its calls sent on average, so the axis is in tokens a call;
 *   - the readout's parts add up to what it says was sent, to the token, each with its unit;
 *   - the call that came back to an expired cache is said with its own numbers, and "before this
 *     session began" wherever its gap reaches back past the start, and only there;
 *   - a viewer who is not the owner hears the rewrite without how long it was away;
 *   - the share words add up to 100, and two rewrite labels never sit on each other;
 *   - the bars' hues mean one thing on the page with burn's chart above them;
 *   - a refusal is a sentence and never a chart of zeros, a missing price is a sentence and never
 *     $0, and nothing is ever "you spent";
 *   - "the conversation only grows" is never said alone of a session that compacted;
 *   - the samples' series add up to their own stats, so no two figures on one sample disagree;
 *   - the drawing keeps its own clock and a still picture once landed (the source is held to it).
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { hasDash } from '../src/copy/plain';
import { explainBurn } from '../src/copy/burn';
import { shareWords } from '../src/copy/numbers';
import { burnBand } from '../src/session/burnChart';
import type { CallTokensRead, SessionDetail } from '../src/data/api';
import type { SessionCallPoint, SessionCallTokens } from '../src/generated/contract';
import { ANIMALS } from '../src/pixel/animals';
import { CAUSE_HUE } from '../src/session/burnChart';
import {
  CARET_H,
  MARK_GAP,
  PART_HUE,
  barHeight,
  beforeSession,
  callsView,
  clampIndex,
  eachBarWords,
  explainCalls,
  markShape,
  niceStep,
  percentWords,
  placeMarkLabels,
  readout,
  rewriteWords,
  whenWords,
  type CallBar,
  type CallsView,
} from '../src/session/callsView';
import { sessionHues } from '../src/session/crew';
import { SAMPLE_VARIANTS, sampleOutcome } from '../src/session/samples';

const MOBILE = join(import.meta.dir, '..');
type Ready = Extract<CallsView, { kind: 'ready' }>;

/** RideGT `0a050ea3`'s sitting that starts at 13:54: call 1 back after 68 minutes (the owner's example). */
const RIDEGT: SessionCallTokens = {
  reason: null,
  calls: 7,
  calls_needed: 5,
  per_point: 1,
  points: [
    { at: 4, cache_read: 26_448, cache_write: 140_553, input: 2, output: 398 },
    { at: 14, cache_read: 167_001, cache_write: 918, input: 2, output: 669 },
    { at: 22, cache_read: 167_919, cache_write: 766, input: 2, output: 238 },
    { at: 31, cache_read: 168_685, cache_write: 455, input: 2, output: 223 },
    { at: 40, cache_read: 169_140, cache_write: 440, input: 2, output: 247 },
    { at: 52, cache_read: 169_580, cache_write: 284, input: 2, output: 427 },
    { at: 184, cache_read: 169_864, cache_write: 826, input: 2, output: 756 },
  ],
  lifetime_seconds: 3600,
  rewrites: [{ call: 1, away_seconds: 4095, written: 140_553 }],
  rewrite_calls: 1,
  usd_cache_read: 0.5193185,
  usd_cache_write: 2.88484,
  usd_input: 0.00007,
  usd_output: 0.0739,
  price_reason: null,
};

function ready(b: CallTokensRead, harness = 'claude_code', window?: { started_at: string; ended_at: string }): Ready {
  const v = callsView({ call_tokens: b, harness, ...window });
  if (v.kind !== 'ready') throw new Error(`expected a chart, got ${JSON.stringify(v)}`);
  return v;
}

/** `n` calls, one to a point unless `per` says otherwise, each re-reading more than the last. */
function growing(n: number, per = 1): SessionCallTokens {
  const points: SessionCallPoint[] = [];
  for (let i = 0; i < n; i += per) {
    const k = Math.min(per, n - i);
    points.push({ at: i * 20, cache_read: k * (50_000 + 1_000 * i), cache_write: k * 900, input: k * 3, output: k * 200 });
  }
  return { ...RIDEGT, calls: n, per_point: per, points, rewrites: [], rewrite_calls: 0 };
}

describe('the chart', () => {
  test('a bar is its calls: new is what was written and sent fresh, sent is re-read plus new', () => {
    const v = ready(RIDEGT);
    expect(v.calls).toBe(7);
    expect(v.bars[0]).toEqual({
      read: 26_448,
      fresh: 140_555,
      reply: 398,
      sent: 167_003,
      first: 1,
      last: 1,
      n: 1,
      at: 4,
      each: { read: 26_448, fresh: 140_555, reply: 398 },
    });
    for (const b of v.bars) expect(b.sent).toBe(b.read + b.fresh);
    expect(v.max).toBe(Math.max(...v.bars.map((b) => b.sent + b.reply)));
    expect(v.initial).toBe(6);
    expect(v.eachBar).toBe('one bar per call');
  });

  test('a bar of several calls names exactly the calls it holds, the last bar the rest', () => {
    const v = ready(growing(500, 3));
    expect(v.bars.length).toBe(167);
    expect([v.bars[0]!.first, v.bars[0]!.last]).toEqual([1, 3]);
    expect([v.bars[1]!.first, v.bars[1]!.last]).toEqual([4, 6]);
    expect([v.bars[166]!.first, v.bars[166]!.last]).toEqual([499, 500]);
    expect(v.eachBar).toBe('each bar the average of 3 calls, the last of 2');
    expect(eachBarWords(3, 501)).toBe('each bar the average of 3 calls');
    // 373 calls two to a bar: the last bar holds one call, said so (it read "the last of 1", 60256e3a).
    expect(eachBarWords(2, 373)).toBe('each bar the average of 2 calls, and the last bar a single call');
    expect(v.axis[0]).toEqual({ index: 0, label: 'call 1' });
    expect(v.axis[v.axis.length - 1]).toEqual({ index: 166, label: '500' });
  });

  test('a bar of several calls stands as high as one of them sent, and so does the axis', () => {
    // FOUND IN REVIEW (2026-09-13): drawn as sums, `41de4166`'s top gridline read 1.5M beside a
    // sentence saying a call sent up to about 784k, and a last bar of one call stood at half height.
    const v = ready(growing(500, 3));
    const whole = v.bars[165]!;
    const last = v.bars[166]!;
    expect([whole.n, last.n]).toEqual([3, 2]);
    expect(barHeight(whole)).toBeCloseTo((whole.sent + whole.reply) / 3, 6);
    expect(barHeight(last)).toBeCloseTo((last.sent + last.reply) / 2, 6);
    // The last bar, two calls of the same growth, stands level with its neighbour, not two thirds of it.
    expect(barHeight(last) / barHeight(whole)).toBeGreaterThan(0.99);
    expect(v.max).toBe(Math.max(...v.bars.map(barHeight)));
    expect(v.ticks.map((t) => t.label)).toEqual(['200k', '400k']);
    // The axis and the sentence under the chart speak one unit: a call's tokens.
    const said = v.explain[1]!.match(/up to about (\d+)k/)![1]!;
    expect(Math.abs(Number(said) * 1000 - v.max)).toBeLessThan(1_000);
    for (const b of v.bars) expect(b.each.read * b.n).toBeCloseTo(b.read, 6);
  });

  test('gridlines are round numbers under the tallest bar, said as tokens are said', () => {
    expect([niceStep(253_474), niceStep(1_000), niceStep(1_390_000)]).toEqual([100_000, 250, 500_000]);
    const v = ready(RIDEGT);
    expect(v.ticks.map((t) => t.label)).toEqual(['50k', '100k', '150k']);
    for (const t of v.ticks) expect(t.value).toBeLessThanOrEqual(v.max);
  });

  test('an expired cache mark can never be read as its bar: dotted, neutral, and stopping short of the bar', () => {
    // FOUND IN THE DEFECTS PASS (2026-09-14): a solid one point amber stem ran from the bar's top to
    // the words, beside bars a point and a half wide, so call 211 of 78b653a5 read about 330k where
    // it sent 118,886. Every bar top from the words down to the floor: the caret's tip stays
    // MARK_GAP above the bar, the leader ends above the caret, and a bar near the words gets no leader.
    for (let peak = 10; peak <= 222; peak += 0.5) {
      const m = markShape(18, peak);
      expect(m.caret.tip).toBe(peak - MARK_GAP);
      expect(m.caret.tip - m.caret.top).toBe(CARET_H);
      if (m.leader) {
        expect(m.leader[0]).toBe(18);
        expect(m.leader[1]).toBeLessThan(m.caret.top);
      } else {
        expect(m.caret.top - 18).toBeLessThan(5);
      }
    }
    expect(MARK_GAP).toBeGreaterThanOrEqual(2);
    const src = readFileSync(join(MOBILE, 'src/session/CallsChart.tsx'), 'utf8');
    // The leader is a dotted path in the neutral ink, never the bar's hue: no stem, no bar colour.
    expect(src).toMatch(/<Path path=\{leaders\} style="stroke" strokeWidth=\{1\} color=\{GROUND\.dim\}>\s*<DashPathEffect/);
    expect(src).not.toMatch(/stem/);
  });

  test('the call back to an expired cache is marked over its own bar, in a bin too', () => {
    expect(ready(RIDEGT).marks).toEqual([{ index: 0, call: 1, written: 140_553, label: '1h 08m away' }]);
    const binned = ready({ ...growing(30, 4), rewrites: [{ call: 10, away_seconds: 5400, written: 90_000 }], rewrite_calls: 1 });
    expect(binned.marks).toEqual([{ index: 2, call: 10, written: 90_000, label: '1h 30m away' }]);
  });

  test('two rewrite labels never sit on each other: the larger keeps its words', () => {
    // FOUND IN REVIEW (2026-09-13): `ee94fd02`'s "11h 03m away" and "46h 34m away" at one x.
    const marks = [
      { index: 100, call: 101, written: 40_000, label: '11h 03m away' },
      { index: 104, call: 105, written: 90_000, label: '46h 34m away' },
      { index: 10, call: 11, written: 20_000, label: '2h 00m away' },
    ];
    const x = (i: number) => 38 + i * 1.5;
    const placed = placeMarkLabels(marks, x, 38, 384, 88);
    expect([...placed.keys()].sort((a, b) => a - b)).toEqual([11, 105]);
    // Placed boxes keep a gap, and every box stays inside the plot.
    const boxes = [...placed.values()].map((p) => p.left).sort((a, b) => a - b);
    for (let i = 1; i < boxes.length; i++) expect(boxes[i]! - boxes[i - 1]!).toBeGreaterThanOrEqual(88 + 8);
    for (const b of boxes) expect(b >= 38 && b + 88 <= 384).toBe(true);
    // At the edges the words are set against the edge.
    expect(placeMarkLabels([{ index: 0, call: 1, written: 1, label: 'a' }], x, 38, 384, 88).get(1)).toEqual({ left: 38, align: 'left' });
    // Two rewrites far apart both keep their words; a tie goes to the earlier call.
    const apart = placeMarkLabels([marks[0]!, { ...marks[2]!, written: 40_000 }], x, 38, 384, 88);
    expect([...apart.keys()].sort((a, b) => a - b)).toEqual([11, 101]);
    expect([...placeMarkLabels([marks[0]!, { ...marks[1]!, written: 40_000 }], x, 38, 384, 88).keys()]).toEqual([101]);
  });

  test('the bar in hand stays inside the bars when they change under it', () => {
    expect([clampIndex(219, 220), clampIndex(219, 121), clampIndex(-3, 10), clampIndex(4.6, 10), clampIndex(7, 0)]).toEqual([219, 120, 0, 5, 0]);
  });
});

describe('the readout', () => {
  test("says the owner's example the way the one off page did, and its parts add up", () => {
    const b: CallBar = {
      read: 26_448,
      fresh: 140_555,
      reply: 398,
      sent: 167_003,
      first: 124,
      last: 124,
      n: 1,
      at: 8_418,
      each: { read: 26_448, fresh: 140_555, reply: 398 },
    };
    expect(readout(b, 'claude_code')).toBe('Call 124, 2h 20m in: sent 167,003 tokens, 26,448 re-read and 140,555 new. Claude wrote back 398 tokens.');
  });

  test('a bar of several calls says their sum between them, and what one sent; another tool is the model', () => {
    const v = ready(growing(500, 3), 'codex');
    expect(readout(v.bars[1]!, 'codex')).toBe(
      'Calls 4 to 6, 1 minute in: sent 161,709 tokens between them (about 54k each), 159,000 re-read and 2,709 new. The model wrote back 600 tokens between them.'
    );
    expect(readout(v.bars[166]!, 'codex')).toBe(
      'Calls 499 and 500, 2h 46m in: sent 1,097,806 tokens between them (about 549k each), 1,096,000 re-read and 1,806 new. The model wrote back 400 tokens between them.'
    );
  });

  test('time is floored, as every clock on the page is', () => {
    expect([whenWords(4), whenWords(59), whenWords(60), whenWords(3_599), whenWords(8_418)]).toEqual([
      'in the first minute',
      'in the first minute',
      '1 minute in',
      '59 minutes in',
      '2h 20m in',
    ]);
  });
});

describe('the rewrite, in words', () => {
  test('call 1 came back before this session began, and the lifetime is the one the calls wrote with', () => {
    expect(rewriteWords(RIDEGT)).toBe(
      "Call 1 came 1h 08m after the conversation's previous call, before this session began. The cache keeps a conversation for an hour, so it had expired, and 140,553 of its 140,555 new tokens were written to it again."
    );
    const five = rewriteWords({ ...RIDEGT, lifetime_seconds: 300, rewrites: [{ call: 12, away_seconds: 610, written: 50_000 }] });
    expect(five).toBe(
      "Call 12 came 10 minutes after the conversation's previous call. The cache keeps a conversation for five minutes, so it had expired, and 50,000 tokens were written to it again."
    );
  });

  test('the largest is said, and the rest are counted, the ones the list did not keep too', () => {
    const b = { ...RIDEGT, rewrites: [{ call: 3, away_seconds: 3_900, written: 20_000 }, { call: 5, away_seconds: 4_000, written: 90_000 }], rewrite_calls: 4 };
    expect(rewriteWords(b)).toBe(
      "Call 5 came 1h 07m after the conversation's previous call, before this session began. The cache keeps a conversation for an hour, so it had expired, and 90,000 tokens were written to it again. 3 more calls came back to an expired cache the same way."
    );
    expect(rewriteWords({ ...RIDEGT, rewrites: [], rewrite_calls: 0 })).toBeNull();
  });

  test('"before this session began" is said of any call whose gap reaches past the start, and only then', () => {
    // FOUND IN REVIEW (2026-09-13): said of call 1 alone, while 58 of 59 rewrites reach back
    // before their session: `8be94bc1`'s call 175 came 46h 45m after its previous call, in a
    // session 2h 39m long.
    const late: SessionCallPoint[] = RIDEGT.points!.map((p, i) => ({ ...p, at: i * 1_800 }));
    const deep = { ...RIDEGT, points: late, rewrites: [{ call: 7, away_seconds: 168_300, written: 90_000 }] };
    expect(rewriteWords(deep)).toContain("Call 7 came 46h 45m after the conversation's previous call, before this session began.");
    // Call 7 was made 3h in (10,800 seconds): a gap of 2h reaches back only to 1h in.
    const inside = { ...RIDEGT, points: late, rewrites: [{ call: 7, away_seconds: 7_200, written: 90_000 }] };
    expect(rewriteWords(inside)).toContain("Call 7 came 2h 00m after the conversation's previous call. The cache");
    expect(beforeSession({ call: 7, away_seconds: 10_800 }, late, 1, null)).toBe(false);
    expect(beforeSession({ call: 7, away_seconds: 10_801 }, late, 1, null)).toBe(true);
    // In a bar of several calls the call's own offset is not on the wire: it was made before the
    // next bar's first call, so only a gap longer than that is certain.
    const binned = growing(30, 4);
    const pts = binned.points!;
    expect(pts[2]!.at).toBe(160);
    expect(pts[3]!.at).toBe(240);
    expect(beforeSession({ call: 10, away_seconds: 200 }, pts, 4, null)).toBe(false);
    expect(beforeSession({ call: 10, away_seconds: 241 }, pts, 4, null)).toBe(true);
    // A bar's first call is made at the bar's own offset, so for it that is the bound.
    expect(beforeSession({ call: 9, away_seconds: 159 }, pts, 4, null)).toBe(false);
    expect(beforeSession({ call: 9, away_seconds: 161 }, pts, 4, null)).toBe(true);
    // The last bar reaches to the session's end; with no end known nothing is claimed.
    expect(beforeSession({ call: 30, away_seconds: 5_000 }, pts, 4, null)).toBe(false);
    expect(beforeSession({ call: 30, away_seconds: 5_000 }, pts, 4, 4_800)).toBe(true);
    expect(beforeSession({ call: 30, away_seconds: 5_000 }, pts, 4, 6_000)).toBe(false);
    const v = ready({ ...binned, rewrites: [{ call: 30, away_seconds: 5_000, written: 90_000 }], rewrite_calls: 1 }, 'claude_code', {
      started_at: '2026-09-13T10:00:00Z',
      ended_at: '2026-09-13T11:20:00Z',
    });
    expect(v.rewrite).toContain('before this session began');
  });

  test('a viewer who is not the owner hears the rewrite without how long it was away', () => {
    // The server serves `away_seconds` to the session's owner only (`routes/sessions._call_tokens_for`).
    const stranger: CallTokensRead = { ...RIDEGT, rewrites: [{ call: 1, away_seconds: null, written: 140_553 }] };
    const v = ready(stranger);
    expect(v.rewrite).toBe(
      'Call 1 came back after the cache had expired (it keeps a conversation for an hour), and 140,553 of its 140,555 new tokens were written to it again.'
    );
    expect(v.marks).toEqual([{ index: 0, call: 1, written: 140_553, label: 'cache expired' }]);
    expect(beforeSession({ call: 1, away_seconds: null }, RIDEGT.points!, 1, null)).toBe(false);
    const more = ready({ ...stranger, rewrites: [...stranger.rewrites!, { call: 4, away_seconds: null, written: 1_000 }], rewrite_calls: 2 });
    expect(more.rewrite).toContain('1 more call came back to an expired cache the same way.');
    expect(more.rewrite).not.toMatch(/\d+h|minutes/);
  });
});

describe('refusals are sentences, never zeros', () => {
  test('too few calls says how many it had and how many a chart needs', () => {
    const v = callsView({ harness: 'claude_code', call_tokens: { ...RIDEGT, reason: 'too_few_calls', calls: 3, per_point: null, points: null, lifetime_seconds: null, rewrites: null, rewrite_calls: null, usd_cache_read: null, usd_cache_write: null, usd_input: null, usd_output: null } });
    expect(v).toEqual({ kind: 'refused', sentence: 'This session made 3 calls to the model, and a chart of what each one sent needs 5.' });
  });

  test('files that record counts, none of them inside this session, made no call: said so, not "no counts"', () => {
    const none = { ...RIDEGT, reason: 'too_few_calls' as const, calls: 0, per_point: null, points: null, lifetime_seconds: null, rewrites: null, rewrite_calls: null };
    expect(callsView({ harness: 'claude_code', call_tokens: none })).toEqual({ kind: 'refused', sentence: 'No call to the model fell inside this session, so there is nothing to draw.' });
  });

  test('no counts names the tool the way burn does, the upload\'s harness name mapped to the engine\'s', () => {
    const refused = { ...RIDEGT, reason: 'no_token_counts' as const, calls: null, per_point: null, points: null };
    const counts = 'This transcript does not record token counts, so there are no calls to draw.';
    expect(callsView({ harness: 'claude_code', call_tokens: refused })).toEqual({ kind: 'refused', sentence: counts });
    expect(callsView({ harness: 'cursor_ide', call_tokens: refused })).toEqual({ kind: 'refused', sentence: 'Calls are not drawn for this tool yet.' });
    // FOUND IN REVIEW (2026-09-13): the upload says `gemini_cli` where the engine's readers say
    // `gemini`, so a Gemini session was "not drawn for this tool yet", and burn said its cost
    // "is not shown for this tool yet", both of a tool whose counts are read.
    expect(callsView({ harness: 'gemini_cli', call_tokens: refused })).toEqual({ kind: 'refused', sentence: counts });
    expect(explainBurn({ tokens: null, reason: 'no_token_counts' } as never, 'gemini_cli').join(' ')).not.toContain('not shown for this tool yet');
    expect(explainBurn({ tokens: null, reason: 'no_token_counts' } as never, 'cursor_ide').join(' ')).toContain('not shown for this tool yet');
  });

  test('a block nobody computed is absent, not refused', () => {
    expect(callsView({ harness: 'claude_code', call_tokens: null }).kind).toBe('absent');
    expect(callsView({ harness: 'claude_code' }).kind).toBe('absent');
  });

  test('a price the machine could not name is a sentence, and the token bar still stands', () => {
    const v = ready({ ...RIDEGT, usd_cache_read: null, usd_cache_write: null, usd_input: null, usd_output: null, price_reason: 'model_not_in_price_table' });
    expect(v.shares.map((s) => s.key)).toEqual(['tokens']);
    expect(v.priceNote).toBe('No list price is shown: a call used a model the price table does not have, and it is not priced at a guess.');
    expect(v.priceBasis).toBeNull();
    expect(v.explain.join(' ')).not.toContain('list price');
  });
});

describe('tokens against list price', () => {
  test("the two bars split the same calls three ways, and the price is never what you spent", () => {
    const v = ready(RIDEGT);
    const [tokens, price] = v.shares;
    expect(tokens!.segments.map((s) => s.text)).toEqual(['re-read 88%', 'new 12%', "Claude's reply under 1%"]);
    expect(tokens!.total).toBe('1.2M');
    expect(price!.total).toBe('$3.48');
    expect(price!.segments.map((s) => s.text)).toEqual(['re-read 15%', 'new 83%', "Claude's reply 2%"]);
    // The sentence under them says the numbers the bars show.
    expect(v.explain[2]).toBe('A re-read is priced far below new tokens and replies, which is why re-reads are 88% of the tokens and 15% of the list price.');
    expect(v.priceBasis).toBe('What these tokens would cost at API list prices, read Sep 6. On a subscription you pay your plan, not this.');
    const every = [v.priceBasis, ...v.explain, ...v.shares.flatMap((s) => [s.label, ...s.segments.map((g) => g.text)])].join(' ');
    expect(every.toLowerCase()).not.toContain('you spent');
  });
});

describe('share words add up to 100', () => {
  test('largest remainder, with "under 1%" and "over 99%" kept at the ends', () => {
    // FOUND IN REVIEW (2026-09-13): each part rounded on its own; `7b2550af` read 75%, 13%, 13%.
    expect(percentWords([75, 12.5, 12.5])).toEqual(['75%', '13%', '12%']);
    expect(percentWords([99.7, 0.3])).toEqual(['over 99%', 'under 1%']);
    expect(percentWords([0.994, 0.006])).toEqual(['99%', '1%']);
    expect(percentWords([1])).toEqual(['100%']);
    expect(percentWords([2, 1, 0])).toEqual(['67%', '33%', '0%']);
    // Over many splits, the whole numbers always make 100 when no part is under half a percent.
    let seed = 7;
    const rnd = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31);
    for (let k = 0; k < 2_000; k++) {
      const parts = [rnd() * 1e6, rnd() * 1e5, rnd() * 1e4 + 6_000];
      const said = percentWords(parts);
      if (said.some((w) => !/^\d+%$/.test(w))) continue;
      expect(said.reduce((t, w) => t + Number(w.slice(0, -1)), 0)).toBe(100);
    }
  });

  test('a part said "under 1%" holds the point the whole numbers leave; it is not handed to the largest part', () => {
    // 60256e3a's tokens: re-read 98.49%, new 1.26%, the reply 0.24%. Largest remainder gave the
    // re-read the reply's point and read 99% under a band and a paragraph saying 98%.
    expect(percentWords([132_134_470, 1_694_548, 327_194])).toEqual(['98%', '1%', 'under 1%']);
    // Without a part in words, the whole numbers still make 100.
    expect(percentWords([1, 1, 1])).toEqual(['34%', '33%', '33%']);
  });

  test('a pinned part reads as shareWords says it, and the others take the point', () => {
    // 97.5% and 2.5%: said on their own they can make 101; the pinned part keeps its own word.
    const said = percentWords([97.5, 2.5], 0);
    expect(said[0]).toBe(shareWords(0.975));
    expect(said.reduce((t, w) => t + Number(w.slice(0, -1)), 0)).toBe(100);
    for (const parts of [[96.5, 2.6, 0.9], [98.5, 1.5], [90.5, 9.5], [50.5, 49.5]]) {
      const total = parts.reduce((t, v) => t + v, 0);
      expect(percentWords(parts, 0)[0]).toBe(shareWords(parts[0]! / total));
    }
  });

  test('the re-read on the bar is the re-read on the band and in the paragraph: one number (60256e3a)', () => {
    // MEASURED on the overnight stack (2026-09-14): burn's total and this block's are equal on all
    // 152 sessions that carry both, so the three places the page says the share must agree.
    const burn = {
      reason: null,
      tokens: 134_156_212,
      cache_read_share: 0.9849299412240411,
      barren_share: 0.11058992929824227,
      unreadable_share: 0.4884698816630273,
      segments: 72,
      lines_added: 507,
      lines_removed: 0,
      files_changed: 5,
      commits: 3,
      spikes: null,
      spikes_needed: 5,
    } as unknown as NonNullable<SessionDetail['burn']>;
    const block: SessionCallTokens = {
      ...RIDEGT,
      calls: 2,
      points: [
        { at: 4, cache_read: 66_067_235, cache_write: 846_901, input: 373, output: 163_597 },
        { at: 900, cache_read: 66_067_235, cache_write: 846_901, input: 373, output: 163_597 },
      ],
    };
    const v = callsView({ call_tokens: block, harness: 'claude_code', burn });
    if (v.kind !== 'ready') throw new Error('expected a chart');
    const read = v.shares[0]!.segments.find((g) => g.part === 'read')!;
    expect(read.text).toBe('re-read 98%');
    expect(burnBand(burn)!.note).toBe('98% of them re-reading the conversation so far');
    expect(explainBurn(burn, 'claude_code')[1]!.startsWith('98% of that was the conversation re-reading itself')).toBe(true);
    expect(v.explain.join(' ')).toContain('re-reads are 98% of the tokens');
    expect(v.totalNote).toBeNull();
    // Were the two totals ever to part, the page says so rather than two figures in silence.
    const parted = callsView({ call_tokens: block, harness: 'claude_code', burn: { ...burn, tokens: 57_600_000 } });
    expect(parted.kind === 'ready' && parted.totalNote).toBe('Counted call by call, so these can differ from the 57.6M tokens under where the tokens went.');
  });

  test('every sample and chart bar that says only whole numbers says 100 in all', () => {
    for (const b of [RIDEGT, growing(20), growing(500, 3)]) {
      for (const bar of ready(b).shares) {
        const words = bar.segments.map((g) => g.share);
        if (words.every((w) => /^\d+%$/.test(w))) expect(words.reduce((t, w) => t + Number(w.slice(0, -1)), 0)).toBe(100);
      }
    }
  });
});

describe('why the re-read is most of it', () => {
  test('the growth is said with its numbers only where a call sent more than the first', () => {
    const grew = ready(growing(20));
    expect(grew.explain).toEqual([
      'The model keeps nothing between calls, so every call sends the whole conversation again, and the cache serves the part it has seen before. That is a re-read.',
      'A conversation only grows until it is compacted or cleared, so each call re-reads more than the one before it: the first call here sent 51k tokens, and the largest 70k.',
      'A re-read is priced far below new tokens and replies, which is why re-reads are 98% of the tokens and 15% of the list price.',
    ]);
    const flat: CallBar[] = [1, 2, 3].map((i) => ({
      read: 100_000,
      fresh: 1_000,
      reply: 100,
      sent: 101_000,
      first: i,
      last: i,
      n: 1,
      at: i,
      each: { read: 100_000, fresh: 1_000, reply: 100 },
    }));
    expect(explainCalls(flat, 1, '98%', null)[1]).toBe('A conversation only grows until it is compacted or cleared, so each call re-reads more than the one before it.');
    expect(explainCalls(flat, 1, '98%', null)[2]).toBe("Re-reads are 98% of this session's tokens.");
  });

  test('a bar of several calls is averaged per call, and says so', () => {
    expect(ready(growing(500, 3)).explain[1]).toBe(
      'A conversation only grows until it is compacted or cleared, so each call re-reads more than the one before it: a call here sent about 51k tokens at the start and up to about 549k.'
    );
  });
});

describe('the samples', () => {
  const BASE = {
    id: 'sample',
    client_session_id: 'sample',
    harness: 'claude_code',
    repo_name: 'gt-transit',
    started_at: '2026-08-29T13:12:00Z',
    ended_at: '2026-08-29T20:00:00Z',
    active_seconds: 19_020,
    idle_seconds: 5460,
    local_date: '2026-08-29',
    title: 'Wire live vehicle positions into the guidance map',
    title_source: 'harness',
    notable: true,
    unattended: false,
    timeline_fidelity: 'full',
    is_shared: false,
    post_id: null,
    strip: { cols: '', marks: [], t0_ms: 0, t1_ms: 24_480_000 },
    stats: {
      tokens_reported: true,
      tok_in: 2_100_000,
      tok_out: 410_000,
      tok_cache_read: 190_000_000,
      tok_cache_w5m: 1_600_000,
      tok_cache_w1h: 0,
      models: [{ model_id: 'claude-opus-5', output_token_share: 1 }],
      model_state: 'known',
      human_prompt_count: 52,
      prompt_count_basis: 'typed_promptsource',
      files_touched: 38,
      lines_added_agent: 2101,
      commit_count: 7,
      agent_line_bucket: 'nine_in_ten',
      attrib_confidence: 'high',
    },
  } satisfies SessionDetail;
  const NOW = Date.parse('2026-09-13T08:00:00Z');
  const of = (v: (typeof SAMPLE_VARIANTS)[number]) => sampleOutcome(BASE, v, NOW, 'offline').session;

  test('every drawn sample adds up to its own stats and burn, bucket by bucket', () => {
    for (const v of ['final', 'live'] as const) {
      const s = of(v)!;
      const b = s.call_tokens!;
      const sum = (k: keyof SessionCallPoint) => b.points!.reduce((t, p) => t + p[k], 0);
      const st = s.stats!;
      expect({ v, read: sum('cache_read'), write: sum('cache_write'), input: sum('input'), output: sum('output') }).toEqual({
        v,
        read: Number(st.tok_cache_read),
        write: (st.tok_cache_w5m ?? 0) + (st.tok_cache_w1h ?? 0),
        input: Number(st.tok_in),
        output: Number(st.tok_out),
      });
      expect(sum('cache_read') + sum('cache_write') + sum('input') + sum('output')).toBe(s.burn!.tokens!);
      expect(b.per_point).toBe(Math.max(1, Math.ceil(b.calls! / 240)));
      expect(b.points!.length).toBe(Math.ceil(b.calls! / b.per_point!));
      expect(b.points!.length).toBeLessThanOrEqual(240);
      for (let i = 1; i < b.points!.length; i++) expect(b.points![i]!.at).toBeGreaterThanOrEqual(b.points![i - 1]!.at);
      for (const r of b.rewrites!) expect(r.call).toBeLessThanOrEqual(b.calls!);
      // The lifetime is the one the stats wrote with: an hour for one hour writes.
      expect(b.lifetime_seconds).toBe((st.tok_cache_w1h ?? 0) > 0 ? 3600 : 300);
    }
  });

  test('the finished sample draws the binned path, the live one a bar per call', () => {
    expect(ready(of('final')!.call_tokens!).eachBar).toBe('each bar the average of 6 calls, the last of 4');
    expect(ready(of('live')!.call_tokens!).eachBar).toBe('one bar per call');
    expect(callsView(of('refused')!).kind).toBe('refused');
    expect(callsView(of('short')!)).toEqual({ kind: 'refused', sentence: 'This session made 4 calls to the model, and a chart of what each one sent needs 5.' });
    expect(callsView(of('quiet')!).kind).toBe('absent');
  });

  test('no word any sample or chart says carries a dash', () => {
    const said: string[] = [];
    const add = (v: CallsView, harness: string) => {
      if (v.kind !== 'ready') return said.push(v.sentence);
      said.push(v.eachBar, v.rewrite ?? '', v.priceNote ?? '', v.priceBasis ?? '', ...v.explain, ...v.legend.map((l) => l.label), ...v.marks.map((m) => m.label));
      said.push(...v.ticks.map((t) => t.label), ...v.axis.map((a) => a.label), ...v.shares.flatMap((s) => [s.label, s.total, ...s.segments.map((g) => g.text)]));
      const stranger = callsView({ harness, call_tokens: { ...RIDEGT, rewrites: [{ call: 1, away_seconds: null, written: 140_553 }] } });
      if (stranger.kind === 'ready') said.push(stranger.rewrite ?? '', ...stranger.marks.map((m) => m.label));
      for (const b of v.bars) said.push(readout(b, harness));
    };
    for (const v of SAMPLE_VARIANTS) {
      const s = of(v);
      if (s) add(callsView(s), s.harness);
    }
    add(callsView({ harness: 'codex', call_tokens: growing(500, 3) }), 'codex');
    add(callsView({ harness: 'claude_code', call_tokens: RIDEGT }), 'claude_code');
    const dashed = said.filter((x) => hasDash(x));
    expect(dashed).toEqual([]);
    expect(said.length).toBeGreaterThan(400);
  });
});

describe('the chapter', () => {
  test("the bars' hues mean one thing on the page, beside burn's chart above them", () => {
    // FOUND IN REVIEW (2026-09-13): matched to Money a screen away, the reply wore tide, which
    // burn's chart directly above draws as re-reading the conversation.
    expect(PART_HUE.read).toBe(CAUSE_HUE.context_replay);
    expect(new Set(Object.values(PART_HUE)).size).toBe(3);
    for (const [cause, hue] of Object.entries(CAUSE_HUE)) {
      for (const part of ['fresh', 'reply'] as const) expect({ cause, part, same: PART_HUE[part] === hue }).toEqual({ cause, part, same: false });
      if (cause !== 'context_replay') expect({ cause, hue }).not.toEqual({ cause, hue: PART_HUE.read });
    }
    // Every hue the chart and its section paint comes from PART_HUE: no ink is picked in the views.
    for (const f of ['src/session/CallsChart.tsx', 'src/session/CallsSection.tsx']) {
      const src = readFileSync(join(MOBILE, f), 'utf8');
      expect({ f, picked: src.match(/SPECTRUM\.(amber|brass|tide|ember|cobalt|orchid)\b/g) }).toEqual({ f, picked: null });
      expect({ f, readInk: src.includes('readInk') }).toEqual({ f, readInk: false });
    }
  });

  test('the band is never a part hue nor burn\'s, for every creature', () => {
    expect(sessionHues('crab').calls).toBe('cobalt');
    for (const c of ANIMALS) {
      const h = sessionHues(c);
      expect(new Set([h.burn, h.calls, h.reading]).size).toBe(3);
      expect(h.calls).not.toBe(h.session);
      expect({ c, calls: h.calls, clash: [...Object.values(PART_HUE), 'ember', 'coral'].includes(h.calls) }).toEqual({ c, calls: h.calls, clash: false });
    }
  });

  test('a finger crossing bars changes nothing the chart is given, and never rebuilds its gestures', () => {
    // FOUND IN REVIEW (2026-09-13): the readout came in as VoiceOver's value, so every bar
    // crossed re-rendered the chart through its memo and rebuilt both gestures mid pan, and the
    // readout was remounted per bar.
    const chart = readFileSync(join(MOBILE, 'src/session/CallsChart.tsx'), 'utf8');
    const section = readFileSync(join(MOBILE, 'src/session/CallsSection.tsx'), 'utf8');
    expect(chart).not.toMatch(/valueText|accessibilityValue/);
    expect(chart).toMatch(/const gesture = useMemo\(\(\) => \{/);
    expect(chart).toContain('export const CallsChart = memo(CallsChartInner);');
    expect(section).toContain('accessibilityValue={{ text: said }}');
    expect(section).not.toMatch(/key=\{index\}|entering=/);
    // The bar in hand is held inside the bars, and a session that grows puts it back on the last.
    expect(chart).toMatch(/Math\.min\(n - 1, Math\.max\(0, at\.value\)\)/);
    expect(section).toMatch(/if \(count !== n\) \{\s+setCount\(n\);\s+setIndex\(view\.initial\);/);
    expect(section).toContain('view.bars[clampIndex(index, n)]');
  });

  test('the drawing keeps its own clock and records one still picture once it lands', () => {
    const src = readFileSync(join(MOBILE, 'src/session/CallsChart.tsx'), 'utf8');
    expect(src).toContain('useDrawClock(total)');
    expect(src).toContain('<Picture picture={still ?? moving} />');
    expect(src).not.toMatch(/useClock\(\)/);
    // Every function the UI thread calls is a worklet, defined before the component that uses it
    // (a plain helper called from a worklet crashed the app twice on 2026-09-13).
    for (const fn of ['function drawCalls(', 'const pick = (']) {
      const at = src.indexOf(fn);
      expect({ fn, found: at >= 0, worklet: src.slice(at, at + 400).includes("'worklet'") }).toEqual({ fn, found: true, worklet: true });
    }
    expect(src.indexOf('function drawCalls(')).toBeLessThan(src.indexOf('function CallsChartInner('));
    const page = readFileSync(join(MOBILE, 'src/session/SessionPage.tsx'), 'utf8');
    expect(page).toContain('<CallsSection');
  });
});

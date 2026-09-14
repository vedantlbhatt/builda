/**
 * Tokens, call by call on the session page (`src/session/callsView.ts`, drawn by `CallsChart.tsx`):
 * every value and word the chapter shows, from the `call_tokens` block `analysis/calls.py` sends.
 *
 * What these protect, each a plausible wrong number or sentence nobody would question:
 *   - a bar of several calls is labelled with exactly the calls it holds, the last one too;
 *   - the readout's parts add up to what it says was sent, to the token;
 *   - the call that came back to an expired cache is said with its own numbers, and "before this
 *     session began" only where that is certain;
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
import type { SessionDetail } from '../src/data/api';
import type { SessionCallPoint, SessionCallTokens } from '../src/generated/contract';
import { SPECTRUM } from '../src/insights/palette';
import { callsView, eachBarWords, explainCalls, niceStep, partInk, readout, rewriteWords, whenWords, type CallBar, type CallsView } from '../src/session/callsView';
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

function ready(b: SessionCallTokens, harness = 'claude_code'): Ready {
  const v = callsView({ call_tokens: b, harness });
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
    expect(v.bars[0]).toEqual({ read: 26_448, fresh: 140_555, reply: 398, sent: 167_003, first: 1, last: 1, at: 4 });
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
    expect(v.eachBar).toBe('each bar is 3 calls, the last one 2');
    expect(eachBarWords(3, 501)).toBe('each bar is 3 calls');
    expect(v.axis[0]).toEqual({ index: 0, label: 'call 1' });
    expect(v.axis[v.axis.length - 1]).toEqual({ index: 166, label: '500' });
  });

  test('gridlines are round numbers under the tallest bar, said as tokens are said', () => {
    expect([niceStep(253_474), niceStep(1_000), niceStep(1_390_000)]).toEqual([100_000, 250, 500_000]);
    const v = ready(RIDEGT);
    expect(v.ticks.map((t) => t.label)).toEqual(['50k', '100k', '150k']);
    for (const t of v.ticks) expect(t.value).toBeLessThanOrEqual(v.max);
  });

  test('the call back to an expired cache is marked over its own bar, in a bin too', () => {
    expect(ready(RIDEGT).marks).toEqual([{ index: 0, call: 1, label: '1h 08m away' }]);
    const binned = ready({ ...growing(30, 4), rewrites: [{ call: 10, away_seconds: 5400, written: 90_000 }], rewrite_calls: 1 });
    expect(binned.marks).toEqual([{ index: 2, call: 10, label: '1h 30m away' }]);
  });
});

describe('the readout', () => {
  test("says the owner's example the way the one off page did, and its parts add up", () => {
    const b: CallBar = { read: 26_448, fresh: 140_555, reply: 398, sent: 167_003, first: 124, last: 124, at: 8_418 };
    expect(readout(b, 'claude_code')).toBe('Call 124, 2h 20m in: sent 167,003 tokens, 26,448 re-read and 140,555 new. Claude wrote back 398.');
  });

  test('a bar of several calls says them all, and another tool is the model', () => {
    const v = ready(growing(500, 3), 'codex');
    expect(readout(v.bars[1]!, 'codex')).toBe('Calls 4 to 6, 1 minute in: sent 161,709 tokens, 159,000 re-read and 2,709 new. The model wrote back 600.');
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
      "Call 1 came 1h 08m after the conversation's previous call, before this session began. The cache keeps a conversation for an hour, so it had expired, and 140,553 tokens were written to it again."
    );
    const five = rewriteWords({ ...RIDEGT, lifetime_seconds: 300, rewrites: [{ call: 12, away_seconds: 610, written: 50_000 }] });
    expect(five).toBe(
      "Call 12 came 10 minutes after the conversation's previous call. The cache keeps a conversation for five minutes, so it had expired, and 50,000 tokens were written to it again."
    );
  });

  test('the largest is said, and the rest are counted, the ones the list did not keep too', () => {
    const b = { ...RIDEGT, rewrites: [{ call: 3, away_seconds: 3_900, written: 20_000 }, { call: 5, away_seconds: 4_000, written: 90_000 }], rewrite_calls: 4 };
    expect(rewriteWords(b)).toBe(
      "Call 5 came 1h 07m after the conversation's previous call. The cache keeps a conversation for an hour, so it had expired, and 90,000 tokens were written to it again. 3 more calls came back to an expired cache the same way."
    );
    expect(rewriteWords({ ...RIDEGT, rewrites: [], rewrite_calls: 0 })).toBeNull();
  });
});

describe('refusals are sentences, never zeros', () => {
  test('too few calls says how many it had and how many a chart needs', () => {
    const v = callsView({ harness: 'claude_code', call_tokens: { ...RIDEGT, reason: 'too_few_calls', calls: 3, per_point: null, points: null, lifetime_seconds: null, rewrites: null, rewrite_calls: null, usd_cache_read: null, usd_cache_write: null, usd_input: null, usd_output: null } });
    expect(v).toEqual({ kind: 'refused', sentence: 'This session made 3 calls to the model, and a chart of what each one sent needs 5.' });
  });

  test('no counts names the tool the way burn does', () => {
    const refused = { ...RIDEGT, reason: 'no_token_counts' as const, calls: null, per_point: null, points: null };
    expect(callsView({ harness: 'claude_code', call_tokens: refused })).toEqual({ kind: 'refused', sentence: 'This transcript does not record token counts, so there are no calls to draw.' });
    expect(callsView({ harness: 'cursor_ide', call_tokens: refused })).toEqual({ kind: 'refused', sentence: 'Calls are not drawn for this tool yet.' });
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
    expect(v.priceBasis).toBe('What these tokens would cost at API list prices, read Sep 6. On a subscription you pay your plan, not this.');
    const every = [v.priceBasis, ...v.explain, ...v.shares.flatMap((s) => [s.label, ...s.segments.map((g) => g.text)])].join(' ');
    expect(every.toLowerCase()).not.toContain('you spent');
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
    const flat: CallBar[] = [1, 2, 3].map((i) => ({ read: 100_000, fresh: 1_000, reply: 100, sent: 101_000, first: i, last: i, at: i }));
    expect(explainCalls(flat, 1, 0.98, null)[1]).toBe('A conversation only grows until it is compacted or cleared, so each call re-reads more than the one before it.');
    expect(explainCalls(flat, 1, 0.98, null)[2]).toBe("Re-reads are 98% of this session's tokens.");
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
    expect(ready(of('final')!.call_tokens!).eachBar).toBe('each bar is 6 calls, the last one 4');
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
  test("the re-read wears the chapter's hue; new and reply wear Money's bucket colours", () => {
    // Money splits tokens the same way (insights/sections/Money.BUCKET_COLOR): a cache write is
    // brass and output is tide there, so they are here, and the re-read wears its chapter's ink.
    const money = readFileSync(join(import.meta.dir, '..', 'src/insights/sections/Money.tsx'), 'utf8');
    expect(money).toContain('cache_write: SPECTRUM.brass.ink');
    expect(money).toContain('output: SPECTRUM.tide.ink');
    expect(partInk('fresh', '#000000')).toBe(SPECTRUM.brass.ink);
    expect(partInk('reply', '#000000')).toBe(SPECTRUM.tide.ink);
    expect(partInk('read', '#123456')).toBe('#123456');
    expect(sessionHues('crab').calls).toBe('cobalt');
    for (const c of ['cat', 'dog', 'fox', 'owl', 'bee', 'whale', 'octopus', 'crab'] as const) {
      const h = sessionHues(c);
      expect(new Set([h.burn, h.calls, h.reading]).size).toBe(3);
      expect(h.calls).not.toBe(h.session);
      // The chapter's ink is the re-read's, so it can be neither of the other two parts.
      expect(['brass', 'tide']).not.toContain(h.calls);
    }
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

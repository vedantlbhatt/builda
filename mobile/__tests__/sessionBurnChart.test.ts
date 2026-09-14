/**
 * Burn forensics drawn (`src/session/burnChart.ts`): the costly stretches as bars in the one unit
 * the wire measures (a typical stretch is 1, each costly one stands at its multiple, beside burn's
 * own bar at three), coloured by the cause claiming the most of each, filled by what each
 * produced in `spikeVerdict`'s own order, the causes as separate meters because they overlap,
 * and the band and the ledger saying no number twice.
 */
import { describe, expect, test } from 'bun:test';

import { hasDash } from '../src/copy/plain';
import type { SessionDetail } from '../src/data/api';
import type { SessionBurn, SessionBurnSpike } from '../src/generated/contract';
import { CONTRACT_ENUMS } from '../src/generated/contract';
import { SPIKE_MULTIPLE } from '../src/map/frames';
import { burnBand, burnChart, burnLedger, burnRuleWords, CAUSE_HUE, CAUSE_LABEL, fillKey, fillOf, meters, stretchNote } from '../src/session/burnChart';
import { burnView } from '../src/session/burnView';
import { sampleOutcome } from '../src/session/samples';
import { REPO } from './pythonRef';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

const FINAL = sampleOutcome(BASE, 'final', Date.parse('2026-09-13T08:00:00Z'), 'offline').session!;

function spike(over: Partial<SessionBurnSpike>): SessionBurnSpike {
  return { tokens: 1_000_000, multiple: 4, barren: false, lines_added: 0, lines_removed: 0, seconds: 600, causes: [], files_changed: 0, commits: 0, unreadable: false, ...over };
}

describe('the chart', () => {
  const chart = burnChart(FINAL.burn)!;

  test('a typical stretch first, one unit tall, then each costly stretch at its multiple, most expensive first', () => {
    expect(chart.bars.map((b) => [b.top, b.under, b.spike])).toEqual([
      ['1×', 'typical', false],
      ['8.1×', '38 minutes', true],
      ['4.4×', '19 minutes', true],
      ['3.3×', '14 minutes', true],
    ]);
    expect(chart.bars.map((b) => b.multiple)).toEqual([1, 8.1, 4.4, 3.3]);
  });

  test('burn\'s own bar is drawn where burn draws it, and the scale never cuts it off', () => {
    expect(chart.threshold).toBe(SPIKE_MULTIPLE);
    expect(chart.threshold).toBe(3);
    expect(chart.max).toBe(8.1);
    const low = burnChart({ ...FINAL.burn!, spikes: [spike({ multiple: 3 })] })!;
    expect(low.max).toBe(3);
  });

  test('each bar wears the cause claiming the most of its tokens; the fill is what it produced', () => {
    expect(chart.bars.map((b) => b.cause)).toEqual([null, 'context_replay', 'context_replay', 'context_replay']);
    expect(chart.bars.map((b) => b.fill)).toEqual(['solid', 'solid', 'dotted', 'solid']);
    expect(chart.fills).toEqual(['solid', 'dotted']);
  });

  test('the fill follows spikeVerdict\'s order: barren, then any work, then unreadable, else nothing written', () => {
    expect(fillOf(spike({ barren: true, lines_added: 9 }))).toBe('dotted');
    expect(fillOf(spike({ lines_added: 9 }))).toBe('solid');
    expect(fillOf(spike({ lines_removed: 2 }))).toBe('solid');
    expect(fillOf(spike({ files_changed: 1 }))).toBe('solid');
    expect(fillOf(spike({ commits: 1 }))).toBe('solid');
    // MEASURED shape on the overnight stack (RideGT, 2026-08-18): 7.35M tokens, nothing visible, a
    // script that could have written: it cannot be judged, so it is outlined, not dotted.
    expect(fillOf(spike({ unreadable: true }))).toBe('hollow');
    expect(fillOf(spike({}))).toBe('dotted');
  });

  test('the key says only the fills that are drawn', () => {
    expect(fillKey(['solid'])).toBeNull();
    expect(fillKey(['solid', 'dotted'])).toBe('A dotted bar wrote nothing.');
    expect(fillKey(['hollow'])).toBe('An outlined bar ran something its transcript cannot show.');
    expect(fillKey(['dotted', 'hollow'])).toBe('A dotted bar wrote nothing, and an outlined one ran something its transcript cannot show.');
  });

  test('the legend is every cause a bar wears, in the order it first appears, and nothing a bar does not', () => {
    expect(chart.legend.map((l) => l.cause)).toEqual([...new Set(chart.bars.map((b) => b.cause).filter((c) => c !== null))]);
    // The fixture's three stretches are all mostly the conversation re-reading itself: one key.
    expect(chart.legend.map((l) => l.cause)).toEqual(['context_replay']);
  });

  test('what a stretch is, said so it is true of the session: no prompt is one stretch, the whole of it', () => {
    // FOUND IN THE FINAL CAPTURE: "1 stretch, each from one prompt of yours to the next" on 0 prompts.
    expect(stretchNote(1, 0)).toBe('the whole session, with no prompt of yours to cut it');
    expect(stretchNote(1, 1)).toBe('from your one prompt to the end');
    expect(stretchNote(52, 52)).toBe('each from one prompt of yours to the next');
    // Work before the first prompt is a stretch of its own (burn.segments, segment 0).
    expect(stretchNote(53, 52)).toBe('each from one prompt of yours to the next, and the work before the first');
    // Counts that do not line up the way burn cuts: the rule, or nothing, never a claim about a count.
    expect(stretchNote(3, 0)).toBeNull();
    expect(stretchNote(1, null)).toBeNull();
    expect(stretchNote(1, 4)).toBeNull();
    expect(stretchNote(9, null)).toBe('each from one prompt of yours to the next');
  });

  test('no chart when there is no costly stretch to draw', () => {
    expect(burnChart(null)).toBeNull();
    expect(burnChart({ ...FINAL.burn!, spikes: [] })).toBeNull();
    expect(burnChart({ ...FINAL.burn!, spikes: null })).toBeNull();
    expect(burnChart({ ...FINAL.burn!, reason: 'no_token_counts' })).toBeNull();
  });
});

describe('the splits under it', () => {
  const chart = burnChart(FINAL.burn)!;

  test('each stretch: its tokens counted to human(), how long, what it produced, how it compares', () => {
    const r = chart.rows[0]!;
    expect(r.index).toBe('01');
    expect(r.tokens.final).toBe('23.4M');
    expect(r.tokens.fmt).toEqual({ kind: 'tokens' });
    expect(r.label).toBe('tokens in 38 minutes');
    expect(r.verdict).toBe('It wrote 412 lines.');
    expect(r.meta).toBe('8.1 times a typical stretch · 52k tokens a line');
    expect(chart.rows[1]!.verdict).toBe('Nothing was written.');
  });

  test('the causes are separate meters with their unrounded share, never one stacked bar', () => {
    const m = chart.rows[0]!.meters;
    expect(m.map((x) => x.cause)).toEqual(['context_replay', 'subagent_fanout', 'error_loop']);
    expect(m[0]!.share).toBeCloseTo(22_610_000 / 23_400_000, 12);
    expect(m[0]!.text).toBe('97% of it re-reading the conversation so far');
    // They overlap: nothing requires them to sum to the stretch, and nothing sums them.
    expect(m.every((x) => x.share > 0 && x.share <= 1)).toBe(true);
  });

  test('a cause that claims no token is not a meter', () => {
    expect(meters(spike({ causes: [{ cause: 'error_loop', n: 3, tokens: 0 }, { cause: 'context_replay', n: 900_000, tokens: 900_000 }] })).map((x) => x.cause)).toEqual(['context_replay']);
  });
});

describe('the band and the ledger', () => {
  test('the band carries the tokens and the share re-reading the conversation', () => {
    const b = burnBand(FINAL.burn!)!;
    expect(b.tokens.final).toBe('194.1M');
    expect(b.note).toBe('98% of them re-reading the conversation so far');
    expect(burnBand({ ...FINAL.burn!, reason: 'no_token_counts', tokens: null })).toBeNull();
  });

  test('the ledger says every other number once, counting the plain ones and setting words still', () => {
    const l = burnLedger(burnView(FINAL));
    expect(l.map((x) => [x.shown, x.label])).toEqual([
      ['3%', 'where nothing was written'],
      ['85k', 'tokens a line'],
      ['8%', 'could not be judged'],
      ['52', 'stretches'],
    ]);
    expect(l.map((x) => x.num?.value ?? null)).toEqual([3, 85, 8, 52]);
    expect(l[3]!.note).toBe('each from one prompt of yours to the next');
    // With the session's own prompt count: 52 prompts, 52 stretches; a count that does not fit says nothing.
    expect(burnLedger(burnView(FINAL), 52)[3]!.note).toBe('each from one prompt of yours to the next');
    expect(burnLedger(burnView(FINAL), 0)[3]!.note).toBeNull();
    const tiny: SessionBurn = { ...FINAL.burn!, barren_share: 0.001 };
    const under = burnLedger(burnView({ ...FINAL, burn: tiny })).find((x) => x.label === 'where nothing was written')!;
    expect(under.shown).toBe('under 1%');
    expect(under.num).toBeNull();
    expect(burnLedger({ kind: 'absent', sentence: 'x' })).toEqual([]);
  });
});

describe('the words', () => {
  test('every cause the contract declares has a hue and a legend word, and no word carries a dash', () => {
    for (const c of CONTRACT_ENUMS.burn_cause) {
      expect(CAUSE_HUE[c]).toBeDefined();
      expect({ c, dash: hasDash(CAUSE_LABEL[c]) }).toEqual({ c, dash: false });
    }
    // Never the burn chapter's own hue, so a bar never reads as the band it sits under.
    expect(Object.values(CAUSE_HUE)).not.toContain('ember');
    expect(new Set(Object.values(CAUSE_HUE)).size).toBe(CONTRACT_ENUMS.burn_cause.length);
  });

  test('the dashed line is said in words a person uses, and never runs through the typical bar', () => {
    // FOUND IN THE DEFECTS PASS (2026-09-14): "The dashed line is burn's own bar: ... is a spike",
    // and on 60256e3a (34.3x) the rule crossed the "1×" over the typical bar.
    const words = burnRuleWords(SPIKE_MULTIPLE);
    expect(words).toBe('The dashed line is 3 times a typical stretch: a stretch that reaches it counts as costly.');
    expect(words).not.toMatch(/burn|spike/i);
    expect(hasDash(words)).toBe(false);
    const chart = readFileSync(join(REPO, 'mobile', 'src', 'session', 'SpikeChart.tsx'), 'utf8');
    expect(chart).toContain('const ruleFrom = chart.bars[0] && !chart.bars[0].spike ? slot : 0;');
    expect(chart).toContain('for (let x = ruleFrom; x < width; x += 8)');
    const section = readFileSync(join(REPO, 'mobile', 'src', 'session', 'BurnSection.tsx'), 'utf8');
    expect(section).not.toContain("burn's own bar");
  });

  test('over the parity fixture\'s real shaped sessions, every string the chart says is dash free', () => {
    const fixture = JSON.parse(readFileSync(join(REPO, 'spec', 'fixtures', 'burn', 'session.json'), 'utf8')) as { entries?: { burn: SessionBurn }[] } | { burn: SessionBurn }[];
    const entries = Array.isArray(fixture) ? fixture : (fixture.entries ?? []);
    let drawn = 0;
    for (const e of entries) {
      const chart = burnChart(e.burn);
      if (!chart) continue;
      drawn++;
      const said = [...chart.bars.flatMap((b) => [b.top, b.under]), ...chart.rows.flatMap((r) => [r.label, r.verdict, r.meta, ...r.meters.map((m) => m.text)])];
      for (const s of said) expect({ s, dash: hasDash(s) }).toEqual({ s, dash: false });
    }
    expect(drawn).toBeGreaterThan(0);
  });
});

/**
 * The You pages' pure decisions: how a dollar, a token count, a share, a date and a trend are
 * said, which archetype the pages show and what numbers stand under it, the money view's
 * sentences, the glossary's months, the stack's groups, and the five load states. Nothing here
 * renders; every rule is a place a plausible wrong number could be stated confidently.
 *
 * Where a rule is Python's too, the test reads the Python and holds the two together, the way
 * strip conformance holds the phone to the Mac.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { BuilderProfile, BuilderProfileResponse, CorpusProfile } from '../src/data/api';
import type { BuilderReport, ReportMoney, ReportStack, ReportVocab, ReportWrappedCard } from '../src/generated/report';
import { BUILDER_PROFILE_KEY } from '../src/onboarding/keys';
import {
  archetypeDisplay,
  archetypeView,
  partOfTheWay,
  runnerUpLine,
  sourceLine,
  THRESHOLD_SOURCE,
  thresholdSentence,
} from '../src/you/archetype';
import {
  dimensionsPending,
  dimensionViews,
  modalArchetypeLine,
  olderHalfMean,
  STEADY_SHARE,
  topDimension,
  trendOf,
} from '../src/you/dimensions';
import { glossaryRowLine, glossaryView } from '../src/you/glossary';
import { moneyRefusal } from '../src/copy/money';
import { stackName, term } from '../src/copy/vocab';
import { BUILDER_KEY, MONEY_MASK_KEY, REVEALED_KEY } from '../src/you/keys';
import { parseSavedAt, resolveLoad, staleLine } from '../src/you/load';
import { corpusBurn, corpusModelCosts, corpusMoney, moneyRowLine, moneyView } from '../src/you/money';
import { dayOf, MASKED_DOLLARS, maskDollars, monthKey, monthLabel } from '../src/you/numbers';
import { youTab } from '../src/you/chapters';
import { STACK_CATEGORY_LABEL, stackRowLine, stackView } from '../src/you/stack';
import { REPORT_ENUMS } from '../src/generated/report';

const MOBILE = join(import.meta.dir, '..');
const REPO = join(MOBILE, '..');
const py = (rel: string) => readFileSync(join(REPO, rel), 'utf8');

/** The no dashes rule, as `plain.DASH` and `__tests__/copy.test.ts` define it. */
const DASH = /[—–]|\s-\s/;

/** Sep 13 2026, 12:00 local: every date below is said relative to it. */
const NOW = new Date(2026, 8, 13, 12, 0).getTime();

// ------------------------------------------------------------------------------ fixtures

/** A server corpus shaped like the real one (`~/.builder-overnight/corpus`, 2026-09-13). */
function corpus(over: Partial<CorpusProfile> = {}): CorpusProfile {
  return {
    profile_version: 1,
    generated_at: '2026-09-13T09:00:00Z',
    sample: {
      sessions: 148,
      sessions_with_prompt_text: 0,
      prompts: 912,
      prompts_with_text: 0,
      tool_calls: 10764,
      active_hours: 83.79,
      days: 27,
      min_sessions: 3,
      enough_sessions: true,
      missing: { steer_rate: 'prompt text and interrupt counts are not stored server side' },
    },
    totals: {
      total_sessions: 148,
      total_hours: 83.79,
      total_prompts: 912,
      total_lines_added: 64652,
      total_commits: null,
      commit_basis: 'overlapping_session_windows',
      total_tool_calls: 10764,
    },
    metrics: {
      code_velocity: { value: 771.6, unit: 'lines per active hour', n: 148, basis: 'uploaded_agent_lines', reason: null },
      steer_rate: {
        value: null,
        unit: 'share',
        n: 0,
        basis: 'interrupts_and_correction_markers',
        reason: 'prompt text and interrupt counts are not stored server side',
      },
      planning_ratio: {
        value: null,
        unit: 'ratio',
        n: 0,
        basis: 'absent',
        reason: 'what the agent did after each prompt is not stored server side',
      },
      test_runs_per_hour: { value: null, unit: 'test runs per active hour', n: 0, basis: 'absent', reason: 'test runs are not counted server side' },
      spend_usd: { value: null, unit: 'US dollars at API list prices', n: 0, basis: 'tokens_not_reported', reason: 'no session reported token counts' },
      spend_without_a_commit_usd: {
        value: null,
        unit: 'US dollars on sittings that ended with no commit',
        n: 0,
        basis: 'absent',
        reason: '0 priced sessions with git commit counts, 8 needed',
      },
      barren_token_share: {
        value: null,
        unit: 'share',
        n: 0,
        basis: 'burn_segments_that_changed_nothing',
        reason: 'sessions reported token counts, but none was split into segments, which needs the transcripts',
      },
    },
    top_tools: [],
    model_mix: [
      { model: 'claude-opus-5', output_tokens: 7822444, share: 0.9171 },
      { model: 'claude-fable-5', output_tokens: 645441, share: 0.0757 },
    ],
    session_rank: [],
    ranked_sessions: 131,
    archetype: {
      name: 'velocity_machine',
      confidence: 0.8,
      reason: null,
      metric: 'code_velocity',
      value: 771.6,
      threshold: 487,
      rule: 'agent lines per active hour',
      scores: [
        { name: 'architect', metric: 'planning_ratio', value: null, threshold: 2.4, score: null, rule: 'prose before the first tool on more than twice as many prompts as go straight to work' },
        { name: 'velocity_machine', metric: 'code_velocity', value: 771.6, threshold: 487, score: 0.792, rule: 'agent lines per active hour' },
        { name: 'quality_guardian', metric: 'test_runs_per_hour', value: null, threshold: 3, score: null, rule: 'test runs per active hour' },
        { name: 'night_owl', metric: 'night_share', value: 0.207, threshold: 0.4, score: 0.259, rule: 'share of active seconds between 22:00 and 04:00 local' },
        { name: 'director', metric: 'autonomy_score', value: 0.121, threshold: 0.5, score: 0.121, rule: 'share of active time the agent ran with nobody present' },
        { name: 'skeptic', metric: 'steer_rate', value: null, threshold: 0.4, score: null, rule: 'interrupts plus corrective prompts, over prompts' },
      ],
      runners_up: [
        { name: 'night_owl', score: 0.259, metric: 'night_share', value: 0.207 },
        { name: 'director', score: 0.121, metric: 'autonomy_score', value: 0.121 },
      ],
    },
    facts: [],
    ...over,
  };
}

/** The Mac's builder_type card, answered: the corpus says Quality guardian at 4.72 test runs an hour. */
function builderTypeCard(over: Partial<ReportWrappedCard> = {}): ReportWrappedCard {
  return {
    id: 'builder_type',
    value: null,
    value_id: 'quality_guardian',
    unit: 'archetype',
    basis: 'archetype_rules',
    n: 155,
    needed: null,
    reason: null,
    extras: {
      confidence: 0.44,
      metric: 'test_runs_per_hour',
      metric_value: 4.72,
      metric_lower_bound: true,
      runners_up: [{ name: 'velocity_machine', metric: 'code_velocity', value: 764.1, threshold: 487, score: 0.785 }],
    },
    ...over,
  };
}

function money(over: Partial<ReportMoney> = {}): ReportMoney {
  return {
    usd: 1873.42,
    basis: 'anthropic_api_list_price',
    reason: null,
    prices_read_on: '2026-09-06T00:00:00Z',
    priced_sessions: 152,
    unpriced_sessions: 0,
    usd_per_active_hour: 22.1,
    usd_without_a_commit: 19.8,
    share_without_a_commit: 0.011,
    tokens: { input: 812201, output: 9912330, cache_read: 3900112034, cache_w5m: 201334551, cache_w1h: 0 },
    token_sessions: 152,
    lines_added: 64680,
    lines_removed: 9021,
    lines_basis: 'project_edit_tools_and_credited_shell_writes',
    by_model: [
      { model: 'claude-opus-4-8', usd: 1502.2, output_tokens: 9120433, sessions: 97, sessions_dominated: 88, commits: 201, usd_per_commit: 6.83 },
      { model: 'claude-sonnet-4-6', usd: 371.22, output_tokens: 791897, sessions: 55, sessions_dominated: 40, commits: 0, usd_per_commit: null },
    ],
    ...over,
  };
}

function vocab(over: Partial<ReportVocab> = {}): ReportVocab {
  return {
    terms: [
      { id: 'commit', count: 412, sessions: 88, first_seen: '2026-08-12T14:11:07Z' },
      { id: 'migration', count: 30, sessions: 9, first_seen: '2026-09-02T10:00:00Z' },
      { id: 'test_suite', count: 200, sessions: 60, first_seen: '2026-08-14T09:00:00Z' },
    ],
    locked: 71,
    catalog_size: 74,
    sessions: 155,
    shell_calls: 9085,
    shell_calls_cut: 312,
    reason: null,
    ...over,
  };
}

function stack(over: Partial<ReportStack> = {}): ReportStack {
  return {
    items: [
      { id: 'python', category: 'language', evidence: 'language', sessions: 140, first_seen: '2026-08-12T14:11:07Z' },
      { id: 'typescript', category: 'language', evidence: 'language', sessions: 150, first_seen: '2026-08-12T15:00:00Z' },
      { id: 'postgres', category: 'database', evidence: 'command', sessions: 14, first_seen: '2026-08-20T09:02:44Z' },
      { id: 'react', category: 'framework', evidence: 'manifest', sessions: 0, first_seen: null },
    ],
    sessions: 155,
    manifests: 38,
    shell_calls: 9085,
    shell_calls_cut: 0,
    reason: null,
    ...over,
  };
}

function report(over: Partial<BuilderReport> = {}): BuilderReport {
  return {
    report_version: 2,
    generated_at: '2026-09-13T09:00:00Z',
    window_days: 90,
    trends: [],
    ...over,
  };
}

function builder(over: Partial<BuilderProfileResponse> = {}): BuilderProfileResponse {
  return {
    builder_profile: null,
    sessions_analysed: 0,
    min_sessions: 3,
    window_days: 90,
    corpus: corpus(),
    ...over,
  };
}

function bp(dimensions: BuilderProfile['dimensions']): BuilderProfile {
  return {
    window_days: 90,
    sessions_analysed: 10,
    confidence_mean: 0.7,
    dimensions,
    archetype: { modal: 'architect', share: 0.6, with_archetype: 10, distribution: {} },
    build_style: {},
    prompting: { specificity_mean: null, correction_share_mean: null, question_share_mean: null, tone_distribution: {} },
    tags: [],
    decision_patterns: [],
  };
}

// ------------------------------------------------------------------------------ numbers

describe('numbers', () => {
  test('the mask hides every dollar amount src/copy writes, and nothing else', () => {
    expect(maskDollars('$19.80 on sessions that ended with no commit, 1% of the spend')).toBe(
      '$••• on sessions that ended with no commit, 1% of the spend',
    );
    expect(maskDollars('97 sessions · 9.1M output tokens · $6.83 a commit')).toBe('97 sessions · 9.1M output tokens · $••• a commit');
    expect(maskDollars('$1,873 at API list prices')).toBe(`${MASKED_DOLLARS} at API list prices`);
    expect(maskDollars('$0.43 an active hour')).toBe('$••• an active hour');
    expect(maskDollars('4,112.2M tokens, 95% cache reads')).toBe('4,112.2M tokens, 95% cache reads');
  });

  test('an instant belongs to the Builda day it happened on: 01:30 is the evening before', () => {
    expect(dayOf(new Date(2026, 7, 30, 1, 30).toISOString(), NOW)).toBe('Aug 29');
    expect(dayOf(new Date(2026, 7, 30, 4, 30).toISOString(), NOW)).toBe('Aug 30');
    expect(dayOf(new Date(2025, 11, 30, 12, 0).toISOString(), NOW)).toBe('Dec 30, 2025');
    expect(dayOf('not a date', NOW)).toBeNull();
    expect(monthKey(new Date(2026, 8, 1, 2, 0).toISOString())).toBe('2026-08');
    expect(monthLabel('2026-09', NOW)).toBe('September');
    expect(monthLabel('2025-09', NOW)).toBe('September 2025');
  });
});

// ------------------------------------------------------------------------------ the archetype

describe('archetype names are the Wrapped card\'s names', () => {
  test('every entry of wrapped.ARCHETYPE_DISPLAY is what archetypeDisplay says', () => {
    const src = py('analysis/wrapped.py');
    const block = /ARCHETYPE_DISPLAY: dict\[str, str\] = \{([\s\S]*?)\n\}/.exec(src)?.[1];
    expect(block).toBeDefined();
    const pairs = [...block!.matchAll(/"(\w+)": "([^"]+)"/g)].map((m) => [m[1]!, m[2]!] as const);
    expect(pairs.length).toBe(7);
    for (const [id, display] of pairs) expect({ id, display: archetypeDisplay(id) }).toEqual({ id, display });
  });
});

describe('where each bar came from', () => {
  /** Each rule's `source` expression in ARCHETYPE_RULES, by name. */
  function ruleSources(): Map<string, string> {
    const src = py('analysis/profile.py');
    const block = /ARCHETYPE_RULES: tuple\[dict, \.\.\.\] = \(([\s\S]*?)\n\)/.exec(src)?.[1] ?? '';
    const out = new Map<string, string>();
    for (const m of block.matchAll(/"name": "(\w+)"[\s\S]*?"source": ([^\n]+)/g)) out.set(m[1]!, m[2]!);
    return out;
  }

  test('the table covers exactly the rules profile.py has', () => {
    expect([...ruleSources().keys()].sort()).toEqual(Object.keys(THRESHOLD_SOURCE).sort());
    expect(Object.keys(THRESHOLD_SOURCE).sort()).toEqual([...REPORT_ENUMS.archetype].sort());
  });

  test('each row says what the Python source says, before and after the explainx relabel', () => {
    const sources = ruleSources();
    for (const [name, kind] of Object.entries(THRESHOLD_SOURCE)) {
      const s = sources.get(name) ?? '';
      if (kind === 'explainx_mock') expect({ name, ok: /explainx|EXPLAINX|PAXEL_UNMEASURED/.test(s) }).toEqual({ name, ok: true });
      if (kind === 'paxel_heavy_steerer') expect({ name, ok: /PAXEL/.test(s) && !/explainx|EXPLAINX/.test(s) }).toEqual({ name, ok: true });
      if (kind === 'judgement') expect({ name, ok: /JUDGEMENT CALL/.test(s) }).toEqual({ name, ok: true });
      if (kind === 'clock') expect({ name, ok: !/PAXEL|explainx|EXPLAINX|JUDGEMENT|MEASURED/.test(s) }).toEqual({ name, ok: true });
    }
  });

  test('a bar that was never measured says so wherever its number is shown', () => {
    const v = archetypeView(corpus(), null)!;
    expect(v.evidence[1]).toEqual({ value: '487', label: 'the bar, never measured' });
    expect(v.evidence[0]).toEqual({ value: '771.6', label: 'agent lines an hour' });
    expect(thresholdSentence(v.winner!)).toBe(
      'The bar, 487, comes from an explainx.ai mock of a Paxel report, which Paxel never published. It is not a measurement.',
    );
    expect(thresholdSentence({ name: 'skeptic', metric: 'steer_rate', threshold: 0.4 })).toContain('heavy steerer');
    expect(thresholdSentence({ name: 'night_owl', metric: 'night_share', threshold: 0.4 })).toBe(
      'The bar, 40%, is a share of the clock, chosen rather than measured.',
    );
  });
});

describe('archetypeView: one type for every page', () => {
  test("the Mac's answered card wins over the server's corpus, and says where it was scored", () => {
    const v = archetypeView(corpus(), report({ wrapped: { cards: [builderTypeCard()], prompts_with_text: 926, attended_sessions: 132 } }))!;
    expect(v.source).toBe('mac');
    expect(v.display).toBe('Quality guardian');
    // The winner's bar is not on the card; the server's rule table carries it.
    expect(v.winner?.threshold).toBe(3);
    expect(v.evidence[0]).toEqual({ value: '4.7', label: 'test runs an hour, at least' });
    expect(v.evidence[2]).toEqual({ value: '44%', label: 'confidence, over 155 sessions' });
    expect(sourceLine(v)).toBe('Scored on your Mac from 155 sessions.');
    // A runner up scored on the Mac never borrows the server's basis to decide whether it is a floor.
    expect(v.runnersUp[0]).toMatchObject({ name: 'velocity_machine', lowerBound: false, threshold: 487 });
    expect(v.line).toBe('The rule is test runs per active hour.');
    // With no server rule table the rule is named by its metric, and the bar it cannot know is left out.
    const alone = archetypeView(null, report({ wrapped: { cards: [builderTypeCard()], prompts_with_text: 926, attended_sessions: 132 } }))!;
    expect(alone.line).toBe('The rule is test runs an hour.');
    expect(alone.evidence).toEqual([
      { value: '4.7', label: 'test runs an hour, at least' },
      { value: '44%', label: 'confidence, over 155 sessions' },
    ]);
  });

  test("a refused card falls back to the server's type rather than showing none", () => {
    const card = builderTypeCard({ value_id: null, reason: 'below_session_floor', needed: 3, n: 2 });
    const v = archetypeView(corpus(), report({ wrapped: { cards: [card], prompts_with_text: 0, attended_sessions: 0 } }))!;
    expect(v.source).toBe('server');
    expect(v.display).toBe('Velocity machine');
  });

  test('the server type names its rule, its numbers and the rules it could not score', () => {
    const v = archetypeView(corpus(), null)!;
    expect(v.state).toBe('named');
    // The rule in words, and its numbers once, under it, as the Wrapped card says them (`profile._n`).
    expect(v.line).toBe('The rule is agent lines per active hour.');
    expect(v.evidence.map((e) => e.value)).toEqual(['771.6', '487', '80%']);
    for (const e of [v.line, sourceLine(v)]) expect(DASH.test(e)).toBe(false);
    expect(v.unscored.map((u) => u.rule.name)).toEqual(['architect', 'quality_guardian', 'skeptic']);
    expect(v.unscored.find((u) => u.rule.name === 'skeptic')?.reason).toBe('prompt text and interrupt counts are not stored server side');
    expect(sourceLine(v)).toBe('Scored on the server from 148 sessions. 3 of the 6 rules read what stays on your Mac and are not scored here.');
    expect(v.runnersUp.map((r) => runnerUpLine(r))).toEqual(['21% of active time at night, 52% of the way', '12% of active time without you, 24% of the way']);
  });

  test('no rule met its bar: Generalist, the nearest rule and how far, capped short of 100', () => {
    const c = corpus();
    c.archetype = { ...c.archetype, name: null, confidence: null, metric: null, value: null, threshold: null, rule: null, reason: 'no archetype rule met its threshold', runners_up: [] };
    c.archetype.scores = c.archetype.scores.map((s) => (s.name === 'velocity_machine' ? { ...s, value: 486.9, score: 0.4999 } : s));
    const v = archetypeView(c, null)!;
    expect(v.state).toBe('generalist');
    expect(v.display).toBe('Generalist');
    expect(v.winner?.name).toBe('velocity_machine');
    expect(v.line).toBe('No single pattern dominates. Closest is Velocity machine.');
    expect(v.evidence[2]).toEqual({ value: '99%', label: 'of the way to velocity machine' });
    expect(partOfTheWay({ value: 2.4, threshold: 3 })).toBe(80);
  });

  test('too few sessions is a refusal with its numbers, never a guessed type', () => {
    const c = corpus();
    c.sample = { ...c.sample, sessions: 1, enough_sessions: false };
    const v = archetypeView(c, null)!;
    expect(v.state).toBe('refused');
    expect(v.evidence).toEqual([]);
    expect(v.line).toBe('1 session so far, and a type needs 3.');
  });

  test('a runner up from the Mac that counts test runs is said as the floor it is', () => {
    const card = builderTypeCard({
      value_id: 'velocity_machine',
      extras: {
        confidence: 0.5,
        metric: 'code_velocity',
        metric_value: 764.1,
        metric_lower_bound: false,
        runners_up: [{ name: 'quality_guardian', metric: 'test_runs_per_hour', value: 2.9, threshold: 3, score: 0.483 }],
      },
    });
    const v = archetypeView(null, report({ wrapped: { cards: [card], prompts_with_text: 0, attended_sessions: 0 } }))!;
    expect(runnerUpLine(v.runnersUp[0]!)).toBe('at least 2.9 test runs an hour, 97% of the way');
  });

  test('a runner up that cleared its own bar says so', () => {
    expect(runnerUpLine({ name: 'director', display: 'Director', metric: 'autonomy_score', value: 0.6, threshold: 0.5, score: 0.6, rule: null, lowerBound: false })).toBe(
      '60% of active time without you, past its bar',
    );
  });

  test('nothing sent is nothing shown', () => {
    expect(archetypeView(null, null)).toBeNull();
  });
});

// ------------------------------------------------------------------------------ dimensions

describe('the five dimensions', () => {
  test('steady is the trends.py bar, read from trends.py', () => {
    const m = /^MIN_MOVE = ([\d.]+)$/m.exec(py('analysis/trends.py'));
    expect(Number(m?.[1])).toBe(STEADY_SHARE);
  });

  test("the older half's mean comes back out of the server's three numbers", () => {
    // 10 sessions: 5 recent at 70, 5 older at 60.
    expect(olderHalfMean(65, 10, 10)).toBeCloseTo(60, 9);
    // 5 sessions: 2 recent at 80, 3 older at 50 (the median goes to the older half).
    expect(olderHalfMean(62, 30, 5)).toBeCloseTo(50, 9);
  });

  test('a move is up or down in points, or steady under the bar, and never an arrow', () => {
    expect(trendOf(65, 12, 10)).toEqual({ direction: 'up', words: 'up 12 points' });
    expect(trendOf(40, -10, 10)).toEqual({ direction: 'down', words: 'down 10 points' });
    expect(trendOf(65, 4.1, 10)).toEqual({ direction: 'steady', words: 'steady' });
    expect(trendOf(65, 0, 10)).toEqual({ direction: 'steady', words: 'steady' });
    expect(trendOf(65, null, 1)).toEqual({ direction: null, words: 'no trend yet' });
    expect(trendOf(5, 1, 2).words).toBe('up 1 point');
  });

  test('spec order, only what the server scored, whole numbers, the highest named', () => {
    const views = dimensionViews(
      bp({ planning: { mean: 48.26, sessions: 10, trend: null }, steering: { mean: 71.5, sessions: 10, trend: 12 }, execution: { mean: 71.5, sessions: 10, trend: -2 } }),
    );
    expect(views.map((v) => v.dimension)).toEqual(['steering', 'execution', 'planning']);
    expect(views.map((v) => v.mean)).toEqual([72, 72, 48]);
    expect(topDimension(views)?.dimension).toBe('steering');
    expect(dimensionViews(null)).toEqual([]);
  });

  test('how many are analysed against the floor, in words, with no digit left alone (FOUND IN THE CAPTURE, 2026-09-14)', () => {
    expect(dimensionsPending(0, 3)).toBe('No session has been analysed yet, and it takes 3.');
    expect(dimensionsPending(1, 3)).toBe('1 of the 3 it takes has been analysed so far.');
    expect(dimensionsPending(2, 3)).toBe('2 of the 3 it takes have been analysed so far.');
    expect(dimensionsPending(3, 3)).toBe('3 sessions have been analysed.');
    for (const k of [0, 1, 2]) expect(dimensionsPending(k, 3)).not.toMatch(/^\d+ of \d+ analysed sessions/);
  });

  test("the model's per session type is said with its article and its share", () => {
    expect(modalArchetypeLine(bp({}))).toBe('Read one session at a time, the model most often called you an architect, in 60% of the 10 sessions that had a type.');
  });
});

// ------------------------------------------------------------------------------ money

describe('money', () => {
  test("the Mac's report: the dollar with its label and its read day, tokens beside it, lines like a diff", () => {
    const v = moneyView(corpus(), report({ money: money() }), NOW)!;
    expect(v.source).toBe('report');
    expect({ usd: v.usd, refusal: v.refusal, label: v.label, stale: v.stale }).toEqual({
      usd: 1873.42,
      refusal: null,
      label: 'at API list prices, read Sep 6',
      stale: false,
    });
    expect(v.tokens).toEqual({ value: '4,112.2M', label: 'tokens, 95% cache reads' });
    expect({ added: v.added, removed: v.removed, refusal: v.linesRefusal }).toEqual({ added: '+64,680', removed: '-9,021', refusal: null });
    expect(v.perHour).toBe('$22.10 an active hour');
    expect(v.models).toEqual([
      { key: 'claude-opus-4-8', name: 'Opus 4.8', usd: 1502.2, meta: '97 sessions · 9.1M output tokens · $6.83 a commit', perCommit: 6.83 },
      { key: 'claude-sonnet-4-6', name: 'Sonnet 4.6', usd: 371.22, meta: '55 sessions · 792k output tokens', perCommit: null },
    ]);
    // The Money page's words (`copy/money.noCommitShareOf`), never "of the spend".
    expect(v.sentences[0]).toBe('$19.80 on sessions that ended with no commit, 1% of every dollar at API list prices.');
    expect(moneyRowLine(v)).toBe('$1,873 at API list prices');
  });

  test('prices past their stale day say they may have moved', () => {
    const v = moneyView(null, report({ money: money({ basis: 'stale_prices' }) }), NOW)!;
    expect(v.label).toBe('at API list prices, read Sep 6, which may have moved since');
    expect(v.stale).toBe(true);
  });

  test('a refused price is a sentence from its code, never $0', () => {
    const none = moneyView(null, report({ money: money({ usd: null, basis: null, reason: 'tokens_not_reported', priced_sessions: 0, tokens: null, token_sessions: 0 }) }), NOW)!;
    expect(none.usd).toBeNull();
    // src/copy's words for the code, said as a sentence: capitalised, one full stop, no number.
    const said = moneyRefusal(money({ usd: null, reason: 'tokens_not_reported' }))!;
    expect(none.refusal).toBe(`${said.charAt(0).toUpperCase()}${said.slice(1).replace(/\.$/, '')}.`);
    expect(/\$/.test(none.refusal!)).toBe(false);
    expect(none.tokens).toBeNull();
    expect(none.sentences).toEqual([]);
    const unknown = moneyView(null, report({ money: money({ usd: null, basis: null, reason: 'model_not_in_price_table', unpriced_sessions: 3 }) }), NOW)!;
    expect(unknown.refusal).toMatch(/^3 sessions .*\.$/);
    expect(moneyRowLine(none)).toBe(none.refusal);
  });

  test('lines no session counted are said, never drawn as +0', () => {
    const v = moneyView(null, report({ money: money({ lines_added: null, lines_removed: null }) }), NOW)!;
    expect({ added: v.added, removed: v.removed }).toEqual({ added: null, removed: null });
    expect(v.linesRefusal).toBe('No session carries a line count.');
  });

  test('masked, no dollar amount survives anywhere on the page, and tokens and lines stay', () => {
    const burn = { share: 0.029, barren_tokens: 120_070_737, tokens: 4_168_469_723, unreadable_tokens: 1_192_481_138, sessions: 156, needed: null, reason: null, causes: [] };
    const v = moneyView(corpus(), report({ money: money(), burn }), NOW)!;
    const everything = [v.perHour ?? '', ...v.models.map((m) => m.meta), ...v.sentences].map(maskDollars).join('\n');
    expect(/\$\d/.test(everything)).toBe(false);
    expect(everything).toContain(MASKED_DOLLARS);
    expect(v.tokens?.value).toBe('4,112.2M');
    // The You tab's money door carries the digits apart from the sign, so the mask can hide them
    // without a dollar ever counting up on screen.
    const d = youTab(builder({ report: report({ money: money() }) }), null, NOW).doors.find((x) => x.key === 'money')!;
    expect({ final: d.num?.final, digits: d.digits?.final }).toEqual({ final: '$1,873', digits: '1,873' });
    expect(maskDollars(d.num!.final)).toBe(MASKED_DOLLARS);
  });

  test('the barren share is the profile fact, a floor unless every token was judged, with the rest said beside it', () => {
    const burn = { share: 0.029, barren_tokens: 120_070_737, tokens: 4_168_469_723, unreadable_tokens: 1_192_481_138, sessions: 156, needed: null, reason: null, causes: [] };
    expect(moneyView(null, report({ money: money(), burn }), NOW)!.sentences.slice(1)).toEqual([
      'At least 3% of your tokens went into stretches where nothing was written.',
      '29% more went into stretches the transcripts cannot judge either way.',
    ]);
    const judged = moneyView(null, report({ money: money(), burn: { ...burn, unreadable_tokens: 0 } }), NOW)!;
    expect(judged.sentences.slice(1)).toEqual(['3% of your tokens went into stretches where nothing was written.']);
    const tiny = moneyView(null, report({ money: money(), burn: { ...burn, barren_tokens: 4, tokens: 1000, unreadable_tokens: 10, share: 0.004 } }), NOW)!;
    expect(tiny.sentences[1]).toBe('Under 1% of your tokens went into stretches where nothing was written.');
    const refused = moneyView(null, report({ money: money(), burn: { ...burn, share: null, barren_tokens: null, tokens: null, unreadable_tokens: null, sessions: 2, needed: 3, reason: 'below_session_floor', causes: null } }), NOW)!;
    expect(refused.sentences.slice(1)).toEqual(['2 sessions with token counts, 3 needed.']);
  });

  test("with no report the server's corpus answers through the same renderers", () => {
    const v = moneyView(corpus(), null, NOW)!;
    expect(v.source).toBe('server');
    // The server's refused spend carries the report's code, so the report's words say it.
    expect(v.refusal).toBe(moneyView(null, report({ money: money({ usd: null, reason: 'tokens_not_reported' }) }), NOW)!.refusal);
    expect(v.label).toBe('at API list prices');
    expect(v.tokens).toEqual({ value: '8.5M', label: 'output tokens' });
    expect({ added: v.added, removed: v.removed, note: v.linesNote }).toEqual({
      added: '+64,652',
      removed: null,
      note: 'Lines removed are not counted by this server yet.',
    });
    expect(v.sentences).toEqual(['Sessions reported token counts, but none was split into segments, which needs the transcripts.']);
  });

  test("the server's metrics map field for field into the report's shapes, and nothing is computed", () => {
    const c = corpus();
    c.metrics.spend_usd = { value: 12.34, unit: 'US dollars at API list prices', n: 5, basis: 'anthropic_api_list_price', reason: null, prices_read_on: '2026-09-06', unpriced_sessions: 1 };
    c.metrics.spend_without_a_commit_usd = { value: null, unit: 'x', n: 5, basis: 'anthropic_api_list_price', reason: '5 priced sessions with git commit counts, 8 needed' };
    const m = corpusMoney(c)!;
    expect({ usd: m.usd, basis: m.basis, reason: m.reason, priced: m.priced_sessions, unpriced: m.unpriced_sessions }).toEqual({
      usd: 12.34,
      basis: 'anthropic_api_list_price',
      reason: null,
      priced: 5,
      unpriced: 1,
    });
    const v = moneyView(c, null, NOW)!;
    expect(v.label).toBe('at API list prices, read Sep 6');
    // Below its floor the server says how far off it is; the report would only have sent null.
    expect(v.sentences[0]).toBe('5 priced sessions with git commit counts, 8 needed.');
    expect(v.sentences[1]).toBe('1 session with a model the price table does not know is left out.');
    const b = corpusBurn({ value: null, unit: 'share', n: 2, basis: 'x', reason: 'r', code: 'below_session_floor', needed: 3, barren_tokens: 10, tokens: 100 })!;
    expect({ reason: b.reason, needed: b.needed, share: b.share }).toEqual({ reason: 'below_session_floor', needed: 3, share: null });
  });

  test("the server's model rows are read field by field, and a malformed one is dropped", () => {
    const c = corpus() as CorpusProfile & { model_costs: unknown[] };
    c.model_costs = [
      { model: 'Opus 5', model_id: 'claude-opus-5', usd: 12.3, output_tokens: 1000, sessions: 2, commits: 1, sessions_dominated: 1, usd_per_commit: 12.3 },
      { model: 'Opus 4.8', usd: 'lots', output_tokens: 1, sessions: 1 },
      null,
    ];
    expect(corpusModelCosts(c)).toEqual([{ model: 'Opus 5', model_id: 'claude-opus-5', usd: 12.3, output_tokens: 1000, sessions: 2, usd_per_commit: 12.3 }]);
  });

  test('no sentence scolds and none carries a dash', () => {
    const views = [
      moneyView(corpus(), report({ money: money() }), NOW)!,
      moneyView(corpus(), null, NOW)!,
      moneyView(null, report({ money: money({ usd_without_a_commit: null, share_without_a_commit: null }), burn: { share: null, barren_tokens: null, tokens: null, unreadable_tokens: null, sessions: 2, needed: 3, reason: 'below_session_floor', causes: null } }), NOW)!,
    ];
    const all = views.flatMap((v) => [v.label, v.refusal ?? '', v.linesNote ?? '', ...v.sentences, ...v.models.map((m) => m.meta)]);
    for (const s of all) {
      expect({ s, scold: /wast|burn(ed|t)|squander|\bonly\b|should|too much/i.test(s), dash: DASH.test(s) }).toEqual({ s, scold: false, dash: false });
    }
    expect(views[2]!.sentences[0]).toBe('Too few priced sessions have a commit count yet to say what went to sessions without one.');
  });
});

// ------------------------------------------------------------------------------ glossary

describe('the glossary', () => {
  test('newest month first, terms in the order they were met, each with its catalog words and first day', () => {
    const v = glossaryView(vocab(), NOW)!;
    expect(v.months.map((m) => m.label)).toEqual(['September', 'August']);
    expect(v.months[1]!.terms.map((t) => t.id)).toEqual(['commit', 'test_suite']);
    expect(v.months[1]!.terms[0]).toEqual({ id: 'commit', ...term('commit')!, firstSeen: 'Aug 12' });
    expect(v.months[1]!.terms[0]!.definition).toBe('A saved snapshot of your code with a note saying what changed.');
    expect(v.summary).toBe('3 terms from 155 sessions.');
    expect(v.locked).toBe('71 more to find.');
    expect(v.cutNote).toBe('312 of 9,085 shell commands were too long to be read whole, so a term may have come up unseen.');
    expect(glossaryRowLine(v)).toBe('3 terms so far, 71 more to find');
  });

  test('a term this build has no words for renders nothing and is not counted as found', () => {
    const v = glossaryView(vocab({ terms: [...vocab().terms, { id: 'not_a_term' as never, count: 1, sessions: 1, first_seen: '2026-09-10T10:00:00Z' }] }), NOW)!;
    expect(v.found).toBe(3);
    expect(v.months.flatMap((m) => m.terms.map((t) => t.id))).not.toContain('not_a_term');
  });

  test('a refusal has no count of what is left, and says why in the engine\'s words', () => {
    const refused = glossaryView(vocab({ terms: [], locked: null, reason: 'no_events', sessions: 0 }), NOW)!;
    expect(refused.refusal).toMatch(/^No session had any events to read, so no terms can be found yet\.$/);
    expect(refused.locked).toBeNull();
    expect(glossaryRowLine(refused)).toBe('nothing to read yet');
  });

  test('no game words anywhere a person reads on the page', () => {
    const src = readFileSync(join(MOBILE, 'app/you/glossary.tsx'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const strings = [...src.matchAll(/(['"`])((?:(?!\1).)*)\1/g)].map((m) => m[2]!).concat([...src.matchAll(/>([^<>{}]+)</g)].map((m) => m[1]!));
    const v = glossaryView(vocab(), NOW)!;
    const said = [v.summary, v.locked ?? '', v.cutNote ?? '', ...v.months.map((m) => m.label)];
    for (const x of [...strings, ...said]) expect({ x, game: /\bunlock|\blevel|\bxp\b|\bbadge|\bscore|\bearn/i.test(x) }).toEqual({ x, game: false });
  });
});

// ------------------------------------------------------------------------------ stack

describe('the stack', () => {
  test('grouped in catalog order, most used first, each with its catalog name and its sessions on the right', () => {
    const v = stackView(stack(), NOW)!;
    expect(v.groups.map((g) => g.label)).toEqual(['languages', 'frameworks', 'databases']);
    expect(v.groups[0]!.items.map((i) => i.id)).toEqual(['typescript', 'python']);
    expect(v.groups[0]!.items[0]).toEqual({ id: 'typescript', name: stackName('typescript')!, value: '150 sessions', meta: 'first used Aug 12', sessions: 150 });
    expect(v.groups[0]!.items[0]!.name).toBe('TypeScript');
    expect(v.summary).toBe('4 things across 3 categories, from 155 sessions and 38 dependency names.');
    expect(stackRowLine(v)).toBe('4 things across 3 categories');
  });

  test('an item only a manifest names says so, and never "0 sessions"', () => {
    const react = stackView(stack(), NOW)!.groups[1]!.items[0]!;
    expect({ value: react.value, meta: react.meta }).toEqual({ value: null, meta: 'named in a manifest, not seen in a session' });
  });

  test('an item this build has no name for renders nothing and is not counted', () => {
    const v = stackView(stack({ items: [...stack().items, { id: 'not_an_item' as never, category: 'service', evidence: 'command', sessions: 3, first_seen: null }] }), NOW)!;
    expect(v.total).toBe(4);
    expect(v.groups.map((g) => g.category)).not.toContain('service');
  });

  test('every category the spec has is labelled, lower case', () => {
    expect(Object.keys(STACK_CATEGORY_LABEL)).toEqual([...REPORT_ENUMS.stack_category]);
    for (const l of Object.values(STACK_CATEGORY_LABEL)) expect(l).toBe(l.toLowerCase());
  });

  test("a refusal is a sentence in the engine's words", () => {
    expect(stackView(stack({ items: [], reason: 'no_evidence', sessions: 12, manifests: 0 }), NOW)!.refusal).toMatch(/^No session events and no manifest names to read, so nothing is named yet\.$/);
  });
});

// ------------------------------------------------------------------------------ the tab

describe('the You tab', () => {
  test('each door states a real number when its page has one', () => {
    const b = builder({
      builder_profile: bp({ steering: { mean: 62, sessions: 10, trend: 1 }, execution: { mean: 71, sessions: 10, trend: 1 } }),
      report: report({ money: money(), vocab: vocab(), stack: stack() }),
    });
    const doors = youTab(b, null, NOW).doors;
    expect(doors.map((d) => d.href)).toEqual(['/analysis', '/wrapped', '/you/money', '/you/dimensions', '/you/glossary', '/you/stack']);
    const byKey = Object.fromEntries(doors.map((d) => [d.key, d]));
    expect([byKey.money!.num?.final, byKey.money!.caption]).toEqual(['$1,873', 'what the tokens would cost at API list prices']);
    expect(byKey.money!.note).toBe('On a subscription you pay your plan, not this.');
    expect([byKey.dimensions!.num?.final, byKey.dimensions!.caption]).toEqual(['71', 'execution, the highest of 2, out of 100']);
    expect([byKey.glossary!.num?.final, byKey.glossary!.caption, byKey.glossary!.note]).toEqual(['3', 'of 74 terms found', '71 more to find.']);
    expect([byKey.stack!.num?.final, byKey.stack!.caption]).toEqual(['4', 'things across 3 categories']);
    for (const d of doors) {
      for (const s of [d.caption, d.note, d.refusal]) if (s) expect({ s, dash: DASH.test(s) }).toEqual({ s, dash: false });
    }
  });

  test('before the Mac sends a block, the door says where it comes from instead of a zero', () => {
    const doors = youTab(builder(), null, NOW).doors;
    const byKey = Object.fromEntries(doors.map((d) => [d.key, d]));
    expect(byKey.dimensions!.num).toBeNull();
    expect(byKey.dimensions!.refusal).toBe('Each session is scored on five axes once your Mac analyses it. No session has been analysed yet, and it takes 3.');
    expect(byKey.money!.num).toBeNull();
    expect(byKey.money!.refusal).toBe(moneyView(corpus(), null, NOW)!.refusal);
    expect(byKey.glossary!.refusal).toBe('Terms arrive with the report from your Mac.');
    expect(byKey.stack!.refusal).toBe('The stack arrives with the report from your Mac.');
    expect(byKey.wrapped!.refusal).toBe('The fifteen questions arrive with the report from your Mac.');
    for (const d of doors) if (d.num === null) expect(d.refusal).toMatch(/^[A-Z0-9].*\.$/);
  });

  test('the Wrapped door counts the answered cards and asks the first question', () => {
    const cards = [builderTypeCard(), builderTypeCard({ id: 'shipped', reason: 'no_line_counts', value_id: null })];
    const d = youTab(builder({ report: report({ wrapped: { cards, prompts_with_text: 0, attended_sessions: 0 } }) }), null, NOW).doors.find((x) => x.key === 'wrapped')!;
    expect([d.num?.final, d.caption]).toEqual(['1', 'of 2 questions answered']);
    expect(d.note).toMatch(/Quality guardian\.$/);
  });
});

// ------------------------------------------------------------------------------ load states

describe('the five states', () => {
  test('signed out first, then a saved page, then the error, then loading', () => {
    expect(resolveLoad({ data: 1, savedAt: 5, signedIn: false, error: null })).toEqual({ kind: 'signedOut' });
    expect(resolveLoad({ data: 1, savedAt: 5, signedIn: true, error: null })).toEqual({ kind: 'ready', data: 1, stale: null });
    expect(resolveLoad({ data: 1, savedAt: 5, signedIn: true, error: 'down' })).toEqual({ kind: 'ready', data: 1, stale: { savedAt: 5, message: 'down' } });
    expect(resolveLoad({ data: null, savedAt: null, signedIn: true, error: 'down' })).toEqual({ kind: 'error', message: 'down' });
    expect(resolveLoad({ data: null, savedAt: null, signedIn: null, error: null })).toEqual({ kind: 'loading' });
  });

  test('the stale line names what failed and when the page on screen was saved', () => {
    const at = new Date(2026, 8, 13, 9, 41).getTime();
    expect(staleLine({ savedAt: at, message: 'Builda is not reachable right now.' }, NOW)).toBe(
      'Builda is not reachable right now. Showing what was saved at 9:41am.',
    );
    expect(staleLine({ savedAt: new Date(2026, 7, 29, 20, 0).getTime(), message: 'Timed out' }, NOW)).toBe('Timed out. Showing what was saved on Aug 29.');
    expect(staleLine({ savedAt: null, message: 'Timed out' }, NOW)).toBe('Timed out. Showing what was saved last.');
    expect(parseSavedAt('abc')).toBeNull();
    expect(parseSavedAt('1757750000000')).toBe(1757750000000);
  });
});

// ------------------------------------------------------------------------------ keys and copy

describe('keys and the catalog seam', () => {
  test("the saved profile's key is the one onboarding reads", () => {
    expect(BUILDER_KEY).toBe(BUILDER_PROFILE_KEY);
  });

  test('the mask outlives a sign out and the reveal does not', () => {
    expect(MONEY_MASK_KEY.startsWith('device.')).toBe(true);
    expect(REVEALED_KEY.startsWith('profile.')).toBe(true);
  });

  test('the pages read catalog words from src/copy, and retype none of them', () => {
    // The glossary's 74 terms and the stack's 80 names are generated from analysis/vocab.py.
    // A You module that spelled one out would be a second copy of a catalog.
    for (const f of ['src/you/glossary.ts', 'src/you/stack.ts', 'src/you/archetype.ts', 'src/you/chapters.ts']) {
      const src = readFileSync(join(MOBILE, f), 'utf8');
      expect({ f, imports: /from '\.\.\/copy\//.test(src), spells: /A saved snapshot|TypeScript|Which kind of builder|Velocity machine'/.test(src) }).toEqual({
        f,
        imports: true,
        spells: false,
      });
    }
    expect(existsSync(join(MOBILE, 'src/you/copy.ts'))).toBe(false);
  });
});

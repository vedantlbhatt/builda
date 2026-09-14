/**
 * The You tab and its four pages as chapters (`src/you/chapters.ts`), held without a renderer on
 * the real report and profile the analysis page was designed against
 * (`src/insights/fixtures/report-2026-09-13.json`).
 *
 * What these pages may never do: say one number two ways (the You pages and the analysis page
 * read the same loaders), land a count on a string the copy helpers would not write, draw a
 * refused number as a zero, say "you spent", or put a dash in front of a person.
 */
import { describe, expect, test } from 'bun:test';

import type { BuilderProfile, BuilderProfileResponse, Profile } from '../src/data/api';
import fixture from '../src/insights/fixtures/report-2026-09-13.json';
import { formatWith, type NumSpec } from '../src/insights/format';
import { analysisModel, coverageOf, isRefused, NO_REPORT, readSpan } from '../src/insights/model';
import { dayOf } from '../src/you/numbers';
import { HUE_NAMES, type HueName } from '../src/insights/palette';
import { hasDash } from '../src/copy/plain';
import {
  dimensionsPage,
  DOOR_ORDER,
  doorHues,
  glossaryPage,
  moneyPage,
  stackPage,
  toolsMix,
  youTab,
} from '../src/you/chapters';

const B = fixture.builder as unknown as BuilderProfileResponse;
const P = fixture.profile as unknown as Profile;
const NOW = Date.parse('2026-09-13T14:00:00Z');
const NO_REPORT_B: BuilderProfileResponse = { ...B, report: null };

/** Every string anywhere in a value. */
function strings(x: unknown, out: string[] = []): string[] {
  if (typeof x === 'string') out.push(x);
  else if (Array.isArray(x)) for (const y of x) strings(y, out);
  else if (x && typeof x === 'object') for (const y of Object.values(x)) strings(y, out);
  return out;
}

/** Every animated number anywhere in a value. */
function nums(x: unknown, out: NumSpec[] = []): NumSpec[] {
  if (!x || typeof x !== 'object') return out;
  if (Array.isArray(x)) {
    for (const y of x) nums(y, out);
    return out;
  }
  const o = x as Record<string, unknown>;
  if ('fmt' in o && 'final' in o && 'value' in o) {
    out.push(o as unknown as NumSpec);
    return out;
  }
  for (const y of Object.values(o)) nums(y, out);
  return out;
}

function bp(dimensions: BuilderProfile['dimensions']): BuilderProfile {
  return {
    window_days: 90,
    sessions_analysed: 12,
    confidence_mean: 0.7,
    dimensions,
    archetype: { modal: 'architect', share: 0.6, with_archetype: 10, distribution: {} },
    build_style: {},
    prompting: { specificity_mean: null, correction_share_mean: null, question_share_mean: null, tone_distribution: {} },
    tags: [],
    decision_patterns: [],
  };
}

const FIVE = bp({
  steering: { mean: 62, sessions: 12, trend: 1 },
  execution: { mean: 71.4, sessions: 12, trend: 12 },
  engineering: { mean: 58, sessions: 12, trend: -12 },
  product_instinct: { mean: 44, sessions: 12, trend: null },
  planning: { mean: 39, sessions: 12, trend: 0 },
});

/** The fixture report's real stretch, in this machine's zone (`dayOf`, the Builda day). */
const FIXTURE_SPAN = `${dayOf('2026-08-12T00:44:30Z', NOW)} to ${dayOf('2026-09-13T07:06:05Z', NOW)}`;

const EVERY_PAGE = (b: BuilderProfileResponse) => [moneyPage(b, NOW), youTab(b, P, NOW), dimensionsPage(b), glossaryPage(b, NOW), stackPage(b, NOW)];

// ------------------------------------------------------------------ money

describe('a window is claimed only when the numbers sit inside it', () => {
  // FOUND IN REVIEW (2026-09-13): the report was computed over all history and three lines
  // said "the last 30 days" over it. MEASURED on the committed report (first sitting Aug 12
  // 00:44 UTC, made Sep 13 12:34 UTC, 33 dates, window 30), before the fix: "The last 30 days,
  // as your Mac read them ... Aug 11 to Sep 13", "The last 30 days, as your Mac priced them",
  // "days with a session, of the last 30". After: the stretch it read, on all three.
  const made = '2026-09-13T12:00:00Z';
  const at = (daysAgo: number) => new Date(Date.parse(made) - daysAgo * 86_400_000).toISOString();
  const report = (firstDaysAgo: number, spans: number) => ({
    ...B.report!,
    generated_at: made,
    window_days: 30,
    coverage: { window_days: 30, spans_days: spans, active_days: 12, sessions: 40, first_at: at(firstDaysAgo), last_at: at(0.2) },
  });

  test('inside the window: "the last 30 days" on every line that says it', () => {
    const b = { ...B, report: report(29.9, 31) };
    expect(readSpan(b.report, NOW)).toMatchObject({ window: true, phrase: 'The last 30 days' });
    expect(coverageOf(b, NOW).line).toStartWith('The last 30 days, as your Mac read them: 40 sessions on 12 days, ');
    // 31 dates is the window, both ends counted: nothing to caveat.
    expect(coverageOf(b, NOW).caveat).toBeNull();
    expect(moneyPage(b, NOW)!.scope).toStartWith('The last 30 days, as your Mac priced them:');
    expect(youTab(b, P, NOW).doors[0]!.caption).toBe('days with a session, of the last 30');
  });

  test('read over more than the window: the stretch it read, and the caveat says both numbers', () => {
    const b = { ...B, report: report(33, 34) };
    const span = `${dayOf(at(33), NOW)} to ${dayOf(at(0.2), NOW)}`;
    expect(readSpan(b.report, NOW)).toMatchObject({ window: false, phrase: span });
    expect(coverageOf(b, NOW).line).toBe(`${span}, as your Mac read them: 40 sessions on 12 days.`);
    expect(coverageOf(b, NOW).caveat).toBe('30 days asked for; these numbers span 34 days.');
    expect(moneyPage(b, NOW)!.scope).toBe(`${span}, as your Mac priced them: ${moneyPage(b, NOW)!.scope!.split(': ')[1]}`);
    expect(moneyPage(b, NOW)!.scope).not.toContain('last 30');
    expect(youTab(b, P, NOW).doors[0]!.caption).toBe(`days with a session, ${span}`);
    for (const page of EVERY_PAGE(b)) expect(JSON.stringify(page)).not.toContain('last 30');
  });
});

describe('the money page', () => {
  const m = moneyPage(B, NOW)!;

  test('the dollar is the analysis page own, its sign apart, said with the day the prices were read', () => {
    if (isRefused(m.hero)) throw new Error('the fixture is priced');
    const analysis = analysisModel(B, P, NOW).money.body;
    if (isRefused(analysis)) throw new Error('the fixture is priced');
    expect(m.hero.usd.final).toBe(analysis.usd.final);
    expect(m.hero.usd.final).toBe('$2,952');
    expect(m.hero.digits.final).toBe('2,952');
    expect(m.hero.read).toBe('Prices read Sep 6.');
    // The committed report was built over ALL history (its first sitting 2026-08-12 00:44 UTC,
    // 33 dates, under `window_days: 30`), so the page says the stretch it read, never the window.
    // 157 priced of the 158 the Mac read (the count the You tab shows): the one with no token
    // counts is said, not left for a reader to notice.
    expect(m.scope).toBe(`${FIXTURE_SPAN}, as your Mac priced them: 157 of the 158 sessions it read. 1 session reported no token counts, so there was nothing to price.`);
  });

  test('what it bought and what it wrote: tokens, the hour, lines added in green and removed in red', () => {
    expect(m.bought.map((r) => [r.key, r.num.final, r.label, r.dollars])).toEqual([
      ['tokens', '4,170.5M', 'tokens, 99% cache reads', false],
      ['hour', '$34.65', 'an active hour, at the same prices', true],
    ]);
    if (isRefused(m.lines)) throw new Error('the fixture counts lines');
    expect(m.lines.rows.map((r) => [r.num.final, r.tone])).toEqual([
      ['+50,177', 'add'],
      ['-1,941', 'del'],
    ]);
    expect(m.lines.addedShare).toBeCloseTo(50177 / (50177 + 1941), 6);
    expect(m.buckets.map((x) => x.key)).toEqual(['cache_read', 'cache_write', 'output', 'input']);
  });

  test('the models, most first, each with its share of the ring; a share under 1% is words, not a count', () => {
    // Parts of the $2,952 hero, apportioned so they add up to it: $10.98 alone would read $2,951.98.
    expect(m.models.map((x) => [x.name, x.num.final, x.shareText])).toEqual([
      ['Opus 5', '$2,484', '84%'],
      ['Fable 5', '$457', '15%'],
      ['Fable 5.1', '$11', 'under 1%'],
    ]);
    expect(m.models.reduce((s, x) => s + x.num.value, 0)).toBe(2952);
    expect(m.models[0]!.shareNum?.final).toBe('84%');
    expect(m.models[2]!.shareNum).toBeNull();
    expect(m.modelsNote).toMatch(/^Dollars a commit are counted over the sessions a model wrote most of/);
  });

  test('where it went: the spend with no commit, its share, and the burn, never scolding', () => {
    const w = m.without;
    if (!w || isRefused(w)) throw new Error('the fixture has a spend without a commit');
    // In the flow's terms, never "of the spend": every priced session here had a commit count.
    expect([w.usd.final, w.digits.final, w.rest, w.share]).toEqual(['$657', '657', 'on sessions that ended with no commit, 22% of every dollar at API list prices', 0.223]);
    const burn = m.burn;
    if (!burn || isRefused(burn)) throw new Error('the fixture has a burn block');
    expect(burn.line).toBe('At least 3% of your tokens went into stretches where nothing was written.');
    for (const s of strings(m)) expect({ s, scold: /wast|burn(ed|t)|squander|\bonly\b|should|too much/i.test(s) }).toEqual({ s, scold: false });
  });

  test('a refused price is a sentence with no figure, and nothing under it pretends to be priced', () => {
    const money = { ...B.report!.money!, usd: null, basis: null, reason: 'tokens_not_reported' as const, priced_sessions: 0 };
    const r = moneyPage({ ...B, report: { ...B.report!, money } }, NOW)!;
    expect(isRefused(r.hero)).toBe(true);
    expect(isRefused(r.hero) && r.hero.refusal).toBe('No session reported token counts, so there is nothing to price.');
    expect(r.scope).toBeNull();
    expect(r.without).toBeNull();
    expect(nums(r.hero)).toEqual([]);
  });

  test("with no report the server's corpus answers, and a refused server spend is still a sentence", () => {
    const r = moneyPage(NO_REPORT_B, NOW);
    if (!r) return; // a corpus without a spend metric has no money view at all, which the page says
    for (const s of strings(r)) expect(s.toLowerCase()).not.toContain('you spent');
    if (isRefused(r.hero)) expect(r.hero.refusal).toMatch(/^[A-Z0-9].*\.$/);
  });
});

// ------------------------------------------------------------------ the tab

describe('the You tab', () => {
  const y = youTab(B, P, NOW);

  test('the hero is the analysis hero: the Mac type and its three numbers', () => {
    const a = analysisModel(B, P, NOW).hero;
    expect(y.hero.name).toBe(a.name);
    expect(y.hero.ledger.map((r) => r.num.final)).toEqual(['74.5', '158', '50,177']);
    expect(y.source).toMatch(/^Scored on your Mac from 158 sessions\./);
    expect(y.empty).toBe(false);
  });

  test('six doors in order, each with one real number or a sentence saying why not', () => {
    expect(y.doors.map((d) => d.key)).toEqual([...DOOR_ORDER]);
    const said = Object.fromEntries(y.doors.map((d) => [d.key, [d.num?.final ?? null, d.caption]]));
    expect(said).toEqual({
      analysis: ['27', `days with a session, ${FIXTURE_SPAN}`],
      wrapped: ['14', 'of 15 questions answered'],
      money: ['$2,952', 'what the tokens would cost at API list prices'],
      dimensions: [null, null],
      glossary: ['6', 'of 74 terms found'],
      stack: ['12', 'things across 2 categories'],
    });
    const money = y.doors.find((d) => d.key === 'money')!;
    expect(money.digits?.final).toBe('2,952');
    expect(money.note).toBe('On a subscription you pay your plan, not this.');
    expect(y.doors.find((d) => d.key === 'dimensions')!.refusal).toBe(
      'Each session is scored on five axes once your Mac analyses it. No session has been analysed yet, and it takes 3.',
    );
    expect(y.collection).toEqual({ found: 6, catalog: 74 });
  });

  test('no sessions anywhere is an empty page, not a page of zeros', () => {
    const empty = youTab({ ...B, report: null, corpus: { ...B.corpus!, sample: { ...B.corpus!.sample, sessions: 0 } } }, { ...P, totals: { ...P.totals, sessions: 0 } }, NOW);
    expect(empty.empty).toBe(true);
  });

  test('no door wears the hero hue or amber, and neighbours never share one, for every creature', () => {
    for (const hero of HUE_NAMES) {
      const hues = doorHues(hero);
      const order = DOOR_ORDER.map((k) => hues[k]);
      for (const h of order) expect({ hero, h, clash: h === hero || h === 'amber' }).toEqual({ hero, h, clash: false });
      for (let i = 1; i < order.length; i++) expect(order[i]).not.toBe(order[i - 1]);
      expect(new Set<HueName>(order).size).toBe(order.length);
    }
  });
});

// ------------------------------------------------------------------ dimensions

describe('the dimensions page', () => {
  test('no analysed sessions: the refusal carries the page with the count needed, and no bar is drawn', () => {
    const d = dimensionsPage(B);
    expect(isRefused(d.body)).toBe(true);
    if (!isRefused(d.body)) return;
    expect(d.body.refusal).toBe('The five dimensions are read one analysed session at a time. No session has been analysed yet, and it takes 3.');
    expect([d.body.analysed, d.body.needed]).toEqual([0, 3]);
    expect(d.hero.name).toBe('Quality guardian');
  });

  test('five bars in spec order, five hues, the highest named, each trend in words', () => {
    const d = dimensionsPage({ ...B, builder_profile: FIVE, sessions_analysed: 12 });
    if (isRefused(d.body)) throw new Error('five were scored');
    expect(d.body.rows.map((r) => [r.key, r.mean.final, r.trend])).toEqual([
      ['steering', '62', 'steady'],
      // A move is steady under 15% of the older half (trends.py MIN_MOVE): 12 of 65.4 is a move.
      ['execution', '71', 'up 12 points'],
      ['engineering', '58', 'down 12 points'],
      ['product_instinct', '44', 'no trend yet'],
      ['planning', '39', 'steady'],
    ]);
    expect(d.body.top.key).toBe('execution');
    expect(new Set(d.body.rows.map((r) => r.hue)).size).toBe(5);
    expect(d.body.basis).toMatch(/^Averaged over 12 analysed sessions in the last 90 days\./);
  });
});

// ------------------------------------------------------------------ glossary and stack

describe('the glossary and stack pages', () => {
  test('the glossary counts what was found against the catalog, and says what is left quietly', () => {
    const g = glossaryPage(B, NOW);
    if (isRefused(g.body)) throw new Error('the fixture has a vocab block');
    expect([g.body.found.final, g.body.catalog, g.body.locked]).toEqual(['6', 74, '68 more to find.']);
    expect(g.body.months.flatMap((m) => m.terms).length).toBe(g.body.foundCount);
    const none = glossaryPage(NO_REPORT_B, NOW);
    expect([isRefused(none.body) && none.body.refusal, none.notSent]).toEqual([NO_REPORT, true]);
  });

  test('the stack: categories as chapters in hues past the band, each thing a bar of the sessions it was in', () => {
    const s = stackPage(B, NOW);
    if (isRefused(s.body)) throw new Error('the fixture has a stack block');
    expect(s.body.total.final).toBe('12');
    expect(s.body.groups.map((g) => [g.label, g.count.final])).toEqual([
      ['Languages', '6'],
      ['Frameworks', '6'],
    ]);
    for (const g of s.body.groups) {
      expect(g.hue).not.toBe('tide');
      for (const it of g.items) {
        // Only what a session used gets a line and a bar, and a bar never passes the whole.
        expect(it.sessions).toBeGreaterThan(0);
        expect(it.share).toBeGreaterThan(0);
        expect(it.share).toBeLessThanOrEqual(1);
      }
    }
    // Absent is not zero: what only a manifest names is one sentence, never a "0 sessions" line.
    expect(s.body.groups[1]!.named).toEqual(['Named in a manifest, not seen in a session: React, React Native, Next.js, FastAPI.']);
    expect(s.body.groups[1]!.items.map((i) => i.name)).toEqual(['Expo', 'SwiftUI']);
    const python = s.body.groups[0]!.items[0]!;
    expect([python.name, python.sessions, python.share]).toEqual(['Python', 63, 63 / 158]);
  });

  test('the tools come from the sessions on this phone, Cursor counted once, an unknown tool left out and said', () => {
    const mix = toolsMix([
      { harness: 'claude_code' },
      { harness: 'claude_code' },
      { harness: 'claude_code' },
      { harness: 'cursor_agent' },
      { harness: 'cursor_ide' },
      { harness: 'from_the_future' },
    ])!;
    expect(mix.tools.map((t) => [t.name, t.sessions.final, t.harness])).toEqual([
      ['Claude Code', '3', 'claude_code'],
      ['Cursor', '2', 'cursor_ide'],
    ]);
    expect(mix.tools[0]!.share).toBeCloseTo(3 / 5, 6);
    expect(mix.basis).toBe('Counted over the 6 finished sessions saved on this phone. 1 session from a tool this build does not know is left out.');
    expect(toolsMix([])).toBeNull();
    expect(toolsMix([{ harness: 'from_the_future' }])).toBeNull();
  });
});

// ------------------------------------------------------------------ the house rules

describe('the house rules, on every page', () => {
  test('every count rests on the string its last frame writes, and starts at zero in that shape', () => {
    for (const b of [B, NO_REPORT_B, { ...B, builder_profile: FIVE, sessions_analysed: 12 }]) {
      for (const s of nums(EVERY_PAGE(b))) {
        expect({ final: s.final, frame: formatWith(s.fmt, s.value) }).toEqual({ final: s.final, frame: s.final });
        expect(formatWith(s.fmt, 0)).not.toMatch(/NaN|undefined|Infinity/);
      }
    }
  });

  test('no dash anywhere, never "you spent", and every refusal is a sentence', () => {
    for (const b of [B, NO_REPORT_B]) {
      const pages = EVERY_PAGE(b);
      for (const s of strings(pages)) {
        expect({ s, dash: hasDash(s) }).toEqual({ s, dash: false });
        expect(s.toLowerCase()).not.toContain('you spent');
      }
      const refusals: string[] = [];
      const walk = (x: unknown) => {
        if (!x || typeof x !== 'object') return;
        if (Array.isArray(x)) return x.forEach(walk);
        const o = x as Record<string, unknown>;
        if (typeof o.refusal === 'string') refusals.push(o.refusal);
        Object.values(o).forEach(walk);
      };
      walk(pages);
      for (const r of refusals) {
        expect(r).toMatch(/^[A-Z0-9]/);
        expect(r.trim().endsWith('.')).toBe(true);
      }
    }
  });
});

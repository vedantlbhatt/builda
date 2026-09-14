/**
 * The analysis page's rules (`src/insights/`), held without a renderer.
 *
 * What a count up may never do: land on a string the copy helpers would not write, or snap to
 * it at the end. What the page may never say: a refused number as a zero, a dash, "you spent".
 * What the motion must be: the kit's curve, a spring that settles to exactly its value, a clock
 * that jumps to the end under Reduce Motion (tested through the pure pieces it is built from).
 *
 * The fixture is the real report and profile this build was designed against (the local stack,
 * 2026-09-13), trimmed: `src/insights/fixtures/report-2026-09-13.json`.
 */
import { describe, expect, test } from 'bun:test';

import type { BuilderProfileResponse, Profile } from '../src/data/api';
import { clock, commas, floorMins, human, n, pct } from '../src/copy/numbers';
import { dollars } from '../src/copy/money';
import { hourOfDay } from '../src/copy/time';
import { hasDash } from '../src/copy/plain';
import { duration } from '../src/theme';
import fixture from '../src/insights/fixtures/report-2026-09-13.json';
import { countLanded, fitSize, fixedFormatOf, formatWith, numSpec, restingText } from '../src/insights/format';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SECTION_CLOCK_MS } from '../src/insights/motion';
import {
  analysisModel,
  everyNum,
  gapsOf,
  gridMonths,
  gridOf,
  gridWeeks,
  isRefused,
  localDateLabel,
  NO_REPORT,
  NOT_WHAT_YOU_PAY,
  sentence,
  trendValue,
  type AnalysisModel,
} from '../src/insights/model';
import { ease, phase, spring } from '../src/insights/motion';
import {
  CATEGORICAL,
  contrast,
  CREATURE_HUE,
  DATA,
  DIMENSION_HUE,
  GROUND,
  HUE_NAMES,
  ON_HUE,
  SECTION_HUE,
  SPECTRUM,
  withAlpha,
} from '../src/insights/palette';

const B = fixture.builder as unknown as BuilderProfileResponse;
const P = fixture.profile as unknown as Profile;
const NOW = Date.parse('2026-09-13T14:00:00Z');
const model = analysisModel(B, P, NOW);

/** Every string anywhere in a value. */
function strings(x: unknown, out: string[] = []): string[] {
  if (typeof x === 'string') out.push(x);
  else if (Array.isArray(x)) for (const y of x) strings(y, out);
  else if (x && typeof x === 'object') for (const y of Object.values(x)) strings(y, out);
  return out;
}

/** Every `{ refusal }` in the model. */
function refusals(m: AnalysisModel): string[] {
  const out: string[] = [];
  const walk = (x: unknown) => {
    if (!x || typeof x !== 'object') return;
    if (Array.isArray(x)) return x.forEach(walk);
    const o = x as Record<string, unknown>;
    if (typeof o.refusal === 'string') out.push(o.refusal);
    Object.values(o).forEach(walk);
  };
  walk(m);
  return out;
}

// ------------------------------------------------------------------ every frame

describe('a count up writes every frame the way its resting string is written', () => {
  test('whole numbers, commas, prefixes and units', () => {
    for (const v of [0, 7, 158, 999, 1_000, 1_941, 50_177, 1_234_567]) {
      expect(formatWith(numSpec(v, commas(v)).fmt, v)).toBe(commas(v));
      expect(formatWith(numSpec(v, `+${commas(v)}`).fmt, v)).toBe(`+${commas(v)}`);
      expect(formatWith(numSpec(v, `-${commas(v)}`).fmt, v)).toBe(`-${commas(v)}`);
    }
  });

  test('one decimal, as profile._n says it, and no ".0"', () => {
    for (const v of [4.86, 74.5, 29.9, 11.3, 2.11, 7.0, 763.3, 12.3]) {
      const s = numSpec(v, n(v));
      expect(formatWith(s.fmt, s.value)).toBe(n(v));
    }
    expect(fixedFormatOf(n(7.0))).toMatchObject({ decimals: 0 });
  });

  test('a share counts to the percent Python writes, not to the raw share', () => {
    // 0.285 is "29%" by the one rounding rule, and `0.285 * 100` is 28.499999999999996, which a
    // frame would write as 28: the count must land on 29.
    for (const share of [0.125, 0.285, 0.435, 0.825, 0.221, 0.189, 0.0, 1.0, 0.005]) {
      const s = numSpec(share * 100, pct(share));
      expect(formatWith(s.fmt, s.value)).toBe(pct(share));
    }
  });

  test('dollars: whole from $100, cents below', () => {
    for (const usd of [2951.68, 456.96, 34.65, 10.98, 0.43, 12.59, 657.01]) {
      const s = numSpec(usd, dollars(usd));
      expect(formatWith(s.fmt, s.value)).toBe(dollars(usd));
    }
  });

  test('durations, clocks and records say what theme.duration, copy.clock and copy.floorMins say', () => {
    for (const secs of [0, 39, 59, 60, 61, 3568, 3599, 3600, 5878.4, 11173, 12429.3, 1532923.5, 86399]) {
      expect(formatWith({ kind: 'duration' }, secs)).toBe(duration(secs));
      expect(formatWith({ kind: 'clock' }, secs)).toBe(clock(secs));
      expect(formatWith({ kind: 'floorMins' }, secs)).toBe(floorMins(secs));
    }
  });

  test('token counts say what burn._human says', () => {
    for (const t of [0, 999, 1_000, 85_372, 999_499, 999_500, 8_581_908, 44_754_814, 4_170_492_782]) {
      expect(formatWith({ kind: 'tokens' }, t)).toBe(human(t));
    }
  });

  test('a count that mounts after its block played shows its value, never the 0 it starts from', () => {
    // FOUND IN INTEGRATION: after a hot reload, or data arriving after the section played, the
    // block's clock was already at rest, nothing on the UI thread wrote the number again, and
    // React had only ever rendered "0".
    const s = numSpec(52, '52');
    expect(countLanded(0, 120, 950)).toBe(false);
    expect(countLanded(1069, 120, 950)).toBe(false);
    expect(countLanded(1070, 120, 950)).toBe(true);
    expect(countLanded(SECTION_CLOCK_MS, 120, 950)).toBe(true);
    expect(countLanded(0, 0, 0)).toBe(true);
    expect(restingText(s, countLanded(SECTION_CLOCK_MS, 120, 950))).toBe('52');
    expect(restingText(s, false)).toBe('0');
    expect(restingText(numSpec(2564.02, '$2,564'), true)).toBe('$2,564');
    // Every delay a page uses lands inside the block's clock, so a played block rests every count.
    for (const delay of [0, 40, 120, 320, 1200]) expect(countLanded(SECTION_CLOCK_MS, delay, 950)).toBe(true);
  });

  test('Num renders what the clock says, and follows it on the UI thread', () => {
    const src = readFileSync(join(import.meta.dir, '..', 'src', 'insights', 'Num.tsx'), 'utf8');
    expect(src).toContain('const startsAt = restingText(spec, landed);');
    expect(src).toContain('defaultValue={startsAt}');
    expect(src).toMatch(/useAnimatedReaction\(\s*\(\) => countLanded\(clock\.value, delay, duration\)/);
    expect(src).toMatch(/useLayoutEffect\(\(\) => \{\s*if \(countLanded\(clock\.value, delay, duration\)\) setLanded\(true\);/);
  });

  test('clock hours: the frame says what copy/time.hourOfDay says', () => {
    expect([0, 1, 11, 12, 13, 23].map((h) => formatWith({ kind: 'hour' }, h))).toEqual(['12am', '1am', '11am', '12pm', '1pm', '11pm']);
    for (let h = 0; h < 24; h++) expect(formatWith({ kind: 'hour' }, h)).toBe(hourOfDay(h));
  });

  test('every number on the page rests where its last frame lands', () => {
    const nums = everyNum(model);
    expect(nums.length).toBeGreaterThan(30);
    for (const s of nums) expect({ final: s.final, frame: formatWith(s.fmt, s.value) }).toEqual({ final: s.final, frame: s.final });
  });

  test('a count starts at zero in the resting shape: the same unit, no stray minus', () => {
    for (const s of everyNum(model)) {
      const first = formatWith(s.fmt, 0);
      expect(first).not.toMatch(/NaN|undefined|Infinity/);
      if (s.fmt.kind === 'fixed') {
        expect(first.startsWith(s.fmt.prefix)).toBe(true);
        expect(first.endsWith(s.fmt.suffix)).toBe(true);
      }
    }
  });

  test('a big figure is sized to fit its line', () => {
    expect(fitSize('+50,177', 362, 96, 40)).toBeLessThanOrEqual(80);
    expect(fitSize('9', 181, 120, 40)).toBe(120);
    expect(fitSize('$2,952', 362, 96, 40)).toBeLessThanOrEqual(96);
    expect(fitSize('1,234,567,890', 300, 96, 40)).toBe(40);
  });
});

// ------------------------------------------------------------------ motion

describe('the motion is the kit’s curve, a settling spring, and a clock', () => {
  test('ease is bezier 0.23 1 0.32 1: pinned ends, monotonic, a strong ease out', () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    let last = 0;
    for (let i = 1; i <= 100; i++) {
      const y = ease(i / 100);
      expect(y).toBeGreaterThanOrEqual(last - 1e-9);
      last = y;
    }
    // A strong ease out is most of the way there early.
    expect(ease(0.25)).toBeGreaterThan(0.7);
    expect(ease(0.5)).toBeGreaterThan(0.9);
  });

  test('spring overshoots a little, settles, and rests at exactly 1', () => {
    let peak = 0;
    for (let i = 0; i <= 200; i++) peak = Math.max(peak, spring(i / 200));
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(1.06);
    expect(Math.abs(spring(0.95) - 1)).toBeLessThan(0.01);
    expect(spring(1)).toBe(1);
    expect(spring(0)).toBe(0);
  });

  test('phase is 0 before its delay and 1 after its window', () => {
    expect(phase(0, 100, 900)).toBe(0);
    expect(phase(100, 100, 900)).toBe(0);
    expect(phase(550, 100, 900)).toBeCloseTo(0.5);
    expect(phase(5000, 100, 900)).toBe(1);
    expect(phase(10, 0, 0)).toBe(1);
  });
});

// ------------------------------------------------------------------ honesty

describe('what the page says', () => {
  test('no dash anywhere, and never "you spent"', () => {
    for (const s of strings(model)) {
      expect({ s, dash: hasDash(s) }).toEqual({ s, dash: false });
      expect(s.toLowerCase()).not.toContain('you spent');
    }
  });

  test('the money view answers the owner’s question under the number, in words', () => {
    expect(NOT_WHAT_YOU_PAY).toBe("What these tokens would cost at Anthropic's API list prices. On a subscription you pay your plan, not this.");
    const b = model.money.body;
    if (isRefused(b)) throw new Error('the fixture is priced');
    expect(b.usd.final).toBe('$2,952');
    expect(b.label).toContain('at API list prices');
  });

  test('every refusal is a sentence: a capital, a full stop, no zero standing in for it', () => {
    const all = [...refusals(model), ...refusals(analysisModel({ ...B, report: null }, P, NOW))];
    expect(all.length).toBeGreaterThan(3);
    for (const r of all) {
      expect(r).toMatch(/^[A-Z0-9"]/);
      expect(r.trim().endsWith('.')).toBe(true);
      expect(r).not.toMatch(/^0\b|^--|^\s*$/);
    }
    expect(sentence('no session reported token counts')).toBe('No session reported token counts.');
  });

  test('one source per number: the Mac’s archetype over the server’s', () => {
    // The server scores velocity machine (it counts no test runs); the Mac scores quality guardian.
    expect(B.corpus?.archetype.name).toBe('velocity_machine');
    expect(model.hero.archetypeId).toBe('quality_guardian');
    expect(model.hero.ruleNum?.final).toBe('4.9');
    expect(model.hero.ruleFloor).toBe(true);
    // The winning bar sits past the tick (score over 0.5), and so do both runners up here.
    expect(model.hero.bars.map((b) => b.key)).toEqual(['quality_guardian', 'velocity_machine', 'skeptic']);
    for (const b of model.hero.bars) expect(b.score).toBeGreaterThan(0.5);
  });

  test('the headline numbers are the Mac’s: hours with you there, sessions, lines', () => {
    expect(model.hero.ledger.map((r) => [r.key, r.num.final])).toEqual([
      ['hours', '74.5'],
      ['sessions', '158'],
      ['lines', '50,177'],
    ]);
    // Whose count it is, on the row: onboarding counts what reached the account, Money what it could price.
    expect(model.hero.ledger.find((r) => r.key === 'sessions')?.label).toBe('sessions your Mac read');
  });

  test('with no report, every section that needs one says so, and nothing is zero', () => {
    const m = analysisModel({ ...B, report: null }, P, NOW);
    expect(m.hasReport).toBe(false);
    expect(isRefused(m.shipping.diff) && m.shipping.diff.refusal).toBe(NO_REPORT);
    expect(isRefused(m.agents.body) && m.agents.body.refusal).toBe(NO_REPORT);
    expect(m.trends.refusal).toBe(NO_REPORT);
    expect(isRefused(m.quality.green) && m.quality.green.refusal).toBe(NO_REPORT);
    // The hero falls back to the server's own three numbers, all from the server.
    expect(m.hero.ledger.map((r) => r.key)).toEqual(['hours', 'sessions', 'lines']);
    expect(m.hero.ledger.find((r) => r.key === 'sessions')?.num.final).toBe('171');
    expect(m.hero.ledger.find((r) => r.key === 'sessions')?.label).toBe('sessions on your account');
    for (const s of everyNum(m)) expect(s.final).not.toBe('0');
    expect(gapsOf({ ...B, report: null })[0]?.key).toBe('report');
  });

  test('a report without an agents block says no helper agents were found, not 0 agents', () => {
    const m = analysisModel({ ...B, report: { ...B.report!, agents: null } }, P, NOW);
    expect(isRefused(m.agents.body)).toBe(true);
    expect(strings(m.agents).join(' ')).not.toMatch(/\b0 agents\b/);
  });

  test('a trend with no direction is reported with no verdict', () => {
    const night = model.trends.trends.find((t) => t.key === 'night_share');
    expect(night?.verdict).toBeNull();
    expect(model.trends.trends.find((t) => t.key === 'code_velocity')?.verdict).toBe('the way you want it');
    expect(model.trends.trends.find((t) => t.key === 'ships_rate')?.verdict).toBe('not the way you want it');
    expect(model.trends.trends.find((t) => t.key === 'short_prompt_share')?.move).toBeNull();
    expect(trendValue('ships_rate', 0.846)).toBe('85%');
    expect(trendValue('spend_per_hour_usd', 34.48)).toBe('$34.48');
    expect(trendValue('code_velocity', 624.5)).toBe('624.5');
  });

  test('the burn is said as shares, and the rest of the bar is what did change something', () => {
    const burn = model.money.burn;
    if (!burn || isRefused(burn)) throw new Error('the fixture has a burn block');
    expect(burn.line).toBe('At least 3% of your tokens went into stretches where nothing was written.');
    expect(burn.share + (burn.unreadableShare ?? 0)).toBeLessThan(1);
    expect(burn.causes[0]?.label).toBe('Re-reading the conversation so far');
  });

  test('the gaps: every server refusal, grouped by whether the Mac supplies it', () => {
    const gaps = model.gaps;
    const keys = gaps.map((g) => g.key);
    for (const k of Object.keys(B.corpus!.sample.missing)) expect(keys).toContain(`server.${k}`);
    expect(gaps.find((g) => g.key === 'server.steer_rate')?.group).toBe('mac');
    expect(gaps.find((g) => g.key === 'server.night_commit_share')?.group).toBe('open');
    expect(gaps.find((g) => g.key === 'card.cryptic_prompt')?.why).toMatch(/^None of the 392 short prompts/);
    for (const g of gaps) {
      expect(g.why.trim().endsWith('.')).toBe(true);
      expect(g.what.length).toBeGreaterThan(3);
    }
  });
});

// ------------------------------------------------------------------ the grid

describe('the contribution grid', () => {
  test('weeks follow the history: at least 8, at most 17', () => {
    expect(gridWeeks('2026-08-12T00:44:30Z', NOW)).toBe(8);
    expect(gridWeeks('2025-01-01T00:00:00Z', NOW)).toBe(17);
    expect(gridWeeks(null, NOW)).toBe(17);
  });

  test('days before the first sitting are outlined, not zero, and today is marked once', () => {
    const cells = gridOf(P.graph, '2026-08-12T00:44:30Z', NOW, 8);
    expect(cells.filter((c) => c.today)).toHaveLength(1);
    const before = cells.filter((c) => c.before);
    expect(before.length).toBeGreaterThan(0);
    for (const c of before) expect(c.level).toBe(0);
    // Every day the server has hours for is a lit cell.
    expect(cells.filter((c) => c.level > 0).length).toBe(P.graph.filter((d) => d.active_seconds > 0).length);
    // No cell after today.
    const last = cells[cells.length - 1]!;
    expect(last.today).toBe(true);
  });

  test('month labels are short names, never crowded', () => {
    const months = gridMonths(NOW, 17);
    for (let i = 1; i < months.length; i++) expect(months[i]!.col - months[i - 1]!.col).toBeGreaterThan(2);
    for (const m of months) expect(m.label).toMatch(/^[A-Z][a-z]{2}$/);
  });

  test('a server date is said as a local day, never shifted by a zone', () => {
    expect(localDateLabel('2026-08-18', NOW)).toBe('Aug 18');
    expect(localDateLabel('2025-12-31', NOW)).toBe('Dec 31, 2025');
    expect(localDateLabel('not a date', NOW)).toBeNull();
  });
});

// ------------------------------------------------------------------ colour

describe('the spectrum, as this page wears it', () => {
  test('dark ink reads on every hue, and every hue reads on the ground (the V2 floors, 4.5:1)', () => {
    for (const name of HUE_NAMES) {
      const h = SPECTRUM[name];
      expect({ name, ink: contrast(ON_HUE, h.ink) >= 4.5 }).toEqual({ name, ink: true });
      expect({ name, ground: contrast(h.ink, GROUND.bg) >= 4.5 }).toEqual({ name, ground: true });
      expect({ name, partner: contrast(h.partner, GROUND.card) >= 3 }).toEqual({ name, partner: true });
      expect(h.ink).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  test('neighbouring chapters never share a hue, and none is a data hue', () => {
    const order = Object.values(SECTION_HUE);
    for (let i = 1; i < order.length; i++) expect(order[i]).not.toBe(order[i - 1]);
    const data = new Set<string>(Object.values(DATA));
    for (const name of HUE_NAMES) if (name !== 'amber') expect(data.has(SPECTRUM[name].ink)).toBe(false);
  });

  test('the five dimensions wear five different hues, and every creature has one', () => {
    expect(new Set(Object.values(DIMENSION_HUE)).size).toBe(5);
    for (const c of ['bit', 'cat', 'dog', 'fox', 'owl', 'bee', 'whale', 'octopus', 'crab']) expect(HUE_NAMES).toContain(CREATURE_HUE[c]!);
    expect(new Set(CATEGORICAL).size).toBe(CATEGORICAL.length);
  });

  test('alpha is appended, not guessed', () => {
    expect(withAlpha('#FFB300', 1)).toBe('#FFB300FF');
    expect(withAlpha('#FFB300', 0)).toBe('#FFB30000');
  });
});

// ------------------------------------------------------------------ one figure per fact

describe('one figure per fact on one page (FOUND IN THE CAPTURE, 2026-09-14)', () => {
  const report = B.report!;

  test('night work on the clock is the Mac’s, over the window every other chapter reads', () => {
    const trend = report.trends.find((t) => t.metric === 'night_share')!;
    // The server's metric (0.221, every session it holds) is not what the clock says.
    expect(model.time.clock.nightShare).toBe(trend.now);
    expect(model.time.clock.night?.final).toBe(pct(trend.now));
    expect(model.trends.trends.find((t) => t.key === 'night_share')?.nowText).toBe(model.time.clock.night?.final);
    // The hour beside it is still the server's, and the page says whose each one is.
    // The fixture's report read Aug 11 to Sep 13 (not inside its 30 day window), and says so.
    expect(model.time.clock.basis).toBe(
      "The night share is your Mac's, over Aug 11 to Sep 13, like the rest of this page. The hour you build most is the server's, over all 171 sessions it holds, because your Mac does not send one.",
    );
  });

  test('with no night trend in the report, the clock says the server’s and says so', () => {
    const noTrend = { ...B, report: { ...report, trends: report.trends.filter((t) => t.metric !== 'night_share') } } as BuilderProfileResponse;
    const m = analysisModel(noTrend, P, NOW);
    expect(m.time.clock.nightShare).toBe(0.221);
    expect(m.time.clock.basis).toMatch(/^Both are the server's/);
  });

  test('What stands out never repeats a number a chapter above says from the Mac', () => {
    const ids = model.standsOut.facts.map((f) => f.key);
    for (const id of ['autonomy_score', 'code_velocity', 'iteration_depth', 'model_mix', 'night_share']) expect(ids).not.toContain(id);
    // What only the server says stays: the tool you call most, its streak, its peak hour, the hours in all.
    expect(ids).toEqual(['longest_streak_days', 'top_tool', 'peak_hour', 'totals']);
    expect(model.standsOut.factsSource).toBe(
      "Ranked by the server, most unusual first, over all 171 sessions it holds. 5 more it ranked are left out, because the chapters above say them from your Mac's report, over the 158 sessions it read.",
    );
    const text = strings(model.standsOut).join(' ');
    expect(text).not.toMatch(/tool calls per prompt|runs without you|of output tokens|lines an hour/);
  });

  test('with no report, every fact the server ranked is shown', () => {
    const noReport = { ...B, report: null } as BuilderProfileResponse;
    expect(analysisModel(noReport, P, NOW).standsOut.facts.map((f) => f.key)).toEqual(B.corpus!.facts.map((f) => f.id));
  });

  test('instructions that landed clean are the two counts rounded once, a tie up', () => {
    const p = report.prompting!;
    const c = model.agentWork.clean;
    if (isRefused(c)) throw new Error('clean refused');
    expect(c.num.final).toBe(pct(p.clean! / p.attempts));
    // The capture's own numbers: 120 of 647 is 18.5%, which is 19%, never 18.
    const capture = { ...B, report: { ...report, prompting: { clean: 120, costly: 527, reason: null, attempts: 647, clean_share: 0.185 } } } as BuilderProfileResponse;
    const cc = analysisModel(capture, P, NOW).agentWork.clean;
    if (isRefused(cc)) throw new Error('clean refused');
    expect(cc.num.final).toBe('19%');
  });

  test('what kind of work: each bar is its share of every line, not of the biggest role', () => {
    const k = model.shipping.kind;
    if (isRefused(k)) throw new Error('kind refused');
    const total = k.roles.reduce((s, r) => s + r.lines, 0);
    for (const r of k.roles) expect(r.share).toBeCloseTo(r.lines / total, 12);
    expect(k.roles.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1, 12);
    // Source files, the biggest, are about 70% of the track, never all of it.
    expect(k.roles[0]!.share).toBeLessThan(0.75);
    const src = readFileSync(join(__dirname, '../src/insights/sections/Shipping.tsx'), 'utf8');
    expect(src).toMatch(/<GrowBar frac=\{r\.share\}/);
    expect(src).not.toMatch(/k\.roles\[0\]\.lines/);
  });
});

describe('tool calls a prompt: one rule, and an old report says what differs', () => {
  test('a report from before the one rule labels its trend beside the card’s number', () => {
    const t = model.trends.trends.find((x) => x.key === 'iteration_depth')!;
    const depth = B.report!.wrapped!.cards.find((c) => c.id === 'prompts_per_session')!.extras.tool_calls_per_prompt!;
    expect(t.nowText).not.toBe(n(depth));
    expect(t.note).toBe(`Counts runs nobody was at, which the ${n(depth)} a prompt above leaves out.`);
    for (const other of model.trends.trends.filter((x) => x.key !== 'iteration_depth')) expect(other.note).toBeNull();
  });

  test('a report computed by the one rule says one number and no note', () => {
    const r = B.report!;
    const depth = r.wrapped!.cards.find((c) => c.id === 'prompts_per_session')!.extras.tool_calls_per_prompt!;
    const same = { ...B, report: { ...r, trends: r.trends.map((t) => (t.metric === 'iteration_depth' ? { ...t, now: depth } : t)) } } as BuilderProfileResponse;
    const t = analysisModel(same, P, NOW).trends.trends.find((x) => x.key === 'iteration_depth')!;
    expect(t.nowText).toBe(n(depth));
    expect(t.note).toBeNull();
  });

  test('a move is said by the one rounding rule, as trends.headline says it', () => {
    const t = { ...B.report!.trends[0]!, move: 0.145, direction: 'up' as const };
    const m = analysisModel({ ...B, report: { ...B.report!, trends: [t] } } as BuilderProfileResponse, P, NOW);
    expect(m.trends.trends[0]!.words).toBe('up 15%');
    expect(m.trends.trends[0]!.move?.final).toBe('up 15%');
  });
});

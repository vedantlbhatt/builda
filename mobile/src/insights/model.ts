/**
 * Everything the analysis page says, decided in one pure function from the two responses the
 * phone already fetches (`GET /v1/profile/builder`, `GET /v1/profile`). No React here, so
 * `__tests__/insights.test.ts` can hold every rule below.
 *
 * THE RULES IT HOLDS (CLAUDE.md): a plausible wrong number is worse than a crash; absent is not
 * zero; a refusal is a sentence, never 0 and never a placeholder; no dashes in anything a person
 * reads. Every number that is drawn carries its resting string from the same copy helper the
 * rest of the app says it with (`src/copy/`), so this page and the Wrapped deck, the money page
 * and the You tab cannot say one number two ways.
 *
 * ONE SOURCE PER NUMBER. The Mac's report (report v2) reads the transcripts and is the fuller
 * answer; the server's corpus profile reads what was uploaded. Where both carry a number, this
 * page says the Mac's, as the Wrapped deck and the You pages do (`src/you/archetype.ts` says why);
 * the server's own numbers appear only where the Mac sends none (the peak hour, the night share,
 * the ranked facts), and the facts say whose ranking they are.
 */
import type { BuilderProfileResponse, CorpusMetric, CorpusProfile, Profile } from '../data/api';
import type { Dimension } from '../generated/analysis';
import type {
  BuilderReport,
  BurnCause,
  ReportAgents,
  ReportTrend,
  ReportWrappedCard,
  WrappedCard,
} from '../generated/report';
import { corpusBurnLine, corpusBurnRefusal } from '../copy/burn';
import { KIND_NOUN, LOOKBACK_MINUTES, PROMPT_BRIEF_WORDS, REFUSALS, ROLE_WORD, SHORT_PROMPT_WORDS } from '../copy/catalog';
import { dollars, withoutACommit } from '../copy/money';
import { capital, clock, commas, count, floorMins, human, n, pct, shareWords, tally } from '../copy/numbers';
import { renderCard, type RenderedCard } from '../copy/wrapped';
import { narrativeView, archetypeSentence as narrativeArchetypeLine } from '../profile/narrative';
import { coverageHint, coverageLine, fanoutWaste, shortDuration, streakLine, trendVerdict, trendWords } from '../profile/report';
import { resolveAnimal, type Animal } from '../pixel/animals';
import { duration, graphLevel, DAY_BOUNDARY_HOUR } from '../theme';
import {
  archetypeView,
  metricLabel,
  metricValue,
  runnerUpLine,
  sourceLine,
  thresholdSentence,
  type ArchetypeView,
  type RuleScore,
} from '../you/archetype';
import { dimensionsPending, dimensionViews, modalArchetypeLine } from '../you/dimensions';
import { glossaryView } from '../you/glossary';
import { moneyView } from '../you/money';
import { dayOf } from '../you/numbers';
import { stackView } from '../you/stack';
import { numSpec, type NumSpec } from './format';
import { CREATURE_HUE, DIMENSION_HUE, type HueName } from './palette';

// ------------------------------------------------------------------ shapes

/** A row of the typographic ledger: a big number, what it counts, and one line under it. */
export interface LedgerRow {
  key: string;
  num: NumSpec;
  label: string;
  note?: string | null;
}

/** A section that has nothing to draw says why, in one sentence. */
export interface Refused {
  refusal: string;
}

export function isRefused<T extends object>(x: T | Refused): x is Refused {
  return 'refusal' in x;
}

export interface Coverage {
  line: string;
  caveat: string | null;
}

export interface RuleBar {
  key: string;
  display: string;
  animal: Animal;
  hue: HueName;
  /** value over the bar, capped at 2 and halved: 0.5 is exactly the bar. */
  score: number;
  said: string;
  /** The bar the rule needs, in the metric's own unit ("3", "487", "40%"), or null unsent. */
  bar: string | null;
  winner: boolean;
}

export interface HeroModel {
  state: 'named' | 'generalist' | 'refused' | 'absent';
  archetypeId: string | null;
  name: string;
  /** The rule's number, drawn large in the band ("4.9"), or null with no winner. */
  ruleNum: NumSpec | null;
  ruleFloor: boolean;
  ruleUnit: string | null;
  /** "against a bar of 3": the threshold the winning rule cleared, said beside its number. */
  ruleBar: string | null;
  sentence: string | null;
  bars: RuleBar[];
  barNote: string | null;
  confidence: string | null;
  source: string | null;
  narrativeLine: string | null;
  ledger: LedgerRow[];
  ledgerNote: string | null;
}

export interface GridCell {
  col: number;
  row: number;
  level: number;
  /** Before the first sitting this machine found: no transcript, which is not zero. */
  before: boolean;
  today: boolean;
}

export interface TimeModel {
  streak: { num: NumSpec | null; display: string; unit: string; sentence: string | null } | Refused;
  grid: { weeks: number; cells: GridCell[]; months: { col: number; label: string }[]; caption: string } | Refused;
  clock: {
    peakHour: number | null;
    peak: NumSpec | null;
    peakLine: string | null;
    nightShare: number | null;
    night: NumSpec | null;
    nightLine: string | null;
    refusals: string[];
  };
  ledger: LedgerRow[];
  notes: string[];
}

export interface LanguageRow {
  name: string;
  lines: NumSpec;
  share: number;
  shareText: string;
  files: string;
  other: boolean;
}

export interface ShippingModel {
  diff:
    | { added: NumSpec | null; removed: NumSpec | null; addedShare: number; basis: string; note: string | null }
    | Refused;
  commits: { total: NumSpec; assisted: number; alone: number; assistedText: string; aloneText: string; sentence: string } | Refused;
  languages: { rows: LanguageRow[]; total: string; note: string | null } | Refused;
  kind: { display: string; sentence: string | null; roles: { key: string; label: string; lines: number; text: string }[]; kinds: string | null } | Refused;
}

export interface DimensionRow {
  key: Dimension;
  label: string;
  mean: NumSpec;
  value: number;
  hue: HueName;
  trend: string;
}

export interface AgentWorkModel {
  steer: { num: NumSpec; caption: string; sentence: string | null } | Refused;
  style: { display: string; sentence: string | null } | Refused;
  prompt:
    | { mean: NumSpec; median: NumSpec; meanValue: number; medianValue: number; label: string; terse: number; brief: number; sentence: string }
    | Refused;
  perSession: { num: NumSpec; median: string | null; toolCalls: NumSpec | null } | Refused;
  autonomy: NumSpec | null;
  clean: { num: NumSpec; sentence: string } | Refused;
  dimensions: { rows: DimensionRow[]; basis: string; archetypeLine: string | null } | Refused;
  tags: string | null;
  patterns: { text: string; example: string }[];
}

export interface AgentsModel {
  body:
    | {
        peak: NumSpec;
        agents: NumSpec;
        types: { name: string; agents: number; text: string }[];
        parallel: NumSpec;
        work: NumSpec;
        busy: string;
        waste: string | null;
        line: string;
      }
    | Refused;
  sessionsAtOnce: { display: string; sentence: string | null } | null;
}

export interface ModelSlice {
  key: string;
  name: string;
  usd: number;
  text: string;
  meta: string;
  family: string;
}

export interface MoneyModel {
  body:
    | {
        usd: NumSpec;
        label: string;
        models: ModelSlice[];
        tokens: { total: NumSpec; label: string; buckets: { key: string; label: string; tokens: number; text: string }[] } | null;
        perHour: NumSpec | null;
        without: { sentence: string; share: number | null } | null;
        unpriced: string | null;
      }
    | Refused;
  burn:
    | {
        line: string;
        share: number;
        unreadableShare: number | null;
        unreadableLine: string | null;
        causes: { key: BurnCause; label: string; share: number; text: string; stretches: string }[];
      }
    | Refused
    | null;
}

export interface TrendModel {
  key: string;
  label: string;
  before: number;
  now: number;
  beforeText: string;
  nowText: string;
  move: NumSpec | null;
  words: string;
  verdict: string | null;
  /** True when the move is the way the metric wants; the verdict word is then drawn in green. */
  good: boolean;
  direction: ReportTrend['direction'];
}

export interface TrendsModel {
  headline: string | null;
  trends: TrendModel[];
  basis: string | null;
  refusal: string | null;
}

export interface QualityModel {
  green: { rate: NumSpec; passed: number; failed: number; runs: string; sentence: string } | Refused;
  recovery: { median: NumSpec; medianSeconds: number; dial: 'minute' | 'hour' | 'day'; worst: string; tries: string | null; n: string } | Refused | null;
}

export interface StandsOutModel {
  facts: { key: string; text: string }[];
  factsSource: string | null;
  narrative:
    | { paragraphs: string[]; strengths: { text: string; evidence: string }[]; watchOuts: { text: string; evidence: string }[]; experiment: string; provenance: string }
    | Refused;
}

export interface WordsModel {
  glossary: { found: NumSpec; catalog: number; foundCount: number; locked: string | null; summary: string } | Refused;
  stack: { total: NumSpec; groups: { label: string; count: number; names: string }[]; summary: string } | Refused;
}

export interface Gap {
  key: string;
  what: string;
  why: string;
  /**
   * `mac`: the server cannot compute it, and your Mac's report supplies it instead (the page
   * shows the Mac's). `open`: nobody supplies it yet.
   */
  group: 'mac' | 'open';
}

export interface AnalysisModel {
  coverage: Coverage;
  hero: HeroModel;
  time: TimeModel;
  shipping: ShippingModel;
  agentWork: AgentWorkModel;
  agents: AgentsModel;
  money: MoneyModel;
  trends: TrendsModel;
  quality: QualityModel;
  standsOut: StandsOutModel;
  words: WordsModel;
  gaps: Gap[];
  /** Whether the Mac's report reached the server at all. */
  hasReport: boolean;
}

// ------------------------------------------------------------------ small helpers

/** The command that sends the report most of this page rests on. */
export const REPORT_COMMAND = 'python -m capture report';

/** Said wherever a section needs the report and there is none. */
export const NO_REPORT = 'This arrives with the report from your Mac, which has not been sent yet.';

function isNum(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/** A clause from a copy helper or a server reason, as a sentence: capitalised, one full stop. */
export function sentence(clause: string): string {
  const t = clause.trim();
  return capital(t.endsWith('.') ? t : `${t}.`);
}

function refused(clause: string): Refused {
  return { refusal: sentence(clause) };
}

function card(report: BuilderReport | null | undefined, id: WrappedCard): ReportWrappedCard | null {
  return report?.wrapped?.cards.find((c) => c.id === id) ?? null;
}

function rendered(report: BuilderReport | null | undefined, id: WrappedCard): RenderedCard | null {
  const c = card(report, id);
  return c ? renderCard(c) : null;
}

/** A card's refusal as a sentence, or the report's own absence. */
function cardRefusal(report: BuilderReport | null | undefined, id: WrappedCard): Refused {
  if (!report) return { refusal: NO_REPORT };
  if (!report.wrapped) return { refusal: 'Your Mac sent a report without the Wrapped cards this reads.' };
  const r = rendered(report, id);
  if (r?.refusal) return refused(r.refusal);
  return { refusal: 'Your Mac did not answer this one.' };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** A local date the server sends as YYYY-MM-DD, said as "Aug 18" (the year when not this one). */
export function localDateLabel(ymd: string, now: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12) return null;
  const thisYear = new Date(now - DAY_BOUNDARY_HOUR * 3_600_000).getFullYear();
  return `${MONTHS[mo - 1]} ${d}${y === thisYear ? '' : `, ${y}`}`;
}

/** The Builda day (days start at 04:00, phone's zone) of an instant, as a UTC midnight epoch. */
function builderDayUtc(t: number): number {
  const d = new Date(t - DAY_BOUNDARY_HOUR * 3_600_000);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

function metric(corpus: CorpusProfile | null | undefined, key: string): CorpusMetric | null {
  return corpus?.metrics?.[key] ?? null;
}

/** The server's reason a metric is null, as a sentence, or null when it has a value. */
function metricRefusal(corpus: CorpusProfile | null | undefined, key: string): string | null {
  const m = metric(corpus, key);
  if (m && m.value !== null) return null;
  const reason = m?.reason ?? corpus?.sample.missing?.[key] ?? null;
  return typeof reason === 'string' ? reason : null;
}

// ------------------------------------------------------------------ coverage

export function coverageOf(b: BuilderProfileResponse, now: number): Coverage {
  const c = b.report?.coverage ?? null;
  if (c) {
    const first = c.first_at ? dayOf(c.first_at, now) : null;
    const last = c.last_at ? dayOf(c.last_at, now) : null;
    const span = first && last ? (first === last ? `, all on ${first}` : `, ${first} to ${last}`) : '';
    const line = `The last ${count(c.window_days, 'day')}, as your Mac read them: ${count(c.sessions, 'session')} on ${count(c.active_days, 'day')}${span}.`;
    const said = coverageLine(c);
    const hint = coverageHint(c);
    return { line, caveat: said ? (hint ? `${said} ${hint}` : said) : null };
  }
  const s = b.corpus?.sample;
  if (s) {
    return {
      line: `The last ${count(b.window_days, 'day')} on the server: ${count(s.sessions, 'session')} on ${count(s.days, 'day')}. Your Mac has not sent its report, so the rest waits on it.`,
      caveat: null,
    };
  }
  return { line: 'Nothing has been uploaded to read yet.', caveat: null };
}

// ------------------------------------------------------------------ 1 the hero

function scoreOf(r: RuleScore): number | null {
  if (isNum(r.score)) return r.score;
  if (isNum(r.value) && isNum(r.threshold) && r.threshold > 0) return Math.min(r.value / r.threshold, 2) / 2;
  return null;
}

function ruleBar(r: RuleScore, winner: boolean): RuleBar | null {
  const score = scoreOf(r);
  if (score === null || r.value === null) return null;
  const animal = resolveAnimal(null, r.name);
  const said = winner
    ? `${r.lowerBound ? 'at least ' : ''}${metricValue(r.metric, r.value)} ${metricLabel(r.metric)}`
    : runnerUpLine(r);
  const bar = r.threshold !== null ? metricValue(r.metric, r.threshold) : null;
  return { key: r.name, display: r.display, animal, hue: CREATURE_HUE[animal] ?? 'amber', score, said, bar, winner };
}

export function heroOf(b: BuilderProfileResponse, profile: Profile | null): HeroModel {
  const report = b.report ?? null;
  const v: ArchetypeView | null = archetypeView(b.corpus, report);
  const ledger = heroLedger(b, profile);
  const time = card(report, 'time_put_in');
  let ledgerNote: string | null = null;
  if (time && !time.reason && isNum(time.value)) {
    const overlap = time.extras.attended_overlap_hours;
    ledgerNote =
      isNum(overlap) && overlap > 0
        ? `${n(time.value)} active hours in all. Up to ${n(overlap)} of the hours with you there were in sessions that ran at the same time.`
        : `${n(time.value)} active hours in all, with you there or not.`;
  }

  if (!v) {
    return {
      state: 'absent',
      archetypeId: null,
      name: 'No type yet',
      ruleNum: null,
      ruleFloor: false,
      ruleUnit: null,
      ruleBar: null,
      sentence: 'Nothing has been uploaded to score yet.',
      bars: [],
      barNote: null,
      confidence: null,
      source: null,
      narrativeLine: null,
      ledger,
      ledgerNote,
    };
  }

  const w = v.winner;
  const bars: RuleBar[] = [];
  if (w) {
    const bar = ruleBar(w, v.state === 'named');
    if (bar) bars.push(bar);
  }
  for (const r of v.runnersUp) {
    const bar = ruleBar(r, false);
    if (bar) bars.push(bar);
  }

  const cardSaid = rendered(report, 'builder_type');
  const sentenceSaid = v.source === 'mac' && cardSaid?.sentence ? cardSaid.sentence : v.line || null;
  const ruleNum = w && isNum(w.value) ? numSpec(w.value, metricValue(w.metric, w.value)) : null;
  const thresholdSaid = w ? thresholdSentence(w) : null;

  return {
    state: v.state,
    archetypeId: v.id,
    name: v.display,
    ruleNum: v.state === 'named' ? ruleNum : null,
    ruleFloor: Boolean(w?.lowerBound),
    ruleUnit: w ? metricLabel(w.metric) : null,
    ruleBar: v.state === 'named' && w && w.threshold !== null ? `against a bar of ${metricValue(w.metric, w.threshold)}` : null,
    sentence: sentenceSaid,
    bars,
    barNote: bars.length ? 'The tick on each line is the bar its rule needs. Past the tick, the rule is met.' : null,
    confidence: v.confidence !== null ? `${pct(v.confidence)} confidence, over ${count(v.sessions, 'session')}.` : null,
    source: [sourceLine(v), thresholdSaid].filter(Boolean).join(' ') || null,
    narrativeLine: narrativeArchetypeLine(b.narrative),
    ledger,
    ledgerNote,
  };
}

function heroLedger(b: BuilderProfileResponse, profile: Profile | null): LedgerRow[] {
  const report = b.report ?? null;
  const rows: LedgerRow[] = [];
  if (report) {
    const time = card(report, 'time_put_in');
    const hours = time && !time.reason ? time.extras.attended_hours : null;
    if (isNum(hours)) rows.push({ key: 'hours', num: numSpec(hours, n(hours)), label: 'hours with you there' });
    const sessions = report.coverage?.sessions ?? (time && !time.reason ? time.n : null);
    if (isNum(sessions)) rows.push({ key: 'sessions', num: numSpec(sessions, commas(sessions)), label: sessions === 1 ? 'session' : 'sessions' });
    const lines = report.money?.lines_added ?? card(report, 'shipped')?.value ?? null;
    if (isNum(lines)) rows.push({ key: 'lines', num: numSpec(lines, commas(Math.round(lines))), label: 'lines shipped' });
    return rows;
  }
  // No report: the server's own numbers, all three from the server.
  const attended = profile?.attribution.attended_seconds;
  if (isNum(attended)) {
    const h = Math.round((attended / 3600) * 10) / 10;
    rows.push({ key: 'hours', num: numSpec(h, n(h)), label: 'hours with you there' });
  }
  const sessions = profile?.totals.sessions ?? b.corpus?.sample.sessions;
  if (isNum(sessions)) rows.push({ key: 'sessions', num: numSpec(sessions, commas(sessions)), label: sessions === 1 ? 'session' : 'sessions' });
  const lines = b.corpus?.totals.total_lines_added;
  if (isNum(lines)) rows.push({ key: 'lines', num: numSpec(lines, commas(lines)), label: 'lines shipped' });
  return rows;
}

// ------------------------------------------------------------------ 2 time

/** Weeks the contribution grid shows: a quarter, 17 columns, as the You tab's grid does. */
export const GRID_WEEKS = 17;

export function gridOf(graph: Profile['graph'], firstAt: string | null, now: number, weeks = GRID_WEEKS): GridCell[] {
  const DAY = 86_400_000;
  const today = builderDayUtc(now);
  const todayRow = (new Date(today).getUTCDay() + 6) % 7; // Monday first
  const firstDay = firstAt ? builderDayUtc(Date.parse(firstAt)) : null;
  const byDay = new Map<number, number>();
  for (const d of graph) {
    const t = Date.parse(`${d.date}T00:00:00Z`);
    if (Number.isFinite(t)) byDay.set(t, (byDay.get(t) ?? 0) + d.active_seconds);
  }
  const cells: GridCell[] = [];
  for (let col = 0; col < weeks; col++) {
    for (let row = 0; row < 7; row++) {
      const back = (weeks - 1 - col) * 7 + (todayRow - row);
      if (back < 0) continue; // the rest of this week has not happened
      const day = today - back * DAY;
      const secs = byDay.get(day) ?? 0;
      cells.push({
        col,
        row,
        level: graphLevel(secs),
        before: firstDay !== null && Number.isFinite(firstDay) && day < firstDay && secs === 0,
        today: back === 0,
      });
    }
  }
  return cells;
}

/**
 * How many weeks the grid shows: enough to hold every week since the first sitting on record and
 * one before it, at least 8 so a new account still has a grid to read, at most 17 (a quarter,
 * where a cell is still a readable square on a phone).
 */
export function gridWeeks(firstAt: string | null, now: number): number {
  if (!firstAt) return GRID_WEEKS;
  const first = builderDayUtc(Date.parse(firstAt));
  if (!Number.isFinite(first)) return GRID_WEEKS;
  const today = builderDayUtc(now);
  const todayRow = (new Date(today).getUTCDay() + 6) % 7;
  const monday = today - todayRow * 86_400_000;
  const spanned = Math.max(1, Math.ceil((monday - first) / (7 * 86_400_000)) + 1);
  return Math.min(GRID_WEEKS, Math.max(8, spanned + 1));
}

/**
 * The month names under the grid: a column is labelled when its Monday is in a new month, and
 * a label that would crowd the next one (two columns or less) is dropped.
 */
export function gridMonths(now: number, weeks = GRID_WEEKS): { col: number; label: string }[] {
  const DAY = 86_400_000;
  const today = builderDayUtc(now);
  const todayRow = (new Date(today).getUTCDay() + 6) % 7;
  const out: { col: number; label: string }[] = [];
  let last = -1;
  for (let col = 0; col < weeks; col++) {
    const monday = new Date(today - ((weeks - 1 - col) * 7 + todayRow) * DAY);
    const month = monday.getUTCMonth();
    if (month !== last) {
      out.push({ col, label: MONTHS[month]! });
      last = month;
    }
  }
  return out.filter((m, i) => i === out.length - 1 || out[i + 1]!.col - m.col > 2);
}

export function timeOf(b: BuilderProfileResponse, profile: Profile | null, now: number): TimeModel {
  const report = b.report ?? null;
  const corpus = b.corpus ?? null;

  let streak: TimeModel['streak'];
  const sc = card(report, 'streak');
  const sr = sc ? renderCard(sc) : null;
  if (sc && sr && !sc.reason && isNum(sc.value)) {
    streak =
      sc.value === 0
        ? { num: null, display: sr.display ?? 'No streak yet', unit: '', sentence: sr.sentence }
        : { num: numSpec(sc.value, n(sc.value)), display: n(sc.value), unit: sc.value === 1 ? 'day straight' : 'days straight', sentence: sr.sentence };
  } else {
    streak = cardRefusal(report, 'streak');
  }

  let grid: TimeModel['grid'];
  if (profile && profile.graph) {
    const firstAt = report?.coverage?.first_at ?? ((corpus?.sample as { first_at?: string } | undefined)?.first_at ?? null);
    const weeks = gridWeeks(firstAt, now);
    const cells = gridOf(profile.graph, firstAt, now, weeks);
    const withDays = cells.filter((c) => c.level > 0).length;
    const anyBefore = cells.some((c) => c.before);
    const caption =
      `Each square is a day, darker to brighter by hours at it: ${count(withDays, 'day')} of the last ${count(weeks, 'week')} had some.` +
      (anyBefore ? ' Outlined squares are before the first sitting on record, which is not the same as a day off.' : '');
    grid = { weeks, cells, months: gridMonths(now, weeks), caption };
  } else {
    grid = { refusal: 'The day by day graph has not loaded yet.' };
  }

  const refusals: string[] = [];
  const peakM = metric(corpus, 'peak_hour');
  const nightM = metric(corpus, 'night_share');
  const peakHour = isNum(peakM?.value) ? Math.round(peakM.value as number) : null;
  const nightShare = isNum(nightM?.value) ? (nightM.value as number) : null;
  const hourSaid = (h: number) => {
    const t = h % 12 === 0 ? 12 : h % 12;
    return `${t}${h < 12 ? 'am' : 'pm'}`;
  };
  if (peakHour === null) {
    const why = corpus ? metricRefusal(corpus, 'peak_hour') : 'the server has not sent its profile';
    if (why) refusals.push(sentence(`The hour you build most is not shown: ${why}`));
  }
  if (nightShare === null) {
    const why = corpus ? metricRefusal(corpus, 'night_share') : null;
    if (why) refusals.push(sentence(`Night work is not shown: ${why}`));
  }

  const ledger: LedgerRow[] = [];
  const notes: string[] = [];
  const longest = card(report, 'longest_session');
  const longestSaid = longest ? renderCard(longest) : null;
  if (longest && !longest.reason && isNum(longest.value)) {
    ledger.push({
      key: 'longest',
      num: numSpec(longest.value, floorMins(longest.value), { kind: 'floorMins' }),
      label: 'your longest session',
      note: longestSaid?.sentence ?? null,
    });
  }
  const deep = card(report, 'deep_sessions');
  const deepSaid = deep ? renderCard(deep) : null;
  if (deep && !deep.reason && isNum(deep.value) && deep.value > 0) {
    ledger.push({ key: 'deep', num: numSpec(deep.value, n(deep.value)), label: deep.value === 1 ? 'session past an hour' : 'sessions past an hour', note: deepSaid?.sentence ?? null });
  }
  const contrib = report?.contributions ?? null;
  if (contrib && contrib.longest_streak > 0) {
    ledger.push({
      key: 'commitStreak',
      num: numSpec(contrib.longest_streak, n(contrib.longest_streak)),
      label: contrib.longest_streak === 1 ? 'day with a commit' : 'days in a row with a commit',
      note: streakLine(contrib) ?? `${count(contrib.active_days, 'day')} in all had a commit, with an agent in the room or not.`,
    });
  }

  const busiest = metric(corpus, 'busiest_day');
  if (busiest && typeof busiest.value === 'string') {
    const day = localDateLabel(busiest.value, now);
    const secs = isNum(busiest.attended_seconds) ? busiest.attended_seconds : null;
    if (day) notes.push(secs !== null ? `Your longest day was ${day}, ${duration(secs)} with you there.` : `Your longest day was ${day}.`);
  }
  const shipping = metric(corpus, 'shipping_day');
  if (shipping && typeof shipping.value === 'string') {
    const day = localDateLabel(shipping.value, now);
    const lines = isNum(shipping.lines_added) ? shipping.lines_added : null;
    if (day) notes.push(lines !== null ? `The most code landed on ${day}: ${tally(lines, 'line')}.` : `The most code landed on ${day}.`);
  }

  return {
    streak,
    grid,
    clock: {
      peakHour,
      peak: peakHour !== null ? numSpec(peakHour, hourSaid(peakHour), { kind: 'hour' }) : null,
      peakLine: peakHour !== null ? `You build most at ${hourSaid(peakHour)}.` : null,
      nightShare,
      night: nightShare !== null ? numSpec(nightShare * 100, pct(nightShare)) : null,
      nightLine: nightShare !== null ? `${pct(nightShare)} of your active time falls between 10pm and 4am.` : null,
      refusals,
    },
    ledger,
    notes,
  };
}

// ------------------------------------------------------------------ 3 shipping

const LINES_BASIS: Record<string, string> = {
  project_edit_tools_and_credited_shell_writes: "Counted from the agent's edits and the shell writes credited to it, in project files.",
  edit_tools_only: "Counted from the agent's edit tools only. Files it wrote through the shell are not in it.",
  uploaded_agent_lines: 'Counted from the line counts each session uploaded.',
};

export function shippingOf(b: BuilderProfileResponse): ShippingModel {
  const report = b.report ?? null;

  let diff: ShippingModel['diff'];
  const money = report?.money ?? null;
  if (!report) diff = { refusal: NO_REPORT };
  else if (!money || (money.lines_added == null && money.lines_removed == null)) diff = refused(REFUSALS.no_line_counts as string);
  else {
    const a = money.lines_added ?? null;
    const r = money.lines_removed ?? null;
    const total = (a ?? 0) + (r ?? 0);
    diff = {
      added: a !== null ? numSpec(a, `+${commas(a)}`) : null,
      removed: r !== null ? numSpec(r, `-${commas(r)}`) : null,
      addedShare: total > 0 ? (a ?? 0) / total : 1,
      basis: LINES_BASIS[money.lines_basis] ?? 'Counted from the lines the agent wrote.',
      note: a !== null && r === null ? 'Lines removed are not counted by this Mac yet, so there is no red side.' : null,
    };
  }

  let commits: ShippingModel['commits'];
  const c = report?.contributions ?? null;
  const shipped = card(report, 'shipped');
  const assisted = c ? c.assisted : shipped && !shipped.reason && isNum(shipped.extras.assisted) ? shipped.extras.assisted : null;
  const alone = c ? c.alone : shipped && !shipped.reason && isNum(shipped.extras.alone) ? shipped.extras.alone : null;
  if (assisted !== null && alone !== null && assisted + alone > 0) {
    const total = assisted + alone;
    commits = {
      total: numSpec(total, commas(total)),
      assisted,
      alone,
      assistedText: `${commas(assisted)} with an agent in the room`,
      aloneText: `${commas(alone)} on your own`,
      sentence: `A commit counts as with an agent when it landed during a session or in the ${LOOKBACK_MINUTES} minutes before one. Anything the capture never saw counts as your own.`,
    };
  } else if (!report) {
    commits = { refusal: NO_REPORT };
  } else if (shipped?.reason === 'no_commit_history' || (shipped && shipped.extras.commits == null && !c)) {
    commits = refused(REFUSALS.no_commit_history as string);
  } else {
    commits = { refusal: 'Commits are split by whether an agent was in the room once there are enough of them, and this report has too few.' };
  }

  let languages: ShippingModel['languages'];
  const L = report?.languages ?? null;
  if (!report) languages = { refusal: NO_REPORT };
  else if (!L) languages = { refusal: 'No session in this window had a write the Mac could count, so there is no language to split.' };
  else if (!L.languages || L.languages.length === 0) languages = refused(L.reason ?? 'there were too few attributable lines to split');
  else {
    languages = {
      rows: L.languages.map((x) => ({
        name: x.name === 'other' ? 'Everything else' : x.name,
        lines: numSpec(x.lines, commas(x.lines)),
        share: x.share,
        shareText: shareWords(x.share),
        files: count(x.files, 'file'),
        other: x.name === 'other',
      })),
      total: `${tally(L.lines, 'line')} the agent added, by the language of the file.`,
      note: L.generated_lines_excluded > 0 ? `${tally(L.generated_lines_excluded, 'generated line')} in lockfiles and generated files are left out.` : null,
    };
  }

  let kind: ShippingModel['kind'];
  const k = card(report, 'kind_of_work');
  const ks = k ? renderCard(k) : null;
  if (k && ks && !k.reason && ks.display) {
    const roleLines = (k.extras.role_lines ?? []).filter((r) => r.lines > 0).sort((x, y) => y.lines - x.lines);
    const roleTotal = roleLines.reduce((s, r) => s + r.lines, 0);
    const kinds = (k.extras.kinds ?? []).filter((x) => x.commits > 0);
    let kindsSaid: string | null = null;
    if (kinds.length && isNum(k.extras.classified) && isNum(k.extras.commits)) {
      const said = kinds.map((x) => count(x.commits, KIND_NOUN[x.kind][0], KIND_NOUN[x.kind][1])).join(', ');
      kindsSaid =
        k.basis === 'commit_subject_labels'
          ? `By commit subject: ${said}.`
          : `${commas(k.extras.classified)} of ${commas(k.extras.commits)} commit subjects say what kind of change they are, too few to go on, so this reads the files instead. Those that do: ${said}.`;
    }
    kind = {
      display: ks.display,
      sentence: ks.sentence,
      roles: roleLines.map((r) => ({
        key: r.role,
        label: `${ROLE_WORD[r.role] ?? r.role} files`,
        lines: r.lines,
        text: roleTotal > 0 ? `${commas(r.lines)}, ${shareWords(r.lines / roleTotal)}` : commas(r.lines),
      })),
      kinds: kindsSaid,
    };
  } else {
    kind = cardRefusal(report, 'kind_of_work');
  }

  return { diff, commits, languages, kind };
}

// ------------------------------------------------------------------ 4 with your agent

export function agentWorkOf(b: BuilderProfileResponse): AgentWorkModel {
  const report = b.report ?? null;

  let steer: AgentWorkModel['steer'];
  const cc = card(report, 'change_course');
  const ccs = cc ? renderCard(cc) : null;
  if (cc && ccs && !cc.reason && isNum(cc.value)) {
    steer = { num: numSpec(cc.value * 100, pct(cc.value)), caption: 'of the time, you stop the agent or redirect it', sentence: ccs.sentence };
  } else steer = cardRefusal(report, 'change_course');

  let style: AgentWorkModel['style'];
  const ws = rendered(report, 'work_style');
  if (ws && ws.display) style = { display: ws.display, sentence: ws.sentence };
  else style = cardRefusal(report, 'work_style');

  let prompt: AgentWorkModel['prompt'];
  const pl = card(report, 'prompt_length');
  const pls = pl ? renderCard(pl) : null;
  if (pl && pls && !pl.reason && isNum(pl.value) && isNum(pl.extras.median)) {
    const median = pl.extras.median;
    const label = median < SHORT_PROMPT_WORDS ? 'Mostly terse.' : median < PROMPT_BRIEF_WORDS ? 'Mostly conversational.' : 'Mostly detailed briefs.';
    prompt = {
      mean: numSpec(pl.value, n(pl.value)),
      median: numSpec(median, n(median)),
      meanValue: pl.value,
      medianValue: median,
      label,
      terse: SHORT_PROMPT_WORDS,
      brief: PROMPT_BRIEF_WORDS,
      sentence: `Counted in words over ${count(pl.n, 'prompt')} you typed. Under ${SHORT_PROMPT_WORDS} words reads as terse, ${PROMPT_BRIEF_WORDS} and up as a written brief.`,
    };
  } else prompt = cardRefusal(report, 'prompt_length');

  let perSession: AgentWorkModel['perSession'];
  const ps = card(report, 'prompts_per_session');
  if (ps && !ps.reason && isNum(ps.value)) {
    const depth = ps.extras.tool_calls_per_prompt;
    perSession = {
      num: numSpec(ps.value, n(ps.value)),
      median: isNum(ps.extras.median) ? `Half your sessions have ${n(ps.extras.median)} or fewer.` : null,
      toolCalls: isNum(depth) ? numSpec(depth, n(depth)) : null,
    };
  } else perSession = cardRefusal(report, 'prompts_per_session');

  const wsCard = card(report, 'work_style');
  const autonomyV = wsCard && !wsCard.reason ? wsCard.extras.autonomy : null;
  const autonomy = isNum(autonomyV) ? numSpec(autonomyV * 100, pct(autonomyV)) : null;

  let clean: AgentWorkModel['clean'];
  const p = report?.prompting ?? null;
  if (!report) clean = { refusal: NO_REPORT };
  else if (!p) clean = { refusal: 'Neither pile of prompts has enough in it to be a rate yet.' };
  else if (!isNum(p.clean_share) || !isNum(p.clean)) clean = refused(p.reason ?? 'there are too few instructions to be a rate');
  else {
    clean = {
      num: numSpec(p.clean_share * 100, pct(p.clean_share)),
      sentence: `${commas(p.clean)} of ${commas(p.attempts)} instructions landed something without a correction or a long stall.`,
    };
  }

  let dimensions: AgentWorkModel['dimensions'];
  const bp = b.builder_profile ?? null;
  const views = dimensionViews(bp);
  if (bp && views.length) {
    dimensions = {
      rows: views.map((d) => ({
        key: d.dimension,
        label: d.label,
        mean: numSpec(d.mean, String(d.mean)),
        value: d.mean,
        hue: DIMENSION_HUE[d.dimension],
        trend: d.trend.words,
      })),
      basis: `Averaged over ${count(bp.sessions_analysed, 'analysed session')} in the last ${n(bp.window_days)} days, 0 to 100 each.`,
      archetypeLine: modalArchetypeLine(bp),
    };
  } else {
    dimensions = {
      refusal: `The five dimensions (steering, execution, engineering, product instinct, planning) are read one analysed session at a time. ${dimensionsPending(b.sessions_analysed, b.min_sessions)}`,
    };
  }

  const tags = bp && bp.tags.length ? `Sessions most often read as ${bp.tags.slice(0, 5).map((t) => t.tag.replace(/_/g, ' ')).join(', ')}.` : null;
  const patterns = (bp?.decision_patterns ?? []).slice(0, 3).map((x) => ({ text: `${x.pattern}, in ${count(x.sessions, 'session')}`, example: x.example }));

  return { steer, style, prompt, perSession, autonomy, clean, dimensions, tags, patterns };
}

// ------------------------------------------------------------------ 5 agents

export function agentsOf(b: BuilderProfileResponse): AgentsModel {
  const report = b.report ?? null;
  const at = card(report, 'agents_at_once');
  const ats = at ? renderCard(at) : null;
  const sessionsAtOnce = at && ats && !at.reason && ats.display ? { display: ats.display, sentence: ats.sentence } : null;
  if (!report) return { body: { refusal: NO_REPORT }, sessionsAtOnce };
  const a: ReportAgents | null = report.agents ?? null;
  if (!a || a.agents <= 0) {
    return {
      body: { refusal: 'No helper agent transcripts were found, which is the normal state for someone who has never handed work to one.' },
      sessionsAtOnce,
    };
  }
  const busyShare = a.wall_seconds > 0 ? a.busy_seconds / a.wall_seconds : null;
  return {
    body: {
      peak: numSpec(a.max_concurrent, n(a.max_concurrent)),
      agents: numSpec(a.agents, commas(a.agents)),
      types: a.by_type.map((t) => ({ name: t.name === 'unknown' ? 'type not recorded' : t.name, agents: t.agents, text: commas(t.agents) })),
      parallel: numSpec(a.parallelism, n(a.parallelism)),
      work: numSpec(a.agent_seconds, duration(a.agent_seconds), { kind: 'duration' }),
      busy:
        busyShare !== null
          ? `An agent was running for ${duration(a.busy_seconds)} of the ${duration(a.wall_seconds)} from the first one starting to the last one stopping, ${shareWords(busyShare)} of that stretch.`
          : `An agent was running for ${duration(a.busy_seconds)} in all.`,
      waste: fanoutWaste(a),
      line: `${count(a.agents, 'agent')}, ${shortDuration(a.agent_seconds)} of agent work between them.`,
    },
    sessionsAtOnce,
  };
}

// ------------------------------------------------------------------ 6 money and burn

/** What a stretch that changed nothing was doing, by cause, said plainly and never as a fault. */
export const CAUSE_LABEL: Record<BurnCause, string> = {
  context_replay: 'Re-reading the conversation so far',
  subagent_fanout: 'Handing work to helper agents',
  error_loop: 'Failing tool calls and the retries after them',
  repeated_call: 'Making the same call again',
  file_churn: 'Rewriting the same file',
  compaction: 'Rebuilding the context after it was summarised',
  investigated: 'Reading files',
};

/** The owner's question, answered under the number: it is not a bill. */
export const NOT_WHAT_YOU_PAY =
  "What these tokens would cost at Anthropic's API list prices. On a subscription you pay your plan, not this.";

function familyOf(model: string): string {
  const m = /claude-([a-z]+)/.exec(model);
  return m?.[1] ?? model;
}

export function moneyOf(b: BuilderProfileResponse, now: number): MoneyModel {
  const report = b.report ?? null;
  const view = moneyView(b.corpus, report, now);

  let body: MoneyModel['body'];
  if (!view) body = { refusal: 'Nothing has been priced yet: neither your Mac nor the server has sent a spend.' };
  else if (view.usd === null) body = { refusal: view.refusal ?? 'There is no price to show yet.' };
  else {
    const m = report?.money ?? null;
    let tokens: Extract<MoneyModel['body'], { usd: NumSpec }>['tokens'] = null;
    if (m?.tokens) {
      const t = m.tokens;
      const total = t.input + t.output + t.cache_read + t.cache_w5m + t.cache_w1h;
      if (total > 0) {
        const buckets = [
          { key: 'cache_read', label: 'cache reads', tokens: t.cache_read },
          { key: 'cache_write', label: 'cache writes', tokens: t.cache_w5m + t.cache_w1h },
          { key: 'output', label: 'output', tokens: t.output },
          { key: 'input', label: 'fresh input', tokens: t.input },
        ]
          .filter((x) => x.tokens > 0)
          .map((x) => ({ ...x, text: `${human(x.tokens)}, ${shareWords(x.tokens / total)}` }));
        tokens = { total: numSpec(total, human(total), { kind: 'tokens' }), label: view.tokens?.label ?? 'tokens', buckets };
      }
    }
    const without = m ? withoutACommit(m) : null;
    body = {
      usd: numSpec(view.usd, dollars(view.usd)),
      label: view.label,
      models: view.models.map((x) => ({ key: x.key, name: x.name, usd: x.usd, text: dollars(x.usd), meta: x.meta, family: familyOf(x.key) })),
      tokens,
      perHour: m && isNum(m.usd_per_active_hour) ? numSpec(m.usd_per_active_hour, dollars(m.usd_per_active_hour)) : null,
      without: without ? { sentence: sentence(without), share: m?.share_without_a_commit ?? null } : null,
      unpriced:
        m && m.unpriced_sessions > 0
          ? `${count(m.unpriced_sessions, 'session')} with a model the price table does not know ${m.unpriced_sessions === 1 ? 'is' : 'are'} left out.`
          : null,
    };
  }

  let burn: MoneyModel['burn'] = null;
  const B = report?.burn ?? null;
  if (report && B) {
    const line = corpusBurnLine(B);
    if (line && isNum(B.share)) {
      const total = B.tokens ?? null;
      const unreadable = B.unreadable_tokens ?? null;
      const unreadableShare = isNum(unreadable) && isNum(total) && total > 0 ? unreadable / total : null;
      burn = {
        line: sentence(line),
        share: isNum(total) && total > 0 && isNum(B.barren_tokens) ? B.barren_tokens / total : B.share,
        unreadableShare,
        unreadableLine:
          unreadableShare !== null && unreadableShare > 0
            ? sentence(`${shareWords(unreadableShare)} more went into stretches the transcripts cannot judge either way`)
            : null,
        causes: (B.causes ?? [])
          .filter((c) => c.tokens > 0)
          .sort((x, y) => y.share - x.share)
          .map((c) => ({
            key: c.cause,
            label: CAUSE_LABEL[c.cause] ?? c.cause.replace(/_/g, ' '),
            share: c.share,
            text: shareWords(c.share),
            stretches: `${human(c.tokens)} tokens, in ${commas(c.segments)} ${c.segments === 1 ? 'stretch' : 'stretches'}`,
          })),
      };
    } else if (B.share === 0 || B.barren_tokens === 0) {
      burn = { refusal: 'No tokens went into a stretch that changed nothing.' };
    } else {
      const r = corpusBurnRefusal(B);
      burn = r ? refused(r) : null;
    }
  }
  return { body, burn };
}

// ------------------------------------------------------------------ 7 you against you

const SHARE_METRICS = new Set(['night_share', 'ships_rate', 'autonomy_score', 'steer_rate', 'short_prompt_share', 'barren_token_share', 'first_try_rate']);

/** A trend's value in its own unit: a share as a percent, dollars as dollars, the rest said by `n`. */
export function trendValue(metricKey: string, v: number): string {
  if (SHARE_METRICS.has(metricKey)) return pct(v);
  if (metricKey.endsWith('_usd')) return dollars(v);
  return n(v);
}

export function trendsOf(b: BuilderProfileResponse): TrendsModel {
  const report = b.report ?? null;
  if (!report) return { headline: null, trends: [], basis: null, refusal: NO_REPORT };
  const trends = report.trends.map((t): TrendModel => {
    const verdict = trendVerdict(t);
    const words = trendWords(t);
    const pctMove = Math.round(Math.abs(t.move) * 100);
    return {
      key: t.metric,
      label: capital(t.label),
      before: t.before,
      now: t.now,
      beforeText: trendValue(t.metric, t.before),
      nowText: trendValue(t.metric, t.now),
      move: t.direction === 'steady' ? null : numSpec(pctMove, words, { kind: 'fixed', decimals: 0, grouping: true, prefix: `${t.direction} `, suffix: '%' }),
      words,
      verdict: verdict === 'good' ? 'the way you want it' : verdict === 'bad' ? 'not the way you want it' : null,
      good: verdict === 'good',
      direction: t.direction,
    };
  });
  const first = report.trends[0];
  return {
    headline: report.trend_headline ?? null,
    trends,
    basis: first
      ? `Two equal windows back to back: ${count(first.sessions_before, 'session')} before, ${n(first.sessions_now)} now. A move under 15% is steady, and more is not always better, so only some moves get a verdict.`
      : null,
    refusal: trends.length ? null : 'Nothing moved enough between the two windows to call it a change, or one of them had too few sessions to compare.',
  };
}

// ------------------------------------------------------------------ 8 quality

export function qualityOf(b: BuilderProfileResponse): QualityModel {
  const report = b.report ?? null;
  if (!report) return { green: { refusal: NO_REPORT }, recovery: null };
  const q = report.quality ?? null;
  if (!q) return { green: { refusal: 'No repository was resolved for these sessions, so no test run could be read.' }, recovery: null };
  let green: QualityModel['green'];
  if (isNum(q.first_try_rate) && isNum(q.passed) && isNum(q.failed)) {
    green = {
      rate: numSpec(q.first_try_rate * 100, pct(q.first_try_rate)),
      passed: q.passed,
      failed: q.failed,
      runs: `${commas(q.passed)} of ${tally(q.runs, 'test run')} were green with no error after them.`,
      sentence: 'The share of test runs that were already green. Not whether each feature worked first time, which no transcript can see.',
    };
  } else {
    green = refused(q.reason ?? `${tally(q.runs, 'test run')} so far, too few to be a rate`);
  }
  let recovery: QualityModel['recovery'] = null;
  const g = q.time_to_green ?? null;
  if (g) {
    const dial: 'minute' | 'hour' | 'day' = g.median_seconds <= 60 ? 'minute' : g.median_seconds <= 3600 ? 'hour' : 'day';
    recovery = {
      median: numSpec(g.median_seconds, clock(g.median_seconds), { kind: 'clock' }),
      medianSeconds: g.median_seconds,
      dial,
      worst: `The longest took ${clock(g.worst_seconds)}.`,
      tries: g.median_attempts > 1 ? `Typically ${spokenRuns(g.median_attempts)} to get there.` : 'Typically the next run.',
      n: `${count(g.n, 'time')} a failing run came back to green.`,
    };
  } else if (isNum(q.failed) && q.failed > 0) {
    recovery = { refusal: 'Nothing in this window failed and then passed, so there is no time back to green.' };
  }
  return { green, recovery };
}

function spokenRuns(k: number): string {
  return `${n(k)} runs`;
}

// ------------------------------------------------------------------ 9 what stands out

export function standsOutOf(b: BuilderProfileResponse): StandsOutModel {
  const corpus = b.corpus ?? null;
  const facts = (corpus?.facts ?? []).filter((f) => typeof f.text === 'string' && f.text.trim()).map((f) => ({ key: f.id, text: sentence(f.text) }));
  const nv = narrativeView(b.narrative);
  return {
    facts,
    factsSource: corpus
      ? `Ranked by the server, most unusual first, over the ${count(corpus.sample.sessions, 'session')} it holds, so a count here can differ from your Mac's above.`
      : null,
    narrative: nv
      ? {
          paragraphs: nv.paragraphs,
          strengths: nv.strengths.map((s) => ({ text: s.text, evidence: s.evidence })),
          watchOuts: nv.watchOuts.map((s) => ({ text: s.text, evidence: s.evidence })),
          experiment: nv.experiment,
          provenance: nv.provenance,
        }
      : { refusal: 'The how you work page has not been written for this account yet. Run python -m capture narrative on your Mac and it appears here.' },
  };
}

// ------------------------------------------------------------------ 10 words and stack

export function wordsOf(b: BuilderProfileResponse, now: number): WordsModel {
  const report = b.report ?? null;
  let glossary: WordsModel['glossary'];
  const gv = report ? glossaryView(report.vocab, now) : null;
  if (!report) glossary = { refusal: NO_REPORT };
  else if (!gv) glossary = { refusal: 'Your Mac sent a report without the glossary.' };
  else if (gv.refusal) glossary = { refusal: gv.refusal };
  else {
    const catalog = report.vocab?.catalog_size ?? gv.found;
    glossary = { found: numSpec(gv.found, n(gv.found)), catalog, foundCount: gv.found, locked: gv.locked, summary: gv.summary };
  }

  let stack: WordsModel['stack'];
  const sv = report ? stackView(report.stack, now) : null;
  if (!report) stack = { refusal: NO_REPORT };
  else if (!sv) stack = { refusal: 'Your Mac sent a report without the stack.' };
  else if (sv.refusal) stack = { refusal: sv.refusal };
  else {
    stack = {
      total: numSpec(sv.total, n(sv.total)),
      groups: sv.groups.map((g) => ({
        label: g.label,
        count: g.items.length,
        names: g.items
          .slice(0, 4)
          .map((i) => i.name)
          .join(', ') + (g.items.length > 4 ? `, and ${n(g.items.length - 4)} more` : ''),
      })),
      summary: sv.summary,
    };
  }
  return { glossary, stack };
}

// ------------------------------------------------------------------ 11 what this cannot see

const SERVER_METRIC_LABEL: Record<string, string> = {
  avg_prompt_chars: 'Average prompt length in characters',
  median_prompt_chars: 'Median prompt length in characters',
  short_prompt_share: 'The share of one line prompts',
  planning_ratio: 'Planning against doing',
  steer_rate: 'How often you take the wheel back',
  tool_diversity: 'Different tools a sitting',
  test_runs_per_hour: 'How often you test',
  barren_token_share: 'Tokens that changed nothing',
  night_commit_share: 'Commits made at night',
  peak_hour: 'The hour you build most',
  night_share: 'Night work',
  code_velocity: 'Lines an hour',
  iteration_depth: 'Tool calls a prompt',
  autonomy_score: 'Time the agent runs alone',
};

/** Where the Mac's report fills in a number the server cannot compute, so the gap says so. */
function macFills(key: string, report: BuilderReport | null): boolean {
  if (!report) return false;
  const answered = (id: WrappedCard) => {
    const c = card(report, id);
    return Boolean(c && !c.reason);
  };
  const trended = (m: string) => report.trends.some((t) => t.metric === m);
  switch (key) {
    case 'avg_prompt_chars':
    case 'median_prompt_chars':
      return answered('prompt_length');
    case 'short_prompt_share':
      return trended('short_prompt_share');
    case 'planning_ratio':
      return trended('planning_ratio');
    case 'steer_rate':
      return answered('change_course');
    case 'tool_diversity':
      return trended('tool_diversity');
    case 'test_runs_per_hour':
      return Boolean(report.quality) || trended('test_runs_per_hour');
    case 'barren_token_share':
      return report.burn?.share != null;
    default:
      return false;
  }
}

export function gapsOf(b: BuilderProfileResponse): Gap[] {
  const report = b.report ?? null;
  const corpus = b.corpus ?? null;
  const gaps: Gap[] = [];

  if (!report) {
    gaps.push({ key: 'report', what: 'Most of this page', why: `${NO_REPORT} Run ${REPORT_COMMAND} there.`, group: 'open' });
  }

  for (const [key, reason] of Object.entries(corpus?.sample.missing ?? {})) {
    if (typeof reason !== 'string' || !reason.trim()) continue;
    const what = SERVER_METRIC_LABEL[key] ?? capital(key.replace(/_/g, ' '));
    gaps.push({ key: `server.${key}`, what, why: sentence(reason), group: macFills(key, report) ? 'mac' : 'open' });
  }

  if (corpus && corpus.totals.total_commits === null && corpus.totals.commit_basis === 'overlapping_session_windows') {
    gaps.push({
      key: 'server.total_commits',
      what: 'A server total of commits',
      why: 'Two sessions that ran at once in one repository both count the commits between them, so the server does not add them up rather than report a number that runs high. The commits above are counted once each, by your Mac.',
      group: report?.contributions ? 'mac' : 'open',
    });
  }

  if (report?.wrapped) {
    for (const c of report.wrapped.cards) {
      const r = renderCard(c);
      if (!r) continue;
      if (r.refusal) gaps.push({ key: `card.${c.id}`, what: r.question, why: sentence(r.refusal), group: 'open' });
      else if (r.local && !r.display) {
        gaps.push({
          key: `card.${c.id}`,
          what: r.question,
          why: 'It stays on your Mac: every number on it is a reading of what you typed. Turn on Quote my prompts in Settings to see it here.',
          group: 'open',
        });
      }
    }
  }

  if (report) {
    if (!report.agents) gaps.push({ key: 'agents', what: 'Helper agents', why: 'No helper agent transcripts were found in this window.', group: 'open' });
    if (report.quality?.reason) gaps.push({ key: 'quality', what: 'Tests going green', why: sentence(report.quality.reason), group: 'open' });
    if (report.prompting?.reason) gaps.push({ key: 'prompting', what: 'Prompts that land clean', why: sentence(report.prompting.reason), group: 'open' });
    if (report.languages?.reason) gaps.push({ key: 'languages', what: 'Languages', why: sentence(report.languages.reason), group: 'open' });
    const k = card(report, 'kind_of_work');
    if (k && !k.reason && k.extras.commit_refusal && isNum(k.extras.classified) && isNum(k.extras.commits)) {
      gaps.push({
        key: 'kind.commits',
        what: 'The kind of work, by commit subject',
        why: `Only ${commas(k.extras.classified)} of ${commas(k.extras.commits)} commit subjects say what kind of change they are, so the kind of work is read from the files the agent wrote.`,
        group: 'open',
      });
    }
  }

  if (!b.builder_profile) {
    gaps.push({
      key: 'dimensions',
      what: 'The five dimensions',
      why: `They are read one analysed session at a time. ${dimensionsPending(b.sessions_analysed, b.min_sessions)}`,
      group: 'open',
    });
  }
  if (b.narrative == null) {
    gaps.push({ key: 'narrative', what: 'How you work, in words', why: 'The narrative has not been written for this account yet.', group: 'open' });
  }
  gaps.push({
    key: 'hours',
    what: 'An hour by hour picture of your day',
    why: 'The server sends the hour you build most and your share of night work, not the hours in between, so the clock marks those two and draws nothing it was not sent.',
    group: 'open',
  });
  return gaps;
}

// ------------------------------------------------------------------ the page

export function analysisModel(b: BuilderProfileResponse, profile: Profile | null, now: number = Date.now()): AnalysisModel {
  return {
    coverage: coverageOf(b, now),
    hero: heroOf(b, profile),
    time: timeOf(b, profile, now),
    shipping: shippingOf(b),
    agentWork: agentWorkOf(b),
    agents: agentsOf(b),
    money: moneyOf(b, now),
    trends: trendsOf(b),
    quality: qualityOf(b),
    standsOut: standsOutOf(b),
    words: wordsOf(b, now),
    gaps: gapsOf(b),
    hasReport: Boolean(b.report),
  };
}

/** Every animated number in the model, for the tests: each must rest on the string it counts to. */
export function everyNum(m: AnalysisModel): NumSpec[] {
  const out: NumSpec[] = [];
  const walk = (x: unknown) => {
    if (!x || typeof x !== 'object') return;
    if (Array.isArray(x)) {
      for (const y of x) walk(y);
      return;
    }
    const o = x as Record<string, unknown>;
    if ('fmt' in o && 'final' in o && 'value' in o) {
      out.push(o as unknown as NumSpec);
      return;
    }
    for (const y of Object.values(o)) walk(y);
  };
  walk(m);
  return out;
}

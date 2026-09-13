/**
 * The report's projects block (report v3, docs/projects.md), turned into what a projects
 * screen draws. Pure: no React Native, so `bun test` holds every word here.
 *
 * WHAT ARRIVES. `report.projects` carries each project under its KEY, the repository's salted
 * hash, and nothing a person reads: ids, numbers, clocks and refusal codes. Beside the report
 * the server sends `project_names`, the PUBLIC name of each key that has one; a private
 * repository has none, and never will from the server. So a project is labelled, in order,
 * by its public name, by the owner's own label for it (kept on the phone, never uploaded:
 * `nicknames`), or as a private project with the first six characters of its key, which is
 * stable and says nothing about it (`projectLabel`).
 *
 * TWO SCOPES. Every project has `history`, every sitting the machine holds in it however old,
 * and `window`, the report's window only, null when nothing in it. A screen says which: the
 * stage, the streak and "last session" are history; the time, the cards, the money and the
 * comparisons are the window ("the last 30 days"). A project with a null window still has a
 * stage and a last session, and shows no window number at all, never a zero.
 *
 * THE WORDS are the engine's (`analysis/projects.py`), generated into `generated/copy.ts`
 * and filled here with `copy/numbers.fill`, the port of `profile.fill`. Every sentence with a
 * number is pinned to what Python says about the same wire input by
 * `spec/fixtures/projects/sentences.json` (`__tests__/projectsModel.test.ts`). No dash
 * anywhere. An id this build does not know renders nothing (null), never a debug string.
 */

import {
  PROJECT_COMPARISON_REFUSALS,
  PROJECT_COMPARISONS,
  PROJECT_LAST_SESSION,
  PROJECT_MOMENTUM,
  PROJECT_REFUSALS,
  PROJECT_STAGE_DISPLAY,
  PROJECT_STAGE_SENTENCES,
  PROJECT_CONSTANTS,
} from '../generated/copy';
import type {
  ComparisonMetric,
  Harness,
  ProjectStage,
  ReportProject,
  ReportProjectClock,
  ReportProjectComparison,
  ReportProjectCostPerCommit,
  ReportProjectHistory,
  ReportProjectLanguages,
  ReportProjectMomentum,
  ReportProjectQuality,
  ReportProjects,
  StackItem,
  TrendDirection,
} from '../generated/report';
import { corpusBurnLine, corpusBurnRefusal } from '../copy/burn';
import { dollars, linesAdded, linesRemoved, modelLine, moneyHeadline, moneyRefusal, perActiveHour, withoutACommit } from '../copy/money';
import { type FillTemplate, fill, n, shareWords } from '../copy/numbers';
import { stackName } from '../copy/vocab';
import { type RenderedCard, renderCards } from '../copy/wrapped';

// ------------------------------------------------------------------ labels

export type LabelSource = 'public' | 'nickname' | 'private';

export interface ProjectLabel {
  text: string;
  /** Where the words came from, so a screen can offer "Name this project" on a private one. */
  source: LabelSource;
}

/** The key as `GET /v1/profile` lists projects, and as `GET /v1/projects/{key}` accepts it. */
export function shortKey(key: string): string {
  return key.slice(0, 12);
}

/**
 * What a project is called on this phone: its public name from the server, else the owner's
 * own label for it (stored on the phone, never sent), else "Private project" and six
 * characters of its key. Never a name the server did not send and the owner did not type.
 */
export function projectLabel(
  key: string,
  names?: Readonly<Record<string, string>> | null,
  nicknames?: Readonly<Record<string, string>> | null,
): ProjectLabel {
  const pub = names?.[key]?.trim();
  if (pub) return { text: pub, source: 'public' };
  const own = nicknames?.[key]?.trim();
  if (own) return { text: own, source: 'nickname' };
  return { text: `Private project ${key.slice(0, 6)}`, source: 'private' };
}

// ------------------------------------------------------------------ the sentences (ports)

type ComparisonSpec = { says: 'share' | 'number' | 'usd'; kind: 'ratio' | 'share'; label: string; times?: string; none?: string; share?: string };
const COMPARISONS = PROJECT_COMPARISONS as unknown as Readonly<Record<string, ComparisonSpec | undefined>>;
const COMPARISON_REFUSALS = PROJECT_COMPARISON_REFUSALS as unknown as Readonly<Record<string, FillTemplate | undefined>>;
const REFUSALS = PROJECT_REFUSALS as unknown as Readonly<Record<string, FillTemplate | undefined>>;
const STAGE_SENTENCES = PROJECT_STAGE_SENTENCES as unknown as Readonly<Record<string, FillTemplate | undefined>>;
const STAGE_DISPLAY = PROJECT_STAGE_DISPLAY as unknown as Readonly<Record<string, string | undefined>>;
const MOMENTUM = PROJECT_MOMENTUM as unknown as Readonly<Record<string, FillTemplate | undefined>>;

/** `projects.times_words`: "twice" at 2, "3.4 times" otherwise, one decimal at most. */
export function timesWords(ratio: number): string {
  const said = n(ratio);
  return said === '2' ? 'twice' : `${said} times`;
}

/** `projects.value_words`: a compared value as the sentences say it, by the metric's `says`. */
export function valueWords(metric: ComparisonMetric | string, v: number): string | null {
  const spec = COMPARISONS[metric];
  if (!spec) return null;
  if (spec.says === 'share') return shareWords(v);
  if (spec.says === 'usd') return dollars(v);
  return n(v);
}

/** The title a comparison is shown under ("How often you run the tests"). */
export function comparisonTitle(metric: ComparisonMetric | string): string | null {
  return COMPARISONS[metric]?.label ?? null;
}

function labelOf(key: string | null, labels: Readonly<Record<string, string>>): string {
  return (key && labels[key]) || 'this project';
}

/**
 * `projects.comparison_sentence`: one comparison, answered or refused, with the projects
 * named by `labels` (key to label text). Null for a metric or a code this build does not know.
 */
export function comparisonSentence(c: ReportProjectComparison, labels: Readonly<Record<string, string>>): string | null {
  const spec = COMPARISONS[c.metric];
  if (!spec) return null;
  if (c.reason === 'fewer_than_two_projects') {
    const t = COMPARISON_REFUSALS.fewer_than_two_projects;
    return t === undefined ? null : fill(t, { n: c.projects, needed: c.needed ?? null });
  }
  const high = labelOf(c.high ?? null, labels);
  const low = labelOf(c.low ?? null, labels);
  if (c.high_value == null || c.low_value == null) return null;
  if (c.reason === 'within_noise' || c.reason === 'floors_only') {
    // Both numbers travel, and no difference is stated: close, or two floors that fall
    // short by different amounts (`projects.COMPARISONS` `floor`).
    const t = COMPARISON_REFUSALS[c.reason];
    return t === undefined ? null : fill(t, { high, low, high_value: valueWords(c.metric, c.high_value), low_value: valueWords(c.metric, c.low_value) });
  }
  if (c.reason != null) return null;
  if (spec.kind === 'share') {
    return spec.share === undefined ? null : fill(spec.share, { high, low, high_share: valueWords(c.metric, c.high_value), low_share: valueWords(c.metric, c.low_value) });
  }
  if (c.ratio == null) return spec.none === undefined ? null : fill(spec.none, { high, low });
  return spec.times === undefined ? null : fill(spec.times, { high, low, times: timesWords(c.ratio) });
}

type StageInput = Pick<ReportProjectHistory, 'stage' | 'stage_rule' | 'days_since_last' | 'age_days' | 'days_built_recent' | 'days_built_before'>;

/** `STAGE_DISPLAY`: "Winding down". Null for a stage this build does not know. */
export function stageLabel(stage: ProjectStage | string): string | null {
  return STAGE_DISPLAY[stage] ?? null;
}

/** `projects.stage_sentence`: the stage's sentence, from the rule that decided it. */
export function stageSentence(h: StageInput): string | null {
  const t = STAGE_SENTENCES[h.stage_rule];
  if (t === undefined) return null;
  const count =
    h.stage_rule === 'quiet_two_weeks' || h.stage_rule === 'quiet_a_week'
      ? h.days_since_last
      : h.stage_rule === 'new_this_fortnight'
        ? h.age_days
        : h.days_built_recent;
  return fill(t, { n: count, prior: h.days_built_before, cadence_days: PROJECT_CONSTANTS.cadence_days });
}

/** `projects.last_session_sentence`: "Last session yesterday." */
export function lastSessionSentence(h: Pick<ReportProjectHistory, 'days_since_last'>): string | null {
  return fill(PROJECT_LAST_SESSION, { n: h.days_since_last });
}

/** `projects.momentum_sentence`: the week against the week before, or why it is not said. */
export function momentumSentence(m: ReportProjectMomentum): string | null {
  if (m.reason != null) {
    const t = MOMENTUM[m.reason];
    return t === undefined ? null : fill(t, { needed: m.needed ?? null });
  }
  if (m.direction === 'steady') return typeof MOMENTUM.steady === 'string' ? MOMENTUM.steady : null;
  const t = m.direction == null ? undefined : MOMENTUM[m.direction];
  if (t === undefined || m.move == null) return null;
  return fill(t, { move: shareWords(Math.abs(m.move)) });
}

function refusal(code: string | null | undefined, count: number | null, needed: number | null | undefined): string | null {
  const t = code == null ? undefined : REFUSALS[code];
  return t === undefined ? null : fill(t, { n: count, needed: needed ?? null });
}

/** `projects.quality_refusal`. */
export function qualityRefusal(q: Pick<ReportProjectQuality, 'reason' | 'runs' | 'needed'>): string | null {
  return refusal(q.reason, q.runs, q.needed);
}

/** `projects.languages_refusal`. */
export function languagesRefusal(l: Pick<ReportProjectLanguages, 'reason' | 'lines' | 'needed'>): string | null {
  return refusal(l.reason, l.lines, l.needed);
}

/** `projects.clock_refusal`. */
export function clockRefusal(c: Pick<ReportProjectClock, 'reason' | 'active_minutes' | 'needed_minutes'>): string | null {
  return refusal(c.reason, c.active_minutes, c.needed_minutes);
}

/** `projects.cost_refusal`: the count its template names is the unpriced sittings for that code, else the commits. */
export function costRefusal(c: Pick<ReportProjectCostPerCommit, 'reason' | 'commits' | 'unpriced_sessions' | 'needed'>): string | null {
  return refusal(c.reason, c.reason === 'unpriced_sessions' ? c.unpriced_sessions : c.commits, c.needed);
}

// ------------------------------------------------------------------ view models

export interface ComparisonSide {
  key: string;
  label: ProjectLabel;
  /** The value as the sentence says it: "42%", "10.4", "$38.26". */
  value: string;
  sessions: number;
}

export interface ComparisonView {
  metric: ComparisonMetric;
  title: string;
  sentence: string;
  /** True when there is a difference to state; a refusal still has its sentence. */
  answered: boolean;
  high: ComparisonSide | null;
  low: ComparisonSide | null;
}

export interface WindowSummary {
  sessions: number;
  activeSeconds: number;
  attendedSeconds: number;
  autonomousSeconds: number;
  activeDays: number;
  /** This project's share of your attended time in the window, as a share and in words. */
  share: number | null;
  shareWords: string | null;
}

export interface ProjectRow {
  key: string;
  shortKey: string;
  rank: number;
  label: ProjectLabel;
  stage: ProjectStage;
  stageLabel: string | null;
  stageSentence: string | null;
  lastSession: string | null;
  momentum: string | null;
  momentumDirection: TrendDirection | null;
  /** Every sitting the machine holds here, however old. */
  history: {
    sessions: number;
    attendedSeconds: number;
    activeSeconds: number;
    /** The local days, "YYYY-MM-DD". */
    firstDay: string;
    lastDay: string;
    longestStreak: number | null;
    currentStreak: number | null;
  };
  /** The report window only; null when nothing ran here in it. */
  window: WindowSummary | null;
}

export interface ProjectsView {
  windowDays: number;
  rows: ProjectRow[];
  /** Repositories the machine holds that the list does not show (the list is capped). */
  hidden: number;
  unresolved: { sessions: number; attendedSeconds: number; historySessions: number };
  comparisons: ComparisonView[];
}

export interface ProjectDetail extends ProjectRow {
  /** The Wrapped cards asked of this project, rendered by the deck's own renderer. */
  cards: RenderedCard[];
  /** The local hour, 0 to 23, the most active time falls in. A number: the screen writes it in the house clock. */
  peakHour: number | null;
  peakHourRefusal: string | null;
  tests: { runs: number; alreadyGreen: string | null; backToGreenSeconds: number | null; refusal: string | null } | null;
  languages: { rows: { language: string; share: string; lines: number }[]; refusal: string | null } | null;
  commits: { assisted: number; alone: number; days: { day: string; assisted: number; alone: number }[] } | null;
  money: {
    headline: string | null;
    refusal: string | null;
    perHour: string | null;
    perCommit: string | null;
    perCommitRefusal: string | null;
    withoutACommit: string | null;
    models: string[];
    linesAdded: string | null;
    linesRemoved: string | null;
  } | null;
  burn: { line: string | null; refusal: string | null } | null;
  stack: { id: StackItem; name: string }[];
  harnesses: { harness: Harness; sessions: number; activeSeconds: number }[];
  agents: { agents: number; atOnce: number } | null;
  comparisons: ComparisonView[];
}

function day(iso: string): string {
  // Already the local day, written as midnight UTC: the date part, never converted.
  return iso.slice(0, 10);
}

function labelsFor(block: ReportProjects, names?: Readonly<Record<string, string>> | null, nicknames?: Readonly<Record<string, string>> | null) {
  const out: Record<string, ProjectLabel> = {};
  const keys = new Set<string>(block.projects.map((p) => p.key));
  for (const c of block.comparisons) {
    if (c.high) keys.add(c.high);
    if (c.low) keys.add(c.low);
  }
  for (const k of keys) out[k] = projectLabel(k, names, nicknames);
  return out;
}

function row(p: ReportProject, labels: Record<string, ProjectLabel>): ProjectRow {
  const h = p.history;
  const w = p.window ?? null;
  return {
    key: p.key,
    shortKey: shortKey(p.key),
    rank: p.rank,
    label: labels[p.key] ?? projectLabel(p.key),
    stage: h.stage,
    stageLabel: stageLabel(h.stage),
    stageSentence: stageSentence(h),
    lastSession: lastSessionSentence(h),
    momentum: momentumSentence(h.momentum),
    momentumDirection: h.momentum.direction ?? null,
    history: {
      sessions: h.sessions,
      attendedSeconds: h.attended_seconds,
      activeSeconds: h.active_seconds,
      firstDay: day(h.first_at),
      lastDay: day(h.last_at),
      longestStreak: h.longest_streak_days ?? null,
      currentStreak: h.current_streak_days ?? null,
    },
    window: w && {
      sessions: w.sessions,
      activeSeconds: w.active_seconds,
      attendedSeconds: w.attended_seconds,
      autonomousSeconds: w.autonomous_seconds,
      activeDays: w.active_days,
      share: w.share_of_attended ?? null,
      shareWords: w.share_of_attended == null ? null : shareWords(w.share_of_attended),
    },
  };
}

function comparisonView(c: ReportProjectComparison, labels: Record<string, ProjectLabel>): ComparisonView | null {
  const title = comparisonTitle(c.metric);
  const text: Record<string, string> = {};
  for (const [k, v] of Object.entries(labels)) text[k] = v.text;
  const sentence = comparisonSentence(c, text);
  if (title === null || sentence === null) return null;
  const side = (key: string | null | undefined, value: number | null | undefined, sessions: number | null | undefined): ComparisonSide | null => {
    if (!key || value == null || sessions == null) return null;
    const said = valueWords(c.metric, value);
    return said === null ? null : { key, label: labels[key] ?? projectLabel(key), value: said, sessions };
  };
  return {
    metric: c.metric,
    title,
    sentence,
    answered: c.reason == null,
    high: side(c.high, c.high_value, c.high_sessions),
    low: side(c.low, c.low_value, c.low_sessions),
  };
}

/**
 * The projects list: one row per project in the block's own order (most of your time in the
 * window first), the comparisons, and what the list leaves out. Null when the report carries
 * no projects block (an older machine), which is "not computed", never "no projects".
 */
export function projectsView(
  block: ReportProjects | null | undefined,
  names?: Readonly<Record<string, string>> | null,
  nicknames?: Readonly<Record<string, string>> | null,
): ProjectsView | null {
  if (!block) return null;
  const labels = labelsFor(block, names, nicknames);
  return {
    windowDays: block.window_days,
    rows: block.projects.map((p) => row(p, labels)),
    hidden: Math.max(0, block.projects_total - block.projects.length),
    unresolved: {
      sessions: block.unresolved.sessions,
      attendedSeconds: block.unresolved.attended_seconds,
      historySessions: block.unresolved.history_sessions,
    },
    comparisons: block.comparisons.map((c) => comparisonView(c, labels)).filter((c): c is ComparisonView => c !== null),
  };
}

/**
 * One project's page. Null when the block does not hold the key (it may still have sessions:
 * `GET /v1/projects/{key}` lists them). Every window section is null when the window is.
 */
export function projectDetail(
  block: ReportProjects | null | undefined,
  key: string,
  names?: Readonly<Record<string, string>> | null,
  nicknames?: Readonly<Record<string, string>> | null,
  nowMs: number = Date.now(),
): ProjectDetail | null {
  if (!block) return null;
  const p = block.projects.find((x) => x.key === key || (key.length >= 12 && x.key.startsWith(key)));
  if (!p) return null;
  const labels = labelsFor(block, names, nicknames);
  const base = row(p, labels);
  const w = p.window ?? null;
  const comparisons = block.comparisons
    .filter((c) => c.high === p.key || c.low === p.key)
    .map((c) => comparisonView(c, labels))
    .filter((c): c is ComparisonView => c !== null);
  if (!w) {
    return { ...base, cards: [], peakHour: null, peakHourRefusal: null, tests: null, languages: null, commits: null, money: null, burn: null, stack: [], harnesses: [], agents: null, comparisons };
  }
  const q = w.quality;
  const money = w.money;
  const per = w.usd_per_commit;
  return {
    ...base,
    cards: renderCards(w.cards),
    peakHour: w.clock.peak_hour ?? null,
    peakHourRefusal: clockRefusal(w.clock),
    tests: {
      runs: q.runs,
      alreadyGreen: q.first_try_rate == null ? null : shareWords(q.first_try_rate),
      backToGreenSeconds: q.time_to_green?.median_seconds ?? null,
      refusal: qualityRefusal(q),
    },
    languages: {
      rows: (w.languages.languages ?? []).map((r) => ({ language: r.language, share: shareWords(r.share), lines: r.lines })),
      refusal: languagesRefusal(w.languages),
    },
    commits: w.commits
      ? {
          assisted: w.commits.assisted,
          alone: w.commits.alone,
          days: w.commits.days.map((d) => ({ day: day(d.day), assisted: d.assisted, alone: d.alone })),
        }
      : null,
    money: {
      headline: moneyHeadline(money, nowMs),
      refusal: moneyRefusal(money),
      perHour: perActiveHour(money),
      perCommit: per.usd == null ? null : `${dollars(per.usd)} a commit`,
      perCommitRefusal: costRefusal(per),
      withoutACommit: withoutACommit(money),
      models: money.by_model.map(modelLine),
      linesAdded: linesAdded(money),
      linesRemoved: linesRemoved(money),
    },
    burn: { line: corpusBurnLine(w.burn), refusal: corpusBurnRefusal(w.burn) },
    stack: w.stack.items.flatMap((i) => {
      const name = stackName(i.id);
      return name === null ? [] : [{ id: i.id, name }];
    }),
    harnesses: w.harnesses.map((h) => ({ harness: h.harness, sessions: h.sessions, activeSeconds: h.active_seconds })),
    agents: w.agents ? { agents: w.agents.agents, atOnce: w.agents.max_concurrent } : null,
    comparisons,
  };
}

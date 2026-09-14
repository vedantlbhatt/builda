/**
 * The report's projects block (report v3, docs/projects.md), turned into what a projects
 * screen draws. Pure: no React Native, so `bun test` holds every word here.
 *
 * WHAT ARRIVES. `report.projects` carries each project under its KEY, the repository's salted
 * hash, and nothing a person reads: ids, numbers, clocks and refusal codes. Beside the report
 * the server sends `project_names`, the PUBLIC name of each key that has one; a private
 * repository has none, and never will from the server. So a project is labelled, in order,
 * by its public name, by the owner's own label for it (kept on the phone, never uploaded:
 * `nicknames`), or as "Private project" and the number this phone gave it on first sight,
 * which is stable and says nothing about it (`projectLabel`, `registerProjects`).
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
import { dollars, linesAdded, linesRemoved, modelLine, modelName, moneyHeadline, moneyRefusal, perActiveHour, withoutACommit } from '../copy/money';
import { type FillTemplate, clock as clockSaid, commas, count, fill, floorMins, n, pct, shareWords } from '../copy/numbers';
import { hourOfDay } from '../copy/time';
import { stackName } from '../copy/vocab';
import { type RenderedCard, renderCards } from '../copy/wrapped';
import type { BuilderReport, ReportProjectsWeek, ReportWrappedCard } from '../generated/report';
import { numSpec, type NumSpec } from '../insights/format';
import { burnOf, NOT_WHAT_YOU_PAY, readSpan, type MoneyModel } from '../insights/model';
import { CREATURE_HUE, SPECTRUM, type HueName } from '../insights/palette';
import { resolveAnimal, type Animal } from '../pixel/animals';
import { archetypeDisplay, metricLabel, metricValue } from '../you/archetype';
import { SWARM_MAX } from './geometry';

// ------------------------------------------------------------------ labels

export type LabelSource = 'public' | 'nickname' | 'private';

/** A no-break space: a private project's number never wraps away from its words. */
const NBSP = '\u00a0';

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
 * own label for it (stored on the phone, never sent), else "Private project" and the number this
 * phone gave it (`registerProjects`). Never a name the server did not send and the owner did not
 * type, and NEVER A CHARACTER OF THE KEY.
 *
 * FOUND IN REVIEW (2026-09-13): the first version said "Private project" and six characters of
 * the key. The key is an HMAC under a pepper that ships in the open (`capture/tuning.py`), so
 * one guess at a repository's name (`builder-repo-v1|github.com/<you>/<repo>`) reproduces the
 * prefix, and any screenshot confirmed a private repository's name. A number the phone gives out
 * says nothing about the repository at all.
 *
 * The number is held to its words by a no-break space, so a narrow column (the money flow's
 * project labels) wraps "Private" over "project 2" and never leaves a number alone on a line.
 */
export function projectLabel(
  key: string,
  names?: Readonly<Record<string, string>> | null,
  nicknames?: Readonly<Record<string, string>> | null,
  number?: number | null,
): ProjectLabel {
  const pub = names?.[key]?.trim();
  if (pub) return { text: pub, source: 'public' };
  const own = nicknames?.[key]?.trim();
  if (own) return { text: own, source: 'nickname' };
  return { text: number != null && number > 0 ? `Private project${NBSP}${number}` : 'Private project', source: 'private' };
}

// ------------------------------------------------------------------ the phone's own register

/**
 * What this phone remembers about each project it has shown, by its full key, and never sends
 * anywhere: the number a private project is called by and the hue it wears. Both are given once,
 * the first time the phone sees the project, new projects in the order of their first sessions,
 * and a number is never given to another project, so "Private project 2" is the same project on
 * every launch and a project keeps its colour when an older one leaves the report's top 20. Kept
 * in the cache kv beside the owner's names (`nicknames.ts`), and cleared with them at sign out.
 */
export interface ProjectRegistry {
  /** The number the next project this phone has not seen gets. */
  next: number;
  projects: Readonly<Record<string, { n: number; hue: HueName }>>;
}

export const EMPTY_REGISTRY: ProjectRegistry = { next: 1, projects: {} };
export const REGISTRY_KEY = 'projects.registry.v1';

const HUE_SET: ReadonlySet<string> = new Set(['amber', 'brass', 'tide', 'cobalt', 'iris', 'heather', 'orchid', 'coral', 'ember']);

/** The saved register. Anything that is not a whole number and a hue for a real key is dropped, not repaired. */
export function parseRegistry(raw: string | null | undefined): ProjectRegistry {
  if (!raw) return EMPTY_REGISTRY;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return EMPTY_REGISTRY;
  }
  const o = v as { next?: unknown; projects?: unknown } | null;
  if (!o || typeof o !== 'object' || !o.projects || typeof o.projects !== 'object') return EMPTY_REGISTRY;
  const projects: Record<string, { n: number; hue: HueName }> = {};
  let top = 0;
  for (const [k, x] of Object.entries(o.projects as Record<string, unknown>)) {
    const e = x as { n?: unknown; hue?: unknown } | null;
    if (!/^[0-9a-f]{64}$/.test(k) || !e || !Number.isInteger(e.n) || (e.n as number) < 1 || typeof e.hue !== 'string' || !HUE_SET.has(e.hue)) continue;
    projects[k] = { n: e.n as number, hue: e.hue as HueName };
    top = Math.max(top, e.n as number);
  }
  // Never below a number already given: a hand edited `next` cannot make one given twice.
  const next = Number.isInteger(o.next) && (o.next as number) > top ? (o.next as number) : top + 1;
  return { next, projects };
}

/**
 * The register with every project in `projects` in it. A project already there keeps its number
 * and hue. The rest, oldest first by their first session (the key breaks a tie), each take the
 * next number, and the hue their key asks for (`preferredHue`) unless a project on this list
 * already wears it, in which case the next free one round the ring; when every hue is worn, the
 * one it asks for. `changed` says whether anything was given out, so a caller saves only then.
 */
export function registerProjects(
  registry: ProjectRegistry,
  projects: readonly { key: string; history: { first_at: string } }[],
): { registry: ProjectRegistry; changed: boolean } {
  const known = new Map(Object.entries(registry.projects));
  const fresh = projects
    .filter((p, i) => !known.has(p.key) && projects.findIndex((q) => q.key === p.key) === i)
    .sort((a, b) => (Date.parse(a.history.first_at) || 0) - (Date.parse(b.history.first_at) || 0) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  if (!fresh.length) return { registry, changed: false };
  const taken = new Set<HueName>(projects.flatMap((p) => (known.has(p.key) ? [known.get(p.key)!.hue] : [])));
  let next = registry.next;
  for (const p of fresh) {
    const want = preferredHue(p.key);
    let hue = want;
    if (taken.size < PROJECT_HUES.length) {
      const at = PROJECT_HUES.indexOf(want);
      for (let k = 0; k < PROJECT_HUES.length; k++) {
        const h = PROJECT_HUES[(at + k) % PROJECT_HUES.length]!;
        if (!taken.has(h)) {
          hue = h;
          break;
        }
      }
    }
    taken.add(hue);
    known.set(p.key, { n: next, hue });
    next += 1;
  }
  return { registry: { next, projects: Object.fromEntries(known) }, changed: true };
}

/**
 * Every listed project's label, the comparisons' too: `projectLabel` with each private project's
 * number from the register (given here, the same way the phone will save it, when the register
 * has not seen it yet). The one place a screen gets a project's name from.
 */
export function projectLabels(
  block: {
    projects: readonly { key: string; history: { first_at: string } }[];
    comparisons?: readonly { high?: string | null; low?: string | null }[];
  },
  names?: Readonly<Record<string, string>> | null,
  nicknames?: Readonly<Record<string, string>> | null,
  registry?: ProjectRegistry | null,
): Record<string, ProjectLabel> {
  const reg = registerProjects(registry ?? EMPTY_REGISTRY, block.projects).registry;
  const out: Record<string, ProjectLabel> = {};
  const keys = new Set<string>(block.projects.map((p) => p.key));
  for (const c of block.comparisons ?? []) {
    if (c.high) keys.add(c.high);
    if (c.low) keys.add(c.low);
  }
  for (const k of keys) out[k] = projectLabel(k, names, nicknames, reg.projects[k]?.n ?? null);
  return out;
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

/** The hour the day turns over, the app's one day rule (`theme.DAY_BOUNDARY_HOUR`, CLAUDE.md). */
const DAY_TURNS_AT_HOUR = 4;

/**
 * The local day an INSTANT falls on, "YYYY-MM-DD": the day turning at 04:00, in the zone
 * `offsetMinutes` east of UTC. The report carries instants (a first session's start, a last
 * session's end) and no zone, so the default is this phone's own offset at that instant.
 *
 * FOUND IN REVIEW (2026-09-13): the first version sliced the date off the instant, so a first
 * session at 2026-08-12T00:44:30Z, which was 20:44 on Aug 11 in New York, read "since Aug 12".
 * `day` above stays for the fields that are ALREADY local days written at midnight UTC (a week,
 * a commit day), which must never be moved to a zone.
 */
export function localDay(iso: string, offsetMinutes?: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso.slice(0, 10);
  const off = offsetMinutes ?? -new Date(t).getTimezoneOffset();
  const d = new Date(t + off * 60_000 - DAY_TURNS_AT_HOUR * 3_600_000);
  return [String(d.getUTCFullYear()), String(d.getUTCMonth() + 1).padStart(2, '0'), String(d.getUTCDate()).padStart(2, '0')].join('-');
}

/**
 * The languages with every `other` row made one, last. FOUND ON THE SIMULATOR (2026-09-13, the
 * real corpus): `languages.split` can send `other` twice for one project, once for an extension
 * nobody mapped that ranked in the top eight and once for the tail summed past them (52 and 30
 * lines here). Both mean "not a language the table names", so the page says it once, with both
 * counts added, rather than two rows with one name.
 */
export function oneOther<T extends { language: string; lines: number; files: number; share: number }>(rows: readonly T[]): T[] {
  const named = rows.filter((r) => r.language !== 'other');
  const other = rows.filter((r) => r.language === 'other');
  if (other.length <= 1) return [...named, ...other];
  const merged = other.reduce((a, r) => ({ ...a, lines: a.lines + r.lines, files: a.files + r.files, share: a.share + r.share }));
  return [...named, merged];
}

function labelsFor(
  block: ReportProjects,
  names?: Readonly<Record<string, string>> | null,
  nicknames?: Readonly<Record<string, string>> | null,
  registry?: ProjectRegistry | null,
): Record<string, ProjectLabel> {
  return projectLabels(block, names, nicknames, registry);
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
      firstDay: localDay(h.first_at),
      lastDay: localDay(h.last_at),
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
  registry?: ProjectRegistry | null,
): ProjectsView | null {
  if (!block) return null;
  const labels = labelsFor(block, names, nicknames, registry);
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
  registry?: ProjectRegistry | null,
): ProjectDetail | null {
  if (!block) return null;
  const p = block.projects.find((x) => x.key === key || (key.length >= 12 && x.key.startsWith(key)));
  if (!p) return null;
  const labels = labelsFor(block, names, nicknames, registry);
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
      // The share said from the lines themselves: the wire's share is rounded to three places, and
      // 151 of 29,300 lines (0.515%) arrives as 0.005, which `shareWords` says "0%", a zero nobody
      // measured (FOUND ON THE SIMULATOR, 2026-09-13).
      rows: oneOther(w.languages.languages ?? []).map((r) => ({ language: r.language, share: shareWords(w.languages.lines > 0 ? r.lines / w.languages.lines : r.share), lines: r.lines })),
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

// ==================================================================================
// THE PROJECTS TAB AND THE PROJECT PAGE
//
// What the screens draw beyond the rows above: every project's hue, the owner's own names
// for projects, the weeks the rivers and the rank race are drawn from (report v3's
// `projects.weeks` and each project's `history.weeks`), the tab's hero and its doors, and
// the page's figures, each a number that counts up to the string a copy helper writes.
// Still pure: no React Native, so `__tests__/projectsScreens.test.ts` holds every rule.
// ==================================================================================

// ------------------------------------------------------------------ hues

/**
 * The hues a project can wear, far apart first: the spectrum less amber, which is the brand and,
 * on a live surface, "needs you" (the rule `theme.CREW_RING` keeps for sessions).
 */
export const PROJECT_HUES: readonly HueName[] = ['tide', 'ember', 'iris', 'brass', 'orchid', 'cobalt', 'coral', 'heather'];

function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The hue a key asks for: its first eight hex digits round the ring. A key is a salted hash, so every hue is as likely. */
export function preferredHue(key: string): HueName {
  const head = /^[0-9a-f]{8}/i.test(key) ? parseInt(key.slice(0, 8), 16) : fnv(key);
  return PROJECT_HUES[head % PROJECT_HUES.length]!;
}

/**
 * Every project's hue, the same on every screen and every launch: the one the register gave it
 * (`registerProjects`). A project the register has not seen yet asks for the hue its key names
 * (`preferredHue`); the oldest by its first session gets what it asks for, and a younger one whose
 * hue a listed project wears steps round the ring to the next free one. A hue once given is kept,
 * so a project never changes colour when a newer one arrives or an older one leaves the list.
 */
export function projectHues(projects: readonly { key: string; history: { first_at: string } }[], registry?: ProjectRegistry | null): Record<string, HueName> {
  const reg = registerProjects(registry ?? EMPTY_REGISTRY, projects).registry;
  const out: Record<string, HueName> = {};
  for (const p of projects) out[p.key] = reg.projects[p.key]?.hue ?? preferredHue(p.key);
  return out;
}

/** The hues a chapter falls back to when its own is taken, far apart first; amber last. */
const SPARE_HUES: readonly HueName[] = ['cobalt', 'heather', 'brass', 'tide', 'iris', 'coral', 'orchid', 'ember', 'amber'];

/**
 * How far round the colour wheel two neighbouring bands must be, in degrees. UNMEASURED
 * JUDGEMENT CALL, set beside a measurement of the tokens' inks: cobalt and iris are 55 degrees
 * apart and read as one family stacked on the simulator (FOUND 2026-09-13: an iris hero over a
 * cobalt chapter), tide and cobalt 19; the analysis page's own neighbours run from 35 (brass over
 * ember) to 172. So 60: the house rule "neighbours are never the same family", as a number.
 */
export const NEIGHBOUR_DEGREES = 60;

/** A hue's angle on the colour wheel, 0 to 360, from its ink. */
export function hueAngle(name: HueName): number {
  const hex = SPECTRUM[name].ink;
  const v = parseInt(hex.slice(1, 7), 16);
  const r = ((v >> 16) & 255) / 255;
  const g = ((v >> 8) & 255) / 255;
  const b = (v & 255) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

/** The distance between two hues round the wheel, 0 to 180 degrees. */
export function hueDistance(a: HueName, b: HueName): number {
  const d = Math.abs(hueAngle(a) - hueAngle(b)) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * A page's chapter hues: each chapter's own, unless the page's hero or a project on the page
 * already wears it (`avoid`), another chapter took it, or it sits within `NEIGHBOUR_DEGREES` of
 * the band before it (`after`, the hero, for the first) or of the band after the last (`next`);
 * then the first spare that clears all of that. When nothing does, the neighbour rule alone.
 */
export function chapterHues(wanted: readonly HueName[], avoid: readonly HueName[], after?: HueName | null, next?: HueName | null): HueName[] {
  const out: HueName[] = [];
  wanted.forEach((want, i) => {
    const prev = out[out.length - 1] ?? after ?? null;
    const last = i === wanted.length - 1 ? (next ?? null) : null;
    const afterPrev = (h: HueName) => prev === null || hueDistance(h, prev) >= NEIGHBOUR_DEGREES;
    const beforeNext = (h: HueName) => last === null || hueDistance(h, last) >= NEIGHBOUR_DEGREES;
    const free = (h: HueName) => !avoid.includes(h) && !out.includes(h);
    const pool = [want, ...SPARE_HUES];
    // Given up in this order when nothing clears everything: the band after, then a hue already
    // worn, and the band before last of all.
    const pick =
      pool.find((h) => free(h) && afterPrev(h) && beforeNext(h)) ??
      pool.find((h) => free(h) && afterPrev(h)) ??
      pool.find((h) => afterPrev(h) && beforeNext(h)) ??
      pool.find((h) => afterPrev(h)) ??
      pool.find((h) => h !== prev) ??
      want;
    out.push(pick);
  });
  return out;
}

// ------------------------------------------------------------------ the owner's own names

/**
 * Where the owner's names for projects live: the phone's cache kv, and nowhere else. Never
 * uploaded (`__tests__/projectsScreens.test.ts` holds that nothing that reads it can send it),
 * and cleared with the rest of the account's cache at sign out.
 */
export const NICKNAMES_KEY = 'projects.nicknames.v1';
/** How long a name may be: a band's title line at the size a door sets it. */
export const NICKNAME_MAX = 32;

/** A name as it is kept: inner runs of space made one, trimmed, and cut at `NICKNAME_MAX` characters. */
export function normalizeNickname(raw: string): string {
  const one = raw.replace(/\s+/g, ' ').trim();
  return [...one].slice(0, NICKNAME_MAX).join('').trim();
}

/** The saved names, keyed by the full 64 hex key. Anything that is not a name for a key is dropped, not repaired. */
export function parseNicknames(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (!/^[0-9a-f]{64}$/.test(k) || typeof x !== 'string') continue;
    const name = normalizeNickname(x);
    if (name) out[k] = name;
  }
  return out;
}

/** The names with `key` named `raw`, or its name taken away when `raw` is null or blank. */
export function withNickname(map: Readonly<Record<string, string>>, key: string, raw: string | null): Record<string, string> {
  const next = { ...map };
  const name = raw === null ? '' : normalizeNickname(raw);
  if (name) next[key] = name;
  else delete next[key];
  return next;
}

// ------------------------------------------------------------------ hours, said

/** Seconds as the hours a figure counts to: "60.6", one decimal at most (`n`). */
export function hoursFigure(seconds: number): NumSpec {
  const h = Math.max(0, seconds) / 3600;
  return numSpec(h, n(h));
}

/** Seconds in a sentence: "60.6 hours", "1 hour", and under an hour the whole minutes ("42 minutes"). */
export function hoursWords(seconds: number): string {
  if (seconds < 3600) return floorMins(seconds);
  const said = n(seconds / 3600);
  return `${said} ${said === '1' ? 'hour' : 'hours'}`;
}

/** A share as a figure: "94%", "under 1%", the words `shareWords` writes. */
function shareFigure(share: number): NumSpec {
  return numSpec(share * 100, shareWords(share));
}

// ------------------------------------------------------------------ the weeks

export interface WeekColumn {
  /** The Monday, "YYYY-MM-DD", already the local day. */
  day: string;
  /** "Aug 11". */
  label: string;
  /** Days of it the report read: 7, fewer in the week history starts and in the week it was made. */
  days: number;
  /** Every counted session's time with you there that week, projects and none alike. */
  attendedSeconds: number;
  sessions: number;
}

export interface WeeklySeries {
  key: string;
  label: ProjectLabel;
  hue: HueName;
  /** Seconds with you there, one a week, every week. */
  attended: number[];
  sessions: number[];
  /** Its place that week, 1 the most time with you there; null in a week with none. */
  ranks: (number | null)[];
  totalSeconds: number;
}

export interface WeeklyView {
  weeks: WeekColumn[];
  /** In the block's order: most of your time in the window first. */
  series: WeeklySeries[];
  totalSeconds: number;
  /** Why there is nothing to draw, in a sentence. Null when there is. */
  refusal: string | null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** "Aug 11" from "2026-08-11": the date as written, never moved to a zone (it is already the local day). */
export function weekLabel(ymd: string): string {
  const m = Number(ymd.slice(5, 7));
  const d = Number(ymd.slice(8, 10));
  return `${MONTHS[m - 1] ?? ''} ${d}`;
}

export const WEEKS_NOT_SENT = 'Your Mac sent this report before it counted weeks. A newer Mac sends them, and this fills in.';
export const WEEKS_EMPTY = 'No weeks to draw yet: your Mac has not counted a session.';
export const WEEKS_QUIET = 'Your Mac read no time with you there in any of these weeks, so there is nothing to draw.';

/**
 * THE ORDER OF A WEEK, the one rule the rank race draws: most time with you there first, a tie to
 * the project the list puts first (most of your time in the window), and a project with no time
 * with you there that week has no place in it at all. The engine sends the numbers and not the
 * ranks, so a project the server leaves out never keeps a place (analysis/projects.py, WEEK BY WEEK).
 */
export function weeklyRanks(series: readonly { attended: readonly number[] }[], weeks: number): (number | null)[][] {
  const out = series.map(() => Array.from({ length: weeks }, () => null as number | null));
  for (let w = 0; w < weeks; w++) {
    const ranked = series
      .map((s, i) => ({ i, v: s.attended[w] ?? 0 }))
      .filter((x) => x.v > 0)
      .sort((a, b) => b.v - a.v || a.i - b.i);
    ranked.forEach((x, r) => {
      out[x.i]![w] = r + 1;
    });
  }
  return out;
}

/**
 * The weeks as the rivers and the race draw them. Null with no block ("not computed"); a view
 * with a refusal when the block has no weeks (an older machine), no weeks at all, or no time with
 * you there in any of them. Never a river of zeroes.
 */
export function weeklyView(
  block: ReportProjects | null | undefined,
  names?: Readonly<Record<string, string>> | null,
  nicknames?: Readonly<Record<string, string>> | null,
  registry?: ProjectRegistry | null,
): WeeklyView | null {
  if (!block) return null;
  const axis: readonly ReportProjectsWeek[] | null = block.weeks ?? null;
  const empty = (refusal: string): WeeklyView => ({ weeks: [], series: [], totalSeconds: 0, refusal });
  if (axis === null) return empty(WEEKS_NOT_SENT);
  if (!axis.length) return empty(WEEKS_EMPTY);
  const labels = labelsFor(block, names, nicknames, registry);
  const hues = projectHues(block.projects, registry);
  const weeks: WeekColumn[] = axis.map((w) => ({ day: day(w.week), label: weekLabel(day(w.week)), days: w.days, attendedSeconds: w.attended_seconds, sessions: w.sessions }));
  const at = new Map(weeks.map((w, i) => [w.day, i]));
  const series: WeeklySeries[] = block.projects.flatMap((p) => {
    const ws = p.history.weeks;
    if (!ws) return [];
    const attended = weeks.map(() => 0);
    const sessions = weeks.map(() => 0);
    for (const w of ws) {
      const i = at.get(day(w.week));
      if (i === undefined) continue;
      attended[i] = Math.max(0, w.attended_seconds);
      sessions[i] = Math.max(0, w.sessions);
    }
    return [{ key: p.key, label: labels[p.key] ?? projectLabel(p.key), hue: hues[p.key] ?? preferredHue(p.key), attended, sessions, ranks: [], totalSeconds: attended.reduce((a, v) => a + v, 0) }];
  });
  weeklyRanks(series, weeks.length).forEach((r, i) => {
    series[i]!.ranks = r;
  });
  const totalSeconds = series.reduce((a, s) => a + s.totalSeconds, 0);
  return { weeks, series, totalSeconds, refusal: series.length && totalSeconds > 0 ? null : WEEKS_QUIET };
}

/** "the week of Aug 11", and how much of it was read when that is not all of it. */
function weekPhrase(w: WeekColumn): { when: string; partial: string } {
  return { when: `the week of ${w.label}`, partial: w.days < 7 ? ` Your Mac's report covers ${count(w.days, 'day')} of it.` : '' };
}

/**
 * What a tap on a river says: the project, its time with you there that week, and its share of
 * everything that week. A week with none says so, which is a measured nothing.
 */
export function riverLine(view: WeeklyView, key: string, week: number): string | null {
  const s = view.series.find((x) => x.key === key);
  const w = view.weeks[week];
  if (!s || !w) return null;
  const secs = s.attended[week] ?? 0;
  const { when, partial } = weekPhrase(w);
  // Every number here is the Mac's report, and says so: the phone's own session list can hold
  // sessions another machine uploaded (the hook channel), which this report never read.
  if (secs <= 0) return `Your Mac read no time with you there in ${s.label.text} in ${when}.${partial}`;
  if (w.attendedSeconds <= secs) return `${s.label.text}: all ${hoursWords(secs)} with you there that your Mac read in ${when}.${partial}`;
  return `${s.label.text}: ${hoursWords(secs)} of the ${hoursWords(w.attendedSeconds)} with you there that your Mac read in ${when}.${partial}`;
}

/** What the rivers say before a tap: the widest stream, over how many weeks, and how to ask. */
export function riversLine(view: WeeklyView): string | null {
  if (view.refusal || !view.series.length) return null;
  const widest = [...view.series].sort((a, b) => b.totalSeconds - a.totalSeconds)[0]!;
  const weeks = view.weeks.length;
  const over = weeks === 1 ? 'in the one week' : `over ${n(weeks)} weeks`;
  const lead =
    view.series.length === 1
      ? `Every hour here is ${widest.label.text}: ${hoursWords(widest.totalSeconds)} with you there ${over}, as your Mac read them.`
      : `${widest.label.text} is the widest river: ${hoursWords(widest.totalSeconds)} with you there ${over}, ${shareWords(widest.totalSeconds / view.totalSeconds)} of the projects' time your Mac read.`;
  return `${lead} Tap a river to see its week.`;
}

// ------------------------------------------------------------------ the rank race

export interface RaceSummary {
  /** The week the order at the right is read from: the latest with any time with you there. */
  latest: number;
  order: { rank: number; key: string; label: ProjectLabel; hue: HueName; seconds: number }[];
  /** Projects on the chart with no time with you there in that week. */
  resting: ProjectLabel[];
  leader: { key: string; label: ProjectLabel; hue: HueName; weeksLed: number } | null;
  /** Weeks in which any project had time with you there. */
  weeksRanked: number;
  /** Every week on the axis: the weeks the Mac's report read. */
  weeksRead: number;
  /** How many times the top place changed hands between one ranked week and the next. */
  changes: number;
  /** The race in sentences, each with its numbers. */
  lines: string[];
}

/** "A", "A and B", "A, B, and C". */
function listed(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

/** The race as the chapter says it. Null when the weeks were refused. */
export function raceSummary(view: WeeklyView): RaceSummary | null {
  if (view.refusal) return null;
  const weeks = view.weeks.length;
  const top: (number | null)[] = Array.from({ length: weeks }, (_, w) => {
    const i = view.series.findIndex((s) => s.ranks[w] === 1);
    return i < 0 ? null : i;
  });
  const rankedWeeks = top.map((t, w) => (t === null ? -1 : w)).filter((w) => w >= 0);
  const latest = rankedWeeks[rankedWeeks.length - 1] ?? weeks - 1;
  const led = view.series.map((_, i) => top.filter((t) => t === i).length);
  let leaderIdx = -1;
  led.forEach((k, i) => {
    if (k > 0 && (leaderIdx < 0 || k > led[leaderIdx]!)) leaderIdx = i;
  });
  let changes = 0;
  let prev: number | null = null;
  for (const t of top) {
    if (t === null) continue;
    if (prev !== null && t !== prev) changes += 1;
    prev = t;
  }
  const order = view.series
    .map((s) => ({ rank: s.ranks[latest] ?? 0, key: s.key, label: s.label, hue: s.hue, seconds: s.attended[latest] ?? 0 }))
    .filter((x) => x.rank > 0)
    .sort((a, b) => a.rank - b.rank);
  const everRanked = view.series.filter((s) => s.ranks.some((r) => r !== null));
  const resting = everRanked.filter((s) => (s.ranks[latest] ?? null) === null).map((s) => s.label);
  const leader = leaderIdx >= 0 ? { key: view.series[leaderIdx]!.key, label: view.series[leaderIdx]!.label, hue: view.series[leaderIdx]!.hue, weeksLed: led[leaderIdx]! } : null;

  // The race is the Mac's report, week by week, and every sentence says so: another machine's
  // uploads are on the phone's session list and not in this report.
  const lines: string[] = [];
  const k = rankedWeeks.length;
  const all = weeks === 1 ? 'the one week your Mac read' : `all ${n(weeks)} weeks your Mac read`;
  if (leader) {
    if (everRanked.length === 1) lines.push(`Only ${leader.label.text} had time with you there on your Mac in these weeks, so it led ${leader.weeksLed === weeks ? all : `${n(leader.weeksLed)} of the ${n(weeks)} weeks your Mac read`}.`);
    else if (leader.weeksLed === weeks) lines.push(`${leader.label.text} led ${all}.`);
    else lines.push(`${leader.label.text} led ${n(leader.weeksLed)} of the ${n(weeks)} weeks your Mac read.`);
  }
  if (everRanked.length > 1) lines.push(changes === 0 ? 'The top place never changed hands.' : `The top place changed hands ${changes === 1 ? 'once' : `${n(changes)} times`}.`);
  const quiet = weeks - k;
  if (quiet > 0) {
    const q = view.weeks.find((_, i) => top[i] === null)!;
    lines.push(quiet === 1 ? `Your Mac read no time with you there in any project in ${weekPhrase(q).when}.` : `Your Mac read no time with you there in any project in ${n(quiet)} of those weeks.`);
  }
  const w = view.weeks[latest];
  if (w && resting.length) lines.push(`In ${weekPhrase(w).when}, your Mac read no time with you there in ${listed(resting.map((l) => l.text))}.`);
  return { latest, order, resting, leader, weeksRanked: k, weeksRead: weeks, changes, lines };
}

// ------------------------------------------------------------------ the tab's hero

export interface ProjectsHero {
  count: NumSpec;
  /** "projects on your Mac". */
  countCaption: string;
  /** Every counted session's time with you there in the window; null when there was none. */
  hours: NumSpec | null;
  /** "hours with you there, the last 30 days". */
  hoursCaption: string;
  /** Where most of it went, or why there is no number. */
  note: string | null;
  /** The projects the list leaves out, and the sessions in no repository. */
  small: string[];
}

/** The scope a window number is said in: "the last 30 days" when the report's coverage holds, else the stretch it read. */
export function windowPhrase(report: BuilderReport | null | undefined, block: ReportProjects, nowMs: number = Date.now()): string {
  return report ? readSpan(report, nowMs).inline : `the last ${count(block.window_days, 'day')}`;
}

export function projectsHero(view: ProjectsView, block: ReportProjects, report: BuilderReport | null | undefined, nowMs: number = Date.now()): ProjectsHero {
  const scope = windowPhrase(report, block, nowMs);
  // The block's own total when it sends one: every sitting in the window, the projects past the
  // list's cap included, which is what each share of it is out of. An older Mac's report has only
  // the listed projects and the unresolved to add up.
  const listed = view.rows.reduce((a, r) => a + (r.window?.attendedSeconds ?? 0), 0) + view.unresolved.attendedSeconds;
  const all = block.window_attended_seconds ?? listed;
  const lead = view.rows.find((r) => r.window && r.window.share !== null && r.window.attendedSeconds > 0) ?? null;
  const small: string[] = [];
  if (view.hidden > 0) small.push(`${count(view.hidden, 'more project', 'more projects')} on your Mac ${view.hidden === 1 ? 'is' : 'are'} left off this list, which keeps the ${n(view.rows.length)} with the most time.`);
  if (view.unresolved.sessions > 0) {
    small.push(`${count(view.unresolved.sessions, 'session')} your Mac read in ${scope} ran in no repository, a home folder or a folder with no git, so ${view.unresolved.sessions === 1 ? 'it belongs' : 'they belong'} to no project: ${hoursWords(view.unresolved.attendedSeconds)} with you there.`);
  }
  return {
    count: numSpec(block.projects_total, n(block.projects_total)),
    countCaption: block.projects_total === 1 ? 'project on your Mac' : 'projects on your Mac',
    hours: all > 0 ? hoursFigure(all) : null,
    hoursCaption: `hours with you there on your Mac, ${scope}`,
    note:
      all <= 0
        ? `Your Mac read no time with you there in ${scope}.`
        : lead && lead.window && lead.window.shareWords
          ? `${capitalFirst(lead.window.shareWords)} of it in ${lead.label.text}.`
          : null,
    small,
  };
}

function capitalFirst(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// ------------------------------------------------------------------ the doors

export interface ProjectDoor {
  key: string;
  rank: number;
  label: ProjectLabel;
  hue: HueName;
  /** "Active". */
  stage: string | null;
  stageSentence: string | null;
  lastSession: string | null;
  /** Window numbers, null when nothing ran here in the window. */
  hours: NumSpec | null;
  share: NumSpec | null;
  /** "hours with you there" and "of your time with you there", or the sentence for an empty window. */
  hoursCaption: string;
  shareCaption: string | null;
  quiet: string | null;
  momentum: string | null;
  direction: TrendDirection | null;
  /** What VoiceOver reads for the whole band. */
  a11y: string;
}

/** Each project as a band door, in the list's order. */
export function projectDoors(
  view: ProjectsView,
  block: ReportProjects,
  report: BuilderReport | null | undefined,
  nowMs: number = Date.now(),
  registry?: ProjectRegistry | null,
): ProjectDoor[] {
  const hues = projectHues(block.projects, registry);
  const scope = windowPhrase(report, block, nowMs);
  return view.rows.map((r) => {
    const w = r.window;
    const hours = w && w.attendedSeconds > 0 ? hoursFigure(w.attendedSeconds) : null;
    const share = w && w.share !== null && w.attendedSeconds > 0 ? shareFigure(w.share) : null;
    const quiet = !w ? `Your Mac read nothing here in ${scope}.` : w.attendedSeconds <= 0 ? `Your Mac read no time with you there in ${scope}: the agent ran alone.` : null;
    const said = [r.label.text, r.stageLabel, hours ? `${hours.final} hours with you there` : quiet, share ? `${share.final} of your time` : null, r.momentum].filter(Boolean).join('. ');
    return {
      key: r.key,
      rank: r.rank,
      label: r.label,
      hue: hues[r.key] ?? preferredHue(r.key),
      stage: r.stageLabel,
      stageSentence: r.stageSentence,
      lastSession: r.lastSession,
      hours,
      share,
      hoursCaption: 'hours with you there on your Mac',
      shareCaption: share ? `of your time, ${scope}` : null,
      quiet,
      momentum: r.momentum,
      direction: r.momentumDirection,
      a11y: `${said}. Opens the project.`,
    };
  });
}

// ------------------------------------------------------------------ comparisons, as figures

export interface ComparisonFigures {
  high: NumSpec | null;
  low: NumSpec | null;
  /** Both values are floors: each is said "at least", and no ratio or gap is stated. */
  floor: boolean;
}

/** A comparison's two numbers as figures that count up to the words its sentence says. */
export function comparisonFigures(c: ComparisonView, raw?: ReportProjectComparison | null): ComparisonFigures {
  const floor = raw?.reason === 'floors_only';
  return { high: c.high ? numSpec(Number.NaN, c.high.value) : null, low: c.low ? numSpec(Number.NaN, c.low.value) : null, floor };
}

// ------------------------------------------------------------------ the page

export interface RuleRow {
  key: string;
  display: string;
  animal: Animal;
  hue: HueName;
  /** Value over the bar, capped at two and halved: 0.5 is exactly the bar. */
  score: number;
  said: string;
  bar: string | null;
  winner: boolean;
}

export interface ProjectPage {
  detail: ProjectDetail;
  hue: HueName;
  /** "the last 30 days", or the stretch the report read. */
  scope: string;
  hero: {
    hours: NumSpec | null;
    autonomous: NumSpec | null;
    sessions: NumSpec | null;
    share: NumSpec | null;
    historySessions: NumSpec;
    historyHours: NumSpec;
    longestStreak: NumSpec | null;
    currentStreak: NumSpec | null;
    since: string;
  };
  time: {
    activeDays: NumSpec | null;
    peak: NumSpec | null;
    peakHour: number | null;
    spanDays: NumSpec;
    /**
     * The share of its active time between 10pm and 4am, the night owl rule's own value on this
     * project (`window.scores`, metric `night_share`), and that share as a figure. Null when the
     * report sent none: then the dial draws no night window and nothing is said about the night.
     */
    nightShare: number | null;
    night: NumSpec | null;
  } | null;
  build: {
    type: string | null;
    typeSentence: string | null;
    typeRefusal: string | null;
    rules: RuleRow[];
    steer: NumSpec | null;
    steerSentence: string | null;
    perSession: NumSpec | null;
    perPrompt: NumSpec | null;
    green: { rate: NumSpec; passed: number; failed: number; runs: string } | null;
    greenRefusal: string | null;
    back: { median: NumSpec; seconds: number; dial: 'minute' | 'hour' | 'day'; worst: string; n: string } | null;
    backRefusal: string | null;
    agents: { agents: NumSpec; atOnce: NumSpec } | null;
    harnesses: { harness: Harness; sessions: number; share: number; text: string }[];
  } | null;
  shipping: {
    added: NumSpec | null;
    removed: NumSpec | null;
    addedShare: number;
    commits: { assisted: NumSpec; alone: NumSpec; total: NumSpec; assistedN: number; aloneN: number; days: { day: string; assisted: number; alone: number }[]; sentence: string } | null;
    commitsRefusal: string | null;
  } | null;
  money: {
    usd: NumSpec | null;
    headline: string | null;
    refusal: string | null;
    notAbill: string;
    perHour: NumSpec | null;
    perCommit: NumSpec | null;
    perCommitRefusal: string | null;
    without: string | null;
    models: { key: string; name: string; usd: number; text: string; family: string }[];
    burn: MoneyModel['burn'];
  } | null;
}

function card(cards: readonly ReportWrappedCard[] | undefined, id: string): ReportWrappedCard | null {
  return cards?.find((c) => c.id === id) ?? null;
}

function num(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/** The archetype metrics whose value on the Mac is always a floor (`you/archetype.ts` says why). */
const FLOOR_METRICS: ReadonlySet<string> = new Set(['test_runs_per_hour']);

/** The six rules scored on this project, the one that won first, then by score. A rule with no value is left out. */
export function ruleRows(scores: readonly { name: string; metric: string; value?: number | null; threshold?: number | null; score?: number | null }[], winner: string | null): RuleRow[] {
  return scores
    .flatMap((r) => {
      const score = num(r.score) ? r.score : num(r.value) && num(r.threshold) && r.threshold > 0 ? Math.min(r.value / r.threshold, 2) / 2 : null;
      if (score === null || !num(r.value)) return [];
      const animal = resolveAnimal(null, r.name);
      return [
        {
          key: r.name,
          display: archetypeDisplay(r.name),
          animal,
          hue: CREATURE_HUE[animal] ?? 'amber',
          score,
          said: `${FLOOR_METRICS.has(r.metric) ? 'at least ' : ''}${metricValue(r.metric, r.value)} ${metricLabel(r.metric)}`,
          bar: num(r.threshold) ? metricValue(r.metric, r.threshold) : null,
          winner: r.name === winner,
        },
      ];
    })
    .sort((a, b) => Number(b.winner) - Number(a.winner) || b.score - a.score);
}

function familyOf(model: string): string {
  return /claude-([a-z]+)/.exec(model)?.[1] ?? model;
}

/**
 * One project's page, every chapter's figures: the hero, time, how you build it, shipping and
 * money. Null when the block does not hold the key. A chapter the window cannot answer is null
 * (the page shows the stage and says the window is empty); a number inside a chapter that is
 * refused carries its sentence.
 */
export function projectPage(
  block: ReportProjects | null | undefined,
  key: string,
  names?: Readonly<Record<string, string>> | null,
  nicknames?: Readonly<Record<string, string>> | null,
  report?: BuilderReport | null,
  nowMs: number = Date.now(),
  registry?: ProjectRegistry | null,
): ProjectPage | null {
  const detail = projectDetail(block, key, names, nicknames, nowMs, registry);
  if (!block || !detail) return null;
  const p = block.projects.find((x) => x.key === detail.key)!;
  const hue = projectHues(block.projects, registry)[p.key] ?? preferredHue(p.key);
  const scope = windowPhrase(report, block, nowMs);
  const h = p.history;
  const w = p.window ?? null;

  const hero: ProjectPage['hero'] = {
    hours: w && w.attended_seconds > 0 ? hoursFigure(w.attended_seconds) : null,
    autonomous: w && w.autonomous_seconds > 0 ? hoursFigure(w.autonomous_seconds) : null,
    sessions: w ? numSpec(w.sessions, n(w.sessions)) : null,
    share: w && num(w.share_of_attended) && w.attended_seconds > 0 ? shareFigure(w.share_of_attended) : null,
    historySessions: numSpec(h.sessions, n(h.sessions)),
    historyHours: hoursFigure(h.attended_seconds),
    longestStreak: num(h.longest_streak_days) && h.longest_streak_days > 0 ? numSpec(h.longest_streak_days, n(h.longest_streak_days)) : null,
    currentStreak: num(h.current_streak_days) && h.current_streak_days > 0 ? numSpec(h.current_streak_days, n(h.current_streak_days)) : null,
    since: weekLabel(localDay(h.first_at)),
  };
  if (!w) return { detail, hue, scope, hero, time: null, build: null, shipping: null, money: null };

  const nightScore = w.scores.find((s) => s.metric === 'night_share') ?? null;
  const nightShare = nightScore && num(nightScore.value) && nightScore.value >= 0 && nightScore.value <= 1 ? nightScore.value : null;
  const time: ProjectPage['time'] = {
    activeDays: w.active_days > 0 ? numSpec(w.active_days, n(w.active_days)) : null,
    peak: num(w.clock.peak_hour) ? numSpec(w.clock.peak_hour, hourOfDay(w.clock.peak_hour), { kind: 'hour' }) : null,
    peakHour: num(w.clock.peak_hour) ? w.clock.peak_hour : null,
    spanDays: numSpec(h.spans_days, n(h.spans_days)),
    nightShare,
    night: nightShare !== null ? numSpec(nightShare * 100, pct(nightShare)) : null,
  };

  const byId = new Map(detail.cards.map((c) => [c.id as string, c]));
  const typeCard = byId.get('builder_type') ?? null;
  const steerCard = card(w.cards, 'change_course');
  const steerSaid = byId.get('change_course') ?? null;
  const per = card(w.cards, 'prompts_per_session');
  const q = w.quality;
  const g = q.time_to_green ?? null;
  const total = w.harnesses.reduce((a, x) => a + x.sessions, 0);
  const build: ProjectPage['build'] = {
    type: typeCard?.display ?? null,
    typeSentence: typeCard?.sentence ?? null,
    typeRefusal: typeCard?.refusal ?? null,
    rules: ruleRows(w.scores, card(w.cards, 'builder_type')?.value_id ?? null),
    // The card's own number ("42%"), said as `profile._pct` says it; the card's "of the time"
    // is the label's to say beside it.
    steer: steerCard && steerCard.reason == null && num(steerCard.value) ? numSpec(steerCard.value * 100, pct(steerCard.value)) : null,
    steerSentence: steerSaid?.sentence ?? steerSaid?.refusal ?? null,
    perSession: per && per.reason == null && num(per.value) ? numSpec(per.value, n(per.value)) : null,
    perPrompt: per && per.reason == null && num(per.extras?.tool_calls_per_prompt) ? numSpec(per.extras.tool_calls_per_prompt, n(per.extras.tool_calls_per_prompt)) : null,
    green:
      num(q.first_try_rate) && num(q.passed) && num(q.failed)
        ? { rate: shareFigure(q.first_try_rate), passed: q.passed, failed: q.failed, runs: `${commas(q.passed)} of ${count(q.runs, 'test run')} were green with no error after them.` }
        : null,
    greenRefusal: num(q.first_try_rate) ? null : detail.tests?.refusal ?? null,
    back: g
      ? {
          median: numSpec(g.median_seconds, clockWords(g.median_seconds), { kind: 'clock' }),
          seconds: g.median_seconds,
          dial: g.median_seconds <= 60 ? 'minute' : g.median_seconds <= 3600 ? 'hour' : 'day',
          worst: `The longest took ${clockWords(g.worst_seconds)}.`,
          n: `${count(g.n, 'time')} a failing run came back to green.`,
        }
      : null,
    backRefusal: g ? null : num(q.first_try_rate) ? detail.tests?.refusal ?? null : null,
    agents: w.agents ? { agents: numSpec(w.agents.agents, n(w.agents.agents)), atOnce: numSpec(w.agents.max_concurrent, n(w.agents.max_concurrent)) } : null,
    harnesses: w.harnesses.map((x) => ({ harness: x.harness, sessions: x.sessions, share: total > 0 ? x.sessions / total : 0, text: `${count(x.sessions, 'session')}, ${hoursWords(x.active_seconds)} active` })),
  };

  const m = w.money;
  const added = num(m.lines_added) && m.lines_added > 0 ? m.lines_added : 0;
  const removed = num(m.lines_removed) && m.lines_removed > 0 ? m.lines_removed : 0;
  const c = w.commits ?? null;
  const shipping: ProjectPage['shipping'] = {
    added: added > 0 ? numSpec(added, `+${commas(added)}`) : null,
    removed: removed > 0 ? numSpec(-removed, `-${commas(removed)}`) : null,
    addedShare: added + removed > 0 ? added / (added + removed) : 1,
    commits: c
      ? {
          assisted: numSpec(c.assisted, commas(c.assisted)),
          alone: numSpec(c.alone, commas(c.alone)),
          total: numSpec(c.assisted + c.alone, commas(c.assisted + c.alone)),
          assistedN: c.assisted,
          aloneN: c.alone,
          days: detail.commits?.days ?? [],
          sentence: `${commas(c.assisted)} landed with a session of this project running, ${commas(c.alone)} without one, over ${count(c.active_days, 'day')} with a commit. A commit made in a session this Mac never saw reads as without one.`,
        }
      : null,
    commitsRefusal: c ? null : `No commit was read for this project in ${scope}.`,
  };

  const per$ = w.usd_per_commit;
  const money: ProjectPage['money'] = {
    usd: num(m.usd) && m.reason == null ? numSpec(m.usd, dollars(m.usd)) : null,
    headline: detail.money?.headline ?? null,
    refusal: detail.money?.refusal ?? null,
    notAbill: NOT_WHAT_YOU_PAY,
    perHour: num(m.usd_per_active_hour) ? numSpec(m.usd_per_active_hour, dollars(m.usd_per_active_hour)) : null,
    perCommit: num(per$.usd) ? numSpec(per$.usd, dollars(per$.usd)) : null,
    perCommitRefusal: num(per$.usd) ? null : detail.money?.perCommitRefusal ?? null,
    without: detail.money?.withoutACommit ? `${capitalFirst(detail.money.withoutACommit)}.` : null,
    models: m.by_model.map((x) => ({ key: x.model, name: modelName(x.model), usd: x.usd, text: dollars(x.usd), family: familyOf(x.model) })),
    burn: burnOf(w.burn),
  };
  return { detail, hue, scope, hero, time, build, shipping, money };
}

/** Measured seconds as a clock, "41s", "59m 28s" (`copy/numbers.clock`). */
function clockWords(seconds: number): string {
  return clockSaid(seconds);
}

// ------------------------------------------------------------------ the session swarm

export interface SwarmSession {
  id: string;
  /** Epoch ms it started. */
  at: number;
  activeSeconds: number;
  /** The part with you there, 0 to 1. */
  attendedShare: number;
  unattended: boolean;
}

type SessionRowIn = {
  id: string;
  started_at: string;
  active_seconds: number;
  attended_seconds?: number;
  unattended?: boolean;
  state?: string;
  repo_key?: string | null;
};

/**
 * This project's finished sessions for the swarm: every row the project's own route sent, and
 * every row this phone has saved whose `repo_key` is this project's, each once. A saved row with
 * no key is left out (it may belong to any project), never guessed into this one.
 */
export function swarmSessions(fromProject: readonly SessionRowIn[], fromCache: readonly SessionRowIn[], key: string): SwarmSession[] {
  const seen = new Map<string, SwarmSession>();
  const take = (r: SessionRowIn) => {
    if (seen.has(r.id) || (r.state ?? 'final') !== 'final') return;
    const at = Date.parse(r.started_at);
    if (!Number.isFinite(at) || !(r.active_seconds > 0)) return;
    const attended = Math.max(0, Math.min(r.active_seconds, r.attended_seconds ?? 0));
    seen.set(r.id, { id: r.id, at, activeSeconds: r.active_seconds, attendedShare: attended / r.active_seconds, unattended: Boolean(r.unattended) });
  };
  fromProject.forEach(take);
  fromCache.filter((r) => r.repo_key === key).forEach(take);
  // The newest `SWARM_MAX`, in the order they happened (`geometry.SWARM_MAX` says why a cap).
  return [...seen.values()].sort((a, b) => a.at - b.at).slice(-SWARM_MAX);
}

/**
 * What the swarm says under it: how many dots, of how many sessions were uploaded in this project
 * (`uploaded`, from the server; the newest are drawn when there are more than the swarm holds),
 * and, when the Mac's report counts a different number, why. The dots are every session uploaded
 * from any machine; the report counts only the sittings the Mac read itself (a second machine's
 * hook uploads are on the server and not in that report), and the page says so rather than show
 * two numbers that disagree with no reason given.
 */
export function swarmLine(shown: number, macCount: number, uploaded?: number | null): string {
  if (shown <= 0) return 'No session of this project is on this phone yet. They arrive as your machines upload them.';
  const total = uploaded != null && uploaded > shown ? uploaded : shown;
  const dots =
    total > shown
      ? `The newest ${n(shown)} of the ${count(total, 'session')} uploaded here, a dot each`
      : shown === 1
        ? 'The one session uploaded here, a dot'
        : `All ${n(shown)} sessions uploaded here, a dot each`;
  const mac =
    macCount !== total
      ? ` Your Mac's report counts ${count(macCount, 'session')} here, only the ones it read itself; the dots are every one uploaded, from any of your machines.`
      : '';
  return `${dots}.${mac} A dot's area is its active time, and the arc round it in your colour goes as far round as the share you were there for. Tap one to open it.`;
}

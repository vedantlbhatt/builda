/**
 * The builder type, as the You tab's hero, the Wrapped entry and the Dimensions page say it.
 * Pure, so every rule below is held by `__tests__/you.test.ts`.
 *
 * ONE ARCHETYPE, TWO PLACES IT CAN COME FROM, AND THEY CAN DISAGREE. The server scores the
 * corpus profile from uploaded rows (`corpus.archetype`), and it cannot score three of the six
 * rules at all: planning, test runs and steering read prompt text and shell commands, which
 * never leave the Mac. The Mac scores the same rules over the transcripts and sends the answer
 * as the Wrapped card `builder_type` (report v2). MEASURED on the corpus, 2026-09-13: the Mac
 * says Quality guardian (4.7 test runs an hour) where the server, which counts no test runs,
 * says Velocity machine. Showing one on the hero and the other on the Wrapped card would be two
 * counters for one number (CLAUDE.md), so `archetypeView` is the one choice every page reads:
 * the Mac's answered card when there is one, the server's corpus archetype otherwise, and the
 * view says which it is.
 */
import { ARCHETYPE_DISPLAY } from '../copy/catalog';
import { count, n, pct } from '../copy/numbers';
import type { BuilderProfileResponse, CorpusArchetype, CorpusProfile } from '../data/api';
import type { Archetype, ArchetypeMetric, BuilderReport, ReportArchetypeScore, ReportWrappedCard } from '../generated/report';

/** Every basis `profile` stamps on a count it knows is short ends with this (wrapped.LOWER_BOUND_SUFFIX). */
const LOWER_BOUND_SUFFIX = '_lower_bound';

/**
 * The archetype metrics whose value on the Mac is always a floor: `profile.corpus_profile` stamps
 * `test_runs_per_hour` with `TEST_RUNS_LOWER_BOUND` whenever it has a value (it reads test
 * commands in the digest, cut at 160 characters). The card says so for its winner
 * (`metric_lower_bound`) and not for its runners up, so a runner up from the Mac reads its
 * floor from here rather than from the server's basis, which describes a different count.
 */
const MAC_FLOOR_METRICS: ReadonlySet<string> = new Set(['test_runs_per_hour']);

/** How many rules the archetype has (analysis/profile.py ARCHETYPE_RULES). */
export const ARCHETYPE_RULE_COUNT = 6;

/**
 * An archetype id as a name: `velocity_machine` is "Velocity machine", the words the Wrapped
 * card prints (`wrapped.ARCHETYPE_DISPLAY`, through `src/copy/catalog.ts`), so the hero and the
 * card cannot spell one type two ways. A name this build has never heard of (the corpus rules
 * can grow) still arrives as English rather than an id.
 */
export function archetypeDisplay(name: string): string {
  const known = (ARCHETYPE_DISPLAY as Record<string, string>)[name];
  if (known) return known;
  const words = name.split('_').filter(Boolean).join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// ------------------------------------------------------------------ where each bar came from

/**
 * Where a rule's threshold came from. The wire carries the thresholds but not their sources, so
 * this table restates `ARCHETYPE_RULES[*].source` by kind, and a test reads profile.py and holds
 * each row to it. Paxel's axes and the explainx.ai mock (brief C2, paxel.md section 6): the
 * architect's 2.4 and the velocity machine's 487 come from an explainx.ai mock of a Paxel report,
 * the skeptic's 0.4 from Paxel's own copy describing a heavy steerer. None is a measurement.
 */
export type ThresholdSource = 'explainx_mock' | 'paxel_heavy_steerer' | 'judgement' | 'clock';

export const THRESHOLD_SOURCE: Record<Archetype, ThresholdSource> = {
  architect: 'explainx_mock',
  velocity_machine: 'explainx_mock',
  quality_guardian: 'judgement',
  night_owl: 'clock',
  director: 'clock',
  skeptic: 'paxel_heavy_steerer',
};

/** The bar's source in a stat label (short) and in a sentence (full, `{bar}` is the value). */
export const THRESHOLD_NOTE: Record<ThresholdSource, { short: string; full: string }> = {
  explainx_mock: {
    short: 'the bar, never measured',
    full: 'The bar, {bar}, comes from an explainx.ai mock of a Paxel report, which Paxel never published. It is not a measurement.',
  },
  paxel_heavy_steerer: {
    short: 'the bar, never measured',
    full: "The bar, {bar}, is Paxel's example of a heavy steerer. It describes one person steering hard, not a norm, and it is not a measurement.",
  },
  judgement: {
    short: 'the bar, a judgement call',
    full: 'The bar, {bar}, is a judgement call, not a measurement.',
  },
  clock: {
    short: 'the bar, a share of the clock',
    full: 'The bar, {bar}, is a share of the clock, chosen rather than measured.',
  },
};

function sourceOf(name: string): ThresholdSource | null {
  return (THRESHOLD_SOURCE as Record<string, ThresholdSource>)[name] ?? null;
}

/** The full sentence about where a rule's bar came from, or null for a rule this build does not know. */
export function thresholdSentence(r: Pick<RuleScore, 'name' | 'metric' | 'threshold'>): string | null {
  const src = sourceOf(r.name);
  if (!src || r.threshold === null) return null;
  return THRESHOLD_NOTE[src].full.replace('{bar}', metricValue(r.metric, r.threshold));
}

// ------------------------------------------------------------------ the metrics, in words

/**
 * Each archetype metric's number, as the Wrapped card says it (`profile._n` for a rate, one
 * decimal at most; `profile._pct` for a share), and its label in a stat.
 */
const METRICS: Record<ArchetypeMetric, { label: string; format: (v: number) => string }> = {
  planning_ratio: { label: 'prompts planned for each one that is not', format: n },
  code_velocity: { label: 'agent lines an hour', format: n },
  test_runs_per_hour: { label: 'test runs an hour', format: n },
  night_share: { label: 'of active time at night', format: pct },
  autonomy_score: { label: 'of active time without you', format: pct },
  steer_rate: { label: 'of prompts stop or redirect it', format: pct },
};

function isMetric(m: string): m is ArchetypeMetric {
  return Object.prototype.hasOwnProperty.call(METRICS, m);
}

/** A metric's value in its own unit: 771.6 lines an hour is "771.6", a 0.207 share is "21%". */
export function metricValue(metric: string, v: number): string {
  return isMetric(metric) ? METRICS[metric].format(v) : n(v);
}

/** The label under a metric's number, "at least" first when the count is a floor. */
export function metricLabel(metric: string, lowerBound = false): string {
  const label = isMetric(metric) ? METRICS[metric].label : metric.replace(/_/g, ' ');
  return lowerBound ? `${label}, at least` : label;
}

// ------------------------------------------------------------------ the view

export interface RuleScore {
  /** The archetype the rule names. */
  name: string;
  display: string;
  metric: string;
  value: number | null;
  threshold: number | null;
  /** value over threshold, capped at 2 and halved: meeting the bar is 0.5. Null when unscored. */
  score: number | null;
  /** The rule in the server's words, when it sent them. */
  rule: string | null;
  lowerBound: boolean;
}

export interface Evidence {
  value: string;
  label: string;
}

export type ArchetypeState = 'named' | 'generalist' | 'refused';

export interface ArchetypeView {
  state: ArchetypeState;
  /** `velocity_machine`, `generalist`, or null on a refusal. */
  id: string | null;
  /** "Velocity machine", "Generalist", "Not enough yet". */
  display: string;
  /** Which of the two scorings this is (see the file comment). */
  source: 'mac' | 'server';
  /** Sessions the answer rests on. */
  sessions: number;
  confidence: number | null;
  /** Named: the winning rule. Generalist: the rule that came nearest. */
  winner: RuleScore | null;
  runnersUp: RuleScore[];
  /** Rules that could not be scored where this was computed, with the reason when known. */
  unscored: { rule: RuleScore; reason: string | null }[];
  /** Two or three numbers under the name. Empty on a refusal. */
  evidence: Evidence[];
  /** The one line under the name: the rule in words, or why there is no type. */
  line: string;
}

/** The server's rules by name, the only place the rule's words and every threshold travel. */
function serverRules(corpus: CorpusProfile | null): Map<string, CorpusArchetype['scores'][number]> {
  return new Map((corpus?.archetype?.scores ?? []).map((s) => [s.name, s]));
}

function lowerBoundOf(corpus: CorpusProfile | null, metric: string | null | undefined): boolean {
  if (!metric) return false;
  const basis = corpus?.metrics?.[metric]?.basis;
  return typeof basis === 'string' && basis.endsWith(LOWER_BOUND_SUFFIX);
}

function rule(
  s: { name: string; metric?: string | null; value?: number | null; threshold?: number | null; score?: number | null },
  corpus: CorpusProfile | null,
  lowerBound?: boolean,
): RuleScore {
  const known = serverRules(corpus).get(s.name);
  const metric = s.metric ?? known?.metric ?? '';
  return {
    name: s.name,
    display: archetypeDisplay(s.name),
    metric,
    value: typeof s.value === 'number' ? s.value : null,
    threshold: typeof s.threshold === 'number' ? s.threshold : (known?.threshold ?? null),
    score: typeof s.score === 'number' ? s.score : null,
    rule: known?.rule ?? null,
    lowerBound: lowerBound ?? lowerBoundOf(corpus, metric),
  };
}

/**
 * "52%": how far the nearest rule got, capped at 99 because no rule met its bar and "100% of
 * the way there" beside "no single pattern dominates" contradicts itself (wrapped.py).
 */
export function partOfTheWay(r: Pick<RuleScore, 'value' | 'threshold'>): number | null {
  if (r.value === null || r.threshold === null || r.threshold === 0) return null;
  return Math.min(Math.round((100 * r.value) / r.threshold), 99);
}

function evidenceFor(state: ArchetypeState, winner: RuleScore | null, sessions: number, confidence: number | null): Evidence[] {
  if (!winner || winner.value === null) return [];
  const out: Evidence[] = [{ value: metricValue(winner.metric, winner.value), label: metricLabel(winner.metric, winner.lowerBound) }];
  const src = sourceOf(winner.name);
  if (winner.threshold !== null) {
    out.push({
      value: metricValue(winner.metric, winner.threshold),
      label: src ? THRESHOLD_NOTE[src].short : 'the bar',
    });
  }
  if (state === 'generalist') {
    const part = partOfTheWay(winner);
    if (part !== null) out.push({ value: `${winner.lowerBound ? 'at least ' : ''}${part}%`, label: `of the way to ${winner.display.toLowerCase()}` });
  } else if (confidence !== null) {
    out.push({ value: pct(confidence), label: `confidence, over ${count(sessions, 'session')}` });
  } else {
    out.push({ value: n(sessions), label: 'sessions read' });
  }
  return out.slice(0, 3);
}

/**
 * The one line under the name: the rule in words, with no number in it, because the two or
 * three numbers stand right under it as stats and saying them twice is a paragraph nobody reads.
 * The generalist's line is the Wrapped card's, without the share its stat already shows.
 */
function lineFor(state: ArchetypeState, winner: RuleScore | null): string {
  if (!winner) return '';
  if (state === 'generalist') return `No single pattern dominates. Closest is ${winner.display}.`;
  return `The rule is ${winner.rule ?? metricLabel(winner.metric)}.`;
}

function fromCard(card: ReportWrappedCard, corpus: CorpusProfile | null): ArchetypeView | null {
  if (card.reason) return null;
  const x = card.extras;
  const runnersUp = (x.runners_up ?? []).map((r: ReportArchetypeScore) =>
    rule(r, corpus, MAC_FLOOR_METRICS.has(r.metric) && typeof r.value === 'number'),
  );
  const confidence = typeof x.confidence === 'number' ? x.confidence : null;
  if (card.value_id === 'generalist') {
    const winner = x.closest ? rule(x.closest, corpus, x.metric_lower_bound ?? undefined) : null;
    return {
      state: 'generalist',
      id: 'generalist',
      display: archetypeDisplay('generalist'),
      source: 'mac',
      sessions: card.n,
      confidence,
      winner,
      runnersUp,
      unscored: [],
      evidence: evidenceFor('generalist', winner, card.n, confidence),
      line: lineFor('generalist', winner),
    };
  }
  if (!card.value_id) return null;
  const winner = rule(
    { name: card.value_id, metric: x.metric ?? null, value: x.metric_value ?? null },
    corpus,
    x.metric_lower_bound ?? false,
  );
  return {
    state: 'named',
    id: card.value_id,
    display: archetypeDisplay(card.value_id),
    source: 'mac',
    sessions: card.n,
    confidence,
    winner,
    runnersUp,
    unscored: [],
    evidence: evidenceFor('named', winner, card.n, confidence),
    line: lineFor('named', winner),
  };
}

function fromCorpus(corpus: CorpusProfile): ArchetypeView {
  const a = corpus.archetype;
  const sessions = corpus.sample.sessions;
  const scores = (a?.scores ?? []).map((s) => rule(s, corpus));
  const unscored = scores
    .filter((s) => s.score === null)
    .map((s) => {
      const reason = corpus.metrics?.[s.metric]?.reason ?? corpus.sample.missing?.[s.metric] ?? null;
      return { rule: s, reason: typeof reason === 'string' ? reason : null };
    });
  const base = { source: 'server' as const, sessions, unscored };

  if (!corpus.sample.enough_sessions || !a) {
    const need = corpus.sample.min_sessions;
    return {
      ...base,
      state: 'refused',
      id: null,
      display: 'Not enough yet',
      confidence: null,
      winner: null,
      runnersUp: [],
      evidence: [],
      line: `${count(sessions, 'session')} so far, and a type needs ${n(need)}.`,
    };
  }
  if (a.name) {
    const winner = rule(
      { name: a.name, metric: a.metric, value: a.value, threshold: a.threshold, score: null },
      corpus,
    );
    const runnersUp = a.runners_up.map((r) => rule(r, corpus));
    return {
      ...base,
      state: 'named',
      id: a.name,
      display: archetypeDisplay(a.name),
      confidence: a.confidence,
      winner,
      runnersUp,
      evidence: evidenceFor('named', winner, sessions, a.confidence),
      line: lineFor('named', winner),
    };
  }
  const scored = scores.filter((s) => s.score !== null);
  if (scored.length === 0) {
    return {
      ...base,
      state: 'refused',
      id: null,
      display: 'Not enough yet',
      confidence: null,
      winner: null,
      runnersUp: [],
      evidence: [],
      line: `None of the ${ARCHETYPE_RULE_COUNT} archetype rules could be scored from what reaches the server.`,
    };
  }
  // The nearest rule, ties by name: the order `wrapped._builder_type` picks it in.
  const [closest, ...rest] = [...scored].sort((x, y) => y.score! - x.score! || x.name.localeCompare(y.name));
  return {
    ...base,
    state: 'generalist',
    id: 'generalist',
    display: archetypeDisplay('generalist'),
    confidence: null,
    winner: closest ?? null,
    runnersUp: rest.slice(0, 2),
    evidence: evidenceFor('generalist', closest ?? null, sessions, null),
    line: lineFor('generalist', closest ?? null),
  };
}

/**
 * The archetype every You page shows. The Mac's answered `builder_type` card first, the
 * server's corpus archetype otherwise; null when neither exists (nothing to say, and nothing
 * is invented).
 */
export function archetypeView(corpus: CorpusProfile | null | undefined, report: BuilderReport | null | undefined): ArchetypeView | null {
  const card = report?.wrapped?.cards.find((c) => c.id === 'builder_type') ?? null;
  const fromMac = card ? fromCard(card, corpus ?? null) : null;
  if (fromMac) return fromMac;
  if (corpus) return fromCorpus(corpus);
  return null;
}

/**
 * THE ARCHETYPE, from a builder profile however it arrives: the response itself, or the JSON the
 * You tab saves (`profile.builder.v1`). `archetypeView` over its report and corpus, so every
 * place outside the You pages that names or leans on the type (onboarding's "this is you" card,
 * the creature it suggests, the creature picker, the accent) reads the one choice the You tab,
 * the analysis page and Wrapped read.
 *
 * FOUND IN THE FINAL CAPTURE (2026-09-13): onboarding's card said "Velocity machine" while every
 * other screen said "Quality guardian". It read `corpus.archetype.name` first, the server's
 * scoring, which cannot score test runs at all (see the file comment), and fell back to the
 * modal of the per session analyses, a third answer to the same question. Neither is read here.
 * Null when the profile names no type or does not parse.
 */
export function builderArchetype(
  builder: string | Partial<Pick<BuilderProfileResponse, 'corpus' | 'report'>> | null | undefined,
): ArchetypeView | null {
  let b: Partial<Pick<BuilderProfileResponse, 'corpus' | 'report'>> | null = null;
  if (typeof builder === 'string') {
    try {
      const parsed: unknown = JSON.parse(builder);
      b = parsed && typeof parsed === 'object' ? (parsed as Partial<BuilderProfileResponse>) : null;
    } catch {
      b = null;
    }
  } else if (builder && typeof builder === 'object') {
    b = builder;
  }
  if (!b) return null;
  return archetypeView(b.corpus ?? null, b.report ?? null);
}

/**
 * The type as a line of words beside a name ("Quality guardian"), or null when there is none to
 * say. The server's scoring says whose it is, because it can disagree with the Mac's: "Velocity
 * machine, scored on the server".
 */
export function archetypeWords(v: ArchetypeView | null | undefined): string | null {
  if (!v || v.state === 'refused' || v.id === null) return null;
  return v.source === 'server' ? `${v.display}, scored on the server` : v.display;
}

/** Where the answer was computed, in one line under it. */
export function sourceLine(v: ArchetypeView): string {
  if (v.source === 'mac') return `Scored on your Mac from ${count(v.sessions, 'session')}.`;
  const k = v.unscored.length;
  const unscored = k > 0 ? ` ${k} of the ${ARCHETYPE_RULE_COUNT} rules read what stays on your Mac and are not scored here.` : '';
  return `Scored on the server from ${count(v.sessions, 'session')}.${unscored}`;
}

/**
 * A runner up as one line: "21% of active time at night, 52% of the way". A runner up can
 * have cleared its own bar too (it lost on score, not on the bar), and then it says so rather
 * than "99% of the way".
 */
export function runnerUpLine(r: RuleScore): string {
  if (r.value === null) return 'not scored';
  // A floor says so in front of its number, where "at least" reads as part of the count.
  const said = `${r.lowerBound ? 'at least ' : ''}${metricValue(r.metric, r.value)} ${metricLabel(r.metric)}`;
  if (r.threshold !== null && r.value >= r.threshold) return `${said}, past its bar`;
  const part = partOfTheWay(r);
  return part === null ? said : `${said}, ${part}% of the way`;
}

/**
 * The sample deck: what the dev link `builder://wrapped?sample=1` draws, and the fixture the
 * tests render. Pure data, no React Native.
 *
 * THE CARD VALUES ARE MEASURED, not invented: they are `python -m analysis wrapped
 * ~/.builder-overnight/corpus --json` as run on 2026-09-13 (the numbers `analysis/wrapped.py`
 * records in its own docstring: 158 sessions, 50,177 lines, 247 commits, streak 11, 44%,
 * 29.9 words), mapped to the wire shape by the rules of docs/overnight-integration.md 1.3
 * (`reason` is the code, the commits basis moves into extras, the archetype, style and kind
 * answers are `value_id`, crash out and cryptic prompt keep only id, unit, basis, n and
 * reason). The screen labels the deck "Sample" wherever it shows it, because a sample is
 * not this phone's account.
 *
 * THE ART SOURCES ARE SYNTHETIC and seeded (the real per day activity stays out of git, as
 * the real corpus does), and so are the three quotes the `quotes=1` link adds: none of them
 * is anything the owner typed.
 */
import type { QuotesUpload } from '../generated/quotes';
import { pack, StripClass, COLUMNS } from '../generated/strip';
import {
  REPORT_ENUMS,
  type ReportCoverage,
  type ReportWrapped,
  type ReportWrappedCard,
  type WrappedCard,
  type WrappedRefusal,
} from '../generated/report';
import { mulberry32 } from '../ui/decrypt';
import type { ArtSession, ArtSources } from './art';

/** When the sample report was computed: the engine run above. */
export const SAMPLE_GENERATED_AT = '2026-09-13T07:06:05Z';

export const SAMPLE_COVERAGE: ReportCoverage = {
  window_days: 90,
  spans_days: 33,
  active_days: 27,
  sessions: 158,
  first_at: '2026-08-12T00:44:30Z',
  last_at: '2026-09-13T07:06:05Z',
};

const cards: ReportWrappedCard[] = [
  {
    id: 'builder_type',
    value: null,
    value_id: 'quality_guardian',
    unit: 'archetype',
    basis: 'archetype_rules',
    n: 158,
    needed: null,
    reason: null,
    extras: {
      confidence: 0.55,
      metric: 'test_runs_per_hour',
      metric_value: 4.86,
      metric_lower_bound: true,
      closest: null,
      runners_up: [
        { name: 'velocity_machine', metric: 'code_velocity', value: 589.0, threshold: 487, score: 0.605 },
        { name: 'skeptic', metric: 'steer_rate', value: 0.435, threshold: 0.4, score: 0.544 },
      ],
    },
  },
  {
    id: 'shipped',
    value: 50177,
    value_id: null,
    unit: 'lines',
    basis: 'project_edit_tools_and_credited_shell_writes',
    n: 158,
    needed: null,
    reason: null,
    extras: { commits: 247, assisted: 232, alone: 15, commits_basis: 'git_log_distinct_commits' },
  },
  {
    id: 'work_style',
    value: null,
    value_id: 'steering',
    unit: 'style',
    basis: 'autonomy_then_prompts_then_steer',
    n: 132,
    needed: null,
    reason: null,
    extras: { autonomy: 0.125, median_prompts: 3.5, steer_rate: 0.435 },
  },
  {
    id: 'longest_session',
    value: 11173,
    value_id: null,
    unit: 'seconds',
    basis: 'attended_seconds_rank',
    n: 132,
    needed: null,
    reason: null,
    extras: { active_seconds: 11173, started_at: '2026-08-19T01:23:20Z' },
  },
  {
    id: 'agents_at_once',
    value: 3,
    value_id: null,
    unit: 'sessions',
    basis: 'sweep_over_first_to_last_event',
    n: 158,
    needed: null,
    reason: null,
    extras: { subagents_peak: 9, subagents: 39 },
  },
  {
    id: 'go_to_prompt',
    value: 4,
    value_id: null,
    unit: 'sends',
    basis: 'normalized_prompt_text_across_sessions',
    n: 898,
    needed: null,
    reason: null,
    extras: { sessions: 4, words: 2 },
  },
  {
    id: 'streak',
    value: 11,
    value_id: null,
    unit: 'days',
    basis: 'days_with_a_commit_and_an_attended_session',
    n: 20,
    needed: null,
    reason: null,
    extras: { commit_days: 24, attended_days: 25, both_days: 20 },
  },
  {
    id: 'change_course',
    value: 0.435,
    value_id: null,
    unit: 'share',
    basis: 'interrupts_and_correction_markers',
    n: 927,
    needed: null,
    reason: null,
    extras: { interrupts: 151, corrective_prompts: 252 },
  },
  {
    id: 'crash_out',
    value: null,
    value_id: null,
    unit: 'score',
    basis: 'profanity_caps_punctuation_markers',
    n: 898,
    needed: null,
    reason: null,
    extras: {},
  },
  {
    id: 'prompt_length',
    value: 29.9,
    value_id: null,
    unit: 'words',
    basis: 'words_per_prompt',
    n: 906,
    needed: null,
    reason: null,
    extras: { median: 16 },
  },
  {
    id: 'deep_sessions',
    value: 19,
    value_id: null,
    unit: 'sessions',
    basis: 'attended_sessions_over_an_hour',
    n: 132,
    needed: null,
    reason: null,
    extras: { avg_minutes: 99, longest_minutes: 186 },
  },
  {
    id: 'time_put_in',
    value: 85.2,
    value_id: null,
    unit: 'hours',
    basis: 'active_seconds',
    n: 158,
    needed: null,
    reason: null,
    extras: { attended_hours: 74.5, attended_overlap_hours: 1.2 },
  },
  {
    id: 'cryptic_prompt',
    value: null,
    value_id: null,
    unit: 'share',
    basis: 'vowelless_runs',
    n: 392,
    needed: null,
    reason: 'no_cryptic_prompt',
    extras: {},
  },
  {
    id: 'prompts_per_session',
    value: 7,
    value_id: null,
    unit: 'prompts_per_session',
    basis: 'prompts_over_attended_sessions',
    n: 132,
    needed: null,
    reason: null,
    extras: { median: 3.5, tool_calls_per_prompt: 11.3 },
  },
  {
    id: 'kind_of_work',
    value: null,
    value_id: 'source',
    unit: 'kind',
    basis: 'lines_by_file_role',
    n: 50177,
    needed: null,
    reason: null,
    extras: {
      kinds: [
        { kind: 'feature', commits: 12 },
        { kind: 'fix', commits: 5 },
        { kind: 'refactor', commits: 5 },
        { kind: 'docs', commits: 1 },
        { kind: 'test', commits: 1 },
        { kind: 'revert', commits: 1 },
      ],
      classified: 25,
      commits: 247,
      coverage: 0.101,
      role_lines: [
        { role: 'test', lines: 11088 },
        { role: 'source', lines: 34867 },
        { role: 'config', lines: 834 },
        { role: 'docs', lines: 2442 },
        { role: 'migration', lines: 530 },
        { role: 'build', lines: 175 },
        { role: 'dependency', lines: 192 },
        { role: 'unknown', lines: 49 },
      ],
      commit_refusal: 'low_label_coverage',
      lines: 50177,
      lines_needed: 200,
    },
  },
];

export const SAMPLE_WRAPPED: ReportWrapped = { cards, prompts_with_text: 927, attended_sessions: 132 };

/**
 * The sample with its three quote cards answered, for `quotes=1`: the cryptic prompt card
 * refused on the real corpus (nobody's short prompts there were keyboard mash), so here it
 * is answered, to show the decrypt. Synthetic, like the quotes.
 */
export const SAMPLE_WRAPPED_WITH_QUOTES: ReportWrapped = {
  ...SAMPLE_WRAPPED,
  cards: cards.map((c) => (c.id === 'cryptic_prompt' ? { ...c, reason: null } : c)),
};

/** 64 lowercase hex, the shape of a client session id; plainly not a real one. */
function sampleSessionId(n: number): string {
  return n.toString(16).padStart(64, '0');
}

export const SAMPLE_QUOTES: QuotesUpload = {
  quotes_version: 1,
  generated_at: SAMPLE_GENERATED_AT,
  quotes: [
    {
      card: 'go_to_prompt',
      text: 'keep going',
      client_session_id: sampleSessionId(1),
      sent_at: '2026-09-02T15:20:11Z',
      seconds_in: 1880,
      tool_calls_after: null,
      corrected: null,
    },
    {
      card: 'crash_out',
      text: 'WHY is the build STILL red?? i said leave the migrations ALONE',
      client_session_id: sampleSessionId(2),
      sent_at: '2026-08-27T23:03:40Z',
      seconds_in: 449,
      tool_calls_after: null,
      corrected: null,
    },
    {
      card: 'cryptic_prompt',
      text: 'jsdkfh fix it',
      client_session_id: sampleSessionId(3),
      sent_at: '2026-09-09T01:12:09Z',
      seconds_in: 5210,
      tool_calls_after: 14,
      corrected: false,
    },
  ],
};

// ─── refusals: one card per code ────────────────────────────────────────────────────────

/** A card each refusal code is refused on, by the engine's own rules. */
const REFUSED_ON: Partial<Record<WrappedRefusal, WrappedCard>> = {
  no_sessions: 'time_put_in',
  below_session_floor: 'builder_type',
  below_attended_floor: 'deep_sessions',
  below_prompt_floor: 'change_course',
  below_own_words_floor: 'prompt_length',
  no_prompt_text: 'prompt_length',
  no_archetype_metric: 'builder_type',
  no_line_counts: 'shipped',
  no_lines_attributed: 'shipped',
  no_presence: 'longest_session',
  no_events: 'agents_at_once',
  no_repeated_prompt: 'go_to_prompt',
  no_commit_history: 'streak',
  no_crash_out: 'crash_out',
  no_cryptic_prompt: 'cryptic_prompt',
  neither_kind_basis: 'kind_of_work',
};

/** The floor a refusal names beside `n` (profile.MIN_SESSIONS, MIN_PROMPTS, KIND_MIN_SUBJECTS). */
const NEEDED: Partial<Record<WrappedRefusal, number>> = {
  below_session_floor: 3,
  below_attended_floor: 3,
  below_prompt_floor: 5,
  below_own_words_floor: 5,
  neither_kind_basis: 20,
};

/**
 * Every refusal code the spec declares, each on a card that refuses with it, with the
 * numbers its template reads. Built from `REPORT_ENUMS`, so a code added to the spec is in
 * the render test the day it lands (on `builder_type` until this table names its card).
 */
export function refusalSamples(): ReportWrappedCard[] {
  return (REPORT_ENUMS.wrapped_refusal as readonly WrappedRefusal[]).map((code) => {
    const id = REFUSED_ON[code] ?? 'builder_type';
    const base = cards.find((c) => c.id === id)!;
    const n = code === 'no_sessions' || code === 'no_events' || code === 'no_commit_history' ? 0 : code === 'no_cryptic_prompt' ? 392 : 2;
    return {
      ...base,
      value: null,
      value_id: null,
      n,
      needed: NEEDED[code] ?? null,
      reason: code,
      extras:
        code === 'neither_kind_basis'
          ? { classified: 4, commits: 15, coverage: 0.267, commit_refusal: 'too_few_labelled', lines: 120, lines_needed: 200 }
          : code === 'no_lines_attributed'
            ? { commits: 12, assisted: 9, alone: 3 }
            : {},
    };
  });
}

/**
 * A deck in which every card is refused, for the dev link `?sample=1&refused=1`: each card
 * refused by a code the engine refuses it with (the first `refusalSamples` entry for it; the
 * two cards that table does not name, work style and prompts per session, refuse below the
 * attended floor, `_attended_floor` in analysis/wrapped.py). What a first week looks like.
 */
export function refusedDeck(): ReportWrapped {
  const samples = refusalSamples();
  const order = REPORT_ENUMS.wrapped_card as readonly WrappedCard[];
  const out = order.map((id): ReportWrappedCard => {
    const hit = samples.find((c) => c.id === id);
    if (hit) return hit;
    const base = cards.find((c) => c.id === id)!;
    return { ...base, value: null, value_id: null, n: 2, needed: NEEDED.below_attended_floor ?? 3, reason: 'below_attended_floor', extras: {} };
  });
  return { cards: out, prompts_with_text: 2, attended_sessions: 2 };
}

// ─── synthetic art sources ──────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const END = Date.parse(SAMPLE_GENERATED_AT);

function isoDay(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

/** Base64 by hand: the sample strip is built in a test runtime and on the phone alike. */
function base64(bytes: Uint8Array): string {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += abc[a >> 2]! + abc[((a & 3) << 4) | ((b ?? 0) >> 4)]!;
    out += b === undefined ? '=' : abc[((b & 15) << 2) | ((c ?? 0) >> 6)]!;
    out += c === undefined ? '=' : abc[c & 63]!;
  }
  return out;
}

function sampleStrip(seed: number): string {
  const r = mulberry32(seed);
  const bytes = new Uint8Array(COLUMNS);
  let klass: number = StripClass.agent;
  let left = 0;
  for (let i = 0; i < COLUMNS; i++) {
    if (left <= 0) {
      const roll = r();
      klass = roll < 0.12 ? StripClass.idle : roll < 0.26 ? StripClass.prompting : roll < 0.3 ? StripClass.human_edit : StripClass.agent;
      left = 8 + Math.floor(r() * (klass === StripClass.idle ? 30 : 70));
    }
    left -= 1;
    const wave = 0.5 + 0.5 * Math.sin(i / 23) * Math.cos(i / 71);
    const density = klass === StripClass.idle ? 0 : Math.min(3, Math.floor((wave + r() * 0.35) * 3.4));
    bytes[i] = pack(klass as StripClass, density);
  }
  return base64(bytes);
}

function sampleSources(): ArtSources {
  const r = mulberry32(13);
  const graph: { date: string; active_seconds: number }[] = [];
  for (let k = 118; k >= 0; k--) {
    const t = END - k * DAY_MS;
    const recent = k < 33;
    const on = recent ? r() < 0.82 : r() < 0.1;
    graph.push({ date: isoDay(t), active_seconds: on ? Math.round((0.3 + r() * (recent ? 7.5 : 1.5)) * 3600) : 0 });
  }
  const commitDays = graph
    .slice(-33)
    .filter((g) => g.active_seconds > 0 && r() < 0.9)
    .map((g) => ({ day: g.date, commits: 1 + Math.floor(r() * 14) }));

  const sessions: ArtSession[] = [];
  let t = END - 32 * DAY_MS;
  while (t < END - 3600_000) {
    const len = (0.25 + r() * 2.6) * 3600_000;
    const attended = Math.round((len / 1000) * (0.55 + r() * 0.45));
    sessions.push({
      started_at: new Date(t).toISOString(),
      ended_at: new Date(t + len).toISOString(),
      attended_seconds: attended,
      lines: Math.round(r() * 900),
      prompts: 1 + Math.floor(r() * 16),
    });
    t += len + (0.6 + r() * 16) * 3600_000;
  }
  // One stretch with three at once, the sample card's answer.
  const peak = END - 9 * DAY_MS;
  for (const [from, to] of [
    [0, 2.4],
    [0.5, 1.9],
    [0.8, 3.1],
  ] as const) {
    sessions.push({
      started_at: new Date(peak + from * 3600_000).toISOString(),
      ended_at: new Date(peak + to * 3600_000).toISOString(),
      attended_seconds: Math.round((to - from) * 2400),
      lines: 300,
      prompts: 6,
    });
  }
  return { graph, commitDays, windowEnd: SAMPLE_GENERATED_AT, sessions, longestStrip: sampleStrip(21) };
}

export const SAMPLE_SOURCES: ArtSources = sampleSources();

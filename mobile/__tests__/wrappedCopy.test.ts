/**
 * The fifteen Wrapped cards, written on the phone, word for word what the Mac writes.
 *
 * Three pins, strongest first:
 *   1. `spec/fixtures/wrapped/cards.json`, written by `scripts/gen_copy.py` from the engine's
 *      own scenarios through the report's own block builder: every card renders its Python
 *      question, display, sentence and refusal exactly. Until that generator exists the
 *      fixture cannot; once it exists, a missing fixture fails here.
 *   2. The engine itself, when python3 can import it: every scenario in
 *      `analysis/tests/corpus_fixture.py`, rendered by `wrapped.py` and by `renderCard`.
 *   3. Hand written cards with the engine's own expected words (`analysis/tests/
 *      test_wrapped.py`), which run everywhere.
 * And the house rules over all of them: no dash, a digit in every answered sentence, and a
 * card the phone cannot render honestly renders nothing.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { QuoteWire } from '../src/generated/quotes';
import type { ReportWrappedCard, ReportWrappedExtras } from '../src/generated/report';
import { REPORT_ENUMS } from '../src/generated/report';
import { hasDash } from '../src/copy/plain';
import { renderCard, renderCards, when, type RenderedCard } from '../src/copy/wrapped';
import { python, REPO } from './pythonRef';

const FIXTURE = join(REPO, 'spec', 'fixtures', 'wrapped', 'cards.json');
const GENERATOR = join(REPO, 'scripts', 'gen_copy.py');

interface FixtureCard {
  card: ReportWrappedCard;
  quote?: QuoteWire | null;
  /** The crash out's clock, the session's own offset, which the quote does not carry. */
  tz_offset_minutes?: number | null;
  local?: boolean;
  question: string;
  display: string | null;
  sentence: string | null;
  refusal: string | null;
}

function words(r: RenderedCard | null) {
  return r && { question: r.question, display: r.display, sentence: r.sentence, refusal: r.refusal };
}

function houseRules(r: RenderedCard) {
  for (const s of [r.question, r.display, r.sentence, r.refusal]) {
    if (s !== null) expect({ id: r.id, s, dash: hasDash(s) }).toEqual({ id: r.id, s, dash: false });
  }
  if (r.refusal === null && !r.local) {
    expect(r.display).not.toBeNull();
    expect({ id: r.id, sentence: r.sentence, digit: /\d/.test(r.sentence ?? '') }).toEqual({ id: r.id, sentence: r.sentence, digit: true });
  }
}

function card(id: ReportWrappedCard['id'], over: Partial<ReportWrappedCard> & { extras?: ReportWrappedExtras } = {}): ReportWrappedCard {
  return { id, value: null, value_id: null, unit: 'sessions', basis: 'archetype_rules', n: 0, needed: null, reason: null, extras: {}, ...over };
}

// ------------------------------------------------------------------ 1. the generated fixture

describe('spec/fixtures/wrapped/cards.json', () => {
  test('exists exactly when its generator does', () => {
    // Before gen_copy.py lands there is nothing to pin to; after, a fixture it did not write
    // is a `make gen` nobody ran, and every assertion below would pass on nothing.
    expect({ fixture: existsSync(FIXTURE) }).toEqual({ fixture: existsSync(GENERATOR) });
  });

  test('every fixture card renders the Python question, display, sentence and refusal exactly', () => {
    if (!existsSync(FIXTURE)) return;
    const entries = JSON.parse(readFileSync(FIXTURE, 'utf8')) as FixtureCard[];
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      const got = renderCard(e.card, { quote: e.quote ?? null, tzOffsetMinutes: e.tz_offset_minutes ?? 0 });
      expect({ id: e.card.id, got: words(got) }).toEqual({
        id: e.card.id,
        got: { question: e.question, display: e.display, sentence: e.sentence, refusal: e.refusal },
      });
      if (e.local !== undefined) expect({ id: e.card.id, local: got?.local }).toEqual({ id: e.card.id, local: e.local });
      if (got) houseRules(got);
    }
    // Every card answered somewhere, and every refusal code reached somewhere.
    const answered = new Set(entries.filter((e) => e.refusal === null).map((e) => e.card.id));
    const codes = new Set(entries.map((e) => e.card.reason).filter(Boolean));
    expect([...answered].sort()).toEqual([...REPORT_ENUMS.wrapped_card].sort());
    expect([...codes].sort()).toEqual([...REPORT_ENUMS.wrapped_refusal].sort());
  });
});

// ------------------------------------------------------------------ 2. the engine itself

/**
 * Every scenario in `corpus_fixture.scenarios()`, and the words `wrapped.py` wrote for it.
 * The wire card is `report_blocks.wrapped_block`'s when that module exists; before it lands,
 * the mapping docs/overnight-integration.md 1.3 specifies, written out here.
 */
const ENGINE = `
import json
from analysis import plain, wrapped as wr
from analysis.tests import corpus_fixture as cf
try:
    from analysis import report_blocks as rb
except ImportError:
    rb = None

SCORE = ("name", "metric", "value", "threshold", "score")
def to_wire(c):
    basis, _, commits_basis = c["basis"].partition("+")
    if c["id"] in wr.LOCAL_CARDS:
        return {"id": c["id"], "value": None, "value_id": None, "unit": c["unit"], "basis": basis,
                "n": c["n"], "needed": c["needed"], "reason": c["code"], "extras": {}}
    out = {}
    for k, v in c["extras"].items():
        if k == "closest": out[k] = None if v is None else {s: v.get(s) for s in SCORE}
        elif k == "runners_up": out[k] = [{s: r.get(s) for s in SCORE} for r in v]
        elif k == "counts": out["kinds"] = [{"kind": x, "commits": v[x]} for x in wr.KINDS if v.get(x)]
        elif k == "role_lines": out[k] = [{"role": r, "lines": v[r]} for r in plain.ROLES if v.get(r)]
        elif k == "commit_code": out["commit_refusal"] = v
        elif k == "metric_basis": out["metric_lower_bound"] = wr._is_lower_bound(v)
        elif k in ("commit_reason", "parts", "length", "tool_calls_after", "corrected"): pass
        else: out[k] = v
    if commits_basis: out["commits_basis"] = commits_basis
    value, value_id = (None, c["value"]) if c["unit"] in ("archetype", "style", "kind") else (c["value"], None)
    return {"id": c["id"], "value": value, "value_id": value_id, "unit": c["unit"], "basis": basis,
            "n": c["n"], "needed": c["needed"], "reason": c["code"], "extras": out}

rows = []
for sc in cf.scenarios():
    result = wr.wrapped(sc.facts, sc.sessions, **sc.kw)
    wire = rb.wrapped_block(wr.wire(result))["cards"] if rb and hasattr(rb, "wrapped_block") else [to_wire(c) for c in result["cards"]]
    quotes = {q["card"]: q for q in wr.quotes_upload(result, generated_at=cf.T0)["quotes"]}
    for c, w in zip(result["cards"], wire):
        rows.append({"scenario": sc.name, "card": w, "quote": quotes.get(c["id"]), "question": c["question"],
                     "display": c["display"], "sentence": c["sentence"], "refusal": c["reason"]})
print(json.dumps(rows, default=str))
`;

describe('against the engine itself (skipped without python3)', () => {
  test('every scenario card renders what wrapped.py wrote', () => {
    const rows = python<(FixtureCard & { scenario: string })[]>(ENGINE);
    if (rows === null) return;
    expect(rows.length).toBeGreaterThanOrEqual(15 * 10);
    for (const e of rows) {
      const got = renderCard(e.card, { quote: e.quote ?? null, tzOffsetMinutes: 0 });
      // A LOCAL card answered with no quote carries nothing the phone can say.
      const local = (e.card.id === 'crash_out' || e.card.id === 'cryptic_prompt') && e.refusal === null && !e.quote;
      const want = local
        ? { question: e.question, display: null, sentence: null, refusal: null }
        : { question: e.question, display: e.display, sentence: e.sentence, refusal: e.refusal };
      expect({ scenario: e.scenario, id: e.card.id, got: words(got) }).toEqual({ scenario: e.scenario, id: e.card.id, got: want });
      if (got) houseRules(got);
    }
  });
});

// ------------------------------------------------------------------ 3. by hand

/** The rich corpus of `analysis/tests/test_wrapped.py`, as the report carries it. */
const RICH: ReportWrappedCard[] = [
  card('builder_type', { value_id: 'director', unit: 'archetype', n: 4, extras: { confidence: 0.44, metric: 'autonomy_score', metric_value: 0.596, metric_lower_bound: false, closest: null, runners_up: [] } }),
  card('shipped', { value: 285, unit: 'lines', basis: 'project_edit_tools_and_credited_shell_writes', n: 4, extras: { commits: 6, assisted: 3, alone: 3, commits_basis: 'git_log_distinct_commits' } }),
  card('work_style', { value_id: 'hand_off', unit: 'style', basis: 'autonomy_then_prompts_then_steer', n: 3, extras: { autonomy: 0.596, median_prompts: 2, steer_rate: 0.222 } }),
  card('longest_session', { value: 3900, unit: 'seconds', basis: 'attended_seconds_rank', n: 3, extras: { active_seconds: 4500, started_at: '2026-09-01T15:00:00Z' } }),
  card('agents_at_once', { value: 1, unit: 'sessions', basis: 'sweep_over_first_to_last_event', n: 4, extras: { subagents_peak: null, subagents: null } }),
  card('go_to_prompt', { value: 3, unit: 'sends', basis: 'normalized_prompt_text_across_sessions', n: 8, extras: { sessions: 3, words: 3 } }),
  card('streak', { value: 2, unit: 'days', basis: 'days_with_a_commit_and_an_attended_session', n: 2, extras: { commit_days: 3, attended_days: 3, both_days: 2 } }),
  card('change_course', { value: 0.222, unit: 'share', basis: 'interrupts_and_correction_markers', n: 9, extras: { interrupts: 1, corrective_prompts: 1 } }),
  card('time_put_in', { value: 4.75, unit: 'hours', basis: 'active_seconds', n: 4, extras: { attended_hours: 3.1, attended_overlap_hours: 0 } }),
];

describe('the rich corpus, in the engine test\'s own words', () => {
  const expected: Record<string, [string, string]> = {
    builder_type: ['Director', '60% of your build time runs without you.'],
    shipped: ['285 lines written, 6 commits', '3 of those commits landed during a session or in the 30 minutes before one.'],
    work_style: ['You hand it off.', '60% of your build time runs without you.'],
    longest_session: ['1h 05m', 'The longest of 3 sessions with you there.'],
    agents_at_once: ['1 session at once', 'Counted from first action to last across 4 sessions.'],
    go_to_prompt: ['Sent 3 times across 3 sessions', '3 words you keep coming back to.'],
    streak: ['2 days straight', '2 days in all had a commit and a session with you there.'],
    change_course: ['22% of the time', '1 interrupt and 1 correction across 9 prompts.'],
    time_put_in: ['4.8 hours across 4 sessions', '3.1 of those hours with you there.'],
  };
  for (const c of RICH) {
    test(c.id, () => {
      const r = renderCard(c)!;
      expect([r.display, r.sentence]).toEqual(expected[c.id]!);
      expect(r.question).toBeTruthy();
      houseRules(r);
    });
  }
});

describe('the sentences a card changes with its numbers', () => {
  test('a quality guardian whose rate is a floor says at least, twice', () => {
    const r = renderCard(card('builder_type', { value_id: 'quality_guardian', unit: 'archetype', n: 155, extras: { metric: 'test_runs_per_hour', metric_value: 4.72, metric_lower_bound: true } }))!;
    expect(r.sentence).toBe('At least 4.7 test runs an hour, at least one every 13 minutes.');
  });

  test('the generalist names its closest rule and never 100% of the way there', () => {
    const closest = { name: 'velocity_machine' as const, metric: 'code_velocity' as const, value: 486.9, threshold: 487, score: 0.4999 };
    const r = renderCard(card('builder_type', { value_id: 'generalist', unit: 'archetype', n: 12, extras: { closest, metric_lower_bound: false } }))!;
    expect(r.display).toBe('Generalist');
    expect(r.sentence).toBe('No single pattern dominates. Closest is Velocity machine, 99% of the way there.');
  });

  test('one answered session and one deep session are singular', () => {
    expect(renderCard(card('longest_session', { value: 3585, unit: 'seconds', n: 1 }))!.display).toBe('59 minutes');
    expect(renderCard(card('longest_session', { value: 3585, unit: 'seconds', n: 1 }))!.sentence).toBe('Counted over 1 session with you there.');
    expect(renderCard(card('deep_sessions', { value: 1, n: 3, extras: { avg_minutes: 99 } }))!.sentence).toBe('It ran 99 minutes with you there.');
    expect(renderCard(card('deep_sessions', { value: 0, n: 3, extras: { longest_minutes: 59 } }))!.display).toBe('No session past an hour yet');
  });

  test('no streak yet is a measured zero, said as one', () => {
    const r = renderCard(card('streak', { value: 0, unit: 'days', n: 0, extras: { commit_days: 2, attended_days: 3, both_days: 0 } }))!;
    expect([r.display, r.sentence]).toEqual(['No streak yet', '2 days had a commit, none alongside a session with you there.']);
  });

  test('helpers at once say inside them only when more than one session ran at once', () => {
    expect(renderCard(card('agents_at_once', { value: 3, n: 40, extras: { subagents_peak: 9, subagents: 39 } }))!.sentence).toBe(
      'Inside them, up to 9 helper agents ran at the same moment.'
    );
    expect(renderCard(card('agents_at_once', { value: 1, n: 40, extras: { subagents_peak: 4, subagents: 12 } }))!.sentence).toBe(
      'Up to 4 helper agents ran at the same moment.'
    );
  });

  test('time put in says how much may be counted twice', () => {
    const r = renderCard(card('time_put_in', { value: 84.9, unit: 'hours', n: 155, extras: { attended_hours: 74.5, attended_overlap_hours: 1.2 } }))!;
    expect(r.sentence).toBe('74.5 of those hours with you there, up to 1.2 of them in sessions that ran at the same time.');
  });

  test('kind of work on commit labels, and on the file role fallback', () => {
    const labels = renderCard(card('kind_of_work', { value_id: 'fix', unit: 'kind', basis: 'commit_subject_labels', n: 30, extras: { commits: 40, classified: 30, kinds: [{ kind: 'feature', commits: 12 }, { kind: 'fix', commits: 18 }] } }))!;
    expect([labels.display, labels.sentence]).toEqual(['Mostly fixes.', '18 fixes and 12 features in 40 commits.']);
    const roles = renderCard(card('kind_of_work', { value_id: 'source', unit: 'kind', basis: 'lines_by_file_role', n: 50177, extras: { role_lines: [{ role: 'test', lines: 11089 }, { role: 'source', lines: 34873 }, { role: 'docs', lines: 4215 }] } }))!;
    expect([roles.display, roles.sentence]).toEqual(['Mostly source code.', '69% of agent lines went to source files, 22% to test files.']);
  });

  test('the prompts a session card falls back to the median when the ratio is refused', () => {
    expect(renderCard(card('prompts_per_session', { value: 7.1, n: 132, extras: { median: 4, tool_calls_per_prompt: null } }))!.sentence).toBe(
      'Half your sessions have 4 or fewer.'
    );
    expect(renderCard(card('prompts_per_session', { value: 7.1, n: 132, extras: { median: 4, tool_calls_per_prompt: 11.3 } }))!.sentence).toBe(
      '11.3 tool calls for every prompt you send.'
    );
  });
});

describe('refusals, from the code and the numbers beside it', () => {
  const cases: [ReportWrappedCard, string][] = [
    [card('builder_type', { reason: 'below_session_floor', n: 2, needed: 3 }), 'fewer than 3 sessions'],
    [card('builder_type', { reason: 'no_archetype_metric', n: 3 }), 'none of the six archetype metrics could be computed'],
    [card('work_style', { reason: 'below_attended_floor', n: 1, needed: 3 }), '1 session with you there, 3 needed'],
    [card('deep_sessions', { reason: 'below_attended_floor', n: 2, needed: 3 }), '2 sessions with you there, 3 needed'],
    [card('change_course', { reason: 'below_prompt_floor', n: 1, needed: 5 }), '1 prompt with text, 5 needed'],
    [card('shipped', { reason: 'no_lines_attributed', n: 3 }), 'none of the 3 sessions has a line the agent wrote into a project file that can be counted, and 0 would read as nothing written'],
    [card('longest_session', { reason: 'no_presence' }), 'no session had you present, and an unattended run cannot hold a record'],
    [card('cryptic_prompt', { reason: 'no_cryptic_prompt', n: 0 }), 'no short prompt of 2 or more words to read (4 to 80 characters, no path, link or hash)'],
    [card('cryptic_prompt', { reason: 'no_cryptic_prompt', n: 1 }), 'the 1 short prompt was not mostly keyboard mash (five letters in a row with no vowel)'],
    [card('cryptic_prompt', { reason: 'no_cryptic_prompt', n: 410 }), 'none of the 410 short prompts was mostly keyboard mash (five letters in a row with no vowel)'],
    [
      card('kind_of_work', { reason: 'neither_kind_basis', basis: 'commit_subject_labels_then_lines_by_file_role', n: 247, needed: 60, extras: { commit_refusal: 'low_label_coverage', classified: 25, commits: 247, lines: 120, lines_needed: 200 } }),
      '25 of 247 commit subjects say what kind of change they are, 60% needed; 120 attributable lines, 200 needed',
    ],
    [
      card('kind_of_work', { reason: 'neither_kind_basis', basis: 'commit_subject_labels_then_lines_by_file_role', n: 0, extras: { commit_refusal: 'no_subjects', commits: 0, classified: 0, lines: 1, lines_needed: 200 } }),
      'no commit subjects were read; 1 attributable line, 200 needed',
    ],
  ];
  for (const [c, want] of cases) {
    test(`${c.id} ${c.reason} ${c.n}`, () => {
      const r = renderCard(c)!;
      expect(r.refusal).toBe(want);
      expect([r.display, r.sentence]).toEqual([null, null]);
      houseRules(r);
    });
  }

  test('every refusal code the report can carry has words', () => {
    for (const code of REPORT_ENUMS.wrapped_refusal) {
      const r = renderCard(card('kind_of_work', { reason: code, n: 2, needed: 3, extras: { commit_refusal: 'no_subjects', commits: 0, classified: 0, lines: 1, lines_needed: 200 } }));
      expect({ code, rendered: r !== null && typeof r.refusal === 'string' }).toEqual({ code, rendered: true });
    }
  });

  test('a refusal whose floor the report left out renders nothing, not a hole', () => {
    expect(renderCard(card('builder_type', { reason: 'below_session_floor', n: 2, needed: null }))).toBeNull();
  });
});

describe('what the phone refuses to invent', () => {
  test('an id this build does not know renders nothing, not a debug string', () => {
    expect(renderCard(card('peak_hour' as ReportWrappedCard['id'], { value: 3 }))).toBeNull();
    expect(renderCard(card('streak', { reason: 'no_such_code' as ReportWrappedCard['reason'] }))).toBeNull();
  });

  test('an answered card missing a number its sentence needs renders nothing, never a zero', () => {
    expect(renderCard(card('change_course', { value: 0.4, n: 9, extras: { interrupts: null, corrective_prompts: 3 } }))).toBeNull();
    expect(renderCard(card('shipped', { value: 285, n: 4, extras: { commits: 6, assisted: null } }))).toBeNull();
    expect(renderCard(card('builder_type', { value_id: 'director', extras: { metric_value: null } }))).toBeNull();
    // A kind of work whose answer disagrees with its own counts is a producer bug, said as nothing.
    expect(renderCard(card('kind_of_work', { value_id: 'feature', basis: 'commit_subject_labels', extras: { commits: 3, kinds: [{ kind: 'fix', commits: 3 }] } }))).toBeNull();
  });

  test('the two LOCAL cards answered without their quote say nothing more than that', () => {
    for (const id of ['crash_out', 'cryptic_prompt'] as const) {
      const r = renderCard(card(id, { unit: id === 'crash_out' ? 'score' : 'share', n: 900 }))!;
      expect(r).toEqual({ id, question: r.question, display: null, sentence: null, refusal: null, local: true });
    }
  });

  test('with the quote, they say when, how long and what followed, and never the words', () => {
    const crash: QuoteWire = { card: 'crash_out', text: 'WHY is this STILL failing???', client_session_id: 'a'.repeat(64), sent_at: '2026-09-01T15:01:00Z', seconds_in: 60 };
    const r = renderCard(card('crash_out', { unit: 'score', n: 9 }), { quote: crash, tzOffsetMinutes: 0 })!;
    expect([r.display, r.sentence]).toEqual(['A Tuesday, at 3:01pm', 'Sent 1 minute into that session. We have all been there.']);
    expect(renderCard(card('crash_out', { unit: 'score', n: 9 }), { quote: { ...crash, seconds_in: 20 }, tzOffsetMinutes: 0 })!.sentence).toBe(
      'Sent less than 1 minute into that session. We have all been there.'
    );
    const cryptic: QuoteWire = { card: 'cryptic_prompt', text: 'sdfgh jklm', client_session_id: 'b'.repeat(64), sent_at: '2026-09-02T09:00:00Z', seconds_in: 5, tool_calls_after: 4, corrected: false };
    const c = renderCard(card('cryptic_prompt', { unit: 'share', n: 3 }), { quote: cryptic })!;
    expect([c.display, c.sentence]).toEqual(['A prompt of 10 characters', 'Somehow the agent knew. 4 tool calls followed.']);
    expect(renderCard(card('cryptic_prompt', { unit: 'share', n: 3 }), { quote: { ...cryptic, corrected: true } })!.sentence).toBe(
      '10 characters, and it had a go anyway.'
    );
    for (const x of [r, c]) {
      expect(x.display).not.toContain(crash.text);
      expect(x.sentence).not.toContain('sdfgh');
    }
    // A quote for another card is not this card's.
    expect(renderCard(card('crash_out', { unit: 'score', n: 9 }), { quote: cryptic })!.display).toBeNull();
  });

  test('the crash out clock is the given offset, twelve hour, zero padded', () => {
    expect(when('2026-09-01T23:42:00Z', 0)).toBe('A Tuesday, at 11:42pm');
    expect(when('2026-09-01T23:42:00Z', 120)).toBe('A Wednesday, at 1:42am');
    expect(when('2026-09-01T12:05:00Z', 0)).toBe('A Tuesday, at 12:05pm');
    expect(when('not a time', 0)).toBeNull();
  });

  test('renderCards keeps the report order, pairs each quote with its card, and drops the unknown', () => {
    const quote: QuoteWire = { card: 'crash_out', text: 'ugh', client_session_id: 'c'.repeat(64), sent_at: '2026-09-01T15:01:00Z', seconds_in: 600 };
    const out = renderCards([RICH[0]!, card('nope' as ReportWrappedCard['id']), card('crash_out', { unit: 'score', n: 9 })], [quote]);
    expect(out.map((c) => c.id)).toEqual(['builder_type', 'crash_out']);
    expect(out[1]!.sentence).toBe('Sent 10 minutes into that session. We have all been there.');
  });
});

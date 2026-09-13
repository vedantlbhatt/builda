/**
 * The session in words: the engineer voice title and the plain English paragraph under the
 * recap card (`src/session/summary.ts`).
 *
 * The paragraph's burn sentences are `burn.explain`'s, and this holds them to it through
 * `spec/fixtures/burn/session.json` (addendum 3: the engine's own sentences for real shaped
 * sessions, written by `scripts/gen_copy.py`): every answered fixture's sentences appear in
 * the paragraph whole, in order and next to each other, and every refused fixture's sentence
 * is the burn section's refusal and never the paragraph's. Then the same against the engine
 * itself over this repository's transcript fixtures when python3 can import it.
 *
 * The sentences the paragraph adds (the time, the commits, the notes) have no Python
 * reference; they are pinned here by hand, with the rules they follow named in each test.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { explainBurn } from '../src/copy/burn';
import { hasDash } from '../src/copy/plain';
import type { SessionDetail } from '../src/data/api';
import type { FeedbackNoteWire, SessionBurn } from '../src/generated/contract';
import { sampleOutcome } from '../src/session/samples';
import {
  agentAlone,
  burnNamesCommits,
  burnRefusal,
  burnSentences,
  commitSentence,
  feedbackSentence,
  sessionTitle,
  summaryParagraph,
  summarySentences,
  timeSentence,
  titleBesideCard,
  type SummaryInput,
} from '../src/session/summary';
import { python, REPO } from './pythonRef';

const FIXTURE = join(REPO, 'spec', 'fixtures', 'burn', 'session.json');

interface BurnEntry {
  name?: string;
  harness: string;
  burn: SessionBurn;
  sentences: string[];
}

function stats(over: Partial<NonNullable<SessionDetail['stats']>> = {}): NonNullable<SessionDetail['stats']> {
  return {
    tokens_reported: true,
    tok_in: 100,
    tok_out: 200,
    tok_cache_read: 300,
    tok_cache_w5m: 0,
    tok_cache_w1h: 0,
    models: null,
    model_state: 'known',
    human_prompt_count: 5,
    prompt_count_basis: 'typed_promptsource',
    files_touched: 4,
    lines_added_agent: 120,
    commit_count: 0,
    agent_line_bucket: 'nine_in_ten',
    attrib_confidence: 'high',
    ...over,
  };
}

function input(over: Partial<SummaryInput> = {}): SummaryInput {
  return {
    harness: 'claude_code',
    active_seconds: 2526,
    attended_seconds: 2289,
    unattended: false,
    state: 'final',
    stats: stats(),
    burn: null,
    feedback: null,
    ...over,
  };
}

/** Where `needle` sits inside `hay` as a contiguous run, or -1. */
function indexOfRun(hay: readonly string[], needle: readonly string[]): number {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/** The words a scolding is made of. The paragraph's own sentences carry none of them. */
const SCOLDING = /\b(wast\w*|fail\w*|bad|should|only|just|lazy|mistake\w*|nothing|stuck|poor\w*|too)\b/i;

// ------------------------------------------------------------------ the parity fixture

describe('spec/fixtures/burn/session.json, inside the paragraph', () => {
  const entries: BurnEntry[] = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, 'utf8')) : [];

  test('the fixture is there to hold the paragraph to', () => {
    // WP-B's generator writes it; the session screen is ported against it (addendum 3).
    expect(existsSync(FIXTURE)).toBe(true);
    expect(entries.length).toBeGreaterThan(5);
  });

  test('an answered block: burn.explain, sentence for sentence, whole and in order in the paragraph', () => {
    const answered = entries.filter((e) => e.burn.reason == null);
    expect(answered.length).toBeGreaterThan(5);
    for (const e of answered) {
      const got = summarySentences(input({ harness: e.harness, burn: e.burn }));
      const at = indexOfRun(got, e.sentences);
      expect({ name: e.name, found: at >= 0 }).toEqual({ name: e.name, found: true });
      // After the time, and never cut by a sentence of the paragraph's own.
      expect({ name: e.name, at }).toEqual({ name: e.name, at: 1 });
      expect(burnSentences({ harness: e.harness, burn: e.burn })).toEqual(e.sentences);
      expect(burnRefusal({ harness: e.harness, burn: e.burn })).toBeNull();
    }
  });

  test('a refused block: the engine\'s sentence is the burn section\'s, said once, never in the paragraph', () => {
    const refused = entries.filter((e) => e.burn.reason != null);
    expect(refused.map((e) => e.burn.reason).sort()).toEqual(['no_token_counts', 'no_token_counts', 'not_segmented']);
    for (const e of refused) {
      const got = summarySentences(input({ harness: e.harness, burn: e.burn }));
      for (const s of e.sentences) expect({ name: e.name, said: got.includes(s) }).toEqual({ name: e.name, said: false });
      expect({ name: e.name, refusal: burnRefusal({ harness: e.harness, burn: e.burn }) }).toEqual({
        name: e.name,
        refusal: e.sentences.join(' '),
      });
    }
  });

  test('no paragraph built on the fixture carries a dash, and every sentence ends as one', () => {
    for (const e of entries) {
      for (const s of summarySentences(input({ harness: e.harness, burn: e.burn }))) {
        expect({ s, dash: hasDash(s), stop: /[.]$/.test(s) }).toEqual({ s, dash: false, stop: true });
      }
    }
  });
});

/** `burn.session_wire` and `burn.explain` over every transcript fixture in the repository. */
const ENGINE = `
import json, pathlib
from analysis import burn
rows = []
roots = [pathlib.Path("spec/fixtures") / d for d in ("live_path", "codex", "gemini", "cline", "opencode", "boundaries")]
for root in roots:
    for p in sorted(root.rglob("*.jsonl")) + sorted(root.rglob("*.json")):
        try:
            rep = burn.burn_report(p)
        except Exception:
            continue
        rows.append({"name": str(p), "harness": rep["harness"], "burn": burn.session_wire(rep), "sentences": burn.explain(rep)})
print(json.dumps(rows))
`;

describe('against the engine itself (skipped without python3)', () => {
  test('every transcript fixture\'s explain is the paragraph\'s burn half, or the section\'s refusal', () => {
    const rows = python<BurnEntry[]>(ENGINE);
    if (rows === null) return;
    expect(rows.length).toBeGreaterThan(10);
    for (const e of rows) {
      const s = { harness: e.harness, burn: e.burn };
      if (e.burn.reason == null) {
        const at = indexOfRun(summarySentences(input(s)), e.sentences);
        expect({ name: e.name, at }).toEqual({ name: e.name, at: 1 });
      } else {
        expect({ name: e.name, refusal: burnRefusal(s) }).toEqual({ name: e.name, refusal: e.sentences.join(' ') });
      }
    }
  });
});

// ------------------------------------------------------------------ the time it took

describe('the time sentence: one total, one part of it, and who was there', () => {
  test('attended beside the total, in whole minutes (the hero\'s rule), with the prompts you sent', () => {
    expect(timeSentence(input())).toBe('You built for 42 minutes, 38 minutes of it with you there, and sent five prompts.');
    expect(timeSentence(input({ active_seconds: 19_020, attended_seconds: 15_120, stats: stats({ human_prompt_count: 52 }) }))).toBe(
      'You built for 5h 17m, 4h 12m of it with you there, and sent 52 prompts.'
    );
  });

  test('all of it, and almost all of it when the two come to the same whole minute', () => {
    expect(timeSentence(input({ attended_seconds: 2526 }))).toBe('You built for 42 minutes, all of it with you there, and sent five prompts.');
    expect(timeSentence(input({ attended_seconds: 2521 }))).toBe(
      'You built for 42 minutes, almost all of it with you there, and sent five prompts.'
    );
    // A whole minute short is said as the minutes: 2,500 s is 41 of them, never "almost all" of 42.
    expect(timeSentence(input({ attended_seconds: 2500 }))).toBe(
      'You built for 42 minutes, 41 minutes of it with you there, and sent five prompts.'
    );
  });

  test('one prompt is singular; no prompt, or no stats, is no clause rather than "zero prompts"', () => {
    expect(timeSentence(input({ stats: stats({ human_prompt_count: 1 }) }))).toBe(
      'You built for 42 minutes, 38 minutes of it with you there, and sent one prompt.'
    );
    expect(timeSentence(input({ stats: stats({ human_prompt_count: 0 }) }))).toBe('You built for 42 minutes, 38 minutes of it with you there.');
    expect(timeSentence(input({ stats: null }))).toBe('You built for 42 minutes, 38 minutes of it with you there.');
  });

  test('an older server with no split says the total, and joins the prompts without a comma', () => {
    expect(timeSentence(input({ attended_seconds: undefined }))).toBe('You built for 42 minutes and sent five prompts.');
  });

  test('nobody there: the agent built on its own, and no prompt count contradicts it', () => {
    expect(timeSentence(input({ unattended: true }))).toBe('The agent built for 42 minutes on its own.');
    expect(timeSentence(input({ attended_seconds: 0 }))).toBe('The agent built for 42 minutes on its own.');
    expect(agentAlone({ unattended: false, attended_seconds: undefined })).toBe(false);
  });

  test('a running session is said as one that is still going', () => {
    expect(timeSentence(input({ state: 'live' }))).toBe(
      'So far you have built for 42 minutes, 38 minutes of it with you there, and sent five prompts.'
    );
    expect(timeSentence(input({ state: 'live', unattended: true }))).toBe('So far the agent has built for 42 minutes on its own.');
  });

  test('under a minute is never zero minutes', () => {
    expect(timeSentence(input({ active_seconds: 200, attended_seconds: 10 }))).toBe(
      'You built for 3 minutes, under a minute of it with you there, and sent five prompts.'
    );
  });

  test('when both clocks come to the same whole minute, the word follows the ratio, not the minutes', () => {
    // 150 s and 125 s both say "2 minutes"; 125 of 150 is most of it, not almost all.
    expect(timeSentence(input({ active_seconds: 150, attended_seconds: 125 }))).toBe(
      'You built for 2 minutes, most of it with you there, and sent five prompts.'
    );
    expect(timeSentence(input({ active_seconds: 20, attended_seconds: 8 }))).toBe(
      'You built for under a minute, part of it with you there, and sent five prompts.'
    );
    expect(timeSentence(input({ active_seconds: 2526, attended_seconds: 2521 }))).toBe(
      'You built for 42 minutes, almost all of it with you there, and sent five prompts.'
    );
  });
});

// ------------------------------------------------------------------ commits

describe('the commits git saw land, and never beside burn\'s own count', () => {
  test('said with plain.spoken, singular at one, digits past twenty', () => {
    expect(commitSentence(input({ stats: stats({ commit_count: 1 }) }))).toBe('One commit landed while you worked.');
    expect(commitSentence(input({ stats: stats({ commit_count: 7 }) }))).toBe('Seven commits landed while you worked.');
    expect(commitSentence(input({ stats: stats({ commit_count: 21 }) }))).toBe('21 commits landed while you worked.');
  });

  test('an agent run on its own, and a running session', () => {
    expect(commitSentence(input({ unattended: true, stats: stats({ commit_count: 3 }) }))).toBe('Three commits landed while it ran.');
    expect(commitSentence(input({ state: 'live', stats: stats({ commit_count: 1 }) }))).toBe('One commit has landed.');
    expect(commitSentence(input({ state: 'live', stats: stats({ commit_count: 2 }) }))).toBe('Two commits have landed.');
  });

  test('zero, or no stats, is no sentence: git finding none is not worth one, and absent is not zero', () => {
    expect(commitSentence(input({ stats: stats({ commit_count: 0 }) }))).toBeNull();
    expect(commitSentence(input({ stats: null }))).toBeNull();
  });

  test('when burn\'s first sentence names its commit calls, git log\'s count is not said too', () => {
    // MEASURED on the overnight stack: git log and burn's commit calls differ on 55 of 78
    // sessions. "This session used 133k tokens and made 1 commit." beside "Three commits
    // landed" would be two numbers for one thing in one paragraph.
    const b: SessionBurn = {
      tokens: 133_000, cache_read_share: 0.5, barren_share: 0.45, unreadable_share: 0, segments: 6,
      lines_added: 0, lines_removed: 0, files_changed: 0, commits: 1, reason: null, spikes: [], spikes_needed: 5,
    };
    expect(burnNamesCommits(b)).toBe(true);
    const got = summarySentences(input({ burn: b, stats: stats({ commit_count: 3 }) }));
    expect(got.some((s) => s.includes('landed'))).toBe(false);
    expect(got[1]).toBe('This session used 133k tokens and made 1 commit.');
    // Lines counted: burn names lines, so git's commits are said.
    expect(burnNamesCommits({ ...b, lines_added: 4 })).toBe(false);
    expect(burnNamesCommits({ ...b, reason: 'no_token_counts' })).toBe(false);
    expect(burnNamesCommits(null)).toBe(false);
  });
});

// ------------------------------------------------------------------ the notes

describe('the notes worth a look, pointed at and not repeated', () => {
  const note = (over: Partial<FeedbackNoteWire> = {}): FeedbackNoteWire => ({ id: 'went_nowhere', seconds: 600, count: 1, ...over });

  test('one note, then several, with their total said the way the notes\' heading says it', () => {
    expect(feedbackSentence({ feedback: [note({ seconds: 1320, id: 'one_file_over_and_over', count: 6 })] })).toBe(
      'One thing in this session is worth a second look, 22 minutes of it.'
    );
    expect(feedbackSentence({ feedback: [note(), note({ id: 'failed_in_a_row', seconds: 780, count: 5 })] })).toBe(
      'Two things in this session are worth a second look, 23 minutes in all.'
    );
    expect(feedbackSentence({ feedback: [note({ seconds: 3600 }), note({ id: 'failed_in_a_row', seconds: 300 })] })).toBe(
      'Two things in this session are worth a second look, 1h 05m in all.'
    );
  });

  test('an id this build cannot render is not counted, and none is no sentence', () => {
    expect(feedbackSentence({ feedback: [note({ id: 'burned_tokens' })] })).toBeNull();
    expect(feedbackSentence({ feedback: [note({ id: 'burned_tokens' }), note()] })).toBe(
      'One thing in this session is worth a second look, 10 minutes of it.'
    );
    expect(feedbackSentence({ feedback: null })).toBeNull();
    expect(feedbackSentence({ feedback: undefined })).toBeNull();
  });
});

// ------------------------------------------------------------------ never a scolding

describe('never a scolding', () => {
  test('the paragraph\'s own sentences carry no word a scolding is made of', () => {
    const cases: SummaryInput[] = [
      input(),
      input({ unattended: true, stats: stats({ commit_count: 2 }) }),
      input({ state: 'live', stats: stats({ commit_count: 1 }) }),
      input({ attended_seconds: 2500 }),
      input({ attended_seconds: undefined }),
      input({ feedback: [{ id: 'went_nowhere', seconds: 1217, count: 1 }, { id: 'failed_in_a_row', seconds: 64, count: 7 }] }),
    ];
    for (const c of cases) {
      const own = [timeSentence(c), commitSentence(c), feedbackSentence(c)].filter((s): s is string => s !== null);
      for (const s of own) expect({ s, scolds: SCOLDING.test(s), dash: hasDash(s) }).toEqual({ s, scolds: false, dash: false });
    }
  });
});

// ------------------------------------------------------------------ the title

describe('the title: the engine\'s when its ids render, else the harness\'s own', () => {
  test('from the ids', () => {
    expect(sessionTitle({ title_ids: { verb: 'shipped', object: 'source', n: 3 }, title: 'Fix the stop list' })).toEqual({
      text: 'Shipped changes to three source files',
      from: 'engine',
    });
  });

  test('ids this build cannot render fall back to the harness title rather than half a title', () => {
    expect(sessionTitle({ title_ids: { verb: 'shipped', object: 'commit', n: 2 }, title: 'Fix the stop list' })).toEqual({
      text: 'Fix the stop list',
      from: 'harness',
    });
    expect(sessionTitle({ title_ids: null, title: '  Fix the stop list  ' })).toEqual({ text: 'Fix the stop list', from: 'harness' });
  });

  test('neither is no title', () => {
    expect(sessionTitle({ title_ids: null, title: null })).toBeNull();
    expect(sessionTitle({ title_ids: undefined, title: '   ' })).toBeNull();
  });

  test('a harness title the card already prints as its headline is not said again under it', () => {
    const harness = { title_ids: null, title: 'Fix the stop list' };
    expect(titleBesideCard(harness, 'Fix the stop list')).toBeNull();
    expect(titleBesideCard(harness, '7 commits')).toEqual({ text: 'Fix the stop list', from: 'harness' });
    // The engine's title is never the card's headline, so it always shows.
    const engine = { title_ids: { verb: 'looked_around', object: 'codebase', n: null }, title: 'Looked around the codebase' } as const;
    expect(titleBesideCard(engine, 'Looked around the codebase')).toEqual({ text: 'Looked around the codebase', from: 'engine' });
  });
});

// ------------------------------------------------------------------ the sample, whole

describe('the finished sample, read out whole', () => {
  const base = {
    id: 'sample', client_session_id: 'sample', harness: 'claude_code', repo_name: 'gt-transit',
    started_at: '2026-08-29T13:12:00Z', ended_at: '2026-08-29T20:00:00Z', active_seconds: 19_020, idle_seconds: 5460,
    local_date: '2026-08-29', title: 'Wire live vehicle positions into the guidance map', title_source: 'harness', notable: true,
    unattended: false, timeline_fidelity: 'full', is_shared: false, post_id: null, strip: null,
    stats: stats({ tok_in: 2_100_000, tok_out: 410_000, tok_cache_read: 190_000_000, tok_cache_w5m: 1_600_000, human_prompt_count: 52, lines_added_agent: 2101, commit_count: 7 }),
  } as SessionDetail;

  test('the paragraph a screenshot of builder://session/sample shows', () => {
    const s = sampleOutcome(base, 'final', 0, 'offline').session!;
    expect(sessionTitle(s)?.text).toBe('Shipped changes to nine source files');
    expect(summaryParagraph(s)).toBe(
      [
        'You built for 5h 17m, 4h 12m of it with you there, and sent 52 prompts.',
        'Seven commits landed while you worked.',
        'This session used 194.1M tokens, added 2,101 lines and removed 186.',
        '98% of that was the conversation re-reading itself, which is normal in a long session and is the main reason cost climbs the longer you go.',
        'The most expensive stretch cost 23.4M tokens, 97% of it re-reading the conversation so far, and it wrote 412 lines.',
        'One thing in this session is worth a second look, 22 minutes of it.',
      ].join(' ')
    );
    expect(explainBurn(s.burn!, s.harness)).toEqual(summarySentences(s).slice(2, 5));
  });
});

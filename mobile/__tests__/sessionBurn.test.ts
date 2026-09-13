/**
 * Burn forensics on the session screen (`src/session/burnView.ts`): the numbers of one
 * session's burn block, its costliest stretches with their causes in words and its cost per
 * line, "nothing was written" said plainly, and every refusal as a sentence.
 *
 * The words come from the engine's tables through `src/copy/burn.ts` and the numbers through
 * the Python ports in `src/copy/numbers.ts`; this pins how the screen lays them out, over the
 * parity fixture's real shaped sessions and by hand.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { explainBurn } from '../src/copy/burn';
import { hasDash } from '../src/copy/plain';
import type { SessionDetail } from '../src/data/api';
import type { SessionBurn, SessionBurnSpike } from '../src/generated/contract';
import {
  ABSENT_SENTENCE,
  burnCoversTokens,
  burnView,
  causeLine,
  NO_SPIKE_SENTENCE,
  NOTHING_INSIDE_SENTENCE,
  OVERLAP_SENTENCE,
  spikesLabel,
  spikeView,
  tokensPerLine,
  tooFewStretches,
  type BurnView,
} from '../src/session/burnView';
import { REPO } from './pythonRef';

const FIXTURE = join(REPO, 'spec', 'fixtures', 'burn', 'session.json');

interface BurnEntry {
  name: string;
  harness: string;
  burn: SessionBurn;
  sentences: string[];
}

const entries: BurnEntry[] = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, 'utf8')) : [];
const named = (name: string) => entries.find((e) => e.name === name)!;

function block(over: Partial<SessionBurn> = {}): SessionBurn {
  return {
    tokens: 10_600_000, cache_read_share: 0.9172641509433962, barren_share: 0, unreadable_share: 0, segments: 7,
    lines_added: 192, lines_removed: 8, files_changed: 7, commits: 0, reason: null, spikes: [], spikes_needed: 5, ...over,
  };
}

function spike(over: Partial<SessionBurnSpike> = {}): SessionBurnSpike {
  return {
    tokens: 9_100_000, multiple: 36.4, barren: false, lines_added: 120, lines_removed: 8, seconds: 40, causes: [],
    files_changed: 1, commits: 0, unreadable: false, ...over,
  };
}

type Ready = Extract<BurnView, { kind: 'ready' }>;

function ready(v: BurnView): Ready {
  if (v.kind !== 'ready') throw new Error(`expected a ready view, got ${v.kind}`);
  return v;
}

/** Every string a view carries, for the dash rule. */
function strings(v: BurnView): string[] {
  if (v.kind !== 'ready') return [v.sentence];
  return [
    ...v.stats.flatMap((s) => [s.value, s.label]),
    ...[v.ledgerNote, v.spikesNote, v.overlapNote].filter((x): x is string => x !== null),
    ...v.spikes.flatMap((s) => [s.title, s.duration, s.meta, s.verdict, ...s.causes]),
  ];
}

describe('over the parity fixture', () => {
  test('the replay session: its numbers, and its stretch with three causes in words', () => {
    const e = named('replay');
    const v = ready(burnView({ burn: e.burn, harness: e.harness, stats: null }));
    expect(v.stats).toEqual([
      { value: '10.6M', label: 'tokens' },
      { value: '92%', label: 're-reading the conversation' },
      { value: '0%', label: 'where nothing was written' },
      // 10,600,000 tokens over 192 + 8 lines.
      { value: '53k', label: 'tokens a line' },
      { value: '7', label: 'stretches' },
    ]);
    expect(v.spikes).toEqual([
      {
        title: '9.1M tokens',
        // feedback._mins: 40 seconds rounds to a minute, as the Mac says it.
        duration: '1 minute',
        meta: '36.4 times a typical stretch · 71k tokens a line',
        causes: [
          '93% of it re-reading the conversation so far',
          '2% of it on the turns that handed work to 4 helper agents',
          '2% of it on 4 failing tool calls and the retries after them',
        ],
        verdict: 'It wrote 120 lines.',
        barren: false,
      },
    ]);
    expect(v.overlapNote).toBe(OVERLAP_SENTENCE);
    expect(v.spikesNote).toBeNull();
    expect(v.ledgerNote).toBeNull();
  });

  test('the dominant share under a stretch is the one the paragraph says', () => {
    // explain: "The most expensive stretch cost 9.1M tokens, 93% of it re-reading ...".
    const e = named('replay');
    const v = ready(burnView({ burn: e.burn, harness: e.harness, stats: null }));
    expect(e.sentences.at(-1)).toContain(v.spikes[0]!.causes[0]!);
  });

  test('a stretch that only read: nothing was written, said plainly, and no cost per line', () => {
    const e = named('reading');
    const v = ready(burnView({ burn: e.burn, harness: e.harness, stats: null }));
    expect(v.spikes[0]).toEqual({
      title: '780k tokens',
      duration: 'under a minute',
      meta: '15.6 times a typical stretch',
      causes: ['72% of it on reading 12 files'],
      verdict: 'Nothing was written.',
      barren: true,
    });
    expect(v.stats.find((s) => s.label === 'where nothing was written')?.value).toBe('76%');
  });

  test('what a stretch produced is never "wrote 0 lines"', () => {
    expect(ready(burnView({ ...named('removed'), stats: null })).spikes[0]!.verdict).toBe('It removed 120 lines.');
    expect(ready(burnView({ ...named('sed'), stats: null })).spikes[0]!.verdict).toBe('It changed 1 file.');
    expect(ready(burnView({ ...named('commit'), stats: null })).spikes[0]!.verdict).toBe('It made 1 commit.');
    expect(ready(burnView({ ...named('script'), stats: null })).spikes[0]!.verdict).toBe(
      'Whether it changed any file cannot be read from this transcript.'
    );
  });

  test('a script whose work could not be seen: the share said, and no cost per line invented', () => {
    const v = ready(burnView({ ...named('script'), stats: null }));
    expect(v.stats.find((s) => s.label === 'could not be judged')?.value).toBe('83%');
    expect(v.stats.some((s) => s.label === 'tokens a line')).toBe(false);
  });

  test('too few stretches: none is named, and the note says why with the two numbers', () => {
    const v = ready(burnView({ ...named('short'), stats: null }));
    expect(v.spikes).toEqual([]);
    expect(v.spikesNote).toBe(
      'No stretch is singled out: it takes five before one can stand out from the rest, and this session has three.'
    );
    expect(ready(burnView({ ...named('halves'), stats: null })).spikesNote).toBe(
      'No stretch is singled out: it takes five before one can stand out from the rest, and this session has two.'
    );
  });

  test('every refusal is the engine\'s sentence for its code, never a zero', () => {
    for (const name of ['no_counts', 'not_read_yet', 'empty']) {
      const e = named(name);
      const v = burnView({ burn: e.burn, harness: e.harness, stats: null });
      expect({ name, v }).toEqual({ name, v: { kind: 'refused', sentence: e.sentences.join(' ') } });
    }
    expect(burnView({ ...named('not_read_yet'), stats: null })).toEqual({ kind: 'refused', sentence: 'Cost is not shown for this tool yet.' });
  });

  test('no string any fixture view carries has a dash', () => {
    for (const e of entries) {
      for (const s of strings(burnView({ burn: e.burn, harness: e.harness, stats: null }))) {
        expect({ name: e.name, s, dash: hasDash(s) }).toEqual({ name: e.name, s, dash: false });
      }
    }
  });
});

describe('by hand', () => {
  test('no block at all is absent, said as such, and never a refusal or a zero', () => {
    expect(burnView({ burn: null, harness: 'claude_code', stats: null })).toEqual({ kind: 'absent', sentence: ABSENT_SENTENCE });
    expect(burnView({ burn: undefined, harness: 'claude_code', stats: null })).toEqual({ kind: 'absent', sentence: ABSENT_SENTENCE });
  });

  test('usage with none inside a stretch is a refusal about the stretches, never "used 0 tokens"', () => {
    const b = block({ tokens: null, cache_read_share: null, barren_share: null, unreadable_share: null, reason: 'nothing_inside_segments', spikes: null });
    // The engine's explain says a zero here; the screen's Numbers may say 12M beside it.
    expect(explainBurn(b, 'claude_code')[0]).toContain('used 0 tokens');
    expect(burnView({ burn: b, harness: 'claude_code', stats: null })).toEqual({ kind: 'refused', sentence: NOTHING_INSIDE_SENTENCE });
    expect(NOTHING_INSIDE_SENTENCE).not.toMatch(/\b0\b/);
  });

  test('enough stretches and none far above the rest is its own sentence', () => {
    expect(ready(burnView({ burn: block({ spikes: [] }), harness: 'claude_code', stats: null })).spikesNote).toBe(NO_SPIKE_SENTENCE);
  });

  test('a cause that claims no token is never listed as a cost', () => {
    expect(causeLine({ cause: 'error_loop', n: 3, tokens: 0 }, 9_100_000)).toBeNull();
    expect(causeLine({ cause: 'investigated', n: 9, tokens: null }, 9_100_000)).toBeNull();
    const v = spikeView(spike({ causes: [{ cause: 'context_replay', n: 8_000_000, tokens: 8_000_000 }, { cause: 'error_loop', n: 3, tokens: 0 }] }));
    expect(v.causes).toEqual(['88% of it re-reading the conversation so far']);
  });

  test('shares at the ends: a positive share is never 0%, a share short of all is never 100%', () => {
    expect(causeLine({ cause: 'subagent_fanout', n: 1, tokens: 15_460 }, 12_900_000)).toBe(
      'under 1% of it on the turn that handed work to 1 helper agent'
    );
    expect(causeLine({ cause: 'context_replay', n: 1, tokens: 159_383_324 }, 159_754_580)).toBe(
      'over 99% of it re-reading the conversation so far'
    );
    const v = ready(burnView({ burn: block({ cache_read_share: 0.9962, barren_share: 0.001 }), harness: 'claude_code', stats: null }));
    expect(v.stats.slice(1, 3).map((s) => s.value)).toEqual(['over 99%', 'under 1%']);
  });

  test('a repeated call is said by what repeated', () => {
    expect(causeLine({ cause: 'repeated_call', n: 4, tokens: 270_000, repeat: 'shell' }, 590_000)).toBe(
      '46% of it on running the same command 4 times'
    );
    expect(causeLine({ cause: 'repeated_call', n: 7, tokens: 11_158, repeat: 'edit' }, 26_794_798)).toBe(
      'under 1% of it on editing the same file 7 times'
    );
  });

  test('cost per line counts added and removed lines, as burn does, and exists only where a line was counted', () => {
    expect(tokensPerLine(9_100_000, 120, 8)).toBe('71k tokens a line');
    expect(tokensPerLine(250_000, 0, 160)).toBe('2k tokens a line');
    expect(tokensPerLine(500, 1, 0)).toBe('500 tokens a line');
    expect(tokensPerLine(9_100_000, 0, 0)).toBeNull();
    expect(tokensPerLine(null, 12, 0)).toBeNull();
    expect(tokensPerLine(0, 12, 0)).toBeNull();
  });

  test('a multiple is said the way profile._n says a number: one decimal at most, no trailing zero', () => {
    expect(spikeView(spike({ multiple: 10 })).meta).toBe('10 times a typical stretch · 71k tokens a line');
    expect(spikeView(spike({ multiple: 3.25 })).meta.startsWith('3.2 times')).toBe(true);
  });

  test('durations are feedback._mins', () => {
    expect(spikeView(spike({ seconds: 20 })).duration).toBe('under a minute');
    expect(spikeView(spike({ seconds: 2280 })).duration).toBe('38 minutes');
    expect(spikeView(spike({ seconds: 3900 })).duration).toBe('1h 05m');
  });

  test('the stretch count is singular at one', () => {
    const v = ready(burnView({ burn: block({ segments: 1, spikes: null }), harness: 'claude_code', stats: null }));
    expect(v.stats.at(-1)).toEqual({ value: '1', label: 'stretch' });
  });
});

describe('two counts for one quantity get a line saying why', () => {
  const stats = (over: Partial<NonNullable<SessionDetail['stats']>>): NonNullable<SessionDetail['stats']> => ({
    tokens_reported: true, tok_in: 0, tok_out: 0, tok_cache_read: 0, tok_cache_w5m: 0, tok_cache_w1h: 0, models: null,
    model_state: 'known', human_prompt_count: 3, prompt_count_basis: 'typed_promptsource', files_touched: 1,
    lines_added_agent: 0, commit_count: 0, agent_line_bucket: 'unknown', attrib_confidence: 'none', ...over,
  });

  test('MEASURED: the ledger said 57.6M where burn counted 41.6M on one real session', () => {
    const v = ready(burnView({ burn: block({ tokens: 41_593_495 }), harness: 'claude_code', stats: stats({ tok_cache_read: 57_609_898 }) }));
    expect(v.ledgerNote).toBe('Counted from your first prompt on, each message once, so it can differ from the 57.6M tokens under numbers.');
  });

  test('silent when both say the same, and when the ledger holds no count', () => {
    const same = block({ tokens: 11_909_584 });
    expect(ready(burnView({ burn: same, harness: 'claude_code', stats: stats({ tok_cache_read: 11_909_584 }) })).ledgerNote).toBeNull();
    expect(ready(burnView({ burn: same, harness: 'claude_code', stats: stats({ tokens_reported: false }) })).ledgerNote).toBeNull();
    expect(ready(burnView({ burn: same, harness: 'claude_code', stats: null })).ledgerNote).toBeNull();
  });

  test('Numbers says the tokens again only when burn does not, or says a different figure', () => {
    const same = block({ tokens: 11_909_584 });
    expect(burnCoversTokens(burnView({ burn: same, harness: 'claude_code', stats: stats({ tok_cache_read: 11_909_584 }) }))).toBe(true);
    expect(burnCoversTokens(burnView({ burn: same, harness: 'claude_code', stats: null }))).toBe(true);
    expect(burnCoversTokens(burnView({ burn: block({ tokens: 41_593_495 }), harness: 'claude_code', stats: stats({ tok_cache_read: 57_609_898 }) }))).toBe(false);
    expect(burnCoversTokens(burnView({ burn: null, harness: 'claude_code', stats: null }))).toBe(false);
    expect(burnCoversTokens({ kind: 'refused', sentence: 'Cost is not shown for this tool yet.' })).toBe(false);
  });
});

describe('labels and the refusal gate', () => {
  test('the stretches section names how many it lists', () => {
    expect(spikesLabel(1)).toBe('the costliest stretch');
    expect(spikesLabel(3)).toBe('the three costliest stretches');
  });

  test('too few stretches is said only when burn itself says so', () => {
    expect(tooFewStretches(block({ spikes: null, segments: 3 }))).not.toBeNull();
    expect(tooFewStretches(block({ spikes: [], segments: 9 }))).toBeNull();
    expect(tooFewStretches(block({ spikes: null, reason: 'no_token_counts' }))).toBeNull();
    expect(tooFewStretches(block({ spikes: null, spikes_needed: null }))).toBeNull();
  });

  test('the refusal and the paragraph never both say the refusal', () => {
    const e = named('no_counts');
    expect(explainBurn(e.burn, e.harness)).toEqual(e.sentences);
  });
});

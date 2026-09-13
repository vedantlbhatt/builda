/**
 * A session's words, written on the phone from the wire: the plain English summary of where
 * its tokens went (`burn.explain`), its engineer voice title (`vocab.session_title`), and the
 * live engine's decision feed and ETA refusals.
 *
 * The burn summary is pinned to Python by `spec/fixtures/burn/session.json` (addendum 3:
 * `scripts/gen_copy.py` writes each scenario's upload block beside the sentences
 * `burn.explain` says about the same session), and to the engine itself over this
 * repository's transcript fixtures when python3 can import it. Titles are held to the exact
 * lines `analysis/tests/test_vocab.py` holds the engine to.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { causePhrase, corpusBurnLine, corpusBurnRefusal, dominantCause, explainBurn, spikeVerdict, spikesMissing } from '../src/copy/burn';
import { decisionLines, decisionSentence, etaRefusal, lockScreenWithoutDetails } from '../src/copy/live';
import { hasDash } from '../src/copy/plain';
import { renderTitle } from '../src/copy/title';
import type { SessionBurn, SessionBurnSpike, SessionTitleIds } from '../src/generated/contract';
import { CONTRACT_ENUMS } from '../src/generated/contract';
import type { LiveEta } from '../src/generated/live';
import { LIVE_ENUMS } from '../src/generated/live';
import type { ReportBurn } from '../src/generated/report';
import { python, REPO } from './pythonRef';

const BURN_FIXTURE = join(REPO, 'spec', 'fixtures', 'burn', 'session.json');
const GENERATOR = join(REPO, 'scripts', 'gen_copy.py');

interface BurnEntry {
  name?: string;
  harness: string;
  burn: SessionBurn;
  sentences: string[];
}

function burn(over: Partial<SessionBurn> = {}): SessionBurn {
  return {
    tokens: 10_600_000, cache_read_share: 0.9172641509433962, barren_share: 0, unreadable_share: 0, segments: 7,
    lines_added: 192, lines_removed: 8, files_changed: 7, commits: 0, reason: null, spikes: null, spikes_needed: 5, ...over,
  };
}

function spike(over: Partial<SessionBurnSpike> = {}): SessionBurnSpike {
  return {
    tokens: 9_100_000, multiple: 36.4, barren: false, lines_added: 120, lines_removed: 8, seconds: 40, causes: [],
    files_changed: 1, commits: 0, unreadable: false, ...over,
  };
}

// ------------------------------------------------------------------ the burn summary

describe('spec/fixtures/burn/session.json', () => {
  test('exists exactly when its generator does', () => {
    expect({ fixture: existsSync(BURN_FIXTURE) }).toEqual({ fixture: existsSync(GENERATOR) });
  });

  test('every fixture session says what burn.explain says, sentence for sentence', () => {
    if (!existsSync(BURN_FIXTURE)) return;
    const entries = JSON.parse(readFileSync(BURN_FIXTURE, 'utf8')) as BurnEntry[];
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      const got = explainBurn(e.burn, e.harness);
      expect({ name: e.name, got }).toEqual({ name: e.name, got: e.sentences });
      for (const s of got) expect({ s, dash: hasDash(s) }).toEqual({ s, dash: false });
    }
  });
});

/** `burn.session_wire` over each transcript fixture in the repository, beside `burn.explain`. */
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
        wire = burn.session_wire(rep) if hasattr(burn, "session_wire") else None
        if wire is None:
            continue
        rows.append({"name": str(p), "harness": rep["harness"], "burn": wire, "sentences": burn.explain(rep)})
print(json.dumps(rows))
`;

describe('against the engine itself (skipped without python3)', () => {
  test('every transcript fixture in the repository says what burn.explain says', () => {
    const rows = python<BurnEntry[]>(ENGINE);
    if (rows === null) return;
    expect(rows.length).toBeGreaterThan(10);
    for (const e of rows) expect({ name: e.name, got: explainBurn(e.burn, e.harness) }).toEqual({ name: e.name, got: e.sentences });
  });
});

describe('the burn summary, by hand', () => {
  test('the dominant cause is the one claiming the most tokens, not the first one listed', () => {
    // MEASURED on the live transcript (overnight-engine 5.1): four helpers and four failing
    // calls were listed first, and the stretch was 93% re-reading.
    const b = burn({
      spikes: [spike({ causes: [
        { cause: 'subagent_fanout', n: 4, tokens: 180_000 },
        { cause: 'context_replay', n: 8_463_000, tokens: 8_463_000 },
        { cause: 'error_loop', n: 4, tokens: 180_000 },
      ] })],
    });
    expect(explainBurn(b, 'claude_code')).toEqual([
      'This session used 10.6M tokens, added 192 lines and removed 8.',
      '92% of that was the conversation re-reading itself, which is normal in a long session and is the main reason cost climbs the longer you go.',
      'The most expensive stretch cost 9.1M tokens, 93% of it re-reading the conversation so far, and it wrote 120 lines.',
    ]);
  });

  test('a cause that claims no token is never named', () => {
    expect(dominantCause([{ cause: 'error_loop', n: 3, tokens: 0 }, { cause: 'investigated', n: 9, tokens: null }])).toBeNull();
    const b = burn({ cache_read_share: 0.1, spikes: [spike({ causes: [{ cause: 'error_loop', n: 3, tokens: 0 }] })] });
    expect(explainBurn(b, 'claude_code').at(-1)).toBe('The most expensive stretch cost 9.1M tokens, and it wrote 120 lines.');
  });

  test('a repeated call is said by what repeated, and one helper is singular', () => {
    expect(causePhrase('repeated_call', 4, 'shell')).toBe('on running the same command 4 times');
    expect(causePhrase('repeated_call', 3, 'edit')).toBe('on editing the same file 3 times');
    expect(causePhrase('repeated_call', 3, null)).toBe('on making the same tool call 3 times');
    expect(causePhrase('subagent_fanout', 1)).toBe('on the turn that handed work to 1 helper agent');
    expect(causePhrase('subagent_fanout', 1200)).toBe('on the turns that handed work to 1,200 helper agents');
    expect(causePhrase('investigated', null)).toBeNull();
  });

  test('a stretch that wrote nothing it can count is never told it wrote 0 lines', () => {
    expect(spikeVerdict(spike({ lines_added: 0, lines_removed: 40 }))).toBe('it removed 40 lines');
    expect(spikeVerdict(spike({ lines_added: 0, lines_removed: 0, files_changed: 1 }))).toBe('it changed 1 file');
    expect(spikeVerdict(spike({ lines_added: 0, lines_removed: 0, files_changed: 0, commits: 2 }))).toBe('it made 2 commits');
    expect(spikeVerdict(spike({ lines_added: 0, lines_removed: 0, files_changed: 0, unreadable: true }))).toBe(
      'whether it changed any file cannot be read from this transcript'
    );
    expect(spikeVerdict(spike({ barren: true, lines_added: 5 }))).toBe('nothing was written');
  });

  test('refusals: nothing read, no counts, and a tool burn does not read yet', () => {
    expect(explainBurn(burn({ reason: 'not_segmented', tokens: null }), 'claude_code')).toEqual([
      'Nothing in this transcript could be read yet, so there is no cost to show.',
    ]);
    expect(explainBurn(burn({ reason: 'no_token_counts', tokens: null }), 'claude_code')).toEqual([
      'This transcript does not record token counts, so cost cannot be shown.',
    ]);
    expect(explainBurn(burn({ reason: 'no_token_counts', tokens: null }), 'cursor')).toEqual(['Cost is not shown for this tool yet.']);
  });

  test('why no spike is named: a median over too few segments would be an accident', () => {
    expect(spikesMissing(burn({ segments: 3, spikes: null }))).toBe(
      'fewer than 5 segments, so a median segment cost would be an accident rather than a baseline'
    );
    expect(spikesMissing(burn({ segments: 9, spikes: [] }))).toBeNull();
    expect(spikesMissing(burn({ reason: 'no_token_counts', spikes: null }))).toBeNull();
  });

  test('the corpus fact is a floor unless every token was judged, and never said of a zero', () => {
    const b: ReportBurn = { share: 0.029, barren_tokens: 120_070_737, tokens: 4_168_469_723, unreadable_tokens: 1_192_481_138, sessions: 156, reason: null };
    expect(corpusBurnLine(b)).toBe('At least 3% of your tokens went into stretches where nothing was written');
    expect(corpusBurnLine({ ...b, unreadable_tokens: 0 })).toBe('3% of your tokens went into stretches where nothing was written');
    expect(corpusBurnLine({ ...b, barren_tokens: 4000, tokens: 3_000_000 })).toBe('Under 1% of your tokens went into stretches where nothing was written');
    expect(corpusBurnLine({ ...b, barren_tokens: 0, share: 0 })).toBeNull();
    expect(corpusBurnLine({ ...b, share: null, reason: 'below_session_floor' })).toBeNull();
  });

  test('the corpus refusals, by code', () => {
    const r = (reason: ReportBurn['reason'], sessions = 2, needed: number | null = 3) =>
      corpusBurnRefusal({ share: null, sessions, reason, needed });
    expect(r('below_session_floor')).toBe('2 sessions with token counts, 3 needed');
    expect(r('below_session_floor', 1)).toBe('1 session with token counts, 3 needed');
    expect(r('no_token_counts')).toBe('no session reported token counts');
    expect(r(null)).toBeNull();
    expect(r('below_session_floor', 2, null)).toBeNull();
    for (const code of ['no_token_counts', 'below_session_floor', 'nothing_inside_segments', 'not_segmented'] as const) {
      expect(typeof r(code)).toBe('string');
    }
  });
});

// ------------------------------------------------------------------ titles

describe('engineer voice titles, in the engine test\'s own words', () => {
  const cases: [SessionTitleIds, string][] = [
    [{ verb: 'debugged', object: 'test_suite', n: 1 }, 'Debugged a failing test suite'],
    [{ verb: 'wired', object: 'migration', n: 1 }, 'Wired a database migration'],
    [{ verb: 'wired', object: 'migration', n: 2 }, 'Wired two database migrations'],
    [{ verb: 'refactored', object: 'source', n: 5, modules: 3 }, 'Refactored five files across three modules'],
    [{ verb: 'refactored', object: 'source', n: 5, modules: 1 }, 'Refactored five files in one module'],
    [{ verb: 'shipped', object: 'source', n: 1 }, 'Shipped a change to a source file'],
    [{ verb: 'shipped', object: 'source', n: 3 }, 'Shipped changes to three source files'],
    [{ verb: 'committed', object: 'commit', n: 1 }, 'Landed a commit'],
    [{ verb: 'committed', object: 'commit', n: 3 }, 'Landed three commits'],
    [{ verb: 'tested', object: 'test', n: 2 }, 'Built out two test files'],
    [{ verb: 'built', object: 'source', n: 2 }, 'Built out two source files'],
    [{ verb: 'built', object: 'source', n: 21 }, 'Built out 21 source files'],
    [{ verb: 'explored', object: 'source', n: 3 }, 'Read through three source files'],
    [{ verb: 'worked_through', object: 'failure', n: 4 }, 'Worked through a stubborn failure'],
    [{ verb: 'edited', object: 'config', n: 1 }, 'Edited a config file'],
    [{ verb: 'edited', object: 'source', n: 2 }, 'Edited two source files'],
    [{ verb: 'edited', object: 'build', n: 1 }, 'Edited the build setup'],
    [{ verb: 'edited', object: 'docs', n: 2 }, 'Edited two docs'],
    [{ verb: 'edited', object: 'docs', n: 1 }, 'Edited a doc'],
    [{ verb: 'looked_around', object: 'codebase', n: null }, 'Looked around the codebase'],
  ];
  for (const [ids, want] of cases) {
    test(want, () => {
      expect(renderTitle(ids)).toBe(want);
      expect(hasDash(want)).toBe(false);
    });
  }

  test('a pair the rules never emit, or a count a title needs and lacks, renders nothing', () => {
    expect(renderTitle({ verb: 'debugged', object: 'source', n: 1 })).toBeNull();
    expect(renderTitle({ verb: 'shipped', object: 'commit', n: 2 })).toBeNull();
    expect(renderTitle({ verb: 'shipped', object: 'source', n: null })).toBeNull();
    expect(renderTitle({ verb: 'refactored', object: 'source', n: 5, modules: null })).toBeNull();
    expect(renderTitle({ verb: 'edited', object: 'source', n: 0 })).toBeNull();
    expect(renderTitle({ verb: 'renamed' as SessionTitleIds['verb'], object: 'source', n: 2 })).toBeNull();
    expect(renderTitle(null)).toBeNull();
    expect(renderTitle(undefined)).toBeNull();
  });

  test('every verb the contract declares has a title for some object', () => {
    for (const verb of CONTRACT_ENUMS.title_verb) {
      const rendered = CONTRACT_ENUMS.title_object.some((object) => renderTitle({ verb, object, n: 2, modules: 2 }) !== null);
      expect({ verb, rendered }).toEqual({ verb, rendered: true });
    }
  });
});

// ------------------------------------------------------------------ the live engine's other words

describe('decisions, ETA refusals and the Lock Screen with details off', () => {
  test('every decision kind the live spec declares has its sentence; an unknown kind has none', () => {
    for (const kind of LIVE_ENUMS.decision_kind) {
      const s = decisionSentence(kind);
      expect({ kind, ok: typeof s === 'string' && s.endsWith('.') && !hasDash(s) }).toEqual({ kind, ok: true });
    }
    expect(decisionSentence('rewrote_history')).toBeNull();
    expect(decisionLines([
      { kind: 'force_pushed', ts: 1, event_n: 3, count: 1 },
      { kind: 'nope' as never, ts: 2, event_n: 4, count: 1 },
      { kind: 'added_dependency', ts: 3, event_n: 9, count: 2 },
    ])).toEqual(['Force pushed over the remote history.', 'Added a dependency.']);
    expect(decisionLines(null)).toEqual([]);
  });

  test('the ETA refusals, in live._eta\'s words, from the code, n and needed', () => {
    const eta = (over: Partial<LiveEta>): LiveEta => ({
      n: null, needed: 10, unattended: false, basis: 'finished_sessions_same_repo_that_ran_at_least_this_long', reason: null, ...over,
    });
    expect(etaRefusal(eta({ reason: 'too_few_sessions', n: 5 }))).toBe('5 finished sessions on this repository, 10 needed');
    expect(etaRefusal(eta({ reason: 'too_few_sessions', n: 1, unattended: true }))).toBe('1 finished unattended run on this repository, 10 needed');
    expect(etaRefusal(eta({ reason: 'too_few_survivors', n: 4, elapsed_s: 1320 }))).toBe(
      '4 finished sessions on this repository ran at least 22 minutes, 10 needed'
    );
    expect(etaRefusal(eta({ reason: 'repo_unresolved' }))).toBe('the repository this session runs in could not be resolved');
    expect(etaRefusal(eta({ reason: 'no_history' }))).toBe('no finished sessions were supplied to compare this one against');
    expect(etaRefusal(eta({ reason: 'no_active_time' }))).toBe('the active time of this session was not supplied');
    expect(etaRefusal(eta({ reason: null, typical_s: 1200, remaining_s: 300, n: 12 }))).toBeNull();
    // A count the refusal names and the wire left out is not said as zero.
    expect(etaRefusal(eta({ reason: 'too_few_sessions', n: null }))).toBeNull();
    for (const reason of LIVE_ENUMS.eta_refusal) {
      expect(typeof etaRefusal(eta({ reason, n: 3, elapsed_s: 600 }))).toBe('string');
    }
  });

  test('details off, the Lock Screen names no repository and no activity', () => {
    expect(lockScreenWithoutDetails(2)).toBe('Builder · 2 running');
    expect(hasDash(lockScreenWithoutDetails(1))).toBe(false);
  });
});

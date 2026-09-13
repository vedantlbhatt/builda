/**
 * The session page as data (`src/session/page.ts`, `when.ts`) and the strip it traces
 * (`src/strip/layout.ts`): the hero's number and its caption, the ledger that says each count once
 * and a missing one never as zero, the words, the list's rows and their names for a session
 * nobody titled, and one geometry for every drawing of a strip.
 */
import { describe, expect, test } from 'bun:test';

import { wholeMinutes } from '../src/copy/numbers';
import { hasDash } from '../src/copy/plain';
import type { SessionDetail } from '../src/data/api';
import { StripClass } from '../src/generated/strip';
import { heroOf, ledgerOf, partOfDay, rowOf, untitledName, wordsOf } from '../src/session/page';
import { sampleOutcome } from '../src/session/samples';
import { sessionTitle, summarySentences, timeSentence } from '../src/session/summary';
import { timeOfDay } from '../src/copy/time';
import { whenLabel } from '../src/session/when';
import { HERO, layoutStrip, legendOf, MINI, TRACK_HEIGHT } from '../src/strip/layout';

const BASE = {
  id: 'abc123',
  client_session_id: 'abc123',
  harness: 'claude_code',
  repo_name: 'gt-transit',
  started_at: '2026-08-29T13:12:00Z',
  ended_at: '2026-08-29T20:00:00Z',
  active_seconds: 19_020,
  idle_seconds: 5460,
  local_date: '2026-08-29',
  title: 'Wire live vehicle positions into the guidance map',
  title_source: 'harness',
  notable: true,
  unattended: false,
  timeline_fidelity: 'full',
  is_shared: false,
  post_id: null,
  stats: {
    tokens_reported: true,
    tok_in: 2_100_000,
    tok_out: 410_000,
    tok_cache_read: 190_000_000,
    tok_cache_w5m: 1_600_000,
    tok_cache_w1h: 0,
    models: [{ model_id: 'claude-opus-5', output_token_share: 1 }],
    model_state: 'known',
    human_prompt_count: 52,
    prompt_count_basis: 'typed_promptsource',
    files_touched: 38,
    lines_added_agent: 2101,
    lines_removed_agent: 186,
    commit_count: 7,
    agent_line_bucket: 'nine_in_ten',
    attrib_confidence: 'high',
  },
} satisfies SessionDetail;

const NOW = Date.parse('2026-09-13T16:00:00Z');
const FINAL = sampleOutcome(BASE, 'final', NOW, 'offline').session!;
const LIVE = sampleOutcome(BASE, 'live', NOW, 'offline').session!;

describe('the hero', () => {
  test('the active time counts to theme.duration, the card\'s and the list\'s figure, and elapsed is said beside it', () => {
    const h = heroOf(FINAL, NOW);
    expect(h.active.final).toBe('5h 17m');
    expect(h.active.value).toBe(19_020);
    expect(h.active.fmt).toEqual({ kind: 'duration' });
    expect(h.caption).toBe('active of 6h 48m elapsed');
    expect(h.repo).toBe('gt-transit');
    expect(h.harnessName).toBe('Claude Code');
    expect(h.title).toEqual(sessionTitle(FINAL));
    expect(h.title?.from).toBe('engine');
  });

  test('a sitting with no idle in it says only "active"; a running one says "so far"', () => {
    const tight = { ...FINAL, started_at: '2026-08-29T13:00:00Z', ended_at: '2026-08-29T13:30:00Z', active_seconds: 1800 };
    expect(heroOf(tight, NOW).caption).toBe('active');
    expect(heroOf(LIVE, NOW).caption).toBe('active so far');
    expect(heroOf(LIVE, NOW).live).toBe(true);
  });

  test('a private repository is said as one, never as an empty line', () => {
    expect(heroOf({ ...FINAL, repo_name: null }, NOW).repo).toBe('private repo');
  });

  test('the hero and the sentence under it say one number of minutes', () => {
    // FOUND IN REVIEW (2026-09-13): the hero floored (`theme.duration`, no zero pad) and the
    // sentence rounded (`mins`). MEASURED before the fix, hero over sentence: 3,570 s "59m" over
    // "1h 00m", 5,370 s "1h 29m" over "1h 30m", 3,900 s "1h 5m" over "1h 05m". After: one rule,
    // `wholeMinutes`, and the same figure in both.
    const said = (secs: number) => {
      const s = { ...FINAL, active_seconds: secs, attended_seconds: secs, autonomous_seconds: 0 };
      return [heroOf(s, NOW).active.final, timeSentence(s)] as const;
    };
    expect(said(3570)).toEqual(['59m', 'You built for 59 minutes, all of it with you there, and sent 52 prompts.']);
    expect(said(5370)).toEqual(['1h 29m', 'You built for 1h 29m, all of it with you there, and sent 52 prompts.']);
    expect(said(3900)).toEqual(['1h 05m', 'You built for 1h 05m, all of it with you there, and sent 52 prompts.']);
    // And everywhere between: the hero's minutes are the sentence's minutes.
    const minutesOf = (text: string): number => {
      const hm = /(\d+)h (\d+)m/.exec(text);
      if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
      const m = /(\d+) ?m(?:inutes?)?\b/.exec(text);
      return m ? Number(m[1]) : 0;
    };
    for (let secs = 0; secs <= 4 * 3600; secs += 7) {
      const [hero, sentence] = said(secs);
      expect({ secs, hero: minutesOf(hero) }).toEqual({ secs, hero: minutesOf(sentence) });
      expect(minutesOf(hero)).toBe(wholeMinutes(secs));
    }
  });
});

describe('the ledger', () => {
  test('lines added in green, removed in red with a hyphen, git\'s commits, the prompts you sent', () => {
    const l = ledgerOf(FINAL);
    expect(l.lines.map((x) => [x.num.final, x.label, x.tone])).toEqual([
      ['+2,101', 'lines added', 'add'],
      ['-186', 'lines removed', 'del'],
      ['7', 'commits landed', null],
      ['52', 'prompts you sent', null],
    ]);
    expect(l.lines.map((x) => x.num.value)).toEqual([2101, 186, 7, 52]);
    expect(l.diff!.addedShare).toBeCloseTo(2101 / 2287, 12);
    for (const x of l.lines) expect(hasDash(x.num.final)).toBe(false);
  });

  test('a count the server did not send is a missing line, never a zero, and no diff bar is drawn from half of it', () => {
    const { lines_removed_agent: _gone, ...stats } = BASE.stats;
    const l = ledgerOf({ ...FINAL, stats: { ...stats } });
    expect(l.lines.map((x) => x.key)).toEqual(['added', 'commits', 'prompts']);
    expect(l.diff).toBeNull();
    expect(ledgerOf({ ...FINAL, stats: null }).lines).toEqual([]);
  });

  test('zero is left out: a measured zero is no finding here, and the words say what happened', () => {
    const l = ledgerOf({ ...FINAL, stats: { ...BASE.stats, lines_added_agent: 0, lines_removed_agent: 0, commit_count: 0, human_prompt_count: 0 } });
    expect(l.lines).toEqual([]);
  });

  test('when burn\'s first sentence names its commit calls, the ledger says those and not git\'s count', () => {
    const quiet = { ...FINAL.burn!, lines_added: 0, lines_removed: 0, files_changed: 0, commits: 2 };
    const s = { ...FINAL, burn: quiet, stats: { ...BASE.stats, lines_added_agent: 0, lines_removed_agent: 0 } };
    const commits = ledgerOf(s).lines.find((x) => x.key === 'commits')!;
    expect([commits.num.final, commits.label]).toEqual(['2', 'commits made']);
    // And the paragraph says the same number, once.
    expect(summarySentences(s).join(' ')).not.toContain('7 commits');
  });

  test('a running session\'s commits have landed so far', () => {
    expect(ledgerOf(LIVE).lines.find((x) => x.key === 'commits')!.label).toBe('commit landed so far');
  });
});

describe('the words', () => {
  test('the paragraph\'s sentences, and the notes with the heading that names their cost', () => {
    const w = wordsOf(FINAL);
    expect(w.sentences).toEqual(summarySentences(FINAL));
    expect(w.notes.map((n) => n.id)).toEqual(['one_file_over_and_over']);
    expect(w.notesHeading).toBe('22 minutes of this session went here');
  });
});

describe('a row in the list', () => {
  test('the engineer title, the card\'s figure, the repository and the day', () => {
    const r = rowOf(FINAL, NOW);
    expect(r.title).toBe(sessionTitle(FINAL)!.text);
    expect(r.title).toBe('Shipped changes to nine source files');
    expect(r.figure).toBe('5h 17m');
    expect(r.meta.startsWith('gt-transit · ')).toBe(true);
    expect(r.harnessName).toBe('Claude Code');
    expect(rowOf({ ...FINAL, unattended: true }, NOW).meta.endsWith(' · on its own')).toBe(true);
  });

  test('no engine title falls back to the harness\'s, then to the day and its part, the way Strava names a run', () => {
    expect(rowOf({ ...FINAL, title_ids: null }, NOW).title).toBe(BASE.title);
    const untitled = rowOf({ ...FINAL, title_ids: null, title: null }, NOW).title;
    expect(untitled).toBe(untitledName(FINAL.started_at, NOW));
    expect(untitled.endsWith(' session')).toBe(true);
  });

  test('the part of the day, on the phone\'s clock, and English for the two relative days', () => {
    const local = (h: number) => new Date(2026, 8, 12, h, 30).toISOString();
    expect([5, 11, 12, 16, 17, 20, 21, 2].map((h) => partOfDay(local(h)))).toEqual(['morning', 'morning', 'afternoon', 'afternoon', 'evening', 'evening', 'late night', 'late night']);
    const today = new Date(NOW);
    const at = (h: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate(), h, 10).toISOString();
    const nowLocal = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 0).getTime();
    expect(untitledName(at(9), nowLocal)).toBe("This morning's session");
    expect(untitledName(at(22), nowLocal)).toBe('Late night session');
    for (const h of [5, 13, 18, 22]) expect(hasDash(untitledName(local(h), NOW))).toBe(false);
  });
});

describe('when it started', () => {
  test('the clock as the analysis page writes an hour, and the day as every list files it', () => {
    expect(timeOfDay(new Date(2026, 8, 12, 13, 5).getTime())).toBe('1:05pm');
    expect(timeOfDay(new Date(2026, 8, 12, 0, 40).getTime())).toBe('12:40am');
    expect(timeOfDay(new Date(2026, 8, 12, 12, 0).getTime())).toBe('12:00pm');
    const now = new Date(2026, 8, 13, 15, 0).getTime();
    expect(whenLabel(new Date(2026, 8, 13, 9, 40).toISOString(), now)).toBe('Today at 9:40am');
    expect(whenLabel(new Date(2026, 8, 12, 13, 12).toISOString(), now)).toBe('Yesterday at 1:12pm');
    // 00:30 belongs to the evening before (days start at 04:00).
    expect(whenLabel(new Date(2026, 8, 13, 0, 30).toISOString(), now)).toBe('Yesterday at 12:30am');
    expect(whenLabel('not a date', now)).toBe('A session');
  });
});

// ------------------------------------------------------------------ the strip's one geometry

/** 1024 columns: idle, then agent at full density, then prompting. */
function strip(): string {
  const bytes = new Uint8Array(1024);
  for (let i = 256; i < 768; i++) bytes[i] = StripClass.agent | (3 << 2);
  for (let i = 768; i < 1024; i++) bytes[i] = StripClass.prompting;
  return Buffer.from(bytes).toString('base64');
}

describe('the strip, laid out once for every drawing', () => {
  test('with bars, idle draws nothing, the work stands on the floor, your marks ride their own lane', () => {
    const l = layoutStrip(strip(), [{ ms: 500, kind: 0 }], 1000, 'hero', 'dark', 300);
    expect(l.height).toBe(72);
    expect(l.rects.every((r) => r.x >= 75 - 1e-9)).toBe(true);
    const floorY = HERO.moves + HERO.gap + HERO.activity;
    for (const r of l.rects) expect(r.y + r.h).toBeCloseTo(floorY, 9);
    expect(l.floor).toEqual({ x: 0, w: 300, y: floorY, h: 1, fill: expect.any(String), opacity: 1 });
    expect(l.marks).toHaveLength(1);
    expect(l.marks[0]!.y).toBe(0);
    expect(l.marks[0]!.h).toBe(HERO.moves);
  });

  test('mini is the hero\'s rhythm in a list row\'s height', () => {
    const l = layoutStrip(strip(), [], 1000, 'mini', 'dark', 200);
    expect(l.height).toBe(TRACK_HEIGHT.mini);
    expect(TRACK_HEIGHT.mini).toBe(MINI.moves + MINI.gap + MINI.activity + MINI.baseline);
    const floorY = MINI.moves + MINI.gap + MINI.activity;
    for (const r of l.rects) expect(r.y + r.h).toBeCloseTo(floorY, 9);
    // A prompting column is a full height tick; full density agent work is the full lane too.
    expect(Math.max(...l.rects.map((r) => r.h))).toBe(MINI.activity);
  });

  test('the row preset is a flat texture, merged into runs, with no floor', () => {
    const l = layoutStrip(strip(), [], 1000, 'row', 'dark', 100);
    expect(l.floor).toBeNull();
    expect(l.rects.length).toBeLessThanOrEqual(3);
    expect(l.rects.reduce((s, r) => s + r.w, 0)).toBeCloseTo(100, 9);
  });

  test('a malformed strip is an empty track and a sentence, never a throw', () => {
    const l = layoutStrip('not base64 of 1024 bytes', [], 1000, 'hero', 'dark', 300);
    expect(l.rects).toEqual([]);
    expect(l.label).toBe('Session timeline unavailable');
  });

  test('the key says each class\'s share, and a share that rounds to zero is "under 1%"', () => {
    expect(legendOf(strip()).map((x) => [x.label, x.share])).toEqual([
      ['agent working', '50%'],
      ['you prompting', '25%'],
      ['your edits', '0%'],
      ['idle', '25%'],
    ]);
    const bytes = new Uint8Array(1024).fill(StripClass.agent);
    bytes[0] = StripClass.prompting;
    expect(legendOf(Buffer.from(bytes).toString('base64'))[1]!.share).toBe('under 1%');
    expect(legendOf(null).every((x) => x.share === null)).toBe(true);
  });
});

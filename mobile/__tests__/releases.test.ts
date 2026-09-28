/**
 * Releases and stars on the phone (`src/releases/model.ts`, `PixelStar.tsx`'s star): a draft's reason
 * and what it carries in words, a star count the server withheld said as nothing, a draft held to
 * the server's bounds before it goes, only what changed sent back, the settings said as one line,
 * the stepper inside the server's range, codes never shown, and no dash in any of it.
 */
import { describe, expect, test } from 'bun:test';

import { hasDash } from '../src/copy/plain';
import {
  carriesLine,
  CADENCE_WORDS,
  doorWords,
  draftLine,
  draftPatch,
  draftProblem,
  EVERY_COMMITS,
  followingWords,
  releasePost,
  sayReleaseError,
  settingsLine,
  starsLine,
  stepCommits,
  triggerLine,
  whenLine,
  withDraft,
  type MyRelease,
  type ReleaseSettings,
} from '../src/releases/model';

function rel(over: Partial<MyRelease> = {}): MyRelease {
  return {
    id: 'r1', project_key: 'ab'.repeat(32), name: 'RideGT', status: 'draft', title: 'Buses on the map', notes: '', highlights: [], commits: 12,
    trigger: 'commits', has_trailer: true, trailer_version: 3, visibility: 'followers', created_at: '2026-09-28T06:00:00Z', updated_at: '2026-09-28T06:00:00Z',
    published_at: null, stars: 4, ...over,
  };
}
const settings = (over: Partial<ReleaseSettings> = {}): ReleaseSettings => ({ project_key: 'k', every_commits: 10, cadence: 'none', on_shipped: true, drafts_to_phone: true, updated_at: null, ...over });

describe('a release in words', () => {
  test('why the Mac drafted it, and what it carries', () => {
    expect(triggerLine(rel())).toBe('drafted after 12 commits');
    expect(triggerLine(rel({ trigger: 'shipped' }))).toBe('drafted after a session that shipped');
    expect(triggerLine(rel({ trigger: 'cadence' }))).toBe('drafted on your schedule');
    expect(carriesLine(rel())).toBe('12 commits · a trailer');
    expect(carriesLine(rel({ commits: 1, has_trailer: false }))).toBe('1 commit');
    expect(carriesLine(rel({ commits: null, has_trailer: false }))).toBeNull();
    expect(draftLine(rel())).toBe('drafted after 12 commits · a trailer');
    expect(draftLine(rel({ trigger: 'shipped' }))).toBe('drafted after a session that shipped · 12 commits · a trailer');
  });

  test('a star count the server withheld is nothing, never zero', () => {
    expect(starsLine(null)).toBeNull();
    expect(starsLine(0)).toBe('0 stars');
    expect(starsLine(1)).toBe('1 star');
  });

  test('when it went out', () => {
    const now = Date.parse('2026-09-28T15:00:00');
    expect(whenLine('2026-09-28T09:00:00', now)).toBe('today');
    expect(whenLine('2026-09-27T09:00:00', now)).toBe('yesterday');
    expect(whenLine('2026-09-24T09:00:00', now)).toBe('4 days ago');
    expect(whenLine('2026-09-01T09:00:00', now)).toBe('sep 1');
    expect(whenLine(null, now)).toBeNull();
  });
});

describe('the draft, edited', () => {
  test('held to the server bounds before it goes', () => {
    expect(draftProblem({ title: '  ', notes: '', highlights: [] })).toBe('Give it a title.');
    expect(draftProblem({ title: 'x'.repeat(81), notes: '', highlights: [] })).toBe('The title is 1 over 80.');
    expect(draftProblem({ title: 'ok', notes: '', highlights: ['a', 'b', 'c', 'd', 'e', 'f'] })).toBe('At most 5 highlights.');
    expect(draftProblem({ title: 'ok', notes: '', highlights: ['x'.repeat(125), ''] })).toBe('A highlight is 5 over 120.');
    expect(draftProblem({ title: 'ok', notes: '', highlights: ['a', '', ''] })).toBeNull();
  });

  test('only what changed goes back, trimmed, blank highlights left out', () => {
    const before = { title: 'Buses', notes: 'n', highlights: ['a'] };
    expect(draftPatch(before, { title: 'Buses ', notes: 'n', highlights: ['a', ' '] })).toBeNull();
    expect(draftPatch(before, { title: 'Buses live', notes: 'n', highlights: ['a', 'b'] })).toEqual({ title: 'Buses live', highlights: ['a', 'b'] });
  });
});

describe('settings', () => {
  test('said as one line, and nothing drafted while it is off', () => {
    expect(settingsLine(settings({ drafts_to_phone: false }))).toBe('Your Mac drafts nothing for this project.');
    expect(settingsLine(settings())).toBe('Your Mac drafts one every 10 commits or after a session that ships. Nothing goes out until you publish it.');
    expect(settingsLine(settings({ on_shipped: false, cadence: 'weekly' }))).toBe('Your Mac drafts one every 10 commits or every week. Nothing goes out until you publish it.');
    expect(settingsLine(settings({ cadence: 'biweekly' }))).toBe('Your Mac drafts one every 10 commits, after a session that ships or every two weeks. Nothing goes out until you publish it.');
  });

  test('the stepper walks inside the server range', () => {
    expect(stepCommits(10, 1)).toBe(15);
    expect(stepCommits(10, -1)).toBe(5);
    expect(stepCommits(3, -1)).toBe(EVERY_COMMITS[0]);
    expect(stepCommits(200, 1)).toBe(EVERY_COMMITS[1]);
    expect(stepCommits(12, 1)).toBe(15);
  });
});

describe('doors and lines', () => {
  test('a waiting draft is the door, else what went out', () => {
    expect(doorWords([rel()])).toEqual({ title: 'A release draft is waiting', line: 'Buses on the map' });
    expect(doorWords([rel({ status: 'published' }), rel({ id: 'r2', status: 'published' })]).line).toBe('2 out. Your Mac can draft the next one.');
    expect(doorWords(null).title).toBe('Releases');
    expect(withDraft('Active · 2 hours ago', true)).toBe('Active · 2 hours ago · a release draft to read');
    expect(withDraft('Active', false)).toBe('Active');
    expect(followingWords(3)).toBe('3 releases this week from what you starred and who you follow');
  });

  test('a code is never shown, a sentence passes', () => {
    expect(sayReleaseError(new Error('project_not_public'), 'x')).toContain('Only a public project');
    expect(sayReleaseError(new Error('brand_new_code'), 'It did not go out.')).toBe('It did not go out.');
    expect(sayReleaseError(new Error('Builda is not reachable right now.'), 'x')).toBe('Builda is not reachable right now.');
  });

  test('no dash in any word here', () => {
    const words = [
      ...Object.values(CADENCE_WORDS),
      settingsLine(settings({ cadence: 'biweekly' })),
      triggerLine(rel({ trigger: 'asked' })),
      doorWords(null).line,
      followingWords(null),
      ...['project_not_public', 'names_a_repository', 'not_draft', 'drafts_off'].map((c) => sayReleaseError(new Error(c), '')),
    ];
    for (const w of words) expect(hasDash(w)).toBe(false);
  });
});

describe('the pixel star', () => {
  test('is symmetric, and its edge is its outline', async () => {
    const { STAR, edgeCell } = await import('../src/releases/model');
    for (const row of STAR) expect(row).toBe([...row].reverse().join(''));
    expect(edgeCell(0, 3)).toBe(true);
    expect(edgeCell(3, 3)).toBe(false);
    expect(edgeCell(0, 0)).toBe(false);
  });
});

describe('a release, posted elsewhere', () => {
  const r = { title: 'Buses you can catch', highlights: ['Leave now times on every trip', 'The stops you ride past, in order', 'A trailer cut from the demo'] };
  test('the title, then the highlights that fit whole, each after the middle dot', () => {
    expect(releasePost(r, 280)).toBe('Buses you can catch\n\n· Leave now times on every trip\n· The stops you ride past, in order\n· A trailer cut from the demo');
    const tight = releasePost(r, 60);
    expect(tight).toBe('Buses you can catch\n\n· Leave now times on every trip');
    expect([...tight].length).toBeLessThanOrEqual(60);
  });

  test('reddit takes the title alone, and a title never runs past the limit', () => {
    expect(releasePost(r, 300, true)).toBe('Buses you can catch');
    expect(releasePost({ title: 'x'.repeat(90), highlights: [] }, 80)).toHaveLength(80);
  });
});

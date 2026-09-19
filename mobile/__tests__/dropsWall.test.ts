import { describe, expect, test } from 'bun:test';

import { undash } from '../src/copy/plain';
import { bandOf, posterWords, runningFor, startsFromPoster, wallLine, wallOf } from '../src/drops/wall/model';
import type { DropRow, MoveRow } from '../src/drops/types';

function drop(id: string, over: Partial<DropRow> = {}): DropRow {
  return {
    id,
    url: `https://www.tiktok.com/@a/video/${id}`,
    platform: 'tiktok',
    status: 'planned',
    kind: 'project',
    title: `Drop ${id}`,
    summary: null,
    thumbnail_url: null,
    refusal: null,
    resolution: null,
    created_at: `2026-09-1${id}T10:00:00Z`,
    resolved_at: null,
    archived_at: null,
    ...over,
  };
}

function move(id: string, dropId: string, over: Partial<MoveRow> = {}): MoveRow {
  return {
    id,
    drop_id: dropId,
    position: 0,
    move_kind: 'scaffold',
    status: 'offered',
    title: `Move ${id}`,
    intent: 'do it',
    evidence: 'the words',
    target: 'new_project',
    effort: 'a_session',
    source: null,
    verification: null,
    adjustment: null,
    repo_key: null,
    session_id: null,
    run_uuid: null,
    outcome: null,
    queued_at: null,
    started_at: null,
    finished_at: null,
    ...over,
  };
}

describe('the wall reads a drop\'s life, not its topic', () => {
  test('running beats everything, then waiting on the Mac, then built, then pick', () => {
    const d = drop('1');
    expect(bandOf(d, [move('a', '1', { status: 'running' }), move('b', '1', { status: 'done' })])).toBe('building');
    expect(bandOf(drop('2', { status: 'resolving' }), [])).toBe('reading');
    expect(bandOf(drop('2', { status: 'waiting' }), [])).toBe('reading');
    expect(bandOf(d, [move('a', '1', { status: 'done' }), move('b', '1')])).toBe('built');
    expect(bandOf(d, [move('a', '1')])).toBe('pick');
  });

  test('a keep or a card that finished made nothing to show beside the reel', () => {
    expect(bandOf(drop('1'), [move('a', '1', { status: 'done', move_kind: 'keep' })])).toBe('kept');
    expect(bandOf(drop('1', { kind: 'recipe' }), [move('a', '1', { status: 'done', move_kind: 'card', target: 'none' })])).toBe('kept');
  });

  test('refused and passed-on drops are kept', () => {
    expect(bandOf(drop('1', { status: 'refused', refusal: 'no_text' }), [])).toBe('kept');
    expect(bandOf(drop('1'), [move('a', '1', { status: 'declined' })])).toBe('kept');
  });

  test('every drop is in exactly one band, newest first, and archived ones are gone', () => {
    const drops = [drop('1'), drop('2', { status: 'waiting' }), drop('3', { archived_at: '2026-09-18T00:00:00Z' }), drop('4')];
    const moves = [move('a', '1'), move('b', '4', { status: 'queued' })];
    const w = wallOf(drops, moves);
    expect(w.all.map((x) => x.drop.id)).toEqual(['4', '2', '1']);
    const total = Object.values(w.bands).reduce((n, b) => n + b.length, 0);
    expect(total).toBe(3);
    expect(w.bands.building[0]!.active!.id).toBe('b');
    expect(w.bands.pick[0]!.lead!.id).toBe('a');
    expect(w.counts).toEqual({ pick: 1, building: 1, built: 0, reading: 1 });
  });

  test('the lead is the planner\'s first offered move', () => {
    const w = wallOf([drop('1')], [move('b', '1', { position: 1 }), move('a', '1', { position: 0 })]);
    expect(w.bands.pick[0]!.lead!.id).toBe('a');
  });

  test('the line is words, and says nothing about an empty band', () => {
    expect(wallLine({ pick: 2, building: 1, built: 0, reading: 0 })).toBe('1 being built, 2 to pick');
    expect(wallLine({ pick: 0, building: 0, built: 0, reading: 0 })).toBe('');
  });

  test('a move into one of your repos needs the repo first; a keep is not worth a button', () => {
    expect(startsFromPoster(move('a', '1'))).toBe(true);
    expect(startsFromPoster(move('a', '1', { target: 'existing_repo', move_kind: 'apply' }))).toBe(false);
    expect(startsFromPoster(move('a', '1', { move_kind: 'keep', target: 'none' }))).toBe(false);
    expect(startsFromPoster(null)).toBe(false);
  });

  test('a poster with no picture says the post\'s words, or its host', () => {
    expect(posterWords(drop('1', { title: 'A menu bar app' }))).toBe('A menu bar app');
    expect(posterWords(drop('1', { title: null, url: 'https://www.instagram.com/reel/x' }))).toBe('instagram.com');
    expect(posterWords(drop('1', { title: 'x'.repeat(200) })).length).toBeLessThanOrEqual(90);
  });

  test('minutes running', () => {
    const m = move('a', '1', { status: 'running', started_at: '2026-09-19T10:00:00Z' });
    expect(runningFor(m, Date.parse('2026-09-19T10:12:30Z'))).toBe(12);
    expect(runningFor(move('b', '1'), 0)).toBeNull();
  });
});

describe('words this app did not write follow the dash rule', () => {
  test('a dash between clauses becomes a comma, a minus a hyphen', () => {
    expect(undash('Done — created README.md')).toBe('Done, created README.md');
    expect(undash('a – b')).toBe('a, b');
    expect(undash('−9')).toBe('-9');
    expect(undash('go-to and --json stay')).toBe('go-to and --json stay');
    expect(undash('one - two')).toBe('one, two');
  });
});

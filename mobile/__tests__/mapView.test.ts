/**
 * What the codebase map and the time lapse show (`src/map/view.ts`): which state a session is
 * in, and every sentence either screen says. A refusal is a sentence from the data, never a
 * zero, a blank map or "--"; no sentence carries a dash; a number is never said without its
 * unit.
 */
import { describe, expect, test } from 'bun:test';

import { hasDash } from '../src/copy/plain';
import type { SessionDetail } from '../src/data/api';
import type { LiveFile, LiveState } from '../src/generated/live';
import { renderLiveSentence } from '../src/live/sentence';
import { cleanFrames } from '../src/map/frames';
import { findBurst, findKnot } from '../src/map/knot';
import { layoutMap } from '../src/map/layout';
import { MAP_SAMPLE_VARIANTS, mapSample, mapSampleVariant } from '../src/map/sample';
import {
  burstSentence,
  cellCaption,
  cutNote,
  elapsedLabel,
  hotRows,
  ISLANDS_NOTE,
  knotSentence,
  legend,
  mapContent,
  mapMeta,
  mapSummary,
  namesOf,
  offMapNote,
  refusalCopy,
  sentenceInput,
  thinnedNote,
  timelapseContent,
  timelapseMeta,
  timelapseTitle,
  times,
  updatedLine,
  whenOf,
  type Refusal,
} from '../src/map/view';

const NOW = Date.parse('2026-09-13T15:00:00Z');
const base = {
  id: 'x1',
  client_session_id: 'x1',
  harness: 'claude_code',
  repo_name: 'gt-transit',
  started_at: '2026-09-13T13:00:00Z',
  ended_at: '2026-09-13T14:02:00Z',
  state: 'live',
} as unknown as SessionDetail;
const sample = (v: (typeof MAP_SAMPLE_VARIANTS)[number]) => mapSample(base, v, NOW);

/** Every string a person could read, collected so one assertion holds them all. */
function allCopy(s: SessionDetail): string[] {
  const out: string[] = [];
  const state = s.live_state!;
  const files = state.map!.files;
  const names = namesOf(s, files);
  out.push(renderLiveSentence(sentenceInput(state)), mapMeta(s, state, NOW), mapSummary(files, layoutMap(files).folders.length));
  const cut = cutNote(state);
  if (cut) out.push(cut);
  for (const f of files) out.push(cellCaption(f, names?.[f.id], NOW));
  const hot = hotRows(files, names, NOW);
  out.push(hot.label, ...hot.rows.flatMap((r) => [r.title, r.meta, r.value ?? '']));
  for (const screen of ['map', 'timelapse'] as const) {
    for (const knot of [true, false]) for (const reduce of [true, false]) out.push(...legend(screen, knot, reduce).map((i) => i.text));
  }
  out.push(ISLANDS_NOTE);
  const frames = cleanFrames(state.timelapse) ?? [];
  if (frames.length) {
    out.push(timelapseTitle(frames), timelapseMeta(s, state, frames, NOW));
    const knot = findKnot(frames);
    const burst = findBurst(frames, knot);
    if (knot) out.push(knotSentence(knot, files, names));
    if (burst) out.push(burstSentence(burst, frames[frames.length - 1]!.t, knot !== null));
    for (const n of [thinnedNote(frames, files), offMapNote(frames, layoutMap(files).index)]) if (n) out.push(n);
  }
  return out.filter((x) => x !== '');
}

describe('which state a session is in', () => {
  const live = sample('map').live_state!;
  const withLive = (l: Partial<LiveState> | null | undefined, state: 'live' | 'final' = 'live') =>
    ({ ...base, state, live_state: l === undefined ? undefined : l === null ? null : { ...live, ...l } }) as SessionDetail;

  test('a server older than the live state sent no field: not sent, on both screens', () => {
    const s = { ...base } as SessionDetail;
    delete (s as { live_state?: unknown }).live_state;
    expect(mapContent(s).kind).toBe('notSent');
    expect(timelapseContent(s).kind).toBe('notSent');
  });

  test('a finished session has none: its live state went with it', () => {
    expect(mapContent(withLive(null, 'final')).kind).toBe('finished');
    expect(timelapseContent(withLive(null, 'final')).kind).toBe('finished');
  });

  test('a running session nobody computes a live state for: not computed', () => {
    expect(mapContent(withLive(null)).kind).toBe('notComputed');
    expect(timelapseContent(withLive(null)).kind).toBe('notComputed');
  });

  test('a live state without its map', () => {
    expect(mapContent(withLive({ map: null })).kind).toBe('noMap');
    expect(timelapseContent(withLive({ map: null })).kind).toBe('noMap');
  });

  test('the slim body from the live list is never drawn as if it were the map', () => {
    const slim = withLive({ timelapse: null, map: { files: live.map!.files.slice(0, 2), files_total: live.map!.files_total } });
    expect(mapContent(slim).kind).toBe('partial');
    expect(timelapseContent(slim).kind).toBe('partial');
    // A map that holds every file it counts is whole, frames or not.
    const whole = withLive({ timelapse: null, map: { files: live.map!.files, files_total: live.map!.files.length } });
    expect(mapContent(whole).kind).toBe('ready');
    expect(timelapseContent(whole).kind).toBe('partial');
  });

  test('nothing touched yet is empty, not a map of nothing', () => {
    expect(mapContent(sample('empty')).kind).toBe('empty');
    expect(timelapseContent(sample('empty')).kind).toBe('empty');
  });

  test('the samples draw', () => {
    for (const v of ['map', 'circling', 'names', 'cut'] as const) {
      expect(mapContent(sample(v)).kind).toBe('ready');
      expect(timelapseContent(sample(v)).kind).toBe('ready');
    }
  });

  test('a link\'s variant: none is the default sample, a known one is ours, any other is the session screen\'s', () => {
    expect(mapSampleVariant(undefined)).toBe('map');
    expect(mapSampleVariant('Circling')).toBe('circling');
    expect(mapSampleVariant(['names'])).toBe('names');
    expect(mapSampleVariant('live')).toBeNull();
    expect(mapSampleVariant('stale')).toBeNull();
  });
});

describe('refusals are sentences from the data', () => {
  const kinds: Refusal[] = ['notSent', 'finished', 'notComputed', 'noMap', 'partial', 'empty'];

  test('every refusal on both screens: a title and a line, full stops, no dash, no zero, no "--"', () => {
    for (const kind of kinds) {
      for (const screen of ['map', 'timelapse'] as const) {
        const r = refusalCopy(kind, screen, base, NOW);
        for (const s of [r.title, r.text]) {
          expect({ kind, screen, s, dash: hasDash(s), stop: /\.$/.test(s), zero: /\b0\b|--/.test(s) }).toEqual({
            kind,
            screen,
            s,
            dash: false,
            stop: true,
            zero: false,
          });
        }
      }
    }
  });

  test('a finished session says when it finished', () => {
    const r = refusalCopy('finished', 'timelapse', base, NOW);
    expect(r.text).toMatch(/^This session finished (at \d{1,2}:\d{2}|on [A-Z][a-z]{2} \d{1,2})\./);
    expect(r.action).toBe('session');
  });

  test('the one action: the session, the command that sends the state, or trying again', () => {
    expect(refusalCopy('notComputed', 'map', base, NOW).action).toBe('copy');
    expect(refusalCopy('partial', 'map', base, NOW).action).toBe('retry');
    expect(refusalCopy('empty', 'timelapse', base, NOW).action).toBe('session');
  });
});

describe('every sentence on both screens', () => {
  for (const v of ['map', 'circling', 'names', 'cut'] as const) {
    test(`${v}: no dash anywhere, and none empty`, () => {
      const lines = allCopy(sample(v));
      expect(lines.length).toBeGreaterThan(10);
      expect(lines.filter(hasDash)).toEqual([]);
    });
  }

  test('numbers carry their units', () => {
    const s = sample('map');
    const state = s.live_state!;
    expect(mapMeta(s, state, NOW)).toMatch(/^gt-transit · \d+ files touched, \d+ changed · updated just now$/);
    const frames = cleanFrames(state.timelapse)!;
    const knot = findKnot(frames)!;
    expect(knotSentence(knot, state.map!.files, null)).toMatch(/^Stuck from \d+m \d{2}s to \d+m \d{2}s on three files: \d+ changes and \d+ failed calls\.$/);
    const burst = findBurst(frames, knot)!;
    expect(burstSentence(burst, frames[frames.length - 1]!.t, true)).toMatch(/^Then [a-z]+ files changed in its last \d+ minutes\.$/);
    expect(timelapseTitle(frames)).toBe('1h 04m of work so far, replayed in fifteen seconds.');
    expect(timelapseMeta(s, state, frames, NOW)).toMatch(/^gt-transit · \d+ reads, changes and failures · updated just now$/);
  });

  test('a cut map says how much it keeps; a whole one says nothing', () => {
    expect(cutNote(sample('cut').live_state!)).toMatch(/^This session touched [\d,]+ files\. The map keeps the 400 it touched most recently\.$/);
    expect(cutNote(sample('map').live_state!)).toBeNull();
    const cut = sample('cut');
    expect(mapMeta(cut, cut.live_state!, NOW)).not.toContain('changed');
  });

  test('a thinned replay says how much it kept, counted against the map; an unthinned one says nothing', () => {
    const cut = sample('cut').live_state!;
    const map = sample('map').live_state!;
    const cutFrames = cleanFrames(cut.timelapse)!;
    // Thinning leaves empty stretches out, so the cap is not the signal: 283 frames here.
    expect(cutFrames.length).toBeLessThan(600);
    expect(thinnedNote(cutFrames, cut.map!.files)).toMatch(/^A long session: the replay keeps [\d,]+ of its [\d,]+ reads and changes, /);
    expect(thinnedNote(cleanFrames(map.timelapse)!, map.map!.files)).toBeNull();
    expect(thinnedNote(cleanFrames(sample('circling').live_state!.timelapse)!, sample('circling').live_state!.map!.files)).toBeNull();
  });

  test('the live sentence reads the verdict through the adapter, as the engine would say it', () => {
    expect(renderLiveSentence(sentenceInput(sample('circling').live_state!))).toMatch(/^Going back and forth on a source file, \d+(st|nd|rd|th) pass$/);
    expect(renderLiveSentence(sentenceInput(sample('empty').live_state!))).toBe('Thinking about the next step');
  });
});

describe('the words for numbers', () => {
  test('a moment in the session', () => {
    expect([0, 59, 60, 725, 3599, 3840, -4, 12.9].map(elapsedLabel)).toEqual(['0s', '59s', '1m 00s', '12m 05s', '59m 59s', '1h 04m', '0s', '12s']);
  });

  test('once, twice, then times', () => {
    expect([1, 2, 3, 14].map(times)).toEqual(['once', 'twice', '3 times', '14 times']);
  });

  test('when: the clock on the same Builder day, the date otherwise, nothing for a bad time', () => {
    const today = new Date(NOW - 3_600_000).toISOString();
    expect(whenOf(today, NOW)).toMatch(/^at \d{1,2}:\d{2}$/);
    expect(whenOf('2026-08-29T15:00:00Z', NOW)).toMatch(/^on Aug (28|29|30)$/);
    expect(whenOf('not a time', NOW)).toBeNull();
    expect(whenOf(null, NOW)).toBeNull();
  });

  test('updated just now, then minutes', () => {
    expect(updatedLine(new Date(NOW - 20_000).toISOString(), NOW)).toBe('updated just now');
    expect(updatedLine(new Date(NOW - 240_000).toISOString(), NOW)).toBe('updated 4 minutes ago');
    expect(updatedLine('garbage', NOW)).toBeNull();
  });
});

describe('names are the opt in basenames, and only for files on the map', () => {
  const f = (id: string, edits: number, reads: number): LiveFile => ({
    id,
    dir_id: null,
    role: 'test',
    depth: 0,
    reads,
    edits,
    last_read_ts: reads ? 1_757_000_000 : null,
    last_edit_ts: edits ? 1_757_000_060 : null,
  });

  test('a name for a file the map does not hold is dropped; no names is null, not an empty map', () => {
    const files = [f('a'.repeat(16), 2, 1)];
    const s = { ...base, live_names: { files: [{ id: 'a'.repeat(16), name: 'store.test.ts' }, { id: 'b'.repeat(16), name: 'x.py' }] } } as SessionDetail;
    expect(namesOf(s, files)).toEqual({ ['a'.repeat(16)]: 'store.test.ts' });
    expect(namesOf({ ...base, live_names: null } as SessionDetail, files)).toBeNull();
    expect(namesOf({ ...base, live_names: { files: [] } } as SessionDetail, files)).toBeNull();
  });

  test('a picked cell: its name when opted in, else its role; what happened, and when', () => {
    expect(cellCaption(f('a'.repeat(16), 6, 3), 'store.test.ts', NOW)).toMatch(/^store\.test\.ts, a test file\. Changed 6 times, read 3 times\. Last touched on /);
    expect(cellCaption(f('a'.repeat(16), 0, 1), null, NOW)).toMatch(/^A test file\. Read once, never changed\./);
    expect(cellCaption(f('a'.repeat(16), 0, 0), null, NOW)).toBe('A test file. Named by a call that neither read nor changed it.');
  });

  test('the list under the map: most changed first; with names, the name leads and the role follows', () => {
    const files = [f('a'.repeat(16), 1, 1), f('b'.repeat(16), 5, 0), f('c'.repeat(16), 0, 4)];
    const plain = hotRows(files, null, NOW);
    expect(plain.label).toBe('most changed');
    expect(plain.rows.map((r) => r.title)).toEqual(['A test file', 'A test file']);
    expect(plain.rows[0]!.meta).toBe('changed 5 times');
    const named = hotRows(files, { ['b'.repeat(16)]: 'store.test.ts' }, NOW);
    expect(named.rows[0]).toMatchObject({ title: 'store.test.ts', meta: 'a test file, changed 5 times' });
    expect(hotRows([f('c'.repeat(16), 0, 4)], null, NOW).label).toBe('most read');
  });
});

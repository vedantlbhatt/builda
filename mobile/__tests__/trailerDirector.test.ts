/**
 * The director's words on the phone (`src/trailer/model.ts`): a change is said in the Mac's own
 * sentence (held to `capture/trailer/cut.py say` by running it), a refusal in the spec's, a code
 * this build does not know says nothing, and a note reads as waiting, cutting, done or refused
 * from the server's row alone.
 */
import { describe, expect, test } from 'bun:test';

import { TRAILER_ENUMS } from '../src/generated/trailer';
import { answerOf, anyPending, canSend, conversation, sayChange, sayRefusal, type TrailerNote } from '../src/trailer/model';
import { havePython, python } from './pythonRef';

const SAMPLES: Record<string, [string | null, string | null]> = {
  seconds: ['20', '14'],
  pace: ['1', '1.15'],
  hue: ['tide', 'ember'],
  title: ['RideGT', 'RideGT Live'],
  line: [null, 'the fastest bus across campus'],
  cta: [null, 'free on the App Store'],
  creature: ['fox', 'owl'],
  mood: ['quiet', 'none'],
  camera: ['drift', 'still'],
  transition: ['fluid', 'cut'],
  scene_added: [null, 'stack'],
  scene_removed: ['days', null],
  scene_moved: [null, 'figure'],
  figure: ['commits', 'hours'],
  screens: ['5', '3'],
  first: [null, 'figure'],
  reverted: [null, '2'],
  rerendered: [null, null],
};

function note(over: Partial<TrailerNote>): TrailerNote {
  return { id: 'n1', body: 'make it shorter', status: 'queued', created_at: '2026-09-28T06:00:00Z', finished_at: null, from_version: 1, to_version: null, changes: [], refusal: null, source: null, ...over };
}

describe('a change in the Mac own words', () => {
  test('every change code has a sample here, so none goes unsaid', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual([...TRAILER_ENUMS.change_code].sort());
  });

  test('the phone says exactly what capture/trailer/cut.py says', () => {
    if (!havePython()) return;
    const changes = Object.entries(SAMPLES).map(([code, [before, after]]) => ({ code, before, after }));
    const mac = python<string[]>(
      'import json, sys\nfrom capture.trailer import cut\nprint(json.dumps([cut.say(c) for c in json.loads(sys.argv[1])]))',
      JSON.stringify(changes),
    )!;
    expect(changes.map(sayChange)).toEqual(mac);
  });

  test('values are said as words, not codes', () => {
    expect(sayChange({ code: 'mood', before: 'quiet', after: 'none' })).toBe('the sound is off now');
    expect(sayChange({ code: 'scene_removed', before: 'days', after: null })).toBe('took out the days built');
    expect(sayChange({ code: 'transition', before: 'fluid', after: 'cut' })).toBe('scenes change by a straight cut now');
  });

  test('a code this build does not know says nothing', () => {
    expect(sayChange({ code: 'confetti', before: null, after: 'lots' })).toBeNull();
    expect(sayRefusal('mystery')).toBeNull();
    expect(sayRefusal(null)).toBeNull();
  });
});

describe('a note, from the server row alone', () => {
  test('waiting, cutting, done with its lines, refused with the spec sentence', () => {
    expect(answerOf(note({ status: 'queued' }))).toEqual({ kind: 'waiting', line: 'Waiting for your Mac' });
    expect(answerOf(note({ status: 'claimed' })).kind).toBe('cutting');
    const done = answerOf(note({ status: 'done', to_version: 2, changes: [{ code: 'seconds', before: '20', after: '15' }, { code: 'nope', before: null, after: null }] }));
    expect(done).toEqual({ kind: 'done', version: 2, lines: ['20 s became 15 s'] });
    expect(answerOf(note({ status: 'failed', refusal: 'needs_new_capture' }))).toEqual({ kind: 'refused', line: 'that needs new screens filmed; ask for a new demo and the trailer will be cut from it' });
  });

  test('the conversation reads down, oldest first, and polls only while a note is with the Mac', () => {
    const a = note({ id: 'a', created_at: '2026-09-28T06:00:00Z', status: 'done' });
    const b = note({ id: 'b', created_at: '2026-09-28T06:05:00Z', status: 'claimed' });
    expect(conversation([b, a]).map((n) => n.id)).toEqual(['a', 'b']);
    expect(anyPending([a, b])).toBe(true);
    expect(anyPending([a])).toBe(false);
  });

  test('a note is sent when there is something to say and fewer than five are waiting', () => {
    expect(canSend('  ', 0)).toBe(false);
    expect(canSend('shorter', 4)).toBe(true);
    expect(canSend('shorter', 5)).toBe(false);
    expect(canSend('x'.repeat(501), 0)).toBe(false);
  });
});

import { describe, expect, test } from 'bun:test';

import contract from '../../privacy/upload-contract.json';
import type { FeedbackNoteWire } from '../src/generated/contract';
import { heading, minutes, NOTE_IDS, NOWHERE_MAX_SHARE, pageFactsOf, renderable, sentence } from '../src/session/feedback';
import { feedbackSentence } from '../src/session/summary';

const note = (over: Partial<FeedbackNoteWire> = {}): FeedbackNoteWire => ({
  id: 'went_nowhere',
  seconds: 1217,
  count: 1,
  ...over,
});

describe('every note the contract declares has a sentence here', () => {
  /**
   * The one way this design fails silently. The wire carries an id, the server checks it
   * against the contract's own list, and the WORDS live in this client — so a fourth note
   * added to the contract without a line in `sentence()` would validate, store, and
   * render nothing at all, on the screen people read most.
   */
  const declared: string[] = (
    contract.fields.find((f: { name: string }) => f.name === 'feedback') as {
      values: string[];
    }
  ).values;

  test('the contract and this client agree on the id list', () => {
    expect([...NOTE_IDS].sort()).toEqual([...declared].sort() as typeof NOTE_IDS[number][]);
  });

  test('each one renders a sentence with its numbers in it', () => {
    for (const id of declared) {
      const text = sentence(note({ id, count: 7, seconds: 480 }));
      expect(text).not.toBeNull();
      expect(text).toContain('7');
      expect(text).toContain('8 minutes');
    }
  });
});

describe('what the wire does not carry, the sentence does not invent', () => {
  test('the failing command is not named, because it never left the machine', () => {
    const text = sentence(note({ id: 'failed_in_a_row', count: 7, seconds: 64 }))!;
    expect(text).toContain('7 failures in a row');
    expect(text).toContain('the same thing');
  });

  test('the file is not named either', () => {
    const text = sentence(note({ id: 'one_file_over_and_over', count: 6, seconds: 720 }))!;
    expect(text).toContain('One file');
  });
});

describe('an id this build does not know', () => {
  test('renders nothing rather than a debug string', () => {
    expect(sentence(note({ id: 'burned_tokens' }))).toBeNull();
    expect(renderable([note({ id: 'burned_tokens' })])).toEqual([]);
  });

  test('and does not take the notes beside it down with it', () => {
    const got = renderable([note({ id: 'burned_tokens' }), note({ id: 'went_nowhere' })]);
    expect(got.length).toBe(1);
    expect(got[0]!.id).toBe('went_nowhere');
  });
});

describe('ordering and absence', () => {
  test('the most expensive note comes first', () => {
    const got = renderable([
      note({ id: 'failed_in_a_row', seconds: 64, count: 7 }),
      note({ id: 'went_nowhere', seconds: 1217, count: 1 }),
    ]);
    expect(got[0]!.id).toBe('went_nowhere');
  });

  test('null and an empty list are the same thing on this card', () => {
    expect(renderable(null)).toEqual([]);
    expect(renderable(undefined)).toEqual([]);
    expect(renderable([])).toEqual([]);
  });

  test('no notes means no heading, so the section never renders empty', () => {
    expect(heading([])).toBeNull();
  });

  test('the heading names what the notes cost in total', () => {
    expect(heading(renderable([note({ seconds: 600 }), note({ id: 'failed_in_a_row', seconds: 600, count: 5 })]))).toBe(
      '20 minutes of this session went here'
    );
  });
});

describe('minutes, the way a person says them', () => {
  test('a stretch under a minute is not zero minutes', () => {
    // A note about something that took no time would not have been written; printing "0
    // minutes" makes the sentence contradict its own existence.
    expect(minutes(20)).toBe('under a minute');
  });

  test('one is singular', () => {
    expect(minutes(60)).toBe('1 minute');
  });

  test('an hour reads as an hour, the way feedback._mins says it', () => {
    expect(minutes(3600)).toBe('1h 00m');
    expect(minutes(4500)).toBe('1h 15m');
  });

  test('a tie rounds UP on both sides (the one rule, `plain.half_up`), so the phone and the Mac say one duration', () => {
    // 150 seconds is 2.5 minutes, a tie: 3, where Python's own round() said 2.
    expect(minutes(150)).toBe('3 minutes');
    expect(minutes(210)).toBe('4 minutes');
    expect(minutes(149)).toBe('2 minutes');
  });
});

describe('the plural of a stretch', () => {
  test('one stretch says how long it was', () => {
    expect(sentence(note({ count: 1, seconds: 1217 }))).toBe(
      'A stretch of 20 minutes with nothing written, tested or committed.'
    );
  });

  test('several say how many and what they cost together', () => {
    expect(sentence(note({ count: 3, seconds: 2400 }))).toBe(
      '3 stretches with nothing written, tested or committed, 40 minutes in total.'
    );
  });
});

describe('a note never contradicts its own page (shots/now2/61-session-binned-03)', () => {
  // 60256e3a as the server still holds it: 3h 12m active, +507 lines, 13 commits, and the old
  // rule's note of 3 stretches, 3h 09m "with nothing written, tested or committed".
  const binned = {
    active_seconds: 11567,
    stats: { commit_count: 13, lines_added_agent: 507 },
    feedback: [{ id: 'went_nowhere', count: 3, seconds: 11341 }] as FeedbackNoteWire[],
  };

  test('the old rule\'s note on that sitting is not drawn, and the paragraph does not point at it', () => {
    expect(renderable(binned.feedback, pageFactsOf(binned))).toEqual([]);
    expect(feedbackSentence(binned as never)).toBeNull();
    // Without the page, the note alone still renders: the guard is the page's, not the note's.
    expect(renderable(binned.feedback)).toHaveLength(1);
  });

  test('a note that leaves most of the sitting to what landed is drawn, and so is any note on a sitting that landed nothing', () => {
    const short = { ...binned, feedback: [{ id: 'went_nowhere', count: 2, seconds: 1500 }] as FeedbackNoteWire[] };
    expect(renderable(short.feedback, pageFactsOf(short)).map((n) => n.seconds)).toEqual([1500]);
    const idle = { ...binned, stats: { commit_count: 0, lines_added_agent: 0 } };
    expect(renderable(idle.feedback, pageFactsOf(idle))).toHaveLength(1);
    // The bound is half the active time, exactly: at it, drawn; past it, not.
    const at = (seconds: number) => renderable([{ id: 'went_nowhere', count: 1, seconds }], { activeSeconds: 1000, landed: true }).length;
    expect(at(1000 * NOWHERE_MAX_SHARE)).toBe(1);
    expect(at(1000 * NOWHERE_MAX_SHARE + 1)).toBe(0);
  });

  test('the other notes are not held to it: a failure streak or a rewritten file is not a claim that nothing landed', () => {
    const notes = [
      { id: 'failed_in_a_row', count: 6, seconds: 11000 },
      { id: 'one_file_over_and_over', count: 5, seconds: 11000 },
    ] as FeedbackNoteWire[];
    expect(renderable(notes, pageFactsOf(binned))).toHaveLength(2);
  });

  test('an unknown active time or unknown stats never hides a note', () => {
    expect(renderable(binned.feedback, pageFactsOf({ active_seconds: null, stats: binned.stats }))).toHaveLength(1);
    expect(renderable(binned.feedback, pageFactsOf({ active_seconds: 11567, stats: null }))).toHaveLength(1);
  });
});

describe('a note\'s seconds are rounded once (review, 2026-09-14)', () => {
  test('the wire floors them, so the phone\'s minutes are the Mac\'s: 3,929.6 s is "1h 05m" on both', () => {
    // `analysis/feedback.wire_seconds(3929.6)` is 3929; it used to round to 3930, which is 65.5 minutes here.
    expect(minutes(3929)).toBe('1h 05m');
    expect(minutes(3930)).toBe('1h 06m');
  });
});

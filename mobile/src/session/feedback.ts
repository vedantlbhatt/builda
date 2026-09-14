import { mins } from '../copy/numbers';
import type { FeedbackNoteWire } from '../generated/contract';

/**
 * THE SENTENCE FOR EACH NOTE, written here rather than uploaded.
 *
 * The wire carries an id and two integers (contract v3). That is deliberate three times
 * over: the failing COMMAND and the FILE NAME the same module names on your own machine
 * are on the never-list and stay there, and the WORDING is not on the wire either — so
 * rewriting a note is a client release rather than a re-upload of everybody's history.
 *
 * The cost of that choice is this file: an id the client does not know renders nothing,
 * silently. `FeedbackNoteWire` is validated against the contract's own id list at the
 * server door, so an unknown id cannot be stored — but a note added to the contract
 * without a line added here would still be invisible, which is why `renderable` exists
 * and why the test asserts every declared id has a sentence.
 */

/** The three notes the contract declares, each with what its two integers mean. */
export const NOTE_IDS = ['went_nowhere', 'failed_in_a_row', 'one_file_over_and_over'] as const;

export type NoteId = (typeof NOTE_IDS)[number];

export interface Note {
  id: string;
  /** Second person, one sentence, with the numbers in it. */
  text: string;
  /** What it cost, in seconds. Used for ordering and for the badge. */
  seconds: number;
}

/**
 * Minutes the way a person says them. Never "0 minutes": a note about a stretch that
 * lasted under a minute would not have been worth writing, and printing zero would make
 * the sentence contradict its own existence.
 *
 * `feedback._mins`, the engine's one rule for a duration a person reads ("under a minute",
 * "12 minutes", "1h 05m"), through its port in `copy/numbers.ts`. This used to be a second
 * copy that rounded ties up and said "1h" on the hour, so the heading over these notes and
 * the session summary that points at them could print two durations for one total.
 */
export function minutes(seconds: number): string {
  return mins(seconds);
}

/**
 * One note's sentence, or null when this client does not know the id.
 *
 * Null rather than a fallback string: "went_nowhere: 3" on a card is worse than nothing,
 * because it reads as a bug and tells the person less than silence does.
 */
export function sentence(n: FeedbackNoteWire): string | null {
  const t = minutes(n.seconds);
  switch (n.id) {
    case 'went_nowhere':
      return n.count === 1
        ? `A stretch of ${t} with nothing written, tested or committed.`
        : `${n.count} stretches with nothing written, tested or committed, ${t} in total.`;
    case 'failed_in_a_row':
      // The COMMAND is not on the wire. "The same thing" is what can be said honestly
      // from an id and two numbers, and it is still the useful half: a run of identical
      // failures is the moment to change approach rather than try again.
      return `${n.count} failures in a row on the same thing before anything changed, over ${t}.`;
    case 'one_file_over_and_over':
      // The FILE NAME is not on the wire either.
      return `One file was rewritten ${n.count} times across ${t}. A file on its fifth pass usually needs a decision, not another attempt.`;
    default:
      return null;
  }
}

/**
 * What the page says about the whole sitting, which a note about part of it must not contradict:
 * its active seconds, and whether it landed anything (a line written or a commit).
 */
export interface PageFacts {
  activeSeconds?: number | null;
  landed?: boolean;
}

/**
 * The most of a sitting's active time a "went nowhere" note may claim when the same page says the
 * sitting landed lines or commits. Past it the two sentences cannot both be true of one sitting,
 * and the note is not drawn.
 *
 * FOUND IN THE DEFECTS PASS (2026-09-14, shots/now2/61-session-binned-03): 60256e3a, 3h 12m
 * active (11,567 s) with +507 lines and 13 commits, said "3 stretches with nothing written, tested
 * or committed, 3h 09m in total": 11,341 s, 98% of the sitting. The engine's rule is fixed
 * (`analysis/patterns._runs_with_nothing_to_show` cuts a stretch at any call that could have
 * changed a file and measures it on the active clock; MEASURED over the overnight corpus's 160
 * counted sittings, the note went from 17 of them, 9 claiming over half their sitting, to none).
 * But a stored note outlives the rule that wrote it: the server keeps a note when a later upload
 * carries none (`COALESCE` in `server/builder/routes/sync.py`, because null there also means "this
 * client does not compute feedback"), so the old sentence stayed on the page after a corrected
 * re-upload of that very session. UNMEASURED JUDGEMENT CALL at half: the corrected rule writes no
 * note this bound would drop, and a note that leaves the sitting less than half of itself for
 * everything the page says it landed is a contradiction, not a finding.
 */
export const NOWHERE_MAX_SHARE = 0.5;

function contradicts(n: FeedbackNoteWire, page: PageFacts | undefined): boolean {
  if (n.id !== 'went_nowhere' || !page?.landed) return false;
  const active = page.activeSeconds;
  if (typeof active !== 'number' || !(active > 0)) return false;
  return n.seconds > active * NOWHERE_MAX_SHARE;
}

/** The page facts a session's notes are held to (`PageFacts`). */
export function pageFactsOf(s: {
  active_seconds?: number | null;
  stats?: { commit_count?: number | null; lines_added_agent?: number | null } | null;
}): PageFacts {
  const st = s.stats;
  return {
    activeSeconds: s.active_seconds ?? null,
    landed: (st?.commit_count ?? 0) > 0 || (st?.lines_added_agent ?? 0) > 0,
  };
}

/**
 * Every note this client can actually render, most expensive first. With `page`, a note that
 * contradicts what the page says about the whole sitting is left out (`NOWHERE_MAX_SHARE`).
 */
export function renderable(notes: FeedbackNoteWire[] | null | undefined, page?: PageFacts): Note[] {
  if (!notes) return [];
  const out: Note[] = [];
  for (const n of notes) {
    if (contradicts(n, page)) continue;
    const text = sentence(n);
    if (text) out.push({ id: n.id, text, seconds: n.seconds });
  }
  return out.sort((a, b) => b.seconds - a.seconds);
}

/**
 * The one line above the notes, or null when there are none.
 *
 * It names the total so the section is a measurement rather than a scolding: "23 minutes
 * went here" is a fact about an hour the person was present for, and they can decide what
 * it was worth.
 */
export function heading(notes: Note[]): string | null {
  if (!notes.length) return null;
  const total = notes.reduce((sum, n) => sum + n.seconds, 0);
  if (total < 60) return 'One thing worth a look';
  return `${minutes(total)} of this session went here`;
}

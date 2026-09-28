/**
 * The director (docs/trailers.md): a note in the owner's words asks the Mac to change the trailer,
 * and the Mac answers with what it changed. PURE, so `__tests__/trailerDirector.test.ts` holds it.
 *
 * THE ANSWER IS NEVER PROSE A MODEL WROTE. The Mac finishes a note with the new version and the
 * CHANGES as the spec's codes (`spec/trailer.v1.json` `change_code`, before and after as codes or
 * numbers), or with a refusal code; the phone words both from the spec's own sentences
 * (`TRAILER_CHANGES`, `TRAILER_REFUSALS`), the same sentences the Mac prints (`capture/trailer/cut.py
 * say`, which a test holds this file to). So "make it punchier" is answered "the pace went from 1 to
 * 1.15 · scenes change by a straight cut now", which is what was done, and a code this build does
 * not know says nothing rather than a debug string.
 */
import { TRAILER_CHANGES, TRAILER_REFUSALS, TRAILER_WORDS, type ChangeCode, type NoteRefusal, type NoteSource, type NoteStatus } from '../generated/trailer';

export interface TrailerChange {
  code: string;
  before: string | null;
  after: string | null;
}

/** A note as the server keeps it (`GET /v1/projects/{key}/trailer/notes`). */
export interface TrailerNote {
  id: string;
  body: string;
  status: NoteStatus;
  created_at: string;
  finished_at: string | null;
  from_version: number | null;
  to_version: number | null;
  changes: TrailerChange[];
  refusal: string | null;
  source: NoteSource | null;
}

/** Which words say a change's values: a scene, a figure, the sound, the camera, a transition. */
const GROUP: Partial<Record<ChangeCode, keyof typeof TRAILER_WORDS>> = {
  scene_added: 'scene_kind',
  scene_removed: 'scene_kind',
  scene_moved: 'scene_kind',
  first: 'scene_kind',
  figure: 'figure',
  mood: 'mood',
  camera: 'camera',
  transition: 'transition',
};

/** A change in the spec's words, or null for a code this build does not know. */
export function sayChange(c: TrailerChange): string | null {
  if (!(c.code in TRAILER_CHANGES)) return null;
  const code = c.code as ChangeCode;
  const group = GROUP[code];
  const word = (v: string | null) => {
    if (v === null) return '';
    if (!group) return v;
    const table = TRAILER_WORDS[group] as Record<string, string>;
    return table[v] ?? v;
  };
  return TRAILER_CHANGES[code].replace('{before}', word(c.before)).replace('{after}', word(c.after));
}

/** A refusal's sentence, or null for a code this build does not know. */
export function sayRefusal(code: string | null): string | null {
  if (!code || !(code in TRAILER_REFUSALS)) return null;
  return TRAILER_REFUSALS[code as NoteRefusal];
}

/** A done note with no version before it: the Mac cut the first one. */
export const FIRST_CUT = 'cut the first version from the demo';

export type NoteAnswer =
  | { kind: 'waiting'; line: string }
  | { kind: 'cutting'; line: string }
  | { kind: 'done'; version: number | null; lines: string[] }
  | { kind: 'refused'; line: string | null }
  | { kind: 'cancelled'; line: string };

/** What the Mac's side of the conversation says about a note, at each point in its life. */
export function answerOf(n: TrailerNote): NoteAnswer {
  switch (n.status) {
    case 'queued':
      return { kind: 'waiting', line: 'Waiting for your Mac' };
    case 'claimed':
      return { kind: 'cutting', line: 'Your Mac is cutting it' };
    case 'done': {
      const lines = n.changes.map(sayChange).filter((s): s is string => s !== null);
      // No version before it: this note made the project's first trailer (spec NoteFinish).
      return { kind: 'done', version: n.to_version, lines: n.from_version === null ? [FIRST_CUT, ...lines] : lines };
    }
    case 'failed':
      return { kind: 'refused', line: sayRefusal(n.refusal) };
    case 'cancelled':
      return { kind: 'cancelled', line: 'Taken back' };
  }
}

/** Whether any note is still with the Mac: the screen reads the notes again until none is. */
export function anyPending(notes: readonly TrailerNote[]): boolean {
  return notes.some((n) => n.status === 'queued' || n.status === 'claimed');
}

/** The conversation, oldest first, so it reads down like a chat; the server sends newest first. */
export function conversation(notes: readonly TrailerNote[]): TrailerNote[] {
  return [...notes].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** Notes the rules on the Mac read without a model, offered under the field as a start. */
export const STARTERS: readonly string[] = ['make it shorter', 'open on the app', 'hard cuts', 'no music'];

/** The note's own cap (spec `max_lengths.note`): the field stops there. */
export const NOTE_MAX = 500;

/** A note worth sending: something typed, within the cap. */
export function canSend(text: string, pending: number): boolean {
  const t = text.trim();
  return t.length > 0 && t.length <= NOTE_MAX && pending < 5;
}

/**
 * A refused request's words. The server refuses with a code (`routes/trailer.py`); the screen never
 * shows one. A sentence (offline, a timeout) passes through as it is.
 */
const NOTE_ERRORS: Readonly<Record<string, string>> = {
  too_many_notes: 'Five notes are already waiting for your Mac.',
  empty_note: 'Write what should change first.',
  not_found: 'This project is not one of yours, or it is excluded.',
  not_queued: 'Your Mac already took that one. Its answer is on the way.',
  bad_key: 'This project is not one of yours, or it is excluded.',
};

export function sayNoteError(e: unknown, fallback: string): string {
  const m = e instanceof Error ? e.message : '';
  if (m in NOTE_ERRORS) return NOTE_ERRORS[m]!;
  return / /.test(m) && !/_/.test(m) ? m : fallback;
}

/**
 * The newest version a note made that the kit on screen does not carry yet, or null. The Mac
 * publishes the kit before it finishes a note when its worker runs with `--publish-requests`, so
 * this is the Mac that made it and was not told to send it: the screen says where it is.
 */
export function onMacOnly(notes: readonly TrailerNote[], kitVersion: number | null): number | null {
  const made = notes.filter((n) => n.status === 'done' && n.to_version !== null).map((n) => n.to_version!);
  if (!made.length) return null;
  const newest = Math.max(...made);
  return kitVersion === null || newest > kitVersion ? newest : null;
}

/** The ids of the notes answered done, as one string: when it changes, an answer just landed. */
export function doneMark(notes: readonly TrailerNote[] | null): string {
  return (notes ?? []).filter((n) => n.status === 'done').map((n) => n.id).join(',');
}

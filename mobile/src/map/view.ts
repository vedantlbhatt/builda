/**
 * What the codebase map and the time lapse show for a session, and every sentence on them.
 *
 * The map and its frames exist only while a session runs: the server keeps the live state in
 * `session_live` and deletes the row when the session finalises (docs/overnight-integration.md
 * 3.3), and the phone's cache drops it on the same transition. So each screen first decides
 * which of these a session is, in one pure function, and says the refusal as a sentence from
 * the data (when it finished, what sends the state) rather than a zero or a blank map:
 *
 *   notSent      a server older than the live state: the field is not in the answer at all
 *   finished     the session ended and its live state went with it
 *   notComputed  running, but whatever uploads it sends no live state (the Mac app)
 *   noMap        a live state without its map
 *   partial      only the slim body the live list serves is on this phone (a map cut to the
 *                one or two rows the sentence needs, no frames): drawing it would claim a
 *                session touched two files when it touched forty
 *   empty        running, and nothing touched yet
 *   ready        the map, or the frames
 *
 * Pure: no React Native, so `bun test` holds every rule and every word
 * (`__tests__/mapView.test.ts`). No sentence here carries a dash, and no number goes out
 * without its unit.
 */

import { capital, commas, count, floorMins, mins } from '../copy/numbers';
import { ROLE_NOUN, spoken } from '../copy/plain';
import type { SessionDetail } from '../data/api';
import type { LiveFile, LiveFrame, LiveState, PlainRole } from '../generated/live';
import type { LiveStateWire } from '../live/sentence';
import { timeOfDay } from '../copy/time';
import { dayOf } from '../you/numbers';
import { cleanFrames, MAX_FRAMES, spanOf } from './frames';
import type { Burst, Knot } from './knot';

/** The replay's length: the roadmap's "replay it in fifteen seconds" (2.8). */
export const REPLAY_MS = 15_000;

/** The command that makes capture send a running session's live state (overnight-integration 3.2). */
export const LIVE_COMMAND = 'python -m capture sync --live';

export type Refusal = 'notSent' | 'finished' | 'notComputed' | 'noMap' | 'partial' | 'empty';

export type MapContent =
  | { kind: Exclude<Refusal, 'empty'> }
  | { kind: 'empty'; state: LiveState }
  | { kind: 'ready'; state: LiveState; files: LiveFile[]; names: Record<string, string> | null };

export type TimelapseContent =
  | { kind: Exclude<Refusal, 'empty'> }
  | { kind: 'empty'; state: LiveState }
  | { kind: 'ready'; state: LiveState; files: LiveFile[]; frames: LiveFrame[]; names: Record<string, string> | null };

/** The opt in basenames by file id, only for files on the map. Null when there are none. */
export function namesOf(s: SessionDetail, files: readonly LiveFile[]): Record<string, string> | null {
  const list = s.live_names?.files;
  if (!Array.isArray(list) || list.length === 0) return null;
  const on = new Set(files.map((f) => f.id));
  const out: Record<string, string> = {};
  for (const n of list) {
    if (n && on.has(n.id) && typeof n.name === 'string' && n.name.trim()) out[n.id] = n.name;
  }
  return Object.keys(out).length ? out : null;
}

/** The refusals both screens share, before either looks at its own block. */
function liveRefusal(s: SessionDetail): Exclude<Refusal, 'noMap' | 'partial' | 'empty'> | null {
  if (s.live_state === undefined) return 'notSent';
  if (s.live_state === null) return (s.state ?? 'final') === 'final' ? 'finished' : 'notComputed';
  return null;
}

export function mapContent(s: SessionDetail): MapContent {
  const r = liveRefusal(s);
  if (r) return { kind: r };
  const state = s.live_state!;
  const map = state.map;
  if (!map || !Array.isArray(map.files)) return { kind: 'noMap' };
  // The slim body: no frames, and the map cut to the rows the sentence names.
  if ((state.timelapse === null || state.timelapse === undefined) && map.files.length < map.files_total) {
    return { kind: 'partial' };
  }
  if (map.files.length === 0) return { kind: 'empty', state };
  return { kind: 'ready', state, files: map.files, names: namesOf(s, map.files) };
}

export function timelapseContent(s: SessionDetail): TimelapseContent {
  const r = liveRefusal(s);
  if (r) return { kind: r };
  const state = s.live_state!;
  const map = state.map;
  if (!map || !Array.isArray(map.files)) return { kind: 'noMap' };
  const frames = cleanFrames(state.timelapse);
  if (frames === null) return { kind: 'partial' };
  if (frames.length === 0 || map.files.length === 0) return { kind: 'empty', state };
  return { kind: 'ready', state, files: map.files, frames, names: namesOf(s, map.files) };
}

// ------------------------------------------------------------------ refusals

export type RefusalAction = 'session' | 'copy' | 'retry';

export interface RefusalCopy {
  title: string;
  text: string;
  action: RefusalAction;
}

/** "at 2:02pm" on the same Builda day, else "on Aug 29". Null for a time that does not parse. */
export function whenOf(iso: string | null | undefined, now: number): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const day = dayOf(iso, now);
  const today = dayOf(new Date(now).toISOString(), now);
  return day !== null && day === today ? `at ${timeOfDay(t)}` : day ? `on ${day}` : null;
}

/** The refusal, as Bit's title, one line, and the one action that fills or leaves the page. */
export function refusalCopy(kind: Refusal, screen: 'map' | 'timelapse', s: SessionDetail, now: number): RefusalCopy {
  const what = screen === 'map' ? 'map' : 'time lapse';
  switch (kind) {
    case 'notSent':
      return {
        title: `No ${what} from this server yet.`,
        text: `The server this phone talks to does not send what a running session is doing, so there is no ${what} to draw.`,
        action: 'session',
      };
    case 'finished': {
      const when = whenOf(s.ended_at, now);
      const ended = when ? `This session finished ${when}.` : 'This session has finished.';
      return screen === 'map'
        ? { title: 'This session has finished.', text: `${ended} A map is kept only while a session runs, so this one has none.`, action: 'session' }
        : {
            title: 'This session has finished.',
            text: `${ended} The time lapse is drawn from a running session and cleared when it ends, so there is nothing to replay.`,
            action: 'session',
          };
    }
    case 'notComputed':
      return {
        title: 'Nothing is sending what it is doing.',
        text: `This session is running, but whatever uploads it does not send its live state. Capture on your Mac does, with live on.`,
        action: 'copy',
      };
    case 'noMap':
      return {
        title: `No ${what} in this live state.`,
        text: 'Its live state arrived without the files it touched. A newer capture sends them.',
        action: 'session',
      };
    case 'partial':
      return {
        title: `The full ${what} has not reached this phone.`,
        text: 'Only the short version of this session saved from the list is here, and the refresh did not bring the rest.',
        action: 'retry',
      };
    case 'empty':
      return screen === 'map'
        ? { title: 'Nothing touched yet.', text: 'Files appear here as the agent reads and changes them.', action: 'session' }
        : { title: 'Nothing to replay yet.', text: 'The time lapse fills in as the agent reads and changes files.', action: 'session' };
  }
}

// ------------------------------------------------------------------ numbers as words

/** "once", "twice", "6 times". */
export function times(n: number): string {
  return n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`;
}

/**
 * A moment in a session, from its first event: "40s", "12m 05s", "1h 04m". Whole seconds,
 * floored, so the readout never runs ahead of the frame on screen. A worklet: the scrubber's
 * readout runs it on the UI thread every frame.
 */
export function elapsedLabel(seconds: number): string {
  'worklet';
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}m ${r < 10 ? '0' : ''}${r}s`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m < 10 ? '0' : ''}${m}m`;
}

/** "updated just now", "updated 4 minutes ago", from when the state was computed. */
export function updatedLine(computedAt: string, now: number): string | null {
  const t = Date.parse(computedAt);
  if (!Number.isFinite(t)) return null;
  const age = Math.max(0, (now - t) / 1000);
  return age < 60 ? 'updated just now' : `updated ${mins(age)} ago`;
}

/** "Updated just now." as a sentence for a band's quiet line. Null for a time that does not parse. */
export function updatedSentence(computedAt: string, now: number): string | null {
  const line = updatedLine(computedAt, now);
  return line ? `${capital(line)}.` : null;
}

/** A line as a sentence: one full stop at the end, never two. */
export function asSentence(line: string): string {
  const t = line.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/** What a file is called on screen: its opt in name, else its role ("a source file"). */
export function fileLabel(f: Pick<LiveFile, 'role'>, name: string | null | undefined): string {
  return name ?? ROLE_NOUN[f.role][0];
}

function roleOne(role: PlainRole): string {
  return ROLE_NOUN[role][0];
}

// ------------------------------------------------------------------ the map

/**
 * The part of a live state the one sentence reads (`live/sentence.ts renderLiveSentence`: the
 * activity, the verdict and the map's roles), in the renderer's hand typed shape, which says
 * "no verdict" as null where the generated type leaves the key out.
 */
export function sentenceInput(state: LiveState): LiveStateWire {
  const v = state.verdict;
  return {
    activity: state.activity ?? null,
    verdict: { state: v.state ?? null, basis: v.basis ?? null, reason: v.reason ?? null, file_id: v.file_id ?? null, evidence: v.evidence },
    map: state.map ? { files: state.map.files.map((f) => ({ id: f.id, role: f.role })) } : null,
  };
}

/** Changed and only read, over the rows the map holds. */
export function tally(files: readonly LiveFile[]): { changed: number; read: number; named: number } {
  let changed = 0;
  let read = 0;
  let named = 0;
  for (const f of files) {
    if (f.edits > 0) changed += 1;
    else if (f.reads > 0) read += 1;
    else named += 1;
  }
  return { changed, read, named };
}

/**
 * The line under the sentence: "gt-transit · 42 files touched, 17 changed · updated 4 minutes
 * ago". When the map is cut, how many it keeps instead of a changed count it cannot vouch for.
 */
export function mapMeta(s: SessionDetail, state: LiveState, now: number): string {
  const map = state.map!;
  const parts: string[] = [];
  if (s.repo_name) parts.push(s.repo_name);
  const total = map.files_total;
  const cut = map.files.length < total;
  const { changed } = tally(map.files);
  parts.push(cut ? `${count(total, 'file')} touched` : `${count(total, 'file')} touched, ${changed} changed`);
  const updated = updatedLine(state.computed_at, now);
  if (updated) parts.push(updated);
  return parts.join(' · ');
}

/** Said under the map when it keeps fewer rows than the session touched. Null when it keeps them all. */
export function cutNote(state: LiveState): string | null {
  const map = state.map;
  if (!map || map.files.length >= map.files_total) return null;
  return `This session touched ${count(map.files_total, 'file')}. The map keeps the ${map.files.length} it touched most recently.`;
}

/** The accessibility label for the whole drawing. */
export function mapSummary(files: readonly LiveFile[], folders: number): string {
  const { changed, read } = tally(files);
  return `A map of ${count(files.length, 'file')} in ${count(folders, 'folder')}: ${changed} changed, ${read} only read.`;
}

/**
 * The caption for a tapped cell: "store.ts, a source file. Changed 6 times, read 3 times.
 * Last touched at 14:02."
 */
export function cellCaption(f: LiveFile, name: string | null | undefined, now: number): string {
  const who = name ? `${name}, ${roleOne(f.role)}.` : `${capital(roleOne(f.role))}.`;
  let did: string;
  if (f.edits > 0 && f.reads > 0) did = `Changed ${times(f.edits)}, read ${times(f.reads)}.`;
  else if (f.edits > 0) did = `Changed ${times(f.edits)}.`;
  else if (f.reads > 0) did = `Read ${times(f.reads)}, never changed.`;
  // A search that named it, or a call an error answered: on the map, but nothing came of it.
  else did = 'Named by a call that neither read nor changed it.';
  const at = [f.last_read_ts, f.last_edit_ts].filter((t): t is number => typeof t === 'number' && Number.isFinite(t));
  const last = at.length ? whenOf(new Date(Math.max(...at) * 1000).toISOString(), now) : null;
  return last ? `${who} ${did} Last touched ${last}.` : `${who} ${did}`;
}

export interface HotRow {
  id: string;
  title: string;
  meta: string;
  value: string | null;
}

/** How many rows the list under the map shows. UNMEASURED JUDGEMENT CALL: a screen's worth. */
export const HOT_ROWS = 5;

/**
 * The list under the map: the files changed most, else read most, each with what happened to
 * it and when. `label` says which list it is.
 */
export function hotRows(
  files: readonly LiveFile[],
  names: Record<string, string> | null,
  now: number,
): { label: string; rows: HotRow[] } {
  const changed = files.filter((f) => f.edits > 0);
  const pool = changed.length ? changed : files.filter((f) => f.reads > 0);
  const key = (f: LiveFile) => (changed.length ? f.edits : f.reads);
  const at = (f: LiveFile) => Math.max(f.last_read_ts ?? Number.NEGATIVE_INFINITY, f.last_edit_ts ?? Number.NEGATIVE_INFINITY);
  const rows = [...pool]
    .sort((a, b) => key(b) - key(a) || at(b) - at(a) || (a.id < b.id ? -1 : 1))
    .slice(0, HOT_ROWS)
    .map((f) => {
      const name = names?.[f.id] ?? null;
      const meta = [f.edits > 0 ? `changed ${times(f.edits)}` : null, f.reads > 0 ? `read ${times(f.reads)}` : null]
        .filter(Boolean)
        .join(', ');
      const t = at(f);
      const value = Number.isFinite(t) ? timeOfDay(t * 1000) : null;
      return { id: f.id, title: name ?? capital(roleOne(f.role)), meta: name ? `${roleOne(f.role)}, ${meta}` : meta, value };
    });
  return { label: changed.length ? 'most changed' : 'most read', rows };
}

// ------------------------------------------------------------------ the headline

/** A role's word on the map and in the legend: the engine's collective noun without its article ("test suite"). */
export function roleWord(role: PlainRole): string {
  return ROLE_NOUN[role][2].replace(/^(the|your) /, '');
}

export interface MapHeadline {
  /** Files the session touched (`files_total`: a cut map keeps fewer and says so under it). */
  files: number;
  /** Changed, and one of the last three files it touched (`paint.isHot`). */
  hot: number;
  /** The whole figure said as words, for VoiceOver: "42 files touched, 3 of them hot". */
  said: string;
}

/**
 * The map's one big figure: "42 files, 3 hot". `hot` is measured, so a zero is a count and not a
 * refusal, but a band that shouts "0 hot" says nothing a reader can use: the figure then drops
 * the clause and the sentence under it says what it is doing.
 */
export function mapHeadline(state: LiveState, hot: number): MapHeadline {
  const files = state.map?.files_total ?? state.map?.files.length ?? 0;
  const said = hot > 0 ? `${count(files, 'file')} touched, ${hot} of them hot.` : `${count(files, 'file')} touched.`;
  return { files, hot, said };
}

// ------------------------------------------------------------------ the legend

export type LegendSwatch = 'changed' | 'read' | 'hot' | 'path' | 'cursor' | 'fail' | 'knot';

export interface LegendItem {
  /** Which swatch: a filled cell, a hollow one, a glowing one, the path, the cursor, a failing cell, the knot. */
  swatch: LegendSwatch;
  text: string;
}

export interface LegendOptions {
  /** There is a knot to point at. */
  knot: boolean;
  /** Reduce Motion: the knot holds still and outlined instead of pulsing. */
  reduceMotion: boolean;
  /** There is a path of two files or more on screen. */
  path: boolean;
}

/** The legend in words, in the order the eye meets the marks. */
export function legend(screen: 'map' | 'timelapse', o: LegendOptions): LegendItem[] {
  const now = screen === 'map' ? 'now' : 'at that moment';
  const items: LegendItem[] = [
    { swatch: 'changed', text: 'Filled: changed.' },
    { swatch: 'read', text: 'Hollow: only read.' },
    {
      swatch: 'hot',
      text: 'Glowing: one of the last three files it touched, brightest where it changed them. The rest cool as it moves on.',
    },
  ];
  if (o.path) {
    items.push({
      swatch: 'path',
      text:
        screen === 'map'
          ? 'The line: the last six files it touched, in the order it last touched them.'
          : 'The line: the last six files it touched up to that moment, in order.',
    });
  }
  items.push({ swatch: 'cursor', text: `Outlined: the file it is on ${now}.` });
  if (screen === 'timelapse') items.push({ swatch: 'fail', text: 'Red: its last call on that file failed.' });
  if (o.knot) {
    const how = o.reduceMotion ? 'Outlined in your colour' : 'Pulsing in your colour';
    items.push({
      swatch: 'knot',
      text: screen === 'map' ? `${how}: the files it keeps rewriting.` : `${how}: the files it was stuck on, while it was stuck.`,
    });
  }
  return items;
}

/** The roles on the map, most files first, ties in `plain.ROLES` order: the colour key. */
export function rolesOnMap(files: readonly LiveFile[]): PlainRole[] {
  const counts = new Map<PlainRole, number>();
  for (const f of files) counts.set(f.role, (counts.get(f.role) ?? 0) + 1);
  return [...counts.keys()].sort((a, b) => counts.get(b)! - counts.get(a)! || ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b));
}

const ROLE_ORDER: readonly PlainRole[] = ['source', 'test', 'config', 'docs', 'migration', 'style', 'build', 'dependency', 'unknown'];

/** The line before the colour key. */
export const ROLES_NOTE = 'Each colour is a kind of file:';

/** The one line that says what an island is. */
export const ISLANDS_NOTE = 'Each island is a folder. The top of the repository sits in the middle and deeper folders further out.';

/** Under the map until a cell is picked. */
export const TAP_HINT = 'Tap a square for what happened to that file.';

// ------------------------------------------------------------------ the ledger under the map

export interface LedgerRow {
  id: string;
  role: PlainRole;
  /** The figure: changes, or reads when nothing was changed. */
  count: number;
  /** What the figure counts, and on what: "changes to store.ts", "reads of a doc". */
  what: string;
  /** The quiet line under it: the other count and when, "read 3 times, last touched at 2:02pm". */
  note: string | null;
}

/**
 * The files changed most, else read most, as lines of print: the count set large and what it
 * counts beside it. The same order `hotRows` gives. Names only when the builder opted in.
 */
export function hotLedger(files: readonly LiveFile[], names: Record<string, string> | null, now: number): { label: string; rows: LedgerRow[] } {
  const hot = hotRows(files, names, now);
  const changed = hot.label === 'most changed';
  const byId = new Map(files.map((f) => [f.id, f]));
  const rows = hot.rows.map((r) => {
    const f = byId.get(r.id)!;
    const n = changed ? f.edits : f.reads;
    const label = fileLabel(f, names?.[f.id]);
    const what = changed ? `${n === 1 ? 'change' : 'changes'} to ${label}` : `${n === 1 ? 'read' : 'reads'} of ${label}`;
    const other = changed && f.reads > 0 ? `read ${times(f.reads)}` : null;
    const at = [f.last_read_ts, f.last_edit_ts].filter((t): t is number => typeof t === 'number' && Number.isFinite(t));
    const when = at.length ? whenOf(new Date(Math.max(...at) * 1000).toISOString(), now) : null;
    const note = [other, when ? `last touched ${when}` : null].filter(Boolean).join(', ');
    return { id: f.id, role: f.role, count: n, what, note: note ? `${capital(note)}.` : null };
  });
  return { label: hot.label, rows };
}

// ------------------------------------------------------------------ the time lapse

/** "1h 04m of work so far, replayed in fifteen seconds." */
export function timelapseTitle(frames: readonly LiveFrame[]): string {
  const span = spanOf(frames);
  // FLOORED, as the replay's own clock is (`elapsedLabel`): the figure above this sentence counts
  // up to the same span and lands on it, so the two must say the same whole minutes. FOUND IN THE
  // FINAL CAPTURE (2026-09-13): `mins` rounded, so a span 30 seconds into a minute put "1h 04m of
  // work" under a clock that stopped at "1h 03m".
  const said = floorMins(span);
  return said === 'under a minute'
    ? 'Under a minute of work so far, replayed in fifteen seconds.'
    : `${capital(said)} of work so far, replayed in fifteen seconds.`;
}

/** A count of frames said as what they are: "214 reads, changes and failures". */
function framesPhrase(n: number): string {
  return count(n, 'read, change or failure', 'reads, changes and failures');
}

/** "gt-transit · 214 reads, changes and failures · updated 4 minutes ago". */
export function timelapseMeta(s: SessionDetail, state: LiveState, frames: readonly LiveFrame[], now: number): string {
  const parts: string[] = [];
  if (s.repo_name) parts.push(s.repo_name);
  parts.push(framesPhrase(frames.length));
  const updated = updatedLine(state.computed_at, now);
  if (updated) parts.push(updated);
  return parts.join(' · ');
}

/** The time lapse band's quiet line: "214 reads, changes and failures. Updated just now." */
export function replayNote(state: LiveState, frames: readonly LiveFrame[], now: number): string {
  const updated = updatedSentence(state.computed_at, now);
  return [`${capital(framesPhrase(frames.length))}.`, updated].filter(Boolean).join(' ');
}

/** The files a knot or a burst names: "store.ts", "a source file", "three files". */
function filesPhrase(ids: readonly string[], files: readonly LiveFile[], names: Record<string, string> | null): string {
  if (ids.length === 1) {
    const f = files.find((x) => x.id === ids[0]);
    return f ? fileLabel(f, names?.[f.id]) : 'one file';
  }
  return `${spoken(ids.length)} files`;
}

/** "Stuck from 31m 00s to 43m 45s on three files: 17 changes and 7 failed calls." */
export function knotSentence(knot: Knot, files: readonly LiveFile[], names: Record<string, string> | null): string {
  return `Stuck from ${elapsedLabel(knot.startT)} to ${elapsedLabel(knot.endT)} on ${filesPhrase(knot.files, files, names)}: ${count(
    knot.edits,
    'change',
  )} and ${count(knot.fails, 'failed call')}.`;
}

/** "Then eleven files changed in its last 6 minutes." */
export function burstSentence(burst: Burst, span: number, afterKnot: boolean): string {
  const tail = span - burst.startT;
  const when = tail < 60 ? 'in its final minute' : `in its last ${mins(tail)}`;
  const lead = afterKnot ? 'Then' : 'At the end,';
  return `${lead} ${spoken(burst.files.length)} files changed ${when}.`;
}

/**
 * Said when the engine thinned the frames, with how much it kept. The count comes from the
 * map: `live._map` and `live._timelapse` read the same reads and the same changes, so for the
 * files on the map an unthinned replay holds exactly `reads + edits` of them, and fewer means
 * the engine kept one per stretch. The frame count alone says nothing: thinning leaves empty
 * stretches out, so a thinned replay is often well under MAX_FRAMES. Null when nothing was cut.
 */
export function thinnedNote(frames: readonly LiveFrame[], files: readonly LiveFile[]): string | null {
  const total = files.reduce((n, f) => n + f.reads + f.edits, 0);
  const on = new Set(files.map((f) => f.id));
  const kept = frames.filter((f) => f.kind !== 'fail' && on.has(f.file_id)).length;
  if (kept >= total) return null;
  return `A long session: the replay keeps ${commas(kept)} of its ${commas(total)} reads and changes, the one that matters most in each of up to ${MAX_FRAMES} equal stretches.`;
}

/** Said when some frames touch files the map left out. Null when every frame has its cell. */
export function offMapNote(frames: readonly LiveFrame[], index: Readonly<Record<string, number>>): string | null {
  const off = frames.filter((f) => index[f.file_id] === undefined).length;
  if (off === 0) return null;
  if (off === 1) return 'One read, change or failure was on a file the map left out, so no cell lights for it.';
  return `${capital(framesPhrase(off))} were on files the map left out, so no cell lights for them.`;
}

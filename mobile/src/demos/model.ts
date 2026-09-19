/**
 * A project's demo as the phone shows it (docs/demos.md, "On the phone"): the order its files are
 * seen in, what each one says under it, the count, where each came from when it was not recorded
 * from the running app, the words when there is no demo yet, and where the video sits on the page.
 * Pure: no React Native, so `bun test` holds every word and every number here.
 *
 * WHAT ARRIVES. `GET /v1/projects/{key}/media` sends the files of one complete publish, the video
 * first and then the stills by position; the preview sends up to three stills a project. Nothing
 * here trusts that order, a size or a kind: the phone sorts again, a file with no size gets the
 * phone's own shape, and a kind or a source this build does not know is left out or says nothing,
 * never a debug string.
 */
import type { MediaSourceRef, ProjectMediaItem } from '../data/api';
import { count } from '../copy/numbers';
import { DEFAULT_PHONE, DEVICES } from '../generated/devices';

// ------------------------------------------------------------------ where a file came from

/**
 * What a file says about where it came from, beside its label. A recording of the running app
 * (`capture`) says nothing: that is what a demo is. The fallbacks say so, because a picture from
 * the repository is not the app running today (capture/demo/fallback.py, which never makes one up).
 */
export const SOURCE_LINES: Readonly<Record<string, string | null>> = {
  capture: null,
  previous: 'The last good capture, from an earlier run.',
  checkout: 'From your repository, not recorded.',
  transcript: 'A screenshot one of your sessions opened.',
};

/** The line for `source`, or null for a recording and for a source this build does not know. */
export function sourceLine(source: string | null | undefined): string | null {
  if (!source) return null;
  return Object.prototype.hasOwnProperty.call(SOURCE_LINES, source) ? SOURCE_LINES[source]! : null;
}

/**
 * The same, as the few plain words a small print can carry on its edge (a door's print, a card in
 * the pile), so a picture that was not recorded from the running app never passes for one.
 *
 * FOUND IN REVIEW (2026-09-14): the doors drew a still from the repository or from a transcript
 * exactly as they drew a recording, with no mark, and VoiceOver's label left the source out.
 */
export const SOURCE_MARKS: Readonly<Record<string, string | null>> = {
  capture: null,
  previous: 'an earlier run',
  checkout: 'from the repo',
  transcript: 'a screenshot',
};

/** The mark for `source`: null for a recording, and for a source this build does not know (as `sourceLine`). */
export function sourceMark(source: string | null | undefined): string | null {
  if (!source) return null;
  return Object.prototype.hasOwnProperty.call(SOURCE_MARKS, source) ? SOURCE_MARKS[source]! : null;
}

// ------------------------------------------------------------------ the gallery

/**
 * The phone demos are filmed on when a project names none: the device table's default row
 * (spec/devices.v1.json, the only place a frame size lives; docs/ship-kit.md). Its shape is the
 * shape of a file that sent no size.
 */
const FILMED_ON = DEVICES.find((d) => d.id === DEFAULT_PHONE)!;

/** The default phone's screen, width over height: the shape of a file that sent no size. */
export const PHONE_ASPECT = FILMED_ON.pixels[0] / FILMED_ON.pixels[1];

export interface GalleryEntry {
  id: string;
  kind: 'image' | 'video';
  /** The state it shows, as the Mac labelled it. */
  label: string;
  /** Where it came from, or null for a recording of the running app. */
  source: string | null;
  /** The same in a few words for a small print's edge, or null for a recording. */
  mark: string | null;
  /** "3 of 6". */
  count: string;
  /** Width over height. */
  aspect: number;
  url: string;
  posterUrl: string | null;
  /** The video's length in words ("28 seconds"); null on a still. */
  duration: string | null;
  /** What VoiceOver reads for it. */
  a11y: string;
}

/** "3 of 6": where one file sits in the gallery. */
export function countLabel(index: number, total: number): string {
  return `${index + 1} of ${total}`;
}

/** A video's length in words, whole seconds: "28 seconds". Null with no length. */
export function durationWords(ms: number | null | undefined): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null;
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return count(s, 'second');
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest ? `${count(m, 'minute')} ${count(rest, 'second')}` : count(m, 'minute');
}

function aspectOf(it: Pick<ProjectMediaItem, 'width' | 'height'>): number {
  return it.width > 0 && it.height > 0 && Number.isFinite(it.width / it.height) ? it.width / it.height : PHONE_ASPECT;
}

/**
 * The gallery, in the order it is seen: the video first (the owner: "demo videos play in the
 * back"), then the stills by position, a tie by id so the same set always reads the same way.
 * A file of a kind this build does not know, or with no url, is left out, and the count counts
 * what is shown.
 */
export function gallery(items: readonly ProjectMediaItem[]): GalleryEntry[] {
  const shown = items
    .filter((it) => (it.kind === 'image' || it.kind === 'video') && typeof it.url === 'string' && it.url.length > 0)
    .map((it, i) => ({ it, i }))
    .sort((a, b) => Number(b.it.kind === 'video') - Number(a.it.kind === 'video') || a.it.position - b.it.position || (a.it.id < b.it.id ? -1 : a.it.id > b.it.id ? 1 : a.i - b.i));
  return shown.map(({ it }, i) => {
    const label = it.label?.trim() || (it.kind === 'video' ? 'the demo' : 'a still');
    const duration = it.kind === 'video' ? durationWords(it.duration_ms) : null;
    const source = sourceLine(it.source);
    const where = countLabel(i, shown.length);
    return {
      id: it.id,
      kind: it.kind,
      label,
      source,
      mark: sourceMark(it.source),
      count: where,
      aspect: aspectOf(it),
      url: it.url,
      posterUrl: it.poster_url ?? null,
      duration,
      a11y: [it.kind === 'video' ? `Video, ${duration ?? 'its length unknown'}` : 'Still', label, source, where].filter(Boolean).join('. '),
    };
  });
}

/** The stills a door fans, top print last: at most three, by position (the preview's own rule). */
export function doorPrints(items: readonly ProjectMediaItem[] | null | undefined, max = 3): GalleryEntry[] {
  return gallery((items ?? []).filter((it) => it.kind === 'image')).slice(0, max);
}

// ------------------------------------------------------------------ the words beside the demo

export interface DemoWords {
  stills: number;
  /** "stills from the running app", "stills, the last good capture". */
  stillsCaption: string;
  /** "28 seconds, recorded from the running app." Null with no video. */
  videoCaption: string | null;
  /** What a tap does, said once. */
  tap: string;
}

function lowerFirst(s: string): string {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

function recorded(entries: readonly GalleryEntry[]): string {
  const sources = new Set(entries.map((e) => e.source));
  if (sources.size === 1 && sources.has(null)) return 'from the running app';
  if (sources.size === 1 && sources.has(SOURCE_LINES.previous ?? '')) return 'from the last good capture';
  return 'each saying where it came from';
}

/** The words beside a project's demo on its page. Null when there is nothing to show. */
export function demoWords(entries: readonly GalleryEntry[]): DemoWords | null {
  if (!entries.length) return null;
  const video = entries.find((e) => e.kind === 'video') ?? null;
  const stills = entries.filter((e) => e.kind === 'image');
  return {
    stills: stills.length,
    stillsCaption: `${stills.length === 1 ? 'still' : 'stills'} ${recorded(stills.length ? stills : entries)}`,
    videoCaption: video ? `${video.duration ? `${video.duration}, ` : ''}${video.source === null ? 'recorded from the running app' : lowerFirst(video.source.replace(/\.$/, ''))}.` : null,
    tap: video && stills.length ? 'Tap the video to watch it with sound, or the stack to see them all.' : video ? 'Tap the video to watch it with sound.' : stills.length === 1 ? 'Tap it to see it whole.' : 'Tap the stack to see them all.',
  };
}

// ------------------------------------------------------------------ what a demo holds, counted

/**
 * "a 14 second video and 6 stills": what a whole demo holds, from its whole list. Never from the
 * preview, which carries at most three stills a project and no video.
 *
 * FOUND IN REVIEW (2026-09-14): a door's VoiceOver label said "still 1 of 3" for a demo of six
 * stills, and the gallery opened on the preview reading "1 of 3" and then jumped to "1 of 7" when
 * the list arrived. A count is said only once the list it counts is in hand.
 */
export function holdsWords(entries: readonly GalleryEntry[]): string | null {
  const video = entries.find((e) => e.kind === 'video') ?? null;
  const stills = entries.filter((e) => e.kind === 'image').length;
  const v = video ? (video.duration ? `a ${video.duration.replace(/s$/, '')} video` : 'a video') : null;
  const s = stills ? count(stills, 'still') : null;
  return [v, s].filter(Boolean).join(' and ') || null;
}

/**
 * What VoiceOver reads for a door's prints: the project, what its demo holds when the whole list is
 * known (and nothing counted when it is not), the print on top with where it came from, and where a
 * tap goes.
 */
export function doorPrintsLabel(project: string, top: GalleryEntry | null, whole: readonly GalleryEntry[] | null): string {
  const holds = whole && whole.length ? holdsWords(whole) : null;
  const onTop = top ? `On top, ${top.label}${top.source ? `: ${lowerFirst(top.source.replace(/\.$/, ''))}` : ''}.` : '';
  return [`${project}, its demo${holds ? `: ${holds}` : ''}.`, onTop, 'Opens the demo.'].filter(Boolean).join(' ');
}

// ------------------------------------------------------------------ deleting it

/** What the page asks before it deletes a demo, and what it says after. */
export const DELETE_DEMO = {
  link: 'Delete this demo',
  title: 'Delete this demo?',
  keep: 'Keep it',
  confirm: 'Delete',
  mac: 'Your Mac keeps its copy; publishing again brings it back.',
} as const;

/** The question under the title: exactly what leaves, from the whole list. */
export function deleteAsk(entries: readonly GalleryEntry[]): string {
  const holds = holdsWords(entries);
  return `${holds ? `${holds.charAt(0).toUpperCase()}${holds.slice(1)} leave` : 'Every file of it leaves'} your account and this phone. ${DELETE_DEMO.mac}`;
}

/**
 * What the page says once the server answered: what it removed, in the server's own count. When
 * that count is not the number of files the phone showed (a publish half way in, whose files the
 * delete also removes), the count is said as a count of files rather than dressed as the demo.
 */
export function deletedSentence(deleted: number, entries: readonly GalleryEntry[]): string {
  if (deleted <= 0) return 'There was nothing to delete: the demo had already gone from your account.';
  const holds = deleted === entries.length ? holdsWords(entries) : null;
  return `Deleted ${holds ?? count(deleted, 'file')} from your account. ${DELETE_DEMO.mac}`;
}

// ------------------------------------------------------------------ a demo as a hook holds it

export interface DemoSources {
  /** By entry id: the file itself. */
  file: Record<string, MediaSourceRef>;
  /** By entry id: the video's still frame. */
  poster: Record<string, MediaSourceRef>;
}

export type DemoLoad =
  /** Not read yet, or signed out, or the read failed before anything was known: draw nothing. */
  | { kind: 'unknown' }
  /** The server holds no demo for this project. */
  | { kind: 'none' }
  | { kind: 'ready'; entries: GalleryEntry[]; sources: DemoSources };

export const UNKNOWN: DemoLoad = { kind: 'unknown' };

/**
 * One project's demo as a hook holds it: whose it is, and the newest request whose answer is in it.
 *
 * FOUND IN REVIEW (2026-09-14): the hook kept its state when its key changed, so opening project A's
 * gallery and then B's showed A's pictures under B's name; they stayed if B's read failed, and a late
 * answer for A could land after B's. Now a new key starts from nothing, every answer carries the key
 * and the order it was asked in, and one for another key, or older than the one shown, is dropped.
 */
export interface DemoState {
  key: string | null;
  /** The request whose answer is shown; an older one is never applied over it. */
  seq: number;
  demo: DemoLoad;
}

export type DemoAction =
  | { type: 'key'; key: string | null }
  | { type: 'answer'; key: string; seq: number; demo: DemoLoad }
  /** The phone deleted it: nothing is shown for it now, whatever a read in flight says. */
  | { type: 'deleted'; key: string; seq: number };

export function demoReducer(s: DemoState, a: DemoAction): DemoState {
  switch (a.type) {
    case 'key':
      return a.key === s.key ? s : { key: a.key, seq: 0, demo: UNKNOWN };
    case 'answer':
      return a.key === s.key && a.seq > s.seq ? { key: s.key, seq: a.seq, demo: a.demo } : s;
    case 'deleted':
      return a.key === s.key ? { key: s.key, seq: Math.max(s.seq, a.seq), demo: { kind: 'none' } } : s;
  }
}

/** What a hook shows for `key`: its state's demo when the state is this key's, else nothing yet. */
export function demoFor(s: DemoState, key: string | null): DemoLoad {
  return s.key === key ? s.demo : UNKNOWN;
}

// ------------------------------------------------------------------ no demo yet

/**
 * A project with no demo shows one empty print that says how to make one, in plain words: never a
 * spinner and never a stock picture (docs/demos.md). The two commands are the Mac's own
 * (`python -m capture demo`, then `--publish`), set in the machine's type so they can be copied.
 */
export const EMPTY_DEMO = {
  title: 'No demo yet',
  lead: 'Your Mac makes one: it runs the app, films it, and checks every frame for names and keys before anything leaves. In the project’s folder:',
  make: 'python -m capture demo',
  then: 'Then send it here, after it shows you every file:',
  publish: 'python -m capture demo --publish',
  /** The door's print is small: the same two steps, shorter. */
  doorTitle: 'No demo yet',
  doorLead: 'On your Mac:',
  /** The command on two lines, broken where a narrow print can hold it. */
  doorMake: ['python -m', 'capture demo'],
  doorThen: 'then add',
  doorPublish: '--publish',
  a11y: 'No demo yet. On your Mac, run python -m capture demo in the project folder, then python -m capture demo --publish.',
} as const;

// ------------------------------------------------------------------ where the video sits

/** A video narrower than this (width over height) stands beside the stills; a wider one runs full width. */
export const SIDE_ASPECT = 0.8;
/** The tallest a video stands on the page. */
export const STRIP_MAX_H = 480;
/** The widest a full width video may run tall. */
export const WIDE_MAX_H = 300;
/** The share of the screen a phone shaped video takes, and the room between it and the stack. */
export const SIDE_SHARE = 0.5;
export const SIDE_GAP = 16;

export interface StripLayout {
  /** `side`: a phone shaped video on the left, the stack and its words beside it. `wide`: full width, the stack under it. */
  mode: 'side' | 'wide';
  videoW: number;
  videoH: number;
  /** The room beside the video (side), or the full inner width under it (wide). */
  sideW: number;
  /**
   * How far the top of the video tucks up under the band's solid ink: a phone recording's own
   * status bar and island (the recorded screen's top safe area), which would otherwise show
   * through the band's pixel edge as a clock and a black pill. 0 for a wide recording.
   */
  tuck: number;
}

/** A recorded phone screen's top safe area over its width, from the device table: the status bar and island a tuck hides. */
export const PHONE_TOP_SHARE = FILMED_ON.safe_area.top / FILMED_ON.points[0];

/**
 * Where the video stands under the hero, from the screen's width and the video's shape: a phone
 * recording at its own shape on the left half, never cropped, never taller than `STRIP_MAX_H`;
 * a landscape one across the whole width, never taller than `WIDE_MAX_H`.
 */
export function stripLayout(width: number, aspect: number, gutter = 20): StripLayout {
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : PHONE_ASPECT;
  if (a < SIDE_ASPECT) {
    let videoW = Math.round(width * SIDE_SHARE);
    let videoH = Math.round(videoW / a);
    if (videoH > STRIP_MAX_H) {
      videoH = STRIP_MAX_H;
      videoW = Math.round(STRIP_MAX_H * a);
    }
    return { mode: 'side', videoW, videoH, sideW: Math.max(0, width - videoW - SIDE_GAP - gutter), tuck: Math.round(videoW * PHONE_TOP_SHARE) };
  }
  return { mode: 'wide', videoW: width, videoH: Math.min(WIDE_MAX_H, Math.round(width / a)), sideW: Math.max(0, width - gutter * 2), tuck: 0 };
}

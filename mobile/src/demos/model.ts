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
import type { ProjectMediaItem } from '../data/api';
import { count } from '../copy/numbers';

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

// ------------------------------------------------------------------ the gallery

/** A phone's screen, width over height (1206 by 2622): the shape of a file that sent no size. */
export const PHONE_ASPECT = 1206 / 2622;

export interface GalleryEntry {
  id: string;
  kind: 'image' | 'video';
  /** The state it shows, as the Mac labelled it. */
  label: string;
  /** Where it came from, or null for a recording of the running app. */
  source: string | null;
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

/** A recorded phone screen's top safe area over its width: 62 of 402 points on the iPhone the demos are filmed on. */
export const PHONE_TOP_SHARE = 62 / 402;

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

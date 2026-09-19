/**
 * The ship kit screen's rules (docs/ship-kit.md), pure: what the kit holds, what is picked, what one
 * Share sends, what the request button says. No React Native, so `bun test` holds every word.
 *
 * ONE SHARE, EVERYTHING PICKED. A post is a video and a few screenshots and the words, and the
 * owner asked for "one click share of demo and/or screenshots (user-selection) to any platform".
 * So the screen keeps one selection (a format's video, on or off, and any stills), one platform's
 * caption (editable), and `sharePayload` turns it into the files and the text the native sheet
 * gets. Picking a platform picks the format that platform shows best (spec `platform_format`),
 * once; a format the person chose by hand is not taken back.
 *
 * NOTHING IS SAID THE SERVER DID NOT SAY. A request's status is read from the server's row, and
 * a failure's words are the spec's sentence for its code (`SHIPKIT_REFUSALS`), the same words the
 * Mac printed; a code this build does not know says nothing rather than a debug string.
 */
import { FORMATS } from '../generated/devices';
import { PLATFORM_FORMAT, PLATFORM_LIMITS, SHIPKIT_ENUMS, SHIPKIT_REFUSALS, type KitCaption, type KitFormat, type Platform } from '../generated/shipkit';
import type { DemoRequestRow, KitFileRow, ShipKitResponse } from './types';

export const PLATFORMS = SHIPKIT_ENUMS.platform as readonly Platform[];

/** How each platform is named on the screen. */
export const PLATFORM_NAMES: Readonly<Record<Platform, string>> = {
  x: 'X',
  linkedin: 'LinkedIn',
  threads: 'Threads',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  bluesky: 'Bluesky',
};

// ------------------------------------------------------------------ the kit

export interface FormatTab {
  id: KitFormat;
  /** "9:16" */
  label: string;
  /** Width over height of the canvas, from the device table (spec/devices.v1.json). */
  aspect: number;
  /** What it is for: "Reels, TikTok, YouTube Shorts, Stories". */
  for: string;
  video: KitFileRow | null;
}

export interface KitView {
  tabs: FormatTab[];
  stills: KitFileRow[];
  framed: KitFileRow[];
  beforeAfter: KitFileRow[];
  loop: KitFileRow | null;
  appStore: KitFileRow[];
  captions: Partial<Record<Platform, KitCaption>>;
  changelog: string[];
  /** What the Mac could not make, each as its sentence. */
  refused: string[];
  published: string;
}

const bySlot = (files: readonly KitFileRow[], slot: string) => files.filter((f) => f.slot === slot).sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1));

/** The kit as the screen lays it out: a tab per format of the device table, in its order. */
export function kitView(kit: ShipKitResponse): KitView {
  const files = kit.files.filter((f) => typeof f.url === 'string' && f.url.length > 0);
  const captions: Partial<Record<Platform, KitCaption>> = {};
  for (const c of kit.document.captions ?? []) if ((PLATFORMS as readonly string[]).includes(c.platform)) captions[c.platform] = c;
  return {
    tabs: FORMATS.map((f) => ({
      id: f.id as KitFormat,
      label: f.label,
      aspect: f.size[0] / f.size[1],
      for: f.for,
      video: bySlot(files, `video_${f.id}`)[0] ?? null,
    })),
    stills: bySlot(files, 'still'),
    framed: bySlot(files, 'framed_still'),
    beforeAfter: bySlot(files, 'before_after'),
    loop: bySlot(files, 'loop')[0] ?? null,
    appStore: [...bySlot(files, 'app_store_iphone'), ...bySlot(files, 'app_store_ipad')],
    captions,
    changelog: kit.document.changelog ?? [],
    refused: (kit.document.refused ?? []).map((r) => SHIPKIT_REFUSALS[r.code as keyof typeof SHIPKIT_REFUSALS]).filter((s): s is string => typeof s === 'string'),
    published: kit.published_at,
  };
}

// ------------------------------------------------------------------ the selection

export interface Selection {
  format: KitFormat;
  /** Whether the format's video goes with the share. */
  video: boolean;
  /** File ids of the stills picked (any of stills, framed, before and after, the loop). */
  picked: readonly string[];
  platform: Platform;
  /** Captions as the person edited them; a platform not here is the kit's own. */
  edits: Partial<Record<Platform, string>>;
  /** The person chose a format by hand: a platform's pick no longer moves it. */
  formatByHand: boolean;
}

export type SelectionAction =
  | { type: 'format'; format: KitFormat }
  | { type: 'video'; on: boolean }
  | { type: 'toggle'; id: string }
  | { type: 'platform'; platform: Platform }
  | { type: 'edit'; platform: Platform; text: string }
  | { type: 'revert'; platform: Platform };

/** Where the screen opens: the first platform with a caption, its best format, its video on. */
export function initialSelection(view: KitView | null): Selection {
  const platform = PLATFORMS.find((p) => view?.captions[p]) ?? 'x';
  const want = PLATFORM_FORMAT[platform];
  const format = view?.tabs.find((t) => t.id === want && t.video)?.id ?? view?.tabs.find((t) => t.video)?.id ?? want;
  return { format, video: Boolean(view?.tabs.some((t) => t.video)), picked: [], platform, edits: {}, formatByHand: false };
}

export function selectionReducer(s: Selection, a: SelectionAction): Selection {
  switch (a.type) {
    case 'format':
      return { ...s, format: a.format, formatByHand: true };
    case 'video':
      return { ...s, video: a.on };
    case 'toggle':
      return { ...s, picked: s.picked.includes(a.id) ? s.picked.filter((x) => x !== a.id) : [...s.picked, a.id] };
    case 'platform':
      return { ...s, platform: a.platform, format: s.formatByHand ? s.format : PLATFORM_FORMAT[a.platform] };
    case 'edit':
      return { ...s, edits: { ...s.edits, [a.platform]: a.text } };
    case 'revert': {
      const edits = { ...s.edits };
      delete edits[a.platform];
      return { ...s, edits };
    }
  }
}

/** The caption shown for a platform: the person's edit, else the kit's, else nothing. */
export function captionFor(view: KitView, s: Selection, platform: Platform = s.platform): string {
  return s.edits[platform] ?? view.captions[platform]?.text ?? '';
}

/** "212 of 280", and whether it is over the platform's limit (spec `platform_limits`). */
export function captionCount(text: string, platform: Platform): { words: string; over: boolean } {
  const limit = PLATFORM_LIMITS[platform];
  const n = [...text].length;
  return { words: `${n} of ${limit}`, over: n > limit };
}

/** The thread variant, X only: each post numbered the way it would be pasted. */
export function threadFor(view: KitView, platform: Platform): string[] {
  return platform === 'x' ? view.captions.x?.thread ?? [] : [];
}

// ------------------------------------------------------------------ one share

export interface ShareFile {
  id: string;
  url: string;
  contentType: KitFileRow['content_type'];
  /** The name the file goes by in the share sheet and on the other side. */
  name: string;
}

export interface SharePayload {
  files: ShareFile[];
  text: string;
  /** What the button says: "Share the 9:16 video and 2 stills". */
  label: string;
}

const EXT: Readonly<Record<KitFileRow['content_type'], string>> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'video/mp4': 'mp4' };

/** A file's name on the other side: what it is, never an id or a path (pure). */
export function fileName(f: KitFileRow, format?: KitFormat): string {
  const n = String(f.position).padStart(2, '0');
  const stem =
    f.slot.startsWith('video_') ? `demo-${format ?? f.slot.slice(6)}` : f.slot === 'loop' ? 'demo-loop' : f.slot === 'framed_still' ? `screen-${n}-framed` : f.slot === 'before_after' ? `before-after-${n}` : f.slot.startsWith('app_store') ? `app-store-${n}` : `screen-${n}`;
  return `${stem}.${EXT[f.content_type]}`;
}

function counted(n: number, one: string): string {
  return `${n} ${one}${n === 1 ? '' : 's'}`;
}

/**
 * What one Share sends: the picked format's video when it is on, every picked still in the order
 * the screen shows them, and the platform's caption. Null when nothing is picked (the button is
 * off and says so), never an empty sheet.
 */
export function sharePayload(view: KitView, s: Selection): SharePayload | null {
  const files: ShareFile[] = [];
  const tab = view.tabs.find((t) => t.id === s.format) ?? null;
  if (s.video && tab?.video) files.push({ id: tab.video.id, url: tab.video.url, contentType: 'video/mp4', name: fileName(tab.video, tab.id) });
  const order = [...view.stills, ...view.framed, ...view.beforeAfter, ...(view.loop ? [view.loop] : []), ...view.appStore];
  for (const f of order) if (s.picked.includes(f.id)) files.push({ id: f.id, url: f.url, contentType: f.content_type, name: fileName(f) });
  if (!files.length) return null;
  const video = files.some((f) => f.contentType === 'video/mp4');
  const pictures = files.length - (video ? 1 : 0);
  const what = [video ? `the ${tab?.label ?? ''} video`.replace('  ', ' ') : null, pictures ? counted(pictures, 'picture') : null].filter(Boolean).join(' and ');
  return { files, text: captionFor(view, s), label: `Share ${what}` };
}

// ------------------------------------------------------------------ asking the Mac

export type RequestView =
  | { kind: 'none'; button: string; line: string }
  | { kind: 'waiting'; button: string; line: string; cancel: string }
  | { kind: 'done'; button: string; line: string }
  | { kind: 'failed'; button: string; line: string };

/**
 * What the request button and its line say, from the newest request the server holds for the
 * project (the list is newest first). The Mac films one demo at a time, so waiting is said as
 * waiting, never as a spinner with no words.
 */
export function requestView(requests: readonly DemoRequestRow[] | null, hasKit: boolean): RequestView {
  const latest = requests?.[0] ?? null;
  const again = hasKit ? 'Make a new demo' : 'Request a demo';
  if (!latest || latest.status === 'cancelled') {
    return { kind: 'none', button: again, line: hasKit ? 'Your Mac films the app again and makes a new kit.' : 'Your Mac runs the app, films it, and makes the kit. It keeps everything until you publish.' };
  }
  if (latest.status === 'queued') return { kind: 'waiting', button: 'Asked', line: 'Waiting for your Mac to pick it up. It films one demo at a time.', cancel: 'Take it back' };
  if (latest.status === 'claimed') return { kind: 'waiting', button: 'Filming', line: 'Your Mac is filming it now.', cancel: 'Take it back' };
  if (latest.status === 'done') return { kind: 'done', button: again, line: hasKit ? 'The last demo is done.' : 'The demo is made on your Mac. Publish its kit there to see it here.' };
  const why = latest.refusal ? SHIPKIT_REFUSALS[latest.refusal] : undefined;
  return { kind: 'failed', button: 'Try again', line: why ? `It did not work: ${why}.` : 'It did not work on your Mac.' };
}

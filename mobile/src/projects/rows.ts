/**
 * The Projects tab as a list: what each row shows (docs/trailers.md, "The Projects tab"). PURE, so
 * `__tests__/projectRows.test.ts` holds it.
 *
 * The owner, 2026-09-28: "it should be focused on projects ... one project per row with actual
 * visuals ... I don't want to have to click anything to see it. It should just be a list of
 * projects." So every row carries its project's picture where the eye lands first, playing, and
 * the words are one line under it. The stage shows the best thing the project has, in this order:
 *
 *   1. its trailer (the kit's `trailer_landscape`): the film cut for it, made for a wide frame
 *   2. its kit's 16:9 video (`video_landscape`): the demo in its device, on its band
 *   3. its demo's stills, laid on its band as prints
 *   4. nothing yet: its ink, moving, stirrable, and the words for how a demo gets made
 *
 * and says which (`from`), because a picture of a repository's README is not the app running (the
 * prints already say "from the repo" on their edge; the stage keeps that rule).
 *
 * "Nothing yet" is only said when the server said so: a project whose kit and demo the phone has
 * not heard about yet shows its hue's plain ground, never the empty state, which would flash on
 * every launch before the answers arrive.
 */
import type { GalleryEntry } from '../demos/model';
import type { KitFileRow, ShipKitResponse } from '../shipkit/types';
import type { WeeklySeries } from './model';

export type StageFrom = 'trailer' | 'kit' | 'demo';

export type StageVisual =
  | { kind: 'unknown' }
  | { kind: 'none' }
  | { kind: 'video'; from: StageFrom; id: string; url: string; posterId: string | null; width: number; height: number }
  | { kind: 'prints'; prints: readonly GalleryEntry[] };

/** The kit as the tab holds it: not heard, heard with none, or the kit. */
export type KitSeen = { kind: 'unknown' } | { kind: 'none' } | { kind: 'ready'; kit: ShipKitResponse };

/** The demo's preview prints as the tab holds them: undefined until heard. */
export type PrintsSeen = readonly GalleryEntry[] | undefined;

function first(files: readonly KitFileRow[], slot: string): KitFileRow | undefined {
  return files.filter((f) => f.slot === slot).sort((a, b) => a.position - b.position)[0];
}

/** What a row's stage shows (see the module doc for the order). */
export function stageVisual(kit: KitSeen, prints: PrintsSeen): StageVisual {
  if (kit.kind === 'ready') {
    const files = kit.kit.files;
    const trailer = first(files, 'trailer_landscape');
    if (trailer) return { kind: 'video', from: 'trailer', id: trailer.id, url: trailer.url, posterId: null, width: trailer.width, height: trailer.height };
    const landscape = first(files, 'video_landscape');
    if (landscape) return { kind: 'video', from: 'kit', id: landscape.id, url: landscape.url, posterId: null, width: landscape.width, height: landscape.height };
  }
  if (prints && prints.length) return { kind: 'prints', prints };
  if (kit.kind === 'unknown' || prints === undefined) return { kind: 'unknown' };
  return { kind: 'none' };
}

/**
 * A row's weeks as pixel columns: each week's hours with you there as a count of cells, 0 to
 * `tall`, against the row's own busiest week (a row compares a project with itself; the rivers
 * chapter compares projects). A week with any time at all gets at least one cell, so a quiet week
 * with work in it never reads as nothing.
 */
export function weekCells(series: WeeklySeries | undefined, tall = 6): number[] {
  if (!series || !series.attended.length) return [];
  const most = Math.max(...series.attended);
  if (most <= 0) return series.attended.map(() => 0);
  return series.attended.map((s) => (s <= 0 ? 0 : Math.max(1, Math.round((s / most) * tall))));
}

/** The row's one line under its name: its stage and when it was last built, joined by the middle dot. */
export function rowMeta(stage: string | null, last: string | null): string {
  return [stage, last].filter((x): x is string => Boolean(x && x.trim())).join(' · ');
}

/** What VoiceOver hears for a row's stage. */
export function stageLabel(name: string, v: StageVisual): string {
  switch (v.kind) {
    case 'video':
      return v.from === 'trailer' ? `${name}, its trailer, playing` : `${name}, its demo, playing`;
    case 'prints':
      return `${name}, ${v.prints.length === 1 ? 'one screen' : `${v.prints.length} screens`} of its demo`;
    case 'none':
      return `${name} has no demo yet`;
    default:
      return name;
  }
}

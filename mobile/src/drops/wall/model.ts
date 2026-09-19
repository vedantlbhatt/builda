/**
 * The wall's shape: which drops go in which band, in what order. PURE, so
 * `__tests__/dropsWall.test.ts` holds it.
 *
 * WHY BANDS BY WHAT HAPPENS NEXT, not by topic (docs/motion.md, "Drops: seen, built, shown"). The
 * web and the piles before it grouped drops by what they were ABOUT, which answered a question
 * nobody opening this tab is asking. What you want to know is what is waiting on you, what is
 * being built, and what came of the reels you sent. A drop's life is seen, picked, built, shown,
 * and the wall is that life read top to bottom:
 *
 *   building   a move is queued or running on your Mac right now. First, because it is live.
 *   pick       read, with moves offered and none started: waiting on your thumb.
 *   built      a move finished: the reel that started it beside what you made of it.
 *   reading    shared, and the Mac has not answered yet.
 *   kept       everything else: refused, passed on, a recipe you filed, done with.
 *
 * A drop sits in exactly one band: the first of these it qualifies for.
 */
import type { SessionDetail } from '../../data/api';
import { MOVE_VERB } from '../copy';
import type { DropRow, MoveRow } from '../types';

export type Band = 'building' | 'pick' | 'built' | 'reading' | 'kept';

export const BAND_ORDER: readonly Band[] = ['building', 'pick', 'built', 'reading', 'kept'];

export interface WallDrop {
  drop: DropRow;
  moves: MoveRow[];
  band: Band;
  /** The move a Start on the poster would start: the planner's first offered one. */
  lead: MoveRow | null;
  /** The move that is running or finished, for the building and built bands. */
  active: MoveRow | null;
}

export interface Wall {
  bands: Record<Band, WallDrop[]>;
  /** Every drop on the wall, newest first, for the grid and for search. */
  all: WallDrop[];
  counts: { pick: number; building: number; built: number; reading: number };
}

function byNewest(a: { created_at: string }, b: { created_at: string }): number {
  return Date.parse(b.created_at) - Date.parse(a.created_at);
}

export function bandOf(drop: DropRow, moves: readonly MoveRow[]): Band {
  if (moves.some((m) => m.status === 'queued' || m.status === 'running')) return 'building';
  if (drop.status === 'waiting' || drop.status === 'resolving') return 'reading';
  // A move that produced something is the payoff; a `keep` or a `card` that "finished" made
  // nothing to show beside the reel, so it does not earn the built band.
  if (moves.some((m) => m.status === 'done' && m.move_kind !== 'keep' && m.move_kind !== 'card')) return 'built';
  if (drop.status === 'planned' && moves.some((m) => m.status === 'offered')) return 'pick';
  return 'kept';
}

export function wallOf(drops: readonly DropRow[], moves: readonly MoveRow[]): Wall {
  const bands: Record<Band, WallDrop[]> = { building: [], pick: [], built: [], reading: [], kept: [] };
  const all: WallDrop[] = [];
  const byDrop = new Map<string, MoveRow[]>();
  for (const m of moves) {
    const list = byDrop.get(m.drop_id) ?? [];
    list.push(m);
    byDrop.set(m.drop_id, list);
  }
  for (const d of [...drops].sort(byNewest)) {
    if (d.archived_at) continue;
    const mine = (byDrop.get(d.id) ?? []).sort((a, b) => a.position - b.position);
    const band = bandOf(d, mine);
    const lead = mine.find((m) => m.status === 'offered') ?? null;
    const active =
      mine.find((m) => m.status === 'running') ??
      mine.find((m) => m.status === 'queued') ??
      mine.find((m) => m.status === 'done' && m.move_kind !== 'keep' && m.move_kind !== 'card') ??
      null;
    const w: WallDrop = { drop: d, moves: mine, band, lead, active };
    bands[band].push(w);
    all.push(w);
  }
  return {
    bands,
    all,
    counts: {
      pick: bands.pick.length,
      building: bands.building.length,
      built: bands.built.length,
      reading: bands.reading.length,
    },
  };
}

/**
 * The line under the title, in words, never as a row of numbers with labels: "2 to pick, 1 being
 * built". Nothing is said about a band that is empty, and an empty wall says nothing at all.
 */
export function wallLine(c: Wall['counts']): string {
  const parts: string[] = [];
  if (c.building) parts.push(`${c.building} being built`);
  if (c.pick) parts.push(`${c.pick} to pick`);
  if (c.reading) parts.push(`${c.reading} being read`);
  if (c.built) parts.push(`${c.built} built`);
  return parts.join(', ');
}

/**
 * Whether a move can start from the poster with one tap. A move whose target is one of your repos
 * needs the repo picked first, and a keep does nothing worth a button: both open the drop instead.
 */
export function startsFromPoster(m: MoveRow | null): boolean {
  if (!m) return false;
  return m.target !== 'existing_repo' && m.move_kind !== 'keep';
}

/** A button inside a card, offered to VoiceOver as one of the card's actions. */
export interface CardAction {
  name: 'start' | 'session' | 'film' | 'share';
  label: string;
}

/**
 * A card is ONE element to VoiceOver, so a screen of them is not five stops a card, and the buttons
 * inside it are its actions (swipe up or down, then double tap). FOUND IN REVIEW (2026-09-19): the
 * card's own label swallowed its children, and a VoiceOver user could open a drop but never start
 * its move, open the session, film it or share it from the wall.
 */
export function pickActions(lead: MoveRow | null): CardAction[] {
  if (!lead) return [];
  return [{ name: 'start', label: startsFromPoster(lead) ? `${MOVE_VERB[lead.move_kind]}: ${lead.title}` : 'Choose a repo' }];
}

/**
 * The props that give a card its VoiceOver actions. On React Native's new architecture a custom
 * action is read out by its `name` and `label` is never read (`RCTViewComponentView.mm`
 * accessibilityCustomActions), so the words a person hears go in `name`; and the double tap is
 * `onAccessibilityTap`, never an `activate` action. FOUND IN REVIEW (2026-09-19): VoiceOver said
 * "start, session, film, share, activate", and the double tap still tapped the card's centre.
 */
export function cardA11y(
  actions: readonly CardAction[],
  open: () => void,
  run: Partial<Record<CardAction['name'], () => unknown>>,
): {
  accessibilityActions: { name: string }[];
  onAccessibilityAction: (e: { nativeEvent: { actionName: string } }) => void;
  onAccessibilityTap: () => void;
} {
  return {
    accessibilityActions: actions.map((a) => ({ name: a.label })),
    onAccessibilityAction: (e) => {
      const hit = actions.find((a) => a.label === e.nativeEvent.actionName);
      if (hit) run[hit.name]?.();
    },
    onAccessibilityTap: open,
  };
}

export function pairActions(has: { session: boolean; film: boolean; share: boolean }): CardAction[] {
  const out: CardAction[] = [];
  if (has.session) out.push({ name: 'session', label: 'Open the session' });
  if (has.film) out.push({ name: 'film', label: 'Film it for sharing' });
  if (has.share) out.push({ name: 'share', label: 'Share what you made of it' });
  return out;
}

/**
 * The poster's first line when the platform gave no picture (Instagram serves none): the title if
 * the Mac read one, else the host, trimmed to what fits five lines at 22 points.
 */
export function posterWords(d: DropRow): string {
  const t = (d.title ?? '').trim();
  if (t) return t.length > 90 ? `${t.slice(0, 88).trimEnd()}…` : t;
  try {
    return new URL(d.url).host.replace(/^www\./, '');
  } catch {
    return d.url;
  }
}

export interface PairFacts {
  minutes: number | null;
  commits: number | null;
  lines: number | null;
}

/**
 * What the "saw this, built this" card may say about the build: the session's attended minutes,
 * commits and agent lines, measured. A run that has not become a session yet has none of them.
 */
export function factsOf(s: Pick<SessionDetail, 'attended_seconds' | 'active_seconds' | 'stats'> | null): PairFacts {
  if (!s) return { minutes: null, commits: null, lines: null };
  const attended = s.attended_seconds ?? s.active_seconds;
  return {
    minutes: attended > 0 ? Math.round(attended / 60) : null,
    commits: s.stats?.commit_count ?? null,
    lines: s.stats?.lines_added_agent ?? null,
  };
}

/** "42 minutes, 6 commits, +551 lines", leaving out what was not measured or was zero. */
export function factsLine(f: PairFacts): string | null {
  const parts: string[] = [];
  if (f.minutes) parts.push(f.minutes >= 60 ? `${Math.floor(f.minutes / 60)}h ${f.minutes % 60}m` : `${f.minutes} minutes`);
  if (f.commits) parts.push(`${f.commits} ${f.commits === 1 ? 'commit' : 'commits'}`);
  if (f.lines) parts.push(`+${f.lines} lines`);
  return parts.length > 0 ? parts.join(', ') : null;
}

/** Minutes since a move started, as the wall says it. Null when it has not started. */
export function runningFor(m: MoveRow, nowMs: number): number | null {
  const s = Date.parse(m.started_at ?? m.queued_at ?? '');
  if (!Number.isFinite(s)) return null;
  return Math.max(0, Math.floor((nowMs - s) / 60000));
}

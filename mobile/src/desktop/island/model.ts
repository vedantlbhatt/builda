/**
 * What the desktop island says, and how big it is while it says it. Pure (no React, no clock:
 * every function takes `nowMs`), so `__tests__/desktopIsland.test.ts` holds every rule in bun.
 *
 * THE RULE (docs/motion.md, "The island is one object, everywhere"): the island carries what is
 * happening somewhere else, on your behalf, that you may need to act on before you would
 * otherwise look. On a desktop that is the same four things as on the phone: a run that needs
 * you, the crew running now, a reel being read, and the one beat when something shipped. Never
 * a streak or a total. With nothing to say the island is not there at all (on a notched Mac it is
 * the notch itself, black on black).
 *
 * The phone's in-app island (`src/island/`, being built alongside this) has the same four kinds
 * and the same priority order; when both are on one branch this file's `Activity` should become
 * that one's and only the desktop's geometry (`boxFor`) should stay here.
 *
 * Every word and number comes from the live engine's own rules through `mission.tileModel`, so
 * the island never says anything the Now tab, the Lock Screen or the widget would not.
 */
import type { SessionDetail } from '../../data/api';
import type { DropRow, MoveRow } from '../../drops/types';
import { missionOrderIds, tileModel } from '../../live/mission';
import type { Animal } from '../../pixel/animals';
import type { RepoNames } from '../../copy/repoLabel';

export type FaceState = 'working' | 'thinking' | 'reading' | 'waiting' | 'error' | 'done' | 'sleep';

export interface CrewMember {
  sessionId: string;
  repo: string;
  animal: Animal;
  state: FaceState;
  /** What it is doing now, in the live engine's words. */
  sentence: string;
  /** "12m", or the word that replaces it. */
  corner: string;
}

export type DropPhase = 'sent' | 'reading' | 'planned' | 'refused';

export type Activity =
  | { kind: 'needsYou'; id: string; sessionId: string; repo: string; animal: Animal; sentence: string; since: string | null }
  | { kind: 'crew'; id: 'crew'; members: CrewMember[] }
  | { kind: 'drop'; id: string; dropId: string; host: string; title: string | null; phase: DropPhase; moves: number; firstMove: string | null }
  | { kind: 'shipped'; id: string; sessionId: string; repo: string; animal: Animal; summary: string };

export type ActivityKind = Activity['kind'];

/**
 * Who wins when several things are true at once. A run blocked on you beats everything, because
 * every second it waits is lost work; then the one beat of something shipping, so it is seen at
 * all; then the reel you just sent (you are waiting on the answer); then the crew, the island's
 * resting state while anything runs. The phone's island uses the same order.
 */
export const PRIORITY: Record<ActivityKind, number> = { needsYou: 100, shipped: 80, drop: 60, crew: 40 };

export function lead(activities: readonly Activity[]): Activity | null {
  let best: Activity | null = null;
  for (const a of activities) if (!best || PRIORITY[a.kind] > PRIORITY[best.kind]) best = a;
  return best;
}

/** A shipped beat and a planned drop hold this long after they landed, then step aside. */
export const SHIPPED_HOLD_MS = 5 * 60_000;
export const DROP_DONE_HOLD_MS = 2 * 60_000;

/** The host a drop came from, as a person says it: "instagram.com", "youtube.com". */
export function hostOf(url: string): string {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(url.trim());
  const host = (m?.[1] ?? '').toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  return host || 'a link';
}

export function dropPhase(d: Pick<DropRow, 'status'>): DropPhase {
  if (d.status === 'waiting') return 'sent';
  if (d.status === 'resolving') return 'reading';
  if (d.status === 'refused') return 'refused';
  return 'planned';
}

/** The wheel for a drop being read: the three steps and where it is. */
export function dropSteps(a: Extract<Activity, { kind: 'drop' }>): { rows: string[]; index: number } {
  const done = a.phase === 'refused' ? 'Nothing to do with this one' : a.moves === 1 ? '1 move ready' : `${a.moves} moves ready`;
  const rows = ['Sent to your Mac', `Reading ${a.host}`, done];
  return { rows, index: a.phase === 'sent' ? 0 : a.phase === 'reading' ? 1 : 2 };
}

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

export interface IslandInputs {
  live: readonly SessionDetail[];
  /** The live rows' creatures (`live/crew.crewFor`). */
  crew: ReadonlyMap<string, Animal>;
  drops: readonly DropRow[];
  moves: readonly MoveRow[];
  names: RepoNames | null;
  /** Sessions this window saw leave the live list, and when (for the shipped beat). */
  finished: readonly { session: SessionDetail; atMs: number }[];
  nowMs: number;
}

/** Everything true right now, before `lead` picks one. */
export function activitiesOf(i: IslandInputs): Activity[] {
  const out: Activity[] = [];
  const order = missionOrderIds(i.live, i.nowMs);
  const byId = new Map(i.live.map((s) => [s.id, s]));
  const members: CrewMember[] = [];
  let waiting: Activity | null = null;
  for (const id of order) {
    const s = byId.get(id);
    if (!s) continue;
    const t = tileModel(s, i.nowMs, i.names);
    if (t.stale) continue;
    const animal = i.crew.get(id) ?? 'cat';
    if (t.kind === 'finished') continue;
    const state: FaceState = t.kind === 'needsYou' ? 'waiting' : t.kind === 'stalled' ? 'sleep' : t.verdict === 'lost' || t.verdict === 'circling' ? 'thinking' : 'working';
    members.push({ sessionId: id, repo: t.repo, animal, state, sentence: t.sentence, corner: t.corner.text });
    if (t.kind === 'needsYou' && !waiting) {
      waiting = { kind: 'needsYou', id: `needs:${id}`, sessionId: id, repo: t.repo, animal, sentence: t.sentence, since: t.eta };
    }
  }
  if (waiting) out.push(waiting);
  if (members.length) out.push({ kind: 'crew', id: 'crew', members });

  for (const f of i.finished) {
    if (i.nowMs - f.atMs > SHIPPED_HOLD_MS) continue;
    const t = tileModel(f.session, i.nowMs, i.names);
    out.push({
      kind: 'shipped',
      id: `shipped:${f.session.id}`,
      sessionId: f.session.id,
      repo: t.repo,
      animal: i.crew.get(f.session.id) ?? 'cat',
      summary: t.sentence,
    });
    break;
  }

  // The newest drop still being read, or planned in the last two minutes.
  const recent = [...i.drops].sort((a, b) => (ms(b.created_at) ?? 0) - (ms(a.created_at) ?? 0));
  for (const d of recent) {
    const phase = dropPhase(d);
    const landed = ms(d.resolved_at) ?? ms(d.created_at) ?? 0;
    const fresh = phase === 'sent' || phase === 'reading' || i.nowMs - landed <= DROP_DONE_HOLD_MS;
    if (!fresh || d.archived_at) continue;
    const offered = i.moves.filter((m) => m.drop_id === d.id && m.status === 'offered').sort((a, b) => a.position - b.position);
    out.push({
      kind: 'drop',
      id: `drop:${d.id}:${phase}`,
      dropId: d.id,
      host: hostOf(d.url),
      title: d.title,
      phase,
      moves: offered.length,
      firstMove: offered[0]?.title ?? null,
    });
    break;
  }
  return out;
}

// ------------------------------------------------------------------ geometry

export type Mode = 'hidden' | 'compact' | 'expanded';

export interface IslandBox {
  w: number;
  h: number;
  r: number;
}

/** A notched Mac's notch, in points; null on every other screen. */
export interface Notch {
  width: number;
  height: number;
}

/** How far each ear reaches past a notch (the phone's island uses the same 38). */
export const EAR = 38;
/** Where there is no notch the compact pill has room for words in its middle. */
export const PILL = { w: 280, h: 36 } as const;
/** Expanded: the kit's task panel, 420 wide. Height grows with what is in it. */
export const EXPANDED_W = 420;

/**
 * The box for a mode. `hidden` is the notch exactly (black on black, so a morph out of it starts
 * from the real thing) or nothing at all. Top edge fixed, centred, so everything grows DOWN and
 * OUT of the notch or the top of the screen.
 */
export function boxFor(mode: Mode, notch: Notch | null, expandedH: number): IslandBox {
  if (mode === 'hidden') return notch ? { w: notch.width, h: notch.height, r: notch.height / 2 } : { w: 0, h: 0, r: 0 };
  if (mode === 'compact') {
    if (notch) return { w: notch.width + EAR * 2, h: notch.height, r: notch.height / 2 };
    return { w: PILL.w, h: PILL.h, r: PILL.h / 2 };
  }
  return { w: EXPANDED_W, h: expandedH, r: 30 };
}

/** The expanded height each kind needs: a header row, then its body. */
export function expandedHeight(a: Activity | null, notch: Notch | null): number {
  const top = notch ? notch.height : 12;
  if (!a) return top + 72;
  switch (a.kind) {
    case 'needsYou':
      return top + 118;
    case 'crew':
      return top + 44 + Math.min(a.members.length, 3) * 30 + 16;
    case 'drop':
      return top + 44 + 3 * 26 + (a.firstMove ? 30 : 0) + 12;
    case 'shipped':
      return top + 104;
  }
}

/** The crew's face: the one that needs you if any does, else the first in the engine's order. */
export function crewLeadOf(members: readonly CrewMember[]): CrewMember | null {
  return members.find((m) => m.state === 'waiting') ?? members[0] ?? null;
}

/** Whole minutes as the island says them: "now", "4m", "1h 12m". */
export function minutesLabel(msSpan: number): string {
  const m = Math.max(0, Math.floor(msSpan / 60000));
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h}h` : `${h}h ${r}m`;
}

/** Where a click on the island goes in the main window. */
export function hrefOf(a: Activity): string {
  switch (a.kind) {
    case 'needsYou':
    case 'shipped':
      return `/session/${a.sessionId}`;
    case 'crew':
      return a.members.length === 1 ? `/session/${a.members[0]!.sessionId}` : '/now';
    case 'drop':
      return `/drop/${a.dropId}`;
  }
}

/** What a screen reader says for the island: one element, because it is one object. */
export function spoken(a: Activity | null): string {
  if (!a) return '';
  switch (a.kind) {
    case 'needsYou':
      return `${a.repo} is waiting on you${a.since ? `, ${a.since}` : ''}. ${a.sentence}`;
    case 'crew':
      return a.members.length === 1 ? `${a.members[0]!.repo} is running. ${a.members[0]!.sentence}` : `${a.members.length} sessions running`;
    case 'drop': {
      const s = dropSteps(a);
      return s.rows[s.index]!;
    }
    case 'shipped':
      return `${a.repo} shipped. ${a.summary}`;
  }
}

/** The system notification a transition earns, or null: only needs you and shipped are news. */
export function notificationFor(prev: Activity | null, next: Activity | null): { title: string; body: string; url: string } | null {
  if (!next || (prev && prev.id === next.id)) return null;
  if (next.kind === 'needsYou') return { title: `${next.repo} needs you`, body: next.sentence, url: `builder://session/${next.sessionId}` };
  if (next.kind === 'shipped') return { title: `${next.repo} shipped`, body: next.summary, url: `builder://session/${next.sessionId}` };
  return null;
}

// ------------------------------------------------------------------ samples

export type SampleKind = 'needsYou' | 'crew' | 'drop' | 'shipped' | 'idle';

/** Fixed activities for the screenshot harness (`/island?sample=crew`). Not real sessions. */
export function sampleActivity(kind: SampleKind): Activity | null {
  switch (kind) {
    case 'needsYou':
      return {
        kind: 'needsYou',
        id: 'sample:needs',
        sessionId: 'sample',
        repo: 'tramline (sample)',
        animal: 'fox',
        sentence: 'Waiting on you to approve a database migration',
        since: 'waiting since 9:41',
      };
    case 'crew':
      return {
        kind: 'crew',
        id: 'crew',
        members: [
          { sessionId: 'sample', repo: 'tramline (sample)', animal: 'dog', state: 'working', sentence: 'Running the test suite, 41 of 58 passing', corner: '23m' },
          { sessionId: 'sample-2', repo: 'notes-app (sample)', animal: 'octopus', state: 'thinking', sentence: 'Reading the router before changing it', corner: '8m' },
          { sessionId: 'sample-3', repo: 'site (sample)', animal: 'whale', state: 'working', sentence: 'Writing the pricing page', corner: '2m' },
        ],
      };
    case 'drop':
      return { kind: 'drop', id: 'sample:drop', dropId: 'sample', host: 'instagram.com', title: 'Menu bar app for clipboard errors', phase: 'reading', moves: 0, firstMove: null };
    case 'shipped':
      return {
        kind: 'shipped',
        id: 'sample:shipped',
        sessionId: 'sample',
        repo: 'tramline (sample)',
        animal: 'bee',
        summary: 'Live vehicle positions are on the guidance map, 7 commits',
      };
    case 'idle':
      return null;
  }
}

export function isSampleKind(v: unknown): v is SampleKind {
  return v === 'needsYou' || v === 'crew' || v === 'drop' || v === 'shipped' || v === 'idle';
}

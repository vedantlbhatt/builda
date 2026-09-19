/**
 * Where the island's news comes from. Each function turns something the app already knows into
 * an activity and posts it; none of them fetch anything the app was not already fetching, except
 * `trackDrop`, which watches the one reel you just shared until the Mac has read it.
 */
import type { SessionDetail } from '../data/api';
import { api } from '../data/client';
import type { RepoNames } from '../copy/repoLabel';
import { tileModel } from '../live/mission';
import { crewFor } from '../live/crew';
import type { FaceState } from '../motion/states';
import { DEFAULT_ANIMAL, type Animal } from '../pixel/animals';
import { creatureHue, dropHue } from '../theme';
import { DROP_DONE_HOLD_MS, type Activity, type CrewMember } from './model';
import { island } from './store';

export const FACE_FOR_TILE: Record<'needsYou' | 'working' | 'stalled' | 'finished', FaceState> = {
  needsYou: 'waiting',
  working: 'working',
  // Not updating: the run may be thinking or the Mac may be asleep. Violet, the thinking colour,
  // because red would claim a failure nothing measured.
  stalled: 'thinking',
  finished: 'done',
};

/**
 * The crew and the runs waiting on you, from the live rows. Called by the root poll
 * (`useLiveSurfaces`) with the same rows the Lock Screen gets, so the island inside the app and
 * the system island outside it can never disagree.
 */
export function publishLive(rows: readonly SessionDetail[], nowMs: number, names?: RepoNames | null): void {
  const creatures = crewFor(rows);
  const members: CrewMember[] = [];
  const waiting: Activity[] = [];
  for (const s of rows) {
    const t = tileModel(s, nowMs, names);
    if (t.kind === 'finished') continue;
    const animal: Animal = creatures.get(s.id) ?? DEFAULT_ANIMAL;
    const ink = creatureHue(animal).ink;
    const state = FACE_FOR_TILE[t.kind];
    const started = Date.parse(s.started_at);
    const m: CrewMember = {
      sessionId: s.id,
      repo: t.repo,
      animal,
      ink,
      state,
      sentence: t.sentence,
      startedMs: Number.isFinite(started) ? started : null,
    };
    members.push(m);
    if (t.kind === 'needsYou') {
      const since = Date.parse(s.live_state?.computed_at ?? s.updated_at ?? s.started_at);
      waiting.push({
        kind: 'needsYou',
        id: `wait:${s.id}`,
        sessionId: s.id,
        repo: t.repo,
        animal,
        ink,
        sentence: t.sentence,
        sinceMs: Number.isFinite(since) ? since : nowMs,
      });
    }
  }
  island.replaceKind('crew', members.length > 0 ? [{ kind: 'crew', id: 'crew', members }] : []);
  island.replaceKind('needsYou', waiting);
}

/**
 * One beat when a session you were running ends. Said once per session for the life of the app,
 * and only for a session that did something: a sitting with no lines and no commits ended, it
 * did not ship, and a green beat over it would be the plausible wrong word this codebase refuses.
 */
export function announceFinished(s: SessionDetail, animal: Animal, names?: RepoNames | null): void {
  const commits = s.stats?.commit_count ?? 0;
  const lines = s.stats?.lines_added_agent ?? 0;
  if (commits === 0 && lines === 0) return;
  const repo = tileModel(s, Date.now(), names).repo;
  const minutes = Math.round((s.active_seconds ?? 0) / 60);
  const parts = [repo, minutes > 0 ? `${minutes}m` : null, commits > 0 ? `${commits} ${commits === 1 ? 'commit' : 'commits'}` : `+${lines} lines`].filter(Boolean);
  island.once({
    kind: 'shipped',
    id: `shipped:${s.id}`,
    sessionId: s.id,
    repo,
    animal,
    ink: creatureHue(animal).ink,
    summary: parts.join(' · '),
  });
}

/** A short word from the app itself: a move started, a link copied. */
export function notice(text: string, state: FaceState, animal: Animal, ink: string): void {
  island.post({ kind: 'notice', id: `notice:${Date.now()}`, text, state, animal, ink });
}

const tracking = new Set<string>();
/** Poll cadence while a drop is being read: fast enough to feel live, slow enough to be cheap. */
export const TRACK_EVERY_MS = 3500;
/** Stop watching after this: the Mac is asleep, and the card on the board already says so. */
export const TRACK_FOR_MS = 4 * 60_000;

/**
 * Watch one drop you just shared from `sent` to its answer, on the island, so the answer lands
 * where you are rather than behind a banner that pulls you out of the app you were in.
 */
export function trackDrop(dropId: string, url: string): void {
  if (tracking.has(dropId)) return;
  tracking.add(dropId);
  let host = 'the post';
  try {
    host = new URL(url).host.replace(/^www\./, '');
  } catch {
    // A link the door accepted always parses; the fallback is only for the type checker.
  }
  const id = `drop:${dropId}`;
  const base = { kind: 'drop' as const, id, dropId, host, title: null, thumbnail: null, moves: 0, firstMove: null, hue: null };
  island.post({ ...base, phase: 'sent' }, 0);
  const started = Date.now();

  const tick = async () => {
    try {
      const { drop, moves } = await api.drop(dropId);
      const offered = moves.filter((m) => m.status === 'offered').sort((a, b) => a.position - b.position);
      const hue = drop.kind ? (dropHue(drop.kind)?.ink ?? null) : null;
      const common = { ...base, title: drop.title, thumbnail: drop.thumbnail_url, hue };
      if (drop.status === 'planned') {
        island.post({ ...common, phase: 'planned', moves: offered.length, firstMove: offered[0]?.title ?? null }, DROP_DONE_HOLD_MS);
        tracking.delete(dropId);
        return;
      }
      if (drop.status === 'refused') {
        island.post({ ...common, phase: 'refused' }, DROP_DONE_HOLD_MS);
        tracking.delete(dropId);
        return;
      }
      island.post({ ...common, phase: drop.status === 'resolving' ? 'reading' : 'sent' }, 0);
    } catch {
      // Offline for a moment: keep what the island shows and try again on the next tick.
    }
    if (Date.now() - started > TRACK_FOR_MS) {
      island.clear(id);
      tracking.delete(dropId);
      return;
    }
    setTimeout(() => void tick(), TRACK_EVERY_MS);
  };
  setTimeout(() => void tick(), 800);
}
